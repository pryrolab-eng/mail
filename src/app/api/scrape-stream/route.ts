/**
 * SSE streaming scrape endpoint — chunk-based.
 *
 * Streams events:
 *   start      — job started
 *   chunk_start — beginning a new search round (~25 leads each)
 *   lead        — single lead found
 *   chunk_done  — search round finished (with stats)
 *   progress    — overall progress update
 *   done        — all done
 *   error       — fatal error
 */

import { NextRequest } from "next/server";
import { createClient } from "../../../../supabase/server";
import { scrapeWithoutAPI } from "@/utils/puppeteer-scraper";
import {
  finalizeScrapedLead,
  finalizePhoneOnlyScrapeLead,
  isJunkScrapeLead,
} from "@/utils/scrape-lead-quality";
import { insertScrapedLeadsToCrm } from "@/utils/scrape-lead-crm";
import { runLeadResearchBatch } from "@/utils/lead-research";
import { getActiveAIProvider } from "@/utils/ai-scraper-helper";
import { getMapsBackendStatus } from "@/utils/gmaps-backend-status";
import type { ScrapedLead } from "@/types/platform";
import {
  buildScrapeSessionSummary,
  resetScrapeRunStats,
  scrapeRunStats,
} from "@/utils/scrape-run-stats";
import { runWithScrapeBrowserPool } from "@/utils/scrape-browser-pool";

export const runtime = "nodejs";
export const maxDuration = 300;

const CHUNK_SIZE = 25; // leads per chunk

export async function POST(request: NextRequest) {
  // Auth
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const { niche, location, maxResults } = (await request.json()) as {
    niche: string;
    location: string;
    maxResults: number;
  };

  if (!niche?.trim() || !location?.trim()) {
    return new Response(JSON.stringify({ error: "Niche and location are required" }), {
      status: 400,
    });
  }

  const totalChunks = Math.ceil(maxResults / CHUNK_SIZE);

  // Create a scrape_job record for progress tracking
  const { data: job } = await supabase
    .from("scrape_jobs")
    .insert({
      user_id: user.id,
      niche: niche.trim(),
      location: location.trim(),
      max_results: maxResults,
      chunk_size: CHUNK_SIZE,
      total_chunks: totalChunks,
      status: "running",
      source: "scraper",
    })
    .select()
    .single();

  const jobId = job?.id ?? null;

  // Load user's active AI provider for AI-assisted scraping
  let aiProvider = null;
  try {
    aiProvider = await getActiveAIProvider(user.id);
  } catch { /* AI is optional — scraping works without it */ }

  const mapsBackend = await getMapsBackendStatus();

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();

      const send = (event: string, data: object) => {
        try {
          controller.enqueue(
            enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        } catch {
          // Client disconnected — ignore
        }
      };

      send("start", {
        jobId,
        niche,
        location,
        maxResults,
        chunkSize: CHUNK_SIZE,
        totalChunks,
        mapsBackend,
      });

      let totalFound = 0;
      let totalFailed = 0;
      let crmAdded = 0;
      let crmCallListAdded = 0;
      let crmDuplicates = 0;
      let crmResearched = 0;
      let crmResearchFailed = 0;
      let phoneOnlyFound = 0;
      const insertedLeadIds: string[] = [];
      const errorLog: string[] = [];
      const sessionKeys = new Set<string>();
      const sharedSeen = new Set<string>();
      const pendingCrm: Promise<void>[] = [];
      const allLeads: ScrapedLead[] = [];

      const sendProgress = (currentChunk: number) => {
        send("progress", {
          totalFound,
          totalFailed,
          remaining: Math.max(0, maxResults - totalFound),
          currentChunk,
          totalChunks,
          percentComplete: Math.min(
            100,
            Math.round((totalFound / maxResults) * 100)
          ),
        });
      };

      try {
        resetScrapeRunStats();
        const targetLoc = location.trim();
        const category = `${niche.trim()} - ${targetLoc}`;
        let activeChunk = 0;

        const persistLeadToCrm = (lead: ScrapedLead) => {
          const persistKey = lead.phoneOnly
            ? `phone|${(lead.phone ?? "").replace(/\D/g, "")}|${lead.company_name.trim().toLowerCase()}`
            : `${lead.email.toLowerCase()}|${lead.company_name.trim().toLowerCase()}|${(lead.location ?? "").toLowerCase()}`;
          if (sessionKeys.has(persistKey)) return;
          sessionKeys.add(persistKey);
          pendingCrm.push(
            (async () => {
              try {
                const result = await insertScrapedLeadsToCrm(
                  supabase,
                  user.id,
                  [lead],
                  {
                    searchLocation: targetLoc,
                    category,
                    niche: niche.trim(),
                    autoResearch: false,
                  }
                );
                crmAdded += result.added;
                crmCallListAdded += result.callListAdded;
                crmDuplicates += result.duplicates;
                insertedLeadIds.push(...result.insertedLeadIds);
                scrapeRunStats.session.crmAdded += result.added;
                scrapeRunStats.session.callListAdded += result.callListAdded;
              } catch (err: unknown) {
                const msg =
                  err instanceof Error ? err.message : "CRM insert failed";
                errorLog.push(msg);
                console.error("[scrape-stream] CRM insert:", msg);
              }
            })()
          );
        };

        const onLead = (rawLead: ScrapedLead) => {
          if (rawLead.phoneOnly) {
            const phoneLead = finalizePhoneOnlyScrapeLead(rawLead, targetLoc);
            if (
              !phoneLead ||
              isJunkScrapeLead(
                { ...phoneLead, phoneOnly: true },
                targetLoc
              )
            ) {
              return;
            }
            phoneOnlyFound++;
            scrapeRunStats.session.phoneOnly++;
            persistLeadToCrm(phoneLead);
            send("lead", { lead: phoneLead, phoneOnly: true, chunk: activeChunk });
            return;
          }

          if (totalFound >= maxResults) return;

          const lead = finalizeScrapedLead(rawLead, targetLoc);
          if (!lead || isJunkScrapeLead(lead, targetLoc)) return;

          persistLeadToCrm(lead);

          totalFound++;
          allLeads.push(lead);
          scrapeRunStats.session.withEmail++;
          if (lead.emailIsReal) scrapeRunStats.session.realEmails++;
          send("lead", { lead, count: totalFound, chunk: activeChunk });

          if (totalFound % 5 === 0) {
            sendProgress(activeChunk);
          }
        };

        await runWithScrapeBrowserPool(async () => {
          for (let chunkNum = 1; chunkNum <= totalChunks && totalFound < maxResults; chunkNum++) {
            activeChunk = chunkNum;
            const chunkTarget = Math.min(CHUNK_SIZE, maxResults - totalFound);
            const beforeChunk = totalFound;

            send("chunk_start", {
              chunk: chunkNum,
              totalChunks,
              targetThisChunk: chunkTarget,
              totalSoFar: totalFound,
            });
            sendProgress(chunkNum);

            console.log(
              `[scrape-stream] Chunk ${chunkNum}/${totalChunks}: target ${chunkTarget} leads (${totalFound}/${maxResults} so far)`
            );

            const roundLeads = await scrapeWithoutAPI(
              niche.trim(),
              location.trim(),
              chunkTarget,
              onLead,
              aiProvider,
              { seen: sharedSeen, round: chunkNum }
            );

            if (totalFound === beforeChunk && roundLeads.length > 0) {
              for (const lead of roundLeads) {
                if (totalFound >= maxResults) break;
                onLead(lead);
              }
            }

            const chunkLeads = totalFound - beforeChunk;
            send("chunk_done", {
              chunk: chunkNum,
              totalChunks,
              chunkLeads,
              status: chunkLeads > 0 ? "done" : "empty",
              totalFound,
              totalFailed,
              remaining: Math.max(0, maxResults - totalFound),
            });
            sendProgress(chunkNum);

            if (jobId) {
              await supabase
                .from("scrape_jobs")
                .update({
                  current_chunk: chunkNum,
                  total_scraped: totalFound,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", jobId);
            }
          }

          await Promise.all(pendingCrm);
        });

        if (insertedLeadIds.length > 0) {
          send("progress", {
            totalFound,
            totalFailed,
            remaining: Math.max(0, maxResults - totalFound),
            currentChunk: totalChunks,
            totalChunks,
            percentComplete: Math.min(
              100,
              Math.round((totalFound / maxResults) * 100)
            ),
            phase: "researching",
          });
          const research = await runLeadResearchBatch(
            supabase,
            user.id,
            insertedLeadIds,
            2
          );
          crmResearched = research.researched;
          crmResearchFailed = research.failed;
          scrapeRunStats.session.researched = crmResearched;
        }

        const percentComplete = Math.min(
          100,
          Math.round((totalFound / maxResults) * 100)
        );

        send("progress", {
          totalFound,
          totalFailed,
          remaining: Math.max(0, maxResults - totalFound),
          currentChunk: Math.min(totalChunks, Math.ceil(totalFound / CHUNK_SIZE) || 1),
          totalChunks,
          percentComplete,
        });

        send("done", {
          jobId,
          total: totalFound,
          target: maxResults,
          totalFailed,
          crmAdded,
          crmCallListAdded,
          crmDuplicates,
          crmResearched,
          crmResearchFailed,
          phoneOnlyFound,
          exhausted: totalFound < maxResults,
          realEmails: allLeads.filter((l) => l.emailIsReal).length,
          scrapeSummary: buildScrapeSessionSummary(),
          chunksCompleted: Math.min(
            totalChunks,
            Math.max(1, Math.ceil(totalFound / CHUNK_SIZE))
          ),
        });

        // Mark job complete
        if (jobId) {
          await supabase
            .from("scrape_jobs")
            .update({
              status: "completed",
              total_scraped: totalFound,
              total_failed: totalFailed,
              current_chunk: Math.min(totalChunks, Math.ceil(totalFound / CHUNK_SIZE) || 1),
              completed_at: new Date().toISOString(),
              error_log: errorLog,
            })
            .eq("id", jobId);
        }
      } catch (err: any) {
        const msg = err?.message || "Scraping failed";
        errorLog.push(msg);
        send("error", { message: msg });

        if (jobId) {
          await supabase
            .from("scrape_jobs")
            .update({
              status: "failed",
              total_scraped: totalFound,
              total_failed: totalFailed,
              error_log: errorLog,
              completed_at: new Date().toISOString(),
            })
            .eq("id", jobId);
        }
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
