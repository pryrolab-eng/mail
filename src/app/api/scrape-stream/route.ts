/**
 * SSE streaming scrape endpoint — chunk-based.
 *
 * Streams events:
 *   start      — job started
 *   chunk_start — beginning a new chunk
 *   lead        — single lead found
 *   chunk_done  — chunk finished (with stats)
 *   progress    — overall progress update
 *   done        — all done
 *   error       — fatal error
 */

import { NextRequest } from "next/server";
import { createClient } from "../../../../supabase/server";
import { createServiceClient } from "../../../../supabase/service";
import { scrapeWithoutAPI } from "@/utils/puppeteer-scraper";

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
    const service = createServiceClient();
    const { data } = await service
      .from("ai_settings")
      .select("provider, api_key, active_model")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .single();
    if (data?.api_key) aiProvider = data;
  } catch { /* AI is optional — scraping works without it */ }

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
      });

      let totalFound = 0;
      let totalFailed = 0;
      let currentChunk = 0;
      let chunkLeadCount = 0;
      const errorLog: string[] = [];

      try {
        // ── Chunk-aware onLead callback ──────────────────────────────────
        const onLead = (lead: any) => {
          // Detect chunk boundary
          if (chunkLeadCount === 0) {
            currentChunk++;
            send("chunk_start", {
              chunk: currentChunk,
              totalChunks,
              totalSoFar: totalFound,
            });
          }

          totalFound++;
          chunkLeadCount++;
          send("lead", { lead, count: totalFound, chunk: currentChunk });

          // Emit chunk_done every CHUNK_SIZE leads
          if (chunkLeadCount >= CHUNK_SIZE) {
            send("chunk_done", {
              chunk: currentChunk,
              totalChunks,
              chunkLeads: chunkLeadCount,
              totalFound,
              totalFailed,
              remaining: Math.max(0, maxResults - totalFound),
            });
            chunkLeadCount = 0;

            // Update job progress in DB
            if (jobId) {
              supabase
                .from("scrape_jobs")
                .update({
                  current_chunk: currentChunk,
                  total_scraped: totalFound,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", jobId)
                .then(() => {});
            }
          }

          // Emit overall progress every 5 leads
          if (totalFound % 5 === 0) {
            send("progress", {
              totalFound,
              totalFailed,
              remaining: Math.max(0, maxResults - totalFound),
              currentChunk,
              totalChunks,
              percentComplete: Math.round((totalFound / maxResults) * 100),
            });
          }
        };

        const leads = await scrapeWithoutAPI(
          niche.trim(),
          location.trim(),
          maxResults,
          onLead,
          aiProvider
        );

        // Fallback: if callback wasn't called (older scraper version)
        if (totalFound === 0 && leads.length > 0) {
          for (const lead of leads) {
            onLead(lead);
          }
        }

        // Flush any partial last chunk
        if (chunkLeadCount > 0) {
          send("chunk_done", {
            chunk: currentChunk,
            totalChunks,
            chunkLeads: chunkLeadCount,
            totalFound,
            totalFailed,
            remaining: 0,
          });
        }

        // Final progress
        send("progress", {
          totalFound,
          totalFailed,
          remaining: 0,
          currentChunk,
          totalChunks,
          percentComplete: 100,
        });

        send("done", {
          jobId,
          total: totalFound,
          totalFailed,
          realEmails: leads.filter((l: any) => l.emailIsReal).length,
          chunks: currentChunk,
        });

        // Mark job complete
        if (jobId) {
          await supabase
            .from("scrape_jobs")
            .update({
              status: "completed",
              total_scraped: totalFound,
              total_failed: totalFailed,
              current_chunk: currentChunk,
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
