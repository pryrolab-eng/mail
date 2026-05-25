/**
 * Streaming bulk email generation via Server-Sent Events.
 * Each email is sent to the client as soon as it's ready —
 * the user sees emails appear one by one instead of waiting for all.
 */

import { NextRequest } from "next/server";
import { createClient } from "../../../../supabase/server";
import { createServiceClient } from "../../../../supabase/service";
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
import { loadAIProviderForUser } from "@/utils/load-ai-provider-server";
import { formatPryroOfferForPrompt, getPryroProfile } from "@/utils/pryro-website-profile";
import { isJunkCompanyName } from "@/utils/scrape-lead-quality";
import {
  meetsMinEmailConfidence,
  type EmailConfidence,
} from "@/utils/scrape-email-meta";

export const runtime = "nodejs";
export const maxDuration = 300;

interface LeadInput {
  id: string;
  company_name: string;
  niche: string | null;
  location: string | null;
  company_context: string | null;
  email: string | null;
  website?: string | null;
  phone?: string | null;
  email_confidence?: string | null;
}

function cleanCompanyName(name: string): string {
  return name
    .replace(/\s*[-|–·]\s*.+$/, '')   // strip "Company - Location" suffix
    .replace(/\s*,\s*.+$/, '')          // strip "Company, City" suffix
    .replace(/\s+/g, ' ')
    .trim();
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
  return data.choices[0].message.content as string;
}

// ─── SSE streaming POST handler ───────────────────────────────────────────────
export async function POST(request: NextRequest) {
  // Auth
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const body = await request.json() as {
    leads: LeadInput[];
    yourCompany?: string;
    yourService?: string;
    tone: string;
    customPainPoint?: string;
    /** Skip leads below this confidence (default medium = high + medium only). */
    minEmailConfidence?: EmailConfidence;
  };
  const { leads, tone, customPainPoint } = body;
  const minConfidence = (body.minEmailConfidence ?? "medium") as EmailConfidence;

  const eligible = (leads ?? []).filter((l) => {
    if (!l.email?.trim()) return false;
    if (isJunkCompanyName(l.company_name)) return false;
    return meetsMinEmailConfidence(l.email_confidence, minConfidence);
  });

  if (!eligible.length) {
    return new Response(
      JSON.stringify({
        error:
          "No leads with email at the selected confidence level. Run research or retry enrich first.",
      }),
      { status: 400 }
    );
  }

  const pryroProfile = await getPryroProfile();
  const yourCompany = body.yourCompany?.trim() || pryroProfile.company || DEFAULT_YOUR_COMPANY;
  const yourService =
    body.yourService?.trim() || formatPryroOfferForPrompt(pryroProfile);

  const serviceSupabase = createServiceClient();
  const intelAiProvider = await loadAIProviderForUser(supabase);

  // Fetch AI provider
  let { data: aiProvider } = await serviceSupabase
    .from("ai_settings").select("provider, api_key, active_model")
    .eq("user_id", user.id).eq("is_active", true).maybeSingle();

  if (!aiProvider?.api_key) {
    const { data: any } = await serviceSupabase
      .from("ai_settings").select("provider, api_key, active_model")
      .eq("user_id", user.id).limit(1).maybeSingle();
    aiProvider = any;
  }

  if (!aiProvider?.api_key) {
    return new Response(JSON.stringify({ error: "No AI provider configured." }), { status: 400 });
  }

  // Fetch sender name from SMTP account
  let senderName = "Sales Team";
  try {
    const { data: smtpAccount } = await serviceSupabase
      .from("smtp_accounts")
      .select("email, sender_name")
      .eq("user_id", user.id)
      .eq("status", "active")
      .order("sent_today", { ascending: true })
      .limit(1)
      .single();
    if (smtpAccount) {
      senderName = smtpAccount.sender_name ||
        smtpAccount.email.split("@")[0]
          .replace(/[._\-]/g, " ")
          .replace(/\b\w/g, (c: string) => c.toUpperCase());
    }
  } catch { /* use default */ }

  const SYSTEM_MESSAGE = buildSystemMessage(senderName, "Executive Sales");
  const provider = aiProvider;

  // ── Provider-aware rate limiting ──────────────────────────────────────────
  // Groq free tier: ~30 req/min → concurrency 5, 800ms delay
  // Groq paid tier / OpenAI / Anthropic / Gemini / Mistral: much higher limits
  const providerLimits: Record<string, { concurrency: number; delayMs: number }> = {
    groq:      { concurrency: 5,  delayMs: 800  },
    openai:    { concurrency: 10, delayMs: 200  },
    anthropic: { concurrency: 10, delayMs: 200  },
    gemini:    { concurrency: 8,  delayMs: 300  },
    mistral:   { concurrency: 8,  delayMs: 300  },
  };
  const limits = providerLimits[provider.provider] ?? { concurrency: 5, delayMs: 800 };
  const CONCURRENCY = limits.concurrency;
  const BATCH_DELAY = limits.delayMs;

  const makeFallback = (lead: LeadInput) => {
    const name = cleanCompanyName(lead.company_name);
    return {
      lead_id: lead.id,
      lead_email: lead.email,
      company_name: name,
      subject: `Quick idea for ${name}`,
      body: `${lead.niche ?? "Businesses"} in ${lead.location ?? "your region"} often juggle admin across spreadsheets and separate apps.\n\n${yourService}\n\nOpen to a 10-minute call to see if it's relevant?\n\nBest regards,\n${senderName}\nExecutive Sales\nPryro`,
      model: "Fallback",
      isFallback: true,
    };
  };

  // ── SSE stream ────────────────────────────────────────────────────────────
  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();

      const send = (event: string, data: object) => {
        controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      // Send total count so client can show progress
      send("start", { total: eligible.length, skippedLowConfidence: leads.length - eligible.length });

      let done = 0;
      let fallbacks = 0;

      const processLead = async (lead: LeadInput, idx: number) => {
        // Skip junk scrape results — search titles, not real companies
        if (isJunkCompanyName(lead.company_name)) {
          console.warn(`⏭  Skipping junk lead: "${lead.company_name}"`);
          done++;
          send("skipped", { company_name: lead.company_name, done, total: eligible.length });
          return null;
        }

        const cleanedName = cleanCompanyName(lead.company_name);
        const cleanedLead = { ...lead, company_name: cleanedName };

        try {
          const leadIntel = await resolveLeadIntel(cleanedLead, {
            aiProvider: intelAiProvider,
            useAi:
              !!intelAiProvider &&
              isWeakLeadContext(cleanedLead.company_context, cleanedName),
          });
          const prompt = buildUserPrompt({
            lead: cleanedLead,
            yourCompany,
            yourService,
            tone: (tone as EmailTone) || "Direct",
            customPainPoint,
            leadIntel,
            subjectFormulaIndex: idx,
          });
          const raw = await callAI(provider, prompt, SYSTEM_MESSAGE);
          let { subject, body } = parseEmailResponse(raw);
          body = applySenderPlaceholders(body, senderName, "Executive Sales", yourCompany);
          subject = subject
            .replace(/List of [^,\n]+/gi, cleanedName)
            .replace(/\[Company Name\]/gi, cleanedName);
          const quality = scoreEmailQuality(subject, body, cleanedName);
          const email = {
            lead_id: lead.id,
            lead_email: lead.email,
            company_name: cleanedName,
            subject,
            body,
            model: provider.active_model ?? provider.provider,
            isFallback: false,
            quality,
          };
          done++;
          send("email", { email, done, total: eligible.length });
          return email;
        } catch (err: any) {
          // Log the actual error so we know why AI failed
          console.error(`AI failed for "${cleanedName}":`, err?.message ?? err);
          const email = makeFallback(cleanedLead);
          done++;
          fallbacks++;
          send("email", { email, done, total: eligible.length });
          return email;
        }
      };

      // Process in parallel batches, stream each result immediately
      for (let i = 0; i < eligible.length; i += CONCURRENCY) {
        const batch = eligible.slice(i, i + CONCURRENCY);
        await Promise.all(batch.map((lead, batchIdx) => processLead(lead, i + batchIdx)));
        if (i + CONCURRENCY < eligible.length) {
          // Pause between batches — duration depends on provider rate limits
          await new Promise((r) => setTimeout(r, BATCH_DELAY));
        }
      }

      send("done", {
        total: eligible.length,
        ai: eligible.length - fallbacks,
        fallback: fallbacks,
        skippedLowConfidence: leads.length - eligible.length,
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
