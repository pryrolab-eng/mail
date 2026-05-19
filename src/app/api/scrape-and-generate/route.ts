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

export const runtime = "nodejs";
export const maxDuration = 300;

// ─── AI helpers ───────────────────────────────────────────────────────────────

function buildSystemMessage(senderName: string): string {
  return `You are a senior B2B sales executive writing cold outreach emails on behalf of Pryro.

EXACT FORMAT TO FOLLOW:

[One sentence — state something true and relevant about their industry or business situation. No compliments. No "I noticed". Just a plain observation.]

[One or two sentences — mention what Pryro does, but keep it brief and humble. Do NOT list features. Do NOT say "we help companies like yours". Say what it does in plain language, like you're explaining it to a friend.]

[One sentence — a soft ask. Request a short call to see if it makes sense. Frame it as "if it's relevant" or "only if it makes sense for you". Never pressure.]

Best regards,
${senderName}
Executive Sales
Pryro

BODY RULES:
- Maximum 80 words total. Count them. Cut anything over 80.
- Write like a human, not a company. Use "I" not "we" where possible.
- ONE idea per paragraph. Three short paragraphs maximum.
- No bullet points. No bold text. No markdown. Plain sentences only.
- The email should sound like it was written in 3 minutes by a real person.

SUBJECT LINE RULES:
Write ONE unique subject line. 6 to 8 words. Feel like a real person typed it.
Pick ONE formula:
Formula A — "Had a thought about [Company Name]"
Formula B — "Something that might help [Company Name]"
Formula C — "Quick idea for your [niche] team"
Formula D — "Worth a 10-minute chat, [Company Name]?"
Formula E — "What other [niche] owners are doing differently"
Formula F — "Cutting manual work for [niche] businesses"
Formula G — "Helping [Company Name] save time on admin"

BANNED WORDS: "reach out", "I noticed", "synergy", "leverage", "game-changer",
"excited to", "I am writing to", "Streamline", "I'd love to", "Unlock",
"manual workflows", "unified platform", "operational efficiency",
"companies like yours", "help you achieve"

SIGNATURE — always on separate lines:
Best regards,
${senderName}
Executive Sales
Pryro

Respond ONLY in this exact format:
SUBJECT: [subject line]
BODY: [email body]`;
}

const TONE_ADDITIONS: Record<string, string> = {
  Direct:     `Tone: Direct and concise. Open with business context in one sentence. State value clearly. End with simple meeting request. No filler. Max 120 words.`,
  Aggressive: `Tone: Confident and opportunity-focused. Open with a specific industry challenge. Make the value impossible to ignore. CTA: ask for a 10-minute call this week. Max 140 words.`,
  Surgical:   `Tone: Hyper-personalized and consultative. Reference their specific industry and context. Sound like a trusted advisor, not a vendor. Max 150 words.`,
};

function buildEmailPrompt(
  lead: { company_name: string; niche: string | null; location: string | null; company_context: string | null },
  yourCompany: string,
  yourService: string,
  tone: string,
  customPainPoint: string | undefined,
  idx: number
): string {
  const formulaHints = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
  const formulaHint = formulaHints[idx % formulaHints.length];
  const context = lead.company_context?.slice(0, 300) ?? "";
  return `Write a Pryro outreach email.
Sender: ${yourCompany} — ${yourService}
Recipient: ${lead.company_name} | ${lead.niche ?? "Business"} | ${lead.location ?? ""}${context ? `\nContext: ${context}` : ""}${customPainPoint ? `\nPain point: ${customPainPoint}` : ""}
Use subject Formula ${formulaHint} from the rules above.
${TONE_ADDITIONS[tone] ?? TONE_ADDITIONS["Direct"]}`;
}

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

  if (provider.provider === "openai") {
    url = "https://api.openai.com/v1/chat/completions";
    headers["Authorization"] = `Bearer ${provider.api_key}`;
    body = { model: provider.active_model ?? "gpt-4o-mini", messages: [{ role: "system", content: systemMessage }, { role: "user", content: prompt }], temperature: 0.4, max_tokens: 400 };
  } else if (provider.provider === "anthropic") {
    url = "https://api.anthropic.com/v1/messages";
    headers["x-api-key"] = provider.api_key;
    headers["anthropic-version"] = "2023-06-01";
    body = { model: provider.active_model ?? "claude-3-5-haiku-20241022", max_tokens: 400, system: systemMessage, messages: [{ role: "user", content: prompt }] };
  } else if (provider.provider === "gemini") {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${provider.active_model ?? "gemini-1.5-flash"}:generateContent?key=${provider.api_key}`;
    headers["Authorization"] = "";
    body = { contents: [{ parts: [{ text: systemMessage + "\n\n" + prompt }] }], generationConfig: { temperature: 0.4, maxOutputTokens: 400 } };
  } else if (provider.provider === "mistral") {
    url = "https://api.mistral.ai/v1/chat/completions";
    headers["Authorization"] = `Bearer ${provider.api_key}`;
    body = { model: provider.active_model ?? "mistral-small", messages: [{ role: "system", content: systemMessage }, { role: "user", content: prompt }], temperature: 0.4, max_tokens: 400 };
  } else {
    // groq (default)
    url = "https://api.groq.com/openai/v1/chat/completions";
    headers["Authorization"] = `Bearer ${provider.api_key}`;
    body = { model: provider.active_model ?? "llama-3.1-8b-instant", messages: [{ role: "system", content: systemMessage }, { role: "user", content: prompt }], temperature: 0.4, max_tokens: 400 };
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

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/`(.+?)`/g, "$1")
    .replace(/_{1,2}(.+?)_{1,2}/g, "$1")
    .trim();
}

function parseAIResponse(raw: string): { subject: string; body: string } {
  const subjectMatch = raw.match(/SUBJECT:\s*(.+?)(?:\n|$)/i);
  const bodyMatch = raw.match(/BODY:\s*([\s\S]+?)$/i);
  if (subjectMatch && bodyMatch) {
    return {
      subject: stripMarkdown(subjectMatch[1].replace(/^["']|["']$/g, "").trim()),
      body: stripMarkdown(bodyMatch[1].replace(/^["']|["']$/g, "").trim()),
    };
  }
  const lines = raw.trim().split("\n");
  if (lines.length >= 2) {
    return {
      subject: stripMarkdown(lines[0].replace(/^(SUBJECT:|Subject:)/i, "").trim()),
      body: stripMarkdown(lines.slice(1).join("\n").replace(/^(BODY:|Body:)/i, "").trim()),
    };
  }
  throw new Error("Could not parse AI response");
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
    yourCompany: string;
    yourService: string;
    tone: string;
    customPainPoint?: string;
  };

  if (!niche?.trim() || !location?.trim()) {
    return new Response(JSON.stringify({ error: "Niche and location are required" }), { status: 400 });
  }

  const service = createServiceClient();

  // Load AI provider
  let aiProvider: { provider: string; api_key: string; active_model: string | null } | null = null;
  try {
    const { data } = await service
      .from("ai_settings")
      .select("provider, api_key, active_model")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .maybeSingle();
    if (data?.api_key) aiProvider = data;
    if (!aiProvider) {
      const { data: any2 } = await service
        .from("ai_settings")
        .select("provider, api_key, active_model")
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle();
      if (any2?.api_key) aiProvider = any2;
    }
  } catch { /* AI optional for scraping */ }

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

  const SYSTEM_MESSAGE = buildSystemMessage(senderName);

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
      });

      // ── PHASE 1: Scrape ───────────────────────────────────────────────
      const scrapedLeads: any[] = [];
      let scrapeCount = 0;

      try {
        await scrapeWithoutAPI(
          niche.trim(),
          location.trim(),
          maxResults,
          (lead) => {
            scrapeCount++;
            scrapedLeads.push(lead);
            send("lead", { lead, count: scrapeCount, total: maxResults });
          },
          aiProvider
        );
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
          const prompt = buildEmailPrompt(lead, yourCompany, yourService, tone, customPainPoint, idx);
          const raw = await callAI(aiProvider!, prompt, SYSTEM_MESSAGE);
          let { subject, body } = parseAIResponse(raw);

          body = body
            .replace(/\[Sender Name\]/gi, senderName)
            .replace(/\[Your Name\]/gi, senderName)
            .replace(/\[Name\]/gi, senderName);

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
