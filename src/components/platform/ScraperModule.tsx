"use client";

import { useState, useRef } from "react";
import { ScrapedLead } from "@/types/platform";
import {
  Radio, Search, MapPin, Plus, Download,
  X, CheckSquare, Square, Loader2, ExternalLink,
  Mail, Phone, Globe, Upload, FileText, AlertCircle,
  CheckCircle2, ChevronRight, BarChart2,
} from "lucide-react";
import { createClient } from "../../../supabase/client";
import { toast } from "sonner";

interface ScraperModuleProps {
  userId: string;
  onLeadsAdded?: () => void;
  onGenerateEmails?: (leads: ScrapedLead[]) => void;
}

const NICHES = [
  "School", "Hospital", "Restaurant", "Hotel", "Bank", "NGO", "Church",
  "Gym", "Salon", "Transport", "Farm", "Shop", "SaaS", "E-Commerce",
  "Digital Marketing", "Fintech", "Health Tech", "Real Estate", "Education",
  "Legal", "Consulting", "Agency", "Manufacturing", "Retail",
];

export default function ScraperModule({ userId, onLeadsAdded, onGenerateEmails }: ScraperModuleProps) {
  const [niche, setNiche] = useState("");
  const [location, setLocation] = useState("");
  const [maxResults, setMaxResults] = useState(100);
  const [isScraping, setIsScraping] = useState(false);
  const [results, setResults] = useState<ScrapedLead[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [drawerLead, setDrawerLead] = useState<ScrapedLead | null>(null);
  const [nicheSuggestions, setNicheSuggestions] = useState<string[]>([]);
  const [addingToCRM, setAddingToCRM] = useState(false);

  // ── Chunk progress state ──────────────────────────────────────────────────
  const [progress, setProgress] = useState<{
    totalFound: number;
    totalFailed: number;
    remaining: number;
    currentChunk: number;
    totalChunks: number;
    percentComplete: number;
  } | null>(null);
  const [chunkLog, setChunkLog] = useState<Array<{
    chunk: number;
    leads: number;
    status: "done" | "running";
  }>>([]);

  // ── CSV import state ──────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<"scraper" | "csv">("scraper");
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

  const handleNicheInput = (val: string) => {
    setNiche(val);
    setNicheSuggestions(
      val.length > 0
        ? NICHES.filter((n) => n.toLowerCase().includes(val.toLowerCase())).slice(0, 5)
        : []
    );
  };

  const handleScrape = async () => {
    if (!niche.trim()) { toast.error("Enter a niche (e.g. school, restaurant)"); return; }
    if (!location.trim()) { toast.error("Enter a location (e.g. Kigali Rwanda)"); return; }

    setIsScraping(true);
    setResults([]);
    setSelected(new Set());
    setProgress(null);
    setChunkLog([]);

    try {
      const res = await fetch("/api/scrape-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ niche: niche.trim(), location: location.trim(), maxResults }),
      });

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Scraping failed. Please try again.");
        setIsScraping(false);
        return;
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
          const dataLine  = part.match(/^data:\s*(.+)/m);
          if (!eventLine || !dataLine) continue;

          const event = eventLine[1].trim();
          let payload: any;
          try { payload = JSON.parse(dataLine[1]); } catch { continue; }

          if (event === "lead") {
            setResults((prev) => [...prev, payload.lead]);
          } else if (event === "chunk_start") {
            setChunkLog((prev) => [
              ...prev,
              { chunk: payload.chunk, leads: 0, status: "running" },
            ]);
          } else if (event === "chunk_done") {
            setChunkLog((prev) =>
              prev.map((c) =>
                c.chunk === payload.chunk
                  ? { ...c, leads: payload.chunkLeads, status: "done" }
                  : c
              )
            );
          } else if (event === "progress") {
            setProgress(payload);
          } else if (event === "done") {
            if (payload.total === 0) {
              toast.info("No leads found. Try a broader niche or different location.");
            } else {
              toast.success(`Found ${payload.total} leads for "${niche}" in "${location}"`);
            }
          } else if (event === "error") {
            toast.error(payload.message || "Scraping failed.");
          }
        }
      }
    } catch {
      toast.error("Scraping failed. Please try again.");
    } finally {
      setIsScraping(false);
    }
  };

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
    // Allow adding both real AND guessed emails — user can see which is which
    const withEmail = leadsToAdd.filter((l) => l.email && l.email.trim() !== "");
    const withNoEmail = leadsToAdd.filter((l) => !l.email);

    if (withEmail.length === 0) {
      toast.info("None of the selected leads have an email address.");
      return;
    }

    setAddingToCRM(true);
    try {
      const category = niche && location ? `${niche} - ${location}` : niche || location || "Uncategorized";

      await supabase
        .from("lead_categories")
        .upsert({ user_id: userId, name: category }, { onConflict: "user_id,name" })
        .select();

      // Deduplication
      const emailsToCheck = withEmail.map((l) => l.email.toLowerCase());
      const { data: existing } = await supabase
        .from("leads")
        .select("email")
        .eq("user_id", userId)
        .in("email", emailsToCheck);

      const existingEmails = new Set(
        (existing ?? []).map((r: any) => r.email?.toLowerCase())
      );

      const newLeads = withEmail.filter(
        (l) => !existingEmails.has(l.email.toLowerCase())
      );
      const duplicateCount = withEmail.length - newLeads.length;

      if (newLeads.length === 0) {
        toast.info(`All ${withEmail.length} lead${withEmail.length !== 1 ? "s" : ""} already exist in your CRM.`);
        return;
      }

      const inserts = newLeads.map((l) => ({
        user_id: userId,
        company_name: l.company_name,
        email: l.email,
        phone: (l as any).phone ?? null,
        website: (l as any).website ?? null,
        niche: l.niche,
        location: l.location,
        company_context: l.company_context,
        status: "new",
        source: "scraper",
        confidence_score: (l as any).emailIsReal ? 90 : 50,
        email_verified: (l as any).emailIsReal ?? false,
      }));

      const { error } = await supabase.from("leads").insert(inserts);
      if (error) throw new Error(error.message);

      const realAdded = newLeads.filter((l: any) => l.emailIsReal).length;
      const guessedAdded = newLeads.length - realAdded;
      let msg = `✅ ${newLeads.length} lead${newLeads.length !== 1 ? "s" : ""} added to CRM`;
      if (realAdded > 0 && guessedAdded > 0) msg += ` (${realAdded} verified, ${guessedAdded} guessed)`;
      if (duplicateCount > 0) msg += ` · ${duplicateCount} duplicate${duplicateCount !== 1 ? "s" : ""} skipped`;
      if (withNoEmail.length > 0) msg += ` · ${withNoEmail.length} skipped (no email)`;
      toast.success(msg);
      onLeadsAdded?.();
    } catch (e: any) {
      toast.error(e?.message || "Failed to add to CRM");
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
          `"${l.company_context.replace(/"/g, "'")}"`,
        ].join(",")
      ),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `leads-${niche}-${location}.csv`.replace(/\s+/g, "-").toLowerCase();
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
              onLeadsAdded?.();
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
        <div className="flex items-center gap-2 mb-4">
          <Radio size={15} className="text-blue-600" />
          <span className="text-sm font-semibold text-gray-900">Lead Scraper</span>
          <span className="ml-auto text-[10px] text-gray-400">Powered by Puppeteer + Google Maps</span>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          {/* Niche */}
          <div className="relative flex-1">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Niche (e.g. school, restaurant)"
              value={niche}
              onChange={(e) => handleNicheInput(e.target.value)}
              className="w-full pl-9 pr-3 py-2.5 rounded-lg text-sm border border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none"
            />
            {nicheSuggestions.length > 0 && (
              <div className="absolute top-full mt-1 left-0 right-0 bg-white rounded-lg z-10 shadow-lg border border-gray-200 overflow-hidden">
                {nicheSuggestions.map((s) => (
                  <button
                    key={s}
                    className="w-full text-left px-3 py-2 text-xs hover:bg-blue-50 text-gray-700"
                    onClick={() => { setNiche(s); setNicheSuggestions([]); }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Location */}
          <div className="relative flex-1">
            <MapPin size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Location (e.g. Kigali Rwanda)"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="w-full pl-9 pr-3 py-2.5 rounded-lg text-sm border border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none"
            />
          </div>

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
          </select>

          {/* Scrape button */}
          <button
            onClick={handleScrape}
            disabled={isScraping}
            className="flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isScraping
              ? <><Loader2 size={14} className="animate-spin" />Scraping...</>
              : <><Radio size={14} />Scrape</>
            }
          </button>
        </div>

        {isScraping && (
          <p className="text-xs text-blue-600 mt-3 flex items-center gap-2">
            <Loader2 size={11} className="animate-spin" />
            {results.length > 0
              ? `Found ${results.length} leads so far — still scraping…`
              : "Visiting websites and extracting real emails — leads appear as they're found…"
            }
          </p>
        )}
        {!isScraping && results.length === 0 && (
          <p className="text-xs text-gray-400 mt-3">
            💡 e.g. <strong>school</strong> + <strong>Kigali Rwanda</strong> — scraper visits each website to find real contact emails
          </p>
        )}
      </div>

      {/* ── Chunk Progress Panel ─────────────────────────────────────── */}
      {(isScraping || (progress && results.length > 0)) && (
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

          {/* Stats row */}
          <div className="grid grid-cols-4 gap-2 mb-3">
            {[
              { label: "Scraped", value: progress?.totalFound ?? results.length, color: "text-blue-600" },
              { label: "Chunk", value: progress ? `${progress.currentChunk}/${progress.totalChunks}` : "—" },
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
                  key={c.chunk}
                  className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium border ${
                    c.status === "done"
                      ? "bg-green-50 border-green-200 text-green-700"
                      : "bg-blue-50 border-blue-200 text-blue-700"
                  }`}
                >
                  {c.status === "done" ? (
                    <CheckCircle2 size={10} />
                  ) : (
                    <Loader2 size={10} className="animate-spin" />
                  )}
                  Chunk {c.chunk}
                  {c.status === "done" && <span className="text-gray-400">· {c.leads}</span>}
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
                        <span className="text-xs text-gray-500 flex items-center gap-1">
                          <MapPin size={10} className="text-gray-400" />
                          {lead.location}
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
            <p className="text-sm font-medium text-gray-700">Enter a niche and location to find leads</p>
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
                  <span className="text-sm text-gray-600">{drawerLead.location}</span>
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
