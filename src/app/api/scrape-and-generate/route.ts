/**
 * Scrape + AI Email Generation — combined SSE pipeline.
 *
 * Phase 1: Scrape leads (Google Maps + Bing + DDG + Directories)
 * Phase 2: Generate personalised AI emails for every scraped lead
 *
 * Events streamed:
 *   start           — job started, phases announced
 *   lead            — a lead was scraped (phase 1)
 *   scrape_done     — phase 1 complete, phase 2 starting
 *   email           — an AI email was generated (phase 2)
 *   progress        — overall progress update
 *   done            — everything complete
 *   error           — fatal error
 */

import { NextRequest } from "next/server";
import { createClient } from "../../../../supabase/server";
import { createServiceClient } from "../../../../supabase/service";
import { scrapeWithoutAPI } from "@/utils/puppeteer-scraper";
import { runWithScrapeBrowserPool } from "@/utils/scrape-browser-pool";
import { getActiveAIProvider } from "@/utils/ai-scraper-helper";
import { getMapsBackendStatus } from "@/utils/gmaps-backend-status";
import {
  applySenderPlaceholders,
  buildSystemMessage,
  buildUserPrompt,
  DEFAULT_YOUR_COMPANY,
  EmailTone,
  parseEmailResponse,
  resolveGenerationModel,
} from "@/utils/email-prompts";
import { scoreEmailQuality } from "@/utils/email-quality";
import { isWeakLeadContext } from "@/utils/lead-context-builder";
import { resolveLeadIntel } from "@/utils/lead-intel";
import { formatPryroOfferForPrompt, getPryroProfile } from "@/utils/pryro-website-profile";

export const runtime = "nodejs";
export const maxDuration = 300;

const CHUNK_SIZE = 25;

async function callAI(
  provider: { provider: string; api_key: string; active_model: string | null },
  prompt: string,
  systemMessage: string,
  attempt = 0
): Promise<string> {
  const MAX_ATTEMPTS = 5;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  let url = "";
  let body: object;

  const model = resolveGenerationModel(provider.provider, provider.active_model);

  if (provider.provider === "openai") {
    url = "https://api.openai.com/v1/chat/completions";
    headers["Authorization"] = `Bearer ${provider.api_key}`;
    body = {
      model,
      messages: [
        { role: "system", content: systemMessage },
        { role: "user", content: prompt },
      ],
      temperature: 0.55,
      max_tokens: 550,
    };
  } else if (provider.provider === "anthropic") {
    url = "https://api.anthropic.com/v1/messages";
    headers["x-api-key"] = provider.api_key;
    headers["anthropic-version"] = "2023-06-01";
    body = {
      model,
      max_tokens: 550,
      system: systemMessage,
      messages: [{ role: "user", content: prompt }],
    };
  } else if (provider.provider === "gemini") {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${provider.api_key}`;
    headers["Authorization"] = "";
    body = {
      contents: [{ parts: [{ text: `${systemMessage}\n\n${prompt}` }] }],
      generationConfig: { temperature: 0.55, maxOutputTokens: 550 },
    };
  } else if (provider.provider === "mistral") {
    url = "https://api.mistral.ai/v1/chat/completions";
    headers["Authorization"] = `Bearer ${provider.api_key}`;
    body = {
      model,
      messages: [
        { role: "system", content: systemMessage },
        { role: "user", content: prompt },
      ],
      temperature: 0.55,
      max_tokens: 550,
    };
  } else {
    url = "https://api.groq.com/openai/v1/chat/completions";
    headers["Authorization"] = `Bearer ${provider.api_key}`;
    body = {
      model,
      messages: [
        { role: "system", content: systemMessage },
        { role: "user", content: prompt },
      ],
      temperature: 0.55,
      max_tokens: 550,
    };
  }

  // Remove empty Authorization header for Gemini
  if (!headers["Authorization"]) delete headers["Authorization"];

  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });

  if (res.status === 429) {
    if (attempt >= MAX_ATTEMPTS) throw new Error("rate_limit_exhausted");
    const retryAfter = res.headers.get("retry-after");
    const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 + 500 : Math.min(5000 * 2 ** attempt, 60000);
    await new Promise((r) => setTimeout(r, waitMs));
    return callAI(provider, prompt, systemMessage, attempt + 1);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`AI API error ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  if (provider.provider === "anthropic") return data.content[0].text as string;
  if (provider.provider === "gemini") return data.candidates[0].content.parts[0].text as string;
  return data.choices[0].message.content as string;
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const {
    niche, location, maxResults,
    yourCompany, yourService, tone, customPainPoint,
  } = await request.json() as {
    niche: string;
    location: string;
    maxResults: number;
    yourCompany?: string;
    yourService?: string;
    tone: string;
    customPainPoint?: string;
  };

  if (!niche?.trim() || !location?.trim()) {
    return new Response(JSON.stringify({ error: "Niche and location are required" }), { status: 400 });
  }

  const service = createServiceClient();

  let aiProvider = null as Awaited<ReturnType<typeof getActiveAIProvider>>;
  try {
    aiProvider = await getActiveAIProvider(user.id);
  } catch {
    /* AI optional for scraping */
  }

  // Load sender name from SMTP
  let senderName = "Sales Team";
  try {
    const { data: smtp } = await service
      .from("smtp_accounts")
      .select("email, sender_name")
      .eq("user_id", user.id)
      .eq("status", "active")
      .order("sent_today", { ascending: true })
      .limit(1)
      .single();
    if (smtp) {
      senderName = smtp.sender_name ||
        smtp.email.split("@")[0]
          .replace(/[._\-]/g, " ")
          .replace(/\b\w/g, (c: string) => c.toUpperCase());
    }
  } catch { /* use default */ }

  const pryroProfile = await getPryroProfile();
  const SYSTEM_MESSAGE = buildSystemMessage(senderName, "Executive Sales");
  const company = yourCompany?.trim() || pryroProfile.company || DEFAULT_YOUR_COMPANY;
  const serviceOffer =
    yourService?.trim() || formatPryroOfferForPrompt(pryroProfile);

  const mapsBackend = await getMapsBackendStatus();

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (event: string, data: object) => {
        try {
          controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch { /* client disconnected */ }
      };

      send("start", {
        niche, location, maxResults,
        hasAI: !!aiProvider,
        phases: ["scraping", "generating"],
        mapsBackend,
      });

      // ── PHASE 1: Scrape (multiple search rounds until target) ─────────
      const scrapedLeads: any[] = [];
      let scrapeCount = 0;
      const sharedSeen = new Set<string>();
      const totalChunks = Math.ceil(maxResults / CHUNK_SIZE);

      try {
        await runWithScrapeBrowserPool(async () => {
          for (let chunkNum = 1; chunkNum <= totalChunks && scrapeCount < maxResults; chunkNum++) {
            const chunkTarget = Math.min(CHUNK_SIZE, maxResults - scrapeCount);
            await scrapeWithoutAPI(
              niche.trim(),
              location.trim(),
              chunkTarget,
              (lead) => {
                scrapeCount++;
                scrapedLeads.push(lead);
                send("lead", { lead, count: scrapeCount, total: maxResults, chunk: chunkNum });
              },
              aiProvider,
              { seen: sharedSeen, round: chunkNum }
            );
          }
        });
      } catch (err: any) {
        send("error", { message: `Scraping failed: ${err?.message ?? "Unknown error"}` });
        controller.close();
        return;
      }

      send("scrape_done", {
        total: scrapedLeads.length,
        message: `Scraped ${scrapedLeads.length} leads. Starting AI email generation…`,
      });

      if (!aiProvider) {
        send("done", {
          scraped: scrapedLeads.length,
          emails: 0,
          message: "No AI provider configured — scraping complete. Set up AI in Settings to generate emails.",
        });
        controller.close();
        return;
      }

      // ── PHASE 2: Generate emails ──────────────────────────────────────
      // Provider-aware concurrency — Groq free tier is the bottleneck,
      // OpenAI/Anthropic/Gemini can handle much higher throughput.
      const providerLimits: Record<string, { concurrency: number; delayMs: number }> = {
        groq:      { concurrency: 5,  delayMs: 800  },
        openai:    { concurrency: 10, delayMs: 200  },
        anthropic: { concurrency: 10, delayMs: 200  },
        gemini:    { concurrency: 8,  delayMs: 300  },
        mistral:   { concurrency: 8,  delayMs: 300  },
      };
      const limits = providerLimits[aiProvider.provider] ?? { concurrency: 5, delayMs: 800 };
      const CONCURRENCY = limits.concurrency;
      const BATCH_DELAY = limits.delayMs;
      let emailCount = 0;
      let failCount = 0;

      const generateForLead = async (lead: any, idx: number) => {
        try {
          const leadInput = {
            company_name: lead.company_name,
            niche: lead.niche,
            location: lead.location,
            company_context: lead.company_context,
            website: lead.website,
            phone: lead.phone,
            rating: lead.rating,
          };
          const leadIntel = await resolveLeadIntel(leadInput, {
            aiProvider: aiProvider ?? undefined,
            useAi:
              !!aiProvider &&
              isWeakLeadContext(leadInput.company_context, lead.company_name),
          });
          const prompt = buildUserPrompt({
            lead: leadInput,
            yourCompany: company,
            yourService: serviceOffer,
            tone: (tone as EmailTone) || "Direct",
            customPainPoint,
            leadIntel,
            subjectFormulaIndex: idx,
          });
          const raw = await callAI(aiProvider!, prompt, SYSTEM_MESSAGE);
          let { subject, body } = parseEmailResponse(raw);
          body = applySenderPlaceholders(body, senderName, "Executive Sales", company);
          const quality = scoreEmailQuality(subject, body, lead.company_name);

          emailCount++;
          send("email", {
            email: {
              lead_id: lead.id ?? null,
              lead_email: lead.email,
              company_name: lead.company_name,
              subject,
              body,
              model: aiProvider!.active_model ?? aiProvider!.provider,
              isFallback: false,
              quality,
            },
            count: emailCount,
            total: scrapedLeads.length,
          });
        } catch (err: any) {
          failCount++;
          console.error(`AI failed for "${lead.company_name}":`, err?.message ?? err);
          // Send fallback email so the lead isn't lost
          emailCount++;
          send("email", {
            email: {
              lead_id: lead.id ?? null,
              lead_email: lead.email,
              company_name: lead.company_name,
              subject: `Quick idea for ${lead.company_name}`,
              body: `${lead.niche ?? "Businesses"} in ${lead.location ?? "your region"} often deal with manual workflows that slow teams down.\n\nPryro is an ERP platform that replaces those inefficiencies with one unified system.\n\nWould you be open to a 10-minute call to see if it's a fit?\n\nBest regards,\n${senderName}\nExecutive Sales\nPryro`,
              model: "Fallback",
              isFallback: true,
            },
            count: emailCount,
            total: scrapedLeads.length,
          });
        }

        // Progress every 5 emails
        if (emailCount % 5 === 0) {
          send("progress", {
            phase: "generating",
            emailCount,
            failCount,
            total: scrapedLeads.length,
            percentComplete: Math.round((emailCount / scrapedLeads.length) * 100),
          });
        }
      };

      for (let i = 0; i < scrapedLeads.length; i += CONCURRENCY) {
        const batch = scrapedLeads.slice(i, i + CONCURRENCY);
        await Promise.all(batch.map((lead, batchIdx) => generateForLead(lead, i + batchIdx)));
        if (i + CONCURRENCY < scrapedLeads.length) {
          await new Promise((r) => setTimeout(r, BATCH_DELAY));
        }
      }

      send("done", {
        scraped: scrapedLeads.length,
        emails: emailCount,
        fallbacks: failCount,
        message: `Done! ${scrapedLeads.length} leads scraped, ${emailCount} emails generated.`,
      });

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
