"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { ScrapedLead } from "@/types/platform";
import {
  getLeadDisplayLocation,
  isJunkScrapeLead,
} from "@/utils/scrape-lead-quality";
import {
  Radio, Search, MapPin, Plus, Minus, Download,
  X, CheckSquare, Square, Loader2, ExternalLink,
  Mail, Phone, Globe, Upload, FileText,
  CheckCircle2, BarChart2, Sparkles, Zap, Settings,
  Container, AlertTriangle, RefreshCw,
} from "lucide-react";
import { createClient } from "../../../supabase/client";
import { toast } from "sonner";

interface ScraperModuleProps {
  userId: string;
  onLeadsAdded?: (addedCount?: number) => void;
  onGenerateEmails?: (leads: ScrapedLead[]) => void;
  /** Jump to Settings → AI Settings (district expansion, email gen). */
  onOpenAiSettings?: () => void;
}

const NICHES = [
  "School", "Hospital", "Restaurant", "Hotel", "Bank", "NGO", "Church",
  "Gym", "Salon", "Transport", "Farm", "Shop", "SaaS", "E-Commerce",
  "Digital Marketing", "Fintech", "Health Tech", "Real Estate", "Education",
  "Legal", "Consulting", "Agency", "Manufacturing", "Retail",
];

type ScrapeSearchRow = {
  id: string;
  niche: string;
  location: string;
};

function createSearchRow(): ScrapeSearchRow {
  return { id: crypto.randomUUID(), niche: "", location: "" };
}

function getValidSearchRows(rows: ScrapeSearchRow[]): ScrapeSearchRow[] {
  return rows.filter((r) => r.niche.trim() && r.location.trim());
}

type MapsBackendMode = "puppeteer" | "docker" | "docker_unreachable";

type MapsBackendStatus = {
  mode: MapsBackendMode;
  configured: boolean;
  reachable: boolean;
  url?: string;
  maxDepth?: number;
  label: string;
  shortLabel: string;
  hint?: string;
};

function dedupeScrapedLead(prev: ScrapedLead[], lead: ScrapedLead): ScrapedLead[] {
  const email = lead.email?.trim().toLowerCase();
  if (lead.phoneOnly || !email) {
    const key = `phone|${(lead.phone ?? "").replace(/\D/g, "")}|${lead.company_name}`.toLowerCase();
    if (prev.some((p) => p.phoneOnly && `phone|${(p.phone ?? "").replace(/\D/g, "")}|${p.company_name}`.toLowerCase() === key)) {
      return prev;
    }
    return [...prev, lead];
  }
  if (email) {
    if (prev.some((p) => p.email?.trim().toLowerCase() === email)) return prev;
  } else {
    const key = `${lead.company_name}|${lead.location}`.toLowerCase();
    if (
      prev.some(
        (p) =>
          `${p.company_name}|${p.location}`.toLowerCase() === key
      )
    ) {
      return prev;
    }
  }
  return [...prev, lead];
}

type ScrapeStreamHandlers = {
  onLead?: (lead: ScrapedLead) => void;
  onStart?: (payload: Record<string, unknown>) => void;
  onChunkStart?: (payload: Record<string, unknown>) => void;
  onChunkDone?: (payload: Record<string, unknown>) => void;
  onProgress?: (payload: Record<string, unknown>) => void;
  onDone?: (payload: Record<string, unknown>) => void;
  onError?: (payload: Record<string, unknown>) => void;
};

async function consumeScrapeStream(
  res: Response,
  handlers: ScrapeStreamHandlers
): Promise<void> {
  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error || "Scraping failed. Please try again."
    );
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      const eventLine = part.match(/^event:\s*(.+)/m);
      const dataLine = part.match(/^data:\s*(.+)/m);
      if (!eventLine || !dataLine) continue;

      const event = eventLine[1].trim();
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(dataLine[1]);
      } catch {
        continue;
      }

      switch (event) {
        case "start":
          handlers.onStart?.(payload);
          break;
        case "lead":
          if (payload.lead) handlers.onLead?.(payload.lead as ScrapedLead);
          break;
        case "chunk_start":
          handlers.onChunkStart?.(payload);
          break;
        case "chunk_done":
          handlers.onChunkDone?.(payload);
          break;
        case "progress":
          handlers.onProgress?.(payload);
          break;
        case "done":
          handlers.onDone?.(payload);
          break;
        case "error":
          handlers.onError?.(payload);
          break;
      }
    }
  }
}

export default function ScraperModule({
  userId,
  onLeadsAdded,
  onGenerateEmails,
  onOpenAiSettings,
}: ScraperModuleProps) {
  const [searchRows, setSearchRows] = useState<ScrapeSearchRow[]>([createSearchRow()]);
  const [suggestionRowId, setSuggestionRowId] = useState<string | null>(null);
  const [nicheSuggestions, setNicheSuggestions] = useState<string[]>([]);
  const [maxResults, setMaxResults] = useState(100);
  const [multiQueryProgress, setMultiQueryProgress] = useState<{
    current: number;
    total: number;
    niche: string;
    location: string;
  } | null>(null);
  const [isScraping, setIsScraping] = useState(false);
  const [isScrapeAndGenerate, setIsScrapeAndGenerate] = useState(false);
  const [results, setResults] = useState<ScrapedLead[]>([]);
  const [generatedEmails, setGeneratedEmails] = useState<any[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [drawerLead, setDrawerLead] = useState<ScrapedLead | null>(null);
  const [addingToCRM, setAddingToCRM] = useState(false);

  // ── Combined pipeline state ───────────────────────────────────────────────
  const [pipelinePhase, setPipelinePhase] = useState<"idle" | "scraping" | "generating" | "done">("idle");
  const [pipelineStats, setPipelineStats] = useState<{
    scraped: number; emails: number; fallbacks: number; total: number;
  }>({ scraped: 0, emails: 0, fallbacks: 0, total: 0 });

  // ── Chunk progress state ──────────────────────────────────────────────────
  const [progress, setProgress] = useState<{
    totalFound: number;
    totalFailed: number;
    remaining: number;
    currentChunk: number;
    totalChunks: number;
    percentComplete: number;
  } | null>(null);
  const [scrapeSummary, setScrapeSummary] = useState<{
    withEmail: number;
    phoneOnly: number;
    crmAdded: number;
    callListAdded: number;
    researched: number;
    realEmails: number;
  } | null>(null);
  const [chunkLog, setChunkLog] = useState<Array<{
    id: string;
    chunk: number;
    searchIndex: number;
    leads: number;
    status: "done" | "running" | "empty";
  }>>([]);

  // ── CSV import state ──────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<"scraper" | "csv">("scraper");
  const [mapsBackend, setMapsBackend] = useState<MapsBackendStatus | null>(null);
  const [mapsBackendLoading, setMapsBackendLoading] = useState(true);
  const [liveMapsBackend, setLiveMapsBackend] = useState<MapsBackendStatus | null>(null);

  const loadMapsBackend = useCallback(async () => {
    setMapsBackendLoading(true);
    try {
      const res = await fetch("/api/scraper/maps-backend");
      if (res.ok) {
        const data = (await res.json()) as MapsBackendStatus;
        setMapsBackend(data);
      }
    } catch {
      setMapsBackend(null);
    } finally {
      setMapsBackendLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMapsBackend();
  }, [loadMapsBackend]);
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvJob, setCsvJob] = useState<{
    jobId: string;
    totalRows: number;
    totalChunks: number;
    currentChunk: number;
    totalSaved: number;
    totalFailed: number;
    status: string;
  } | null>(null);
  const csvPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const supabase = createClient();

  const updateSearchRow = (
    id: string,
    patch: Partial<Pick<ScrapeSearchRow, "niche" | "location">>
  ) => {
    setSearchRows((rows) =>
      rows.map((r) => (r.id === id ? { ...r, ...patch } : r))
    );
  };

  const handleNicheInput = (rowId: string, val: string) => {
    updateSearchRow(rowId, { niche: val });
    setSuggestionRowId(rowId);
    setNicheSuggestions(
      val.length > 0
        ? NICHES.filter((n) => n.toLowerCase().includes(val.toLowerCase())).slice(0, 5)
        : []
    );
  };

  const addSearchRow = () => {
    setSearchRows((rows) => [...rows, createSearchRow()]);
  };

  const removeSearchRow = (id: string) => {
    setSearchRows((rows) => {
      if (rows.length <= 1) return rows;
      return rows.filter((r) => r.id !== id);
    });
    if (suggestionRowId === id) {
      setSuggestionRowId(null);
      setNicheSuggestions([]);
    }
  };

  const handleScrape = async () => {
    const queries = getValidSearchRows(searchRows);
    if (queries.length === 0) {
      toast.error("Add at least one niche and location pair");
      return;
    }

    setIsScraping(true);
    setResults([]);
    setSelected(new Set());
    setProgress(null);
    setChunkLog([]);
    setScrapeSummary(null);
    setMultiQueryProgress(null);
    setLiveMapsBackend(null);

    const totalRef = { current: 0 };
    const lastRunSummary = {
      callListAdded: 0,
    };

    try {
      for (let i = 0; i < queries.length; i++) {
        const q = queries[i];
        setMultiQueryProgress({
          current: i + 1,
          total: queries.length,
          niche: q.niche.trim(),
          location: q.location.trim(),
        });

        if (queries.length > 1) {
          toast.info(
            `Search ${i + 1}/${queries.length}: ${q.niche} in ${q.location}`
          );
        }

        const res = await fetch("/api/scrape-stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            niche: q.niche.trim(),
            location: q.location.trim(),
            maxResults,
          }),
        });

        let activeChunkLogId = "";

        await consumeScrapeStream(res, {
          onStart: (payload) => {
            const mb = payload.mapsBackend as MapsBackendStatus | undefined;
            if (mb?.mode) setLiveMapsBackend(mb);
            setProgress({
              totalFound: totalRef.current,
              totalFailed: 0,
              remaining: (payload.maxResults as number) ?? maxResults,
              currentChunk: 0,
              totalChunks: (payload.totalChunks as number) ?? 1,
              percentComplete: 0,
            });
          },
          onLead: (lead) => {
            setResults((prev) => {
              const next = dedupeScrapedLead(prev, lead);
              totalRef.current = next.length;
              return next;
            });
          },
          onChunkStart: (payload) => {
            activeChunkLogId = `search-${i}-chunk-${payload.chunk}-${Date.now()}`;
            setChunkLog((prev) => [
              ...prev,
              {
                id: activeChunkLogId,
                chunk: payload.chunk as number,
                searchIndex: i + 1,
                leads: 0,
                status: "running",
              },
            ]);
            setProgress((p) =>
              p
                ? {
                    ...p,
                    currentChunk: payload.chunk as number,
                    totalChunks:
                      (payload.totalChunks as number) ?? p.totalChunks,
                  }
                : p
            );
          },
          onChunkDone: (payload) => {
            const doneId = activeChunkLogId;
            setChunkLog((prev) =>
              prev.map((c) =>
                c.id === doneId
                  ? {
                      ...c,
                      leads: payload.chunkLeads as number,
                      status:
                        (payload.status as "done" | "running" | "empty") ??
                        ((payload.chunkLeads as number) > 0 ? "done" : "empty"),
                    }
                  : c
              )
            );
          },
          onProgress: (payload) => {
            setProgress({
              totalFound: totalRef.current,
              totalFailed: (payload.totalFailed as number) ?? 0,
              remaining: (payload.remaining as number) ?? 0,
              currentChunk: (payload.currentChunk as number) ?? 0,
              totalChunks: (payload.totalChunks as number) ?? 1,
              percentComplete: (payload.percentComplete as number) ?? 0,
            });
          },
          onDone: (payload) => {
            const sum = payload.scrapeSummary as {
              withEmail?: number;
              phoneOnly?: number;
              crmAdded?: number;
              callListAdded?: number;
              researched?: number;
              realEmails?: number;
            } | undefined;
            const callListAdded =
              sum?.callListAdded ?? (payload.crmCallListAdded as number) ?? 0;
            lastRunSummary.callListAdded = callListAdded;
            if (sum) {
              setScrapeSummary({
                withEmail: sum.withEmail ?? (payload.total as number) ?? 0,
                phoneOnly: sum.phoneOnly ?? (payload.phoneOnlyFound as number) ?? 0,
                crmAdded: sum.crmAdded ?? (payload.crmAdded as number) ?? 0,
                callListAdded,
                researched: sum.researched ?? (payload.crmResearched as number) ?? 0,
                realEmails: sum.realEmails ?? (payload.realEmails as number) ?? 0,
              });
            }
          },
          onError: (payload) => {
            throw new Error(
              (payload.message as string) || "Scraping failed."
            );
          },
        });
      }

      setProgress((p) =>
        p
          ? {
              ...p,
              totalFound: totalRef.current,
              remaining: 0,
              percentComplete: 100,
            }
          : p
      );

      if (totalRef.current === 0 && !lastRunSummary.callListAdded) {
        toast.info(
          "No leads with real emails found. Try broader niches or different locations."
        );
      } else if (queries.length > 1) {
        toast.success(
          `Found ${totalRef.current} with email${lastRunSummary.callListAdded ? ` · ${lastRunSummary.callListAdded} call list` : ""} across ${queries.length} searches`
        );
      } else {
        toast.success(
          `Found ${totalRef.current} with email${lastRunSummary.callListAdded ? ` · ${lastRunSummary.callListAdded} saved to call list (phone only)` : ""}`
        );
      }
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Scraping failed. Please try again."
      );
    } finally {
      setIsScraping(false);
      setMultiQueryProgress(null);
      setLiveMapsBackend(null);
    }
  };

  // ── Scrape + Generate pipeline ────────────────────────────────────────────
  const handleScrapeAndGenerate = async () => {
    const queries = getValidSearchRows(searchRows);
    if (queries.length === 0) {
      toast.error("Add at least one niche and location pair");
      return;
    }

    setIsScrapeAndGenerate(true);
    setResults([]);
    setGeneratedEmails([]);
    setSelected(new Set());
    setProgress(null);
    setChunkLog([]);
    setPipelinePhase("scraping");
    setMultiQueryProgress(null);
    setLiveMapsBackend(null);
    setPipelineStats({
      scraped: 0,
      emails: 0,
      fallbacks: 0,
      total: maxResults * queries.length,
    });

    const totalRef = { current: 0 };
    let totalEmails = 0;
    let totalScrapedReported = 0;

    try {
      for (let i = 0; i < queries.length; i++) {
        const q = queries[i];
        setMultiQueryProgress({
          current: i + 1,
          total: queries.length,
          niche: q.niche.trim(),
          location: q.location.trim(),
        });

        const res = await fetch("/api/scrape-and-generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            niche: q.niche.trim(),
            location: q.location.trim(),
            maxResults,
            tone: "Direct",
          }),
        });

        if (!res.ok || !res.body) {
          const err = await res.json().catch(() => ({}));
          throw new Error(
            (err as { error?: string }).error || "Pipeline failed."
          );
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";

          for (const part of parts) {
            const eventLine = part.match(/^event:\s*(.+)/m);
            const dataLine = part.match(/^data:\s*(.+)/m);
            if (!eventLine || !dataLine) continue;

            const event = eventLine[1].trim();
            let payload: Record<string, unknown>;
            try {
              payload = JSON.parse(dataLine[1]);
            } catch {
              continue;
            }

            if (event === "start" && payload.mapsBackend) {
              const mb = payload.mapsBackend as MapsBackendStatus;
              if (mb?.mode) setLiveMapsBackend(mb);
            } else if (event === "lead" && payload.lead) {
              setResults((prev) => {
                const next = dedupeScrapedLead(
                  prev,
                  payload.lead as ScrapedLead
                );
                totalRef.current = next.length;
                return next;
              });
              setPipelineStats((s) => ({
                ...s,
                scraped: totalRef.current,
              }));
            } else if (event === "scrape_done") {
              setPipelinePhase("generating");
              totalScrapedReported = (payload.total as number) ?? totalRef.current;
              toast.info(
                `Search ${i + 1}/${queries.length}: scraped ${totalScrapedReported} — generating emails…`
              );
            } else if (event === "email") {
              setGeneratedEmails((prev) => [
                ...prev,
                payload.email as Record<string, unknown>,
              ]);
              totalEmails = (payload.count as number) ?? totalEmails + 1;
              setPipelineStats((s) => ({ ...s, emails: totalEmails }));
            } else if (event === "progress") {
              if (payload.phase === "generating") {
                setPipelineStats((s) => ({
                  ...s,
                  emails: (payload.emailCount as number) ?? s.emails,
                  fallbacks: (payload.failCount as number) ?? s.fallbacks,
                }));
              }
            } else if (event === "done") {
              totalScrapedReported =
                (payload.scraped as number) ?? totalRef.current;
              totalEmails = (payload.emails as number) ?? totalEmails;
            } else if (event === "error") {
              throw new Error(
                (payload.message as string) || "Pipeline failed."
              );
            }
          }
        }
      }

      setPipelinePhase("done");
      toast.success(
        `✅ ${totalRef.current} unique leads scraped · ${totalEmails} emails generated across ${queries.length} search(es)`
      );
      onLeadsAdded?.(totalRef.current);
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Pipeline failed. Please try again."
      );
    } finally {
      setIsScrapeAndGenerate(false);
      setMultiQueryProgress(null);
      setLiveMapsBackend(null);
    }
  };

  const effectiveMapsBackend = liveMapsBackend ?? mapsBackend;
  const mapsUsesDocker = effectiveMapsBackend?.mode === "docker";

  const toggleRow = (idx: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  };

  const toggleAll = () => {
    if (results.every((_, i) => selected.has(i))) {
      setSelected(new Set());
    } else {
      setSelected(new Set(results.map((_, i) => i)));
    }
  };

  /**
   * Save leads to the `leads` table in Supabase.
   * - Skips leads with no email
   * - Skips leads whose email already exists in the database (deduplication)
   * - Stores phone, website, source so the CRM has full data
   */
  const addToCRM = async (leadsToAdd: ScrapedLead[]) => {
    const withEmail = leadsToAdd.filter((l) => l.email && l.email.trim() !== "");
    const withNoEmail = leadsToAdd.filter((l) => !l.email);

    if (withEmail.length === 0) {
      toast.info("None of the selected leads have an email address.");
      return;
    }

    setAddingToCRM(true);
    try {
      const queries = getValidSearchRows(searchRows);
      const category =
        queries.length > 0
          ? queries
              .map((q) => `${q.niche.trim()} - ${q.location.trim()}`)
              .join(" | ")
          : "Uncategorized";
      const primaryLocation = queries[0]?.location.trim() ?? "";

      const res = await fetch("/api/leads/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leads: withEmail.map((l) => ({
            company_name: l.company_name,
            email: l.email,
            phone: l.phone ?? null,
            website: l.website ?? null,
            niche: l.niche,
            location: l.location,
            business_address: l.business_address,
            source_snippet: l.source_snippet,
            company_context: l.company_context,
            emailIsReal: l.emailIsReal,
          })),
          category,
          searchLocation: primaryLocation,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add to CRM");

      if (data.added === 0) {
        toast.info(
          data.duplicates > 0
            ? `All ${withEmail.length} lead${withEmail.length !== 1 ? "s" : ""} already exist in your CRM.`
            : data.message || "No leads were added."
        );
        return;
      }

      const realAdded = withEmail.filter((l) => l.emailIsReal).length;
      let msg = `✅ ${data.added} lead${data.added !== 1 ? "s" : ""} added to CRM`;
      if (data.duplicates > 0) {
        msg += ` · ${data.duplicates} duplicate${data.duplicates !== 1 ? "s" : ""} skipped`;
      }
      if (data.junkFiltered > 0) {
        msg += ` · ${data.junkFiltered} filtered (wrong area or junk)`;
      }
      if (withNoEmail.length > 0) msg += ` · ${withNoEmail.length} skipped (no email)`;
      toast.success(msg);
      onLeadsAdded?.(data.added);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Failed to add to CRM";
      toast.error(message);
    } finally {
      setAddingToCRM(false);
    }
  };

  const exportCSV = () => {
    const rows = (selected.size > 0 ? Array.from(selected).map((i) => results[i]) : results);
    const headers = ["Company Name", "Email", "Phone", "Website", "Niche", "Location", "Context"];
    const csv = [
      headers.join(","),
      ...rows.map((l) =>
        [
          `"${l.company_name}"`,
          `"${l.email}"`,
          `"${(l as any).phone ?? ""}"`,
          `"${(l as any).website ?? ""}"`,
          `"${l.niche}"`,
          `"${l.location}"`,
          `"${(l.company_context ?? "").replace(/"/g, "'")}"`,
        ].join(",")
      ),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const queries = getValidSearchRows(searchRows);
    const slug =
      queries.length > 0
        ? queries
            .map((q) => `${q.niche}-${q.location}`)
            .join("_")
            .slice(0, 80)
        : "export";
    a.download = `leads-${slug}.csv`.replace(/\s+/g, "-").toLowerCase();
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── CSV Import ────────────────────────────────────────────────────────────
  const handleCSVImport = async (file: File) => {
    if (!file.name.endsWith(".csv")) {
      toast.error("Please upload a .csv file");
      return;
    }

    setCsvImporting(true);
    setCsvJob(null);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/csv-import", { method: "POST", body: formData });
      const data = await res.json();

      if (!data.success) {
        toast.error(data.error || "Import failed");
        setCsvImporting(false);
        return;
      }

      toast.success(`Processing ${data.totalRows} rows in ${data.totalChunks} chunks…`);
      setCsvJob({
        jobId: data.jobId,
        totalRows: data.totalRows,
        totalChunks: data.totalChunks,
        currentChunk: 0,
        totalSaved: 0,
        totalFailed: 0,
        status: "running",
      });

      // Poll job progress every 2 seconds
      if (csvPollRef.current) clearInterval(csvPollRef.current);
      csvPollRef.current = setInterval(async () => {
        const { data: job } = await supabase
          .from("scrape_jobs")
          .select("*")
          .eq("id", data.jobId)
          .single();

        if (job) {
          setCsvJob({
            jobId: job.id,
            totalRows: job.max_results,
            totalChunks: job.total_chunks,
            currentChunk: job.current_chunk,
            totalSaved: job.total_saved ?? 0,
            totalFailed: job.total_failed ?? 0,
            status: job.status,
          });

          if (job.status === "completed" || job.status === "failed") {
            clearInterval(csvPollRef.current!);
            setCsvImporting(false);
            if (job.status === "completed") {
              toast.success(`Import complete: ${job.total_saved ?? 0} leads added`);
              onLeadsAdded?.(job.total_saved ?? 0);
            } else {
              toast.error("Import failed. Check error log.");
            }
          }
        }
      }, 2000);
    } catch {
      toast.error("Import failed. Please try again.");
      setCsvImporting(false);
    }
  };

  const selectedLeads = Array.from(selected).map((i) => results[i]).filter(Boolean);
  const realCount = results.filter((l: any) => l.emailIsReal).length;
  const guessedCount = results.filter((l: any) => l.email && !l.emailIsReal).length;
  const noEmailCount = results.filter((l) => !l.email).length;
  const totalWithEmail = results.filter((l) => l.email).length;

  return (
    <div className="flex flex-col gap-5 p-5 bg-white overflow-y-auto" style={{ minHeight: '100%' }}>

      {/* ── Tab switcher ─────────────────────────────────────────────── */}
      <div className="flex gap-1 border-b border-gray-200 pb-0">
        {[
          { id: "scraper" as const, label: "Web Scraper", icon: Radio },
          { id: "csv" as const, label: "CSV Import", icon: Upload },
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors ${
              activeTab === id
                ? "bg-blue-50 text-blue-700 border border-b-0 border-blue-200"
                : "text-gray-500 hover:text-gray-800"
            }`}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {/* ── CSV Import Tab ────────────────────────────────────────────── */}
      {activeTab === "csv" && (
        <div className="flex flex-col gap-4">
          <div className="rounded-xl p-6 bg-white border border-gray-200 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <FileText size={15} className="text-blue-600" />
              <span className="text-sm font-semibold text-gray-900">Import Leads from CSV</span>
            </div>
            <p className="text-xs text-gray-500 mb-4">
              Upload a CSV with columns: <code className="bg-gray-100 px-1 rounded">company_name</code>,{" "}
              <code className="bg-gray-100 px-1 rounded">email</code>,{" "}
              <code className="bg-gray-100 px-1 rounded">phone</code>,{" "}
              <code className="bg-gray-100 px-1 rounded">website</code>,{" "}
              <code className="bg-gray-100 px-1 rounded">niche</code>,{" "}
              <code className="bg-gray-100 px-1 rounded">location</code>.
              Records are processed in chunks of 100.
            </p>

            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleCSVImport(f);
                e.target.value = "";
              }}
            />

            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={csvImporting}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {csvImporting ? (
                <><Loader2 size={14} className="animate-spin" />Importing…</>
              ) : (
                <><Upload size={14} />Choose CSV File</>
              )}
            </button>
          </div>

          {/* CSV Job Progress */}
          {csvJob && (
            <div className="rounded-xl p-5 bg-white border border-gray-200 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-semibold text-gray-900">Import Progress</span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  csvJob.status === "completed" ? "bg-green-100 text-green-700" :
                  csvJob.status === "failed" ? "bg-red-100 text-red-700" :
                  "bg-blue-100 text-blue-700"
                }`}>
                  {csvJob.status.toUpperCase()}
                </span>
              </div>

              {/* Progress bar */}
              <div className="w-full bg-gray-100 rounded-full h-2 mb-3">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-500"
                  style={{
                    width: `${csvJob.totalChunks > 0
                      ? Math.round((csvJob.currentChunk / csvJob.totalChunks) * 100)
                      : 0}%`,
                  }}
                />
              </div>

              <div className="grid grid-cols-4 gap-3">
                {[
                  { label: "Total Rows", value: csvJob.totalRows },
                  { label: "Chunk", value: `${csvJob.currentChunk}/${csvJob.totalChunks}` },
                  { label: "Saved", value: csvJob.totalSaved, color: "text-green-600" },
                  { label: "Failed", value: csvJob.totalFailed, color: "text-red-500" },
                ].map((s) => (
                  <div key={s.label} className="bg-gray-50 rounded-lg p-3 border border-gray-100 text-center">
                    <p className="text-xs text-gray-500 mb-1">{s.label}</p>
                    <p className={`text-lg font-bold ${s.color ?? "text-gray-900"}`}>{s.value}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Scraper Tab ───────────────────────────────────────────────── */}
      {activeTab === "scraper" && (
      <>

      {/* ── Search Panel ─────────────────────────────────────────────── */}
      <div className="rounded-xl p-5 bg-white border border-gray-200 shadow-sm">
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <Radio size={15} className="text-blue-600" />
          <span className="text-sm font-semibold text-gray-900">Lead Scraper</span>
          <div className="ml-auto flex items-center gap-2 flex-wrap justify-end">
            {mapsBackendLoading ? (
              <span className="text-[10px] text-gray-400 flex items-center gap-1">
                <Loader2 size={10} className="animate-spin" />
                Checking Maps backend…
              </span>
            ) : effectiveMapsBackend ? (
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${
                  effectiveMapsBackend.mode === "docker"
                    ? "bg-teal-50 border-teal-200 text-teal-800"
                    : effectiveMapsBackend.mode === "docker_unreachable"
                      ? "bg-amber-50 border-amber-200 text-amber-800"
                      : "bg-gray-50 border-gray-200 text-gray-600"
                }`}
                title={effectiveMapsBackend.hint}
              >
                {effectiveMapsBackend.mode === "docker" ? (
                  <Container size={10} />
                ) : effectiveMapsBackend.mode === "docker_unreachable" ? (
                  <AlertTriangle size={10} />
                ) : (
                  <MapPin size={10} />
                )}
                {effectiveMapsBackend.shortLabel}
              </span>
            ) : (
              <span className="text-[10px] text-gray-400">Puppeteer Maps</span>
            )}
            <button
              type="button"
              onClick={loadMapsBackend}
              disabled={mapsBackendLoading}
              className="p-1 text-gray-400 hover:text-gray-600 rounded"
              title="Refresh Maps backend status"
            >
              <RefreshCw size={11} className={mapsBackendLoading ? "animate-spin" : ""} />
            </button>
            {onOpenAiSettings && (
              <button
                type="button"
                onClick={onOpenAiSettings}
                className="flex items-center gap-1 text-[10px] font-medium text-blue-600 hover:text-blue-800"
              >
                <Settings size={11} />
                AI Settings
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3">
          {searchRows.map((row, index) => (
            <div key={row.id} className="flex flex-col sm:flex-row gap-2 items-stretch">
              <div className="relative flex-1 min-w-0">
                <Search
                  size={13}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                />
                <input
                  type="text"
                  placeholder="Niche (e.g. school, restaurant)"
                  value={row.niche}
                  onChange={(e) => handleNicheInput(row.id, e.target.value)}
                  onFocus={() => setSuggestionRowId(row.id)}
                  className="w-full pl-9 pr-3 py-2.5 rounded-lg text-sm border border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none"
                />
                {suggestionRowId === row.id && nicheSuggestions.length > 0 && (
                  <div className="absolute top-full mt-1 left-0 right-0 bg-white rounded-lg z-20 shadow-lg border border-gray-200 overflow-hidden">
                    {nicheSuggestions.map((s) => (
                      <button
                        key={s}
                        type="button"
                        className="w-full text-left px-3 py-2 text-xs hover:bg-blue-50 text-gray-700"
                        onClick={() => {
                          updateSearchRow(row.id, { niche: s });
                          setNicheSuggestions([]);
                        }}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="relative flex-1 min-w-0">
                <MapPin
                  size={13}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                />
                <input
                  type="text"
                  placeholder="Location (e.g. Kigali Rwanda)"
                  value={row.location}
                  onChange={(e) =>
                    updateSearchRow(row.id, { location: e.target.value })
                  }
                  className="w-full pl-9 pr-3 py-2.5 rounded-lg text-sm border border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none"
                />
              </div>

              {searchRows.length > 1 ? (
                <button
                  type="button"
                  onClick={() => removeSearchRow(row.id)}
                  disabled={isScraping || isScrapeAndGenerate}
                  className="flex items-center justify-center px-3 py-2.5 rounded-lg border border-gray-300 text-gray-500 hover:bg-gray-50 hover:text-red-600 disabled:opacity-40 shrink-0"
                  title="Remove this search"
                  aria-label={`Remove search row ${index + 1}`}
                >
                  <Minus size={16} />
                </button>
              ) : (
                <div className="w-[46px] shrink-0 hidden sm:block" aria-hidden />
              )}
            </div>
          ))}

          <div className="flex flex-col sm:flex-row gap-3 items-stretch flex-wrap">
          <button
            type="button"
            onClick={addSearchRow}
            disabled={isScraping || isScrapeAndGenerate}
            className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg text-sm font-medium border border-dashed border-gray-300 text-gray-600 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50/50 disabled:opacity-40 shrink-0"
          >
            <Plus size={16} />
            Add search
          </button>

          {/* Max results */}
          <select
            value={maxResults}
            onChange={(e) => setMaxResults(Number(e.target.value))}
            className="px-3 py-2.5 rounded-lg text-sm border border-gray-300 text-gray-900 focus:border-blue-500 outline-none bg-white"
          >
            <option value={25}>25 leads</option>
            <option value={50}>50 leads</option>
            <option value={100}>100 leads</option>
            <option value={200}>200 leads</option>
            <option value={300}>300 leads</option>
            <option value={500}>500 leads</option>
          </select>

          {/* Scrape button */}
          <button
            onClick={handleScrape}
            disabled={isScraping || isScrapeAndGenerate}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isScraping
              ? <><Loader2 size={14} className="animate-spin" />Scraping...</>
              : <><Radio size={14} />Scrape</>
            }
          </button>

          {/* Scrape + Generate button */}
          <button
            onClick={handleScrapeAndGenerate}
            disabled={isScraping || isScrapeAndGenerate}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Scrape leads AND generate AI emails in one click"
          >
            {isScrapeAndGenerate
              ? <><Loader2 size={14} className="animate-spin" />{pipelinePhase === "generating" ? "Generating..." : "Scraping..."}</>
              : <><Zap size={14} />Scrape + AI Emails</>
            }
          </button>
          </div>
        </div>

        {(isScraping || isScrapeAndGenerate) && (
          <p className="text-xs text-blue-600 mt-3 flex items-center gap-2 flex-wrap">
            <Loader2 size={11} className="animate-spin shrink-0" />
            {multiQueryProgress && multiQueryProgress.total > 1 && (
              <span className="font-medium">
                Search {multiQueryProgress.current}/{multiQueryProgress.total}:{" "}
                {multiQueryProgress.niche} · {multiQueryProgress.location}
                {" — "}
              </span>
            )}
            {isScrapeAndGenerate && pipelinePhase === "generating"
              ? `Generating emails… ${pipelineStats.emails}/${pipelineStats.scraped} done`
              : mapsUsesDocker && results.length === 0
                ? "Docker Maps jobs running — first results may take a few minutes per district…"
                : results.length > 0
                  ? `Found ${results.length} unique leads so far — still scraping…`
                  : mapsUsesDocker
                    ? "Docker Maps + website email extraction — leads appear as they're found…"
                    : "Visiting websites and extracting real emails — leads appear as they're found…"
            }
          </p>
        )}
      </div>

      {/* ── Chunk Progress Panel ─────────────────────────────────────── */}
      {(isScraping || isScrapeAndGenerate || (progress && results.length > 0)) && (
        <div className="rounded-xl p-4 bg-white border border-blue-200 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <BarChart2 size={14} className="text-blue-600" />
              <span className="text-sm font-semibold text-gray-900">Scrape Progress</span>
            </div>
            {progress && (
              <span className="text-xs text-gray-500">
                {progress.percentComplete}% complete
              </span>
            )}
          </div>

          {/* Overall progress bar */}
          <div className="w-full bg-gray-100 rounded-full h-2 mb-3">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${progress?.percentComplete ?? 0}%` }}
            />
          </div>

          {scrapeSummary && !isScraping && (
            <p className="text-xs text-gray-600 mb-3 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
              <strong>Run summary:</strong> {scrapeSummary.withEmail} with email (
              {scrapeSummary.realEmails} from website crawl) · {scrapeSummary.crmAdded}{" "}
              saved to CRM · {scrapeSummary.researched} researched
              {scrapeSummary.callListAdded > 0
                ? ` · ${scrapeSummary.callListAdded} call list (phone only — use Pipeline → Retry enrich)`
                : ""}
            </p>
          )}

          {/* Stats row */}
          <div className="grid grid-cols-4 gap-2 mb-3">
            {[
              { label: "Scraped", value: progress?.totalFound ?? results.length, color: "text-blue-600" },
              { label: "Round", value: progress ? `${progress.currentChunk}/${progress.totalChunks}` : "—" },
              { label: "Failed", value: progress?.totalFailed ?? 0, color: "text-red-500" },
              { label: "Remaining", value: progress?.remaining ?? "…", color: "text-orange-500" },
            ].map((s) => (
              <div key={s.label} className="bg-gray-50 rounded-lg p-2 border border-gray-100 text-center">
                <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-0.5">{s.label}</p>
                <p className={`text-base font-bold ${s.color ?? "text-gray-900"}`}>{s.value}</p>
              </div>
            ))}
          </div>

          {/* Chunk log */}
          {chunkLog.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {chunkLog.map((c) => (
                <div
                  key={c.id}
                  className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium border ${
                    c.status === "done"
                      ? "bg-green-50 border-green-200 text-green-700"
                      : c.status === "empty"
                        ? "bg-amber-50 border-amber-200 text-amber-700"
                        : "bg-blue-50 border-blue-200 text-blue-700"
                  }`}
                >
                  {c.status === "done" ? (
                    <CheckCircle2 size={10} />
                  ) : c.status === "empty" ? (
                    <span className="text-[9px]">—</span>
                  ) : (
                    <Loader2 size={10} className="animate-spin" />
                  )}
                  {getValidSearchRows(searchRows).length > 1
                    ? `S${c.searchIndex} R${c.chunk}`
                    : `Round ${c.chunk}`}
                  {c.status !== "running" && (
                    <span className="text-gray-400">
                      · {c.leads}
                      {c.status === "empty" ? " (no new)" : ""}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Pipeline progress panel (Scrape + Generate mode) ─────────── */}
      {(isScrapeAndGenerate || pipelinePhase === "done") && (
        <div className="rounded-xl p-4 bg-white border border-blue-200 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <Zap size={14} className="text-blue-600" />
            <span className="text-sm font-semibold text-gray-900">Scrape + AI Email Pipeline</span>
            <span className={`ml-auto text-xs px-2 py-0.5 rounded-full font-medium ${
              pipelinePhase === "scraping"   ? "bg-blue-100 text-blue-700" :
              pipelinePhase === "generating" ? "bg-blue-100 text-blue-700" :
              pipelinePhase === "done"       ? "bg-green-100 text-green-700" :
              "bg-gray-100 text-gray-500"
            }`}>
              {pipelinePhase === "scraping"   ? "Phase 1: Scraping" :
               pipelinePhase === "generating" ? "Phase 2: Generating Emails" :
               pipelinePhase === "done"       ? "Complete" : ""}
            </span>
          </div>

          {/* Phase indicators */}
          <div className="flex items-center gap-2 mb-3">
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border ${
              pipelinePhase === "scraping" ? "bg-blue-50 border-blue-200 text-blue-700" :
              pipelinePhase !== "idle"     ? "bg-green-50 border-green-200 text-green-700" :
              "bg-gray-50 border-gray-200 text-gray-400"
            }`}>
              {pipelinePhase === "scraping"
                ? <Loader2 size={10} className="animate-spin" />
                : <CheckCircle2 size={10} />}
              Scrape leads
            </div>
            <div className="text-gray-300 text-xs">→</div>
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border ${
              pipelinePhase === "generating" ? "bg-blue-50 border-blue-200 text-blue-700" :
              pipelinePhase === "done"       ? "bg-green-50 border-green-200 text-green-700" :
              "bg-gray-50 border-gray-200 text-gray-400"
            }`}>
              {pipelinePhase === "generating"
                ? <Loader2 size={10} className="animate-spin" />
                : pipelinePhase === "done"
                  ? <CheckCircle2 size={10} />
                  : <Sparkles size={10} />}
              Generate emails
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "Leads Scraped", value: pipelineStats.scraped, color: "text-blue-600" },
              { label: "Emails Generated", value: pipelineStats.emails, color: "text-blue-600" },
              { label: "Fallbacks", value: pipelineStats.fallbacks, color: "text-orange-500" },
            ].map((s) => (
              <div key={s.label} className="bg-gray-50 rounded-lg p-2 border border-gray-100 text-center">
                <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-0.5">{s.label}</p>
                <p className={`text-base font-bold ${s.color}`}>{s.value}</p>
              </div>
            ))}
          </div>

          {/* Generated emails list */}
          {generatedEmails.length > 0 && (
            <div className="mt-3 max-h-48 overflow-y-auto flex flex-col gap-2">
              {generatedEmails.map((e, i) => (
                <div key={i} className={`rounded-lg p-3 border text-xs ${e.isFallback ? "bg-orange-50 border-orange-200" : "bg-blue-50 border-blue-200"}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-gray-800 truncate">{e.company_name}</span>
                    {e.isFallback
                      ? <span className="text-orange-500 text-[10px] shrink-0 ml-2">fallback</span>
                      : <span className="text-blue-600 text-[10px] shrink-0 ml-2">✓ AI</span>
                    }
                  </div>
                  <p className="text-gray-500 truncate">📧 {e.lead_email}</p>
                  <p className="text-gray-700 font-medium truncate mt-0.5">Subject: {e.subject}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Results header ────────────────────────────────────────────── */}
      {(results.length > 0) && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm font-bold text-gray-900">
              {results.length} leads {isScraping ? "found so far…" : "found"}
            </span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">
              ✓ {realCount} verified
            </span>
            {guessedCount > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 font-medium">
                ~ {guessedCount} guessed
              </span>
            )}
            {noEmailCount > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 font-medium">
                {noEmailCount} no email
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={toggleAll}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
            >
              {results.every((_, i) => selected.has(i))
                ? <><CheckSquare size={12} />Deselect All</>
                : <><Square size={12} />Select All</>
              }
            </button>
            <button
              onClick={exportCSV}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
            >
              <Download size={12} />Export CSV
            </button>
            <button
              onClick={() => addToCRM(results.filter((l) => l.email))}
              disabled={addingToCRM}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
            >
              {addingToCRM
                ? <><Loader2 size={12} className="animate-spin" />Saving...</>
                : <><Plus size={12} />Add All to CRM ({totalWithEmail})</>
              }
            </button>
          </div>
        </div>
      )}

      {/* ── Bulk action bar (when rows selected) ─────────────────────── */}
      {selected.size > 0 && (
        <div className="flex items-center justify-between px-4 py-2.5 rounded-xl bg-blue-50 border border-blue-200">
          <span className="text-sm text-blue-700 font-medium">{selected.size} selected</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => addToCRM(selectedLeads)}
              disabled={addingToCRM}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-green-100 border border-green-300 text-green-700 hover:bg-green-200"
            >
              {addingToCRM ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
              Add to CRM
            </button>
            <button
              onClick={() => onGenerateEmails?.(selectedLeads)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-100 border border-blue-300 text-blue-700 hover:bg-blue-200"
            >
              <Mail size={11} />Write Emails
            </button>
            <button
              onClick={exportCSV}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-100 border border-gray-300 text-gray-700 hover:bg-gray-200"
            >
              <Download size={11} />Export
            </button>
            <button onClick={() => setSelected(new Set())} className="text-gray-400 hover:text-gray-600">
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* ── Results table ─────────────────────────────────────────────── */}
      {results.length > 0 && (
        <div className="rounded-xl overflow-hidden border border-gray-200 bg-white shadow-sm" style={{ minHeight: 0, maxHeight: '60vh' }}>
          <div className="overflow-y-auto h-full" style={{ maxHeight: '60vh' }}>
            <table className="w-full">
              <thead className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 w-10">
                    <button onClick={toggleAll}>
                      {results.every((_, i) => selected.has(i))
                        ? <CheckSquare size={13} className="text-blue-600" />
                        : <Square size={13} className="text-gray-400" />
                      }
                    </button>
                  </th>
                  {["Company", "Email", "Phone", "Location", ""].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-[10px] font-semibold tracking-widest uppercase text-gray-500">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {results.map((lead, i) => {
                  const isSelected = selected.has(i);
                  const isReal = (lead as any).emailIsReal;
                  return (
                    <tr
                      key={i}
                      className={`border-b border-gray-100 hover:bg-blue-50 group transition-colors ${isSelected ? "bg-blue-50" : ""}`}
                    >
                      <td className="px-4 py-3">
                        <button onClick={() => toggleRow(i)}>
                          {isSelected
                            ? <CheckSquare size={13} className="text-blue-600" />
                            : <Square size={13} className="text-gray-400" />
                          }
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm font-medium text-gray-900">{lead.company_name}</span>
                      </td>
                      <td className="px-4 py-3">
                        {lead.email ? (
                          <div className="flex items-center gap-1.5">
                            <span className={`text-xs font-mono ${isReal ? "text-blue-600" : "text-amber-600"}`}>
                              {lead.email}
                            </span>
                            {isReal ? (
                              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-200 font-semibold">
                                ✓ REAL
                              </span>
                            ) : (
                              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-200 font-semibold">
                                ~ GUESS
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-orange-50 text-orange-500 border border-orange-200">
                            No email found
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs text-gray-600 flex items-center gap-1">
                          {(lead as any).phone
                            ? <><Phone size={10} className="text-gray-400" />{(lead as any).phone}</>
                            : <span className="text-gray-300">—</span>
                          }
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`text-xs flex items-center gap-1 ${
                            getLeadDisplayLocation(lead, lead.location) === "Not in search area"
                              ? "text-amber-600"
                              : "text-gray-500"
                          }`}
                          title={
                            getLeadDisplayLocation(lead, lead.location) === "Not in search area"
                              ? `Search was: ${lead.location}`
                              : undefined
                          }
                        >
                          <MapPin size={10} className="text-gray-400 shrink-0" />
                          {getLeadDisplayLocation(lead, lead.location)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => setDrawerLead(lead)}
                            className="p-1.5 rounded text-[10px] flex items-center gap-1 bg-gray-100 text-gray-600 hover:bg-gray-200"
                          >
                            <ExternalLink size={10} />View
                          </button>
                          {lead.email && (
                            <button
                              onClick={() => addToCRM([lead])}
                              className="p-1.5 rounded text-[10px] flex items-center gap-1 bg-green-100 text-green-700 hover:bg-green-200"
                            >
                              <Plus size={10} />CRM
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2 border-t border-gray-100 bg-gray-50 flex items-center justify-between">
            <span className="text-[10px] text-gray-400 font-mono">
              {results.length} found · <span className="text-green-600 font-semibold">{realCount} verified ✓</span>
              {guessedCount > 0 && <> · <span className="text-yellow-600 font-semibold">{guessedCount} guessed ~</span></>}
              {noEmailCount > 0 && <> · <span className="text-orange-400">{noEmailCount} no email</span></>}
            </span>
            {selected.size > 0 && (
              <span className="text-[10px] text-blue-600 font-medium">{selected.size} selected</span>
            )}
          </div>
        </div>
      )}

      {/* ── Empty state ───────────────────────────────────────────────── */}
      {results.length === 0 && !isScraping && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center bg-blue-50 border border-blue-100">
              <Radio size={24} className="text-blue-600" />
            </div>
            <p className="text-sm font-medium text-gray-700">Add niche + location rows, then scrape</p>
            <p className="text-xs mt-1 text-gray-500">
              e.g. <strong>school</strong> + <strong>Kigali Rwanda</strong>
            </p>
          </div>
        </div>
      )}
      </>
      )}

      {/* ── Lead detail drawer (outside tabs — renders over everything) ── */}
      {drawerLead && (
        <div className="fixed inset-0 z-50" onClick={() => setDrawerLead(null)}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <div
            className="absolute right-0 top-0 bottom-0 w-full max-w-md bg-white border-l border-gray-200 shadow-xl flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <h2 className="text-base font-bold text-gray-900 truncate pr-4">{drawerLead.company_name}</h2>
              <button onClick={() => setDrawerLead(null)} className="text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
              {/* Contact info */}
              <div className="rounded-xl p-4 bg-gray-50 border border-gray-200 flex flex-col gap-2">
                {drawerLead.email && (
                  <div className="flex items-center gap-2">
                    <Mail size={13} className="text-blue-500 flex-shrink-0" />
                    <span className="text-sm text-blue-600 font-mono break-all">{drawerLead.email}</span>
                    {(drawerLead as any).emailIsReal && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-200 font-semibold flex-shrink-0">REAL</span>
                    )}
                  </div>
                )}
                {(drawerLead as any).phone && (
                  <div className="flex items-center gap-2">
                    <Phone size={13} className="text-gray-400 flex-shrink-0" />
                    <span className="text-sm text-gray-700">{(drawerLead as any).phone}</span>
                  </div>
                )}
                {(drawerLead as any).website && (
                  <div className="flex items-center gap-2">
                    <Globe size={13} className="text-gray-400 flex-shrink-0" />
                    <a
                      href={(drawerLead as any).website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-blue-500 hover:underline truncate"
                    >
                      {(drawerLead as any).website}
                    </a>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <MapPin size={13} className="text-gray-400 flex-shrink-0" />
                  <span className="text-sm text-gray-600">
                    {getLeadDisplayLocation(drawerLead, drawerLead.location)}
                  </span>
                  {getLeadDisplayLocation(drawerLead, drawerLead.location) ===
                    "Not in search area" && (
                    <span className="text-xs text-amber-600 block mt-0.5">
                      Search target: {drawerLead.location}
                    </span>
                  )}
                </div>
              </div>

              {/* Context */}
              {drawerLead.company_context && (
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-gray-400 font-semibold mb-2">About</p>
                  <p className="text-sm leading-relaxed text-gray-700">{drawerLead.company_context}</p>
                </div>
              )}
            </div>

            <div className="px-5 py-4 border-t border-gray-200 flex gap-2">
              {drawerLead.email && (
                <button
                  onClick={async () => { await addToCRM([drawerLead]); setDrawerLead(null); }}
                  disabled={addingToCRM}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 bg-green-50 border border-green-300 text-green-700 hover:bg-green-100 disabled:opacity-50"
                >
                  {addingToCRM ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                  Add to CRM
                </button>
              )}
              <button
                onClick={() => { onGenerateEmails?.([drawerLead]); setDrawerLead(null); }}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 bg-blue-50 border border-blue-300 text-blue-700 hover:bg-blue-100"
              >
                <Mail size={13} />Write Email
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
