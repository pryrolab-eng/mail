/**
 * Server-side bulk email generation with built-in rate limit handling.
 *
 * Why server-side?
 * - The browser can't reliably sleep/retry across 60 leads without the tab
 *   freezing or the user navigating away.
 * - The server can read the Retry-After header from Groq and wait exactly
 *   the right amount of time before retrying.
 * - One HTTP round-trip from the browser instead of 60.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "../../../../supabase/server";
import { createServiceClient } from "../../../../supabase/service";

export const runtime = "nodejs";
// Allow up to 5 minutes — 60 leads × ~4 s each = ~4 min worst case
export const maxDuration = 300;

interface LeadInput {
  id: string;
  company_name: string;
  niche: string | null;
  location: string | null;
  company_context: string | null;
  email: string | null;
}

interface GeneratedEmail {
  lead_id: string;
  lead_email: string | null;
  company_name: string;
  subject: string;
  body: string;
  model: string;
  isFallback: boolean;
}

// ─── Tone prompts ─────────────────────────────────────────────────────────────

function buildPrompt(
  lead: LeadInput,
  yourCompany: string,
  yourService: string,
  tone: string,
  customPainPoint?: string
): string {
  const context = lead.company_context?.slice(0, 600) ?? "No additional context available";

  const toneBlock =
    tone === "Aggressive"
      ? `Write a high-urgency, pattern-interrupting cold email that creates genuine FOMO.
- Open with a bold, provocative statement about a costly problem in their industry
- Quantify the pain: use realistic numbers, percentages, or time wasted
- Create urgency: limited availability or a window they're about to miss
- End with a direct binary CTA: "Are you open to a 20-minute call this week — yes or no?"
- 120–180 words, punchy paragraphs`
      : tone === "Surgical"
      ? `Write a hyper-personalized cold email that proves you did your homework.
- Open by referencing something specific from their company context
- Connect that detail to a challenge that naturally follows
- Explain how ${yourService} addresses that exact challenge
- Close with a consultative CTA that feels like a natural next step
- 150–220 words`
      : /* Direct */ `Write a HARD DIRECT cold email. NO politeness. NO fluff.
STRUCTURE (80-120 words):
1. SUBJECT: state a specific problem they have
2. OPENING: state the problem immediately — no greeting, no "I came across"
3. SOLUTION: one sentence on what ${yourService} does
4. PROOF: one concrete result or timeframe
5. CTA: "15-minute call this week?"

BANNED: "I'd love to" / "reaching out" / "I came across" / "Looking forward" / "Would you be available" / "I hope"`;

  return `You are an elite B2B cold email copywriter. Write emails that are DIRECT, PROBLEM-FOCUSED, and get responses.

=== SENDER ===
Company: ${yourCompany}
Service: ${yourService}

=== TARGET ===
Company: ${lead.company_name}
Niche: ${lead.niche ?? "Unknown"}
Location: ${lead.location ?? "Unknown"}
Context: ${context}
${customPainPoint ? `\n=== PAIN POINT ===\n${customPainPoint}\n` : ""}
=== INSTRUCTIONS ===
${toneBlock}

=== RULES ===
- Subject must state a specific problem
- NO "Hi", "Hello", "Dear", "I hope", "reaching out", "I came across"
- Start immediately with the problem
- End with a direct question
- NO signature block or name placeholder

Respond EXACTLY in this format (nothing before or after):
SUBJECT: [subject line, max 60 chars]
BODY: [email body]`;
}

// ─── Call AI with retry on 429 ────────────────────────────────────────────────

async function callAI(
  provider: { provider: string; api_key: string; active_model: string | null },
  prompt: string,
  attempt = 0
): Promise<string> {
  const MAX_ATTEMPTS = 5;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  let url = "";
  let body: object;

  if (provider.provider === "openai") {
    url = "https://api.openai.com/v1/chat/completions";
    headers["Authorization"] = `Bearer ${provider.api_key}`;
    body = {
      model: provider.active_model ?? "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a HARD DIRECT B2B cold email copywriter. Follow the exact output format: SUBJECT: ... BODY: ..." },
        { role: "user", content: prompt },
      ],
      temperature: 0.75,
      max_tokens: 900,
    };
  } else if (provider.provider === "anthropic") {
    url = "https://api.anthropic.com/v1/messages";
    headers["x-api-key"] = provider.api_key;
    headers["anthropic-version"] = "2023-06-01";
    body = {
      model: provider.active_model ?? "claude-3-5-sonnet-20241022",
      max_tokens: 900,
      system: "You are a HARD DIRECT B2B cold email copywriter. Follow the exact output format: SUBJECT: ... BODY: ...",
      messages: [{ role: "user", content: prompt }],
    };
  } else {
    // Groq (default)
    url = "https://api.groq.com/openai/v1/chat/completions";
    headers["Authorization"] = `Bearer ${provider.api_key}`;
    body = {
      model: provider.active_model ?? "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: "You are a HARD DIRECT B2B cold email copywriter. Follow the exact output format: SUBJECT: ... BODY: ..." },
        { role: "user", content: prompt },
      ],
      temperature: 0.75,
      max_tokens: 900,
    };
  }

  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });

  if (res.status === 429) {
    if (attempt >= MAX_ATTEMPTS) throw new Error("rate_limit_exhausted");

    // Read Retry-After header; fall back to exponential back-off
    const retryAfter = res.headers.get("retry-after");
    const waitMs = retryAfter
      ? parseInt(retryAfter, 10) * 1000 + 500
      : Math.min(2000 * 2 ** attempt, 30000); // 2s, 4s, 8s, 16s, 30s

    console.log(`[generate-emails-bulk] 429 — waiting ${waitMs}ms before retry ${attempt + 1}/${MAX_ATTEMPTS}`);
    await new Promise((r) => setTimeout(r, waitMs));
    return callAI(provider, prompt, attempt + 1);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`AI API error ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();

  if (provider.provider === "anthropic") return data.content[0].text as string;
  return data.choices[0].message.content as string;
}

// ─── Parse AI response ────────────────────────────────────────────────────────

function parseResponse(raw: string): { subject: string; body: string } {
  const subjectMatch = raw.match(/SUBJECT:\s*(.+?)(?:\n|$)/i);
  const bodyMatch = raw.match(/BODY:\s*([\s\S]+?)$/i);

  if (subjectMatch && bodyMatch) {
    return {
      subject: subjectMatch[1].replace(/^["']|["']$/g, "").trim(),
      body: bodyMatch[1].replace(/^["']|["']$/g, "").trim(),
    };
  }

  // Fallback: first line = subject, rest = body
  const lines = raw.trim().split("\n");
  if (lines.length >= 2) {
    return {
      subject: lines[0].replace(/^(SUBJECT:|Subject:)/i, "").trim(),
      body: lines.slice(1).join("\n").replace(/^(BODY:|Body:)/i, "").trim(),
    };
  }

  throw new Error("Could not parse AI response");
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    // Auth
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { leads, yourCompany, yourService, tone, customPainPoint } = await request.json() as {
      leads: LeadInput[];
      yourCompany: string;
      yourService: string;
      tone: string;
      customPainPoint?: string;
    };

    if (!leads?.length) {
      return NextResponse.json({ error: "No leads provided" }, { status: 400 });
    }

    // Fetch AI provider — same table the rest of the app uses
    const serviceSupabase = createServiceClient();
    let { data: aiProvider } = await serviceSupabase
      .from("ai_settings")
      .select("provider, api_key, active_model")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .maybeSingle();

    if (!aiProvider?.api_key) {
      // Fall back to any configured provider
      const { data: anyProvider } = await serviceSupabase
        .from("ai_settings")
        .select("provider, api_key, active_model")
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle();
      aiProvider = anyProvider;
    }

    if (!aiProvider?.api_key) {
      return NextResponse.json(
        { error: "No AI provider configured. Please add your API key in AI Settings." },
        { status: 400 }
      );
    }

    const results: GeneratedEmail[] = [];
    let rateLimitHits = 0;

    for (let i = 0; i < leads.length; i++) {
      const lead = leads[i];

      try {
        const prompt = buildPrompt(lead, yourCompany, yourService, tone, customPainPoint);
        const raw = await callAI(aiProvider, prompt);
        const { subject, body } = parseResponse(raw);

        results.push({
          lead_id: lead.id,
          lead_email: lead.email,
          company_name: lead.company_name,
          subject,
          body,
          model: aiProvider.active_model ?? aiProvider.provider,
          isFallback: false,
        });

        // Pace requests: 2.5 s between calls = 24 req/min, safely under the 30/min limit
        if (i < leads.length - 1) {
          await new Promise((r) => setTimeout(r, 2500));
        }
      } catch (err: any) {
        if (err.message === "rate_limit_exhausted") {
          rateLimitHits++;
          // Use a fallback template so the user still gets something
        }

        // Fallback template — always better than nothing
        const subject = `Quick question about ${lead.company_name}`;
        const body = `${lead.company_name} — most ${lead.niche ?? "businesses"} in ${lead.location ?? "your area"} are dealing with [specific problem].\n\n${yourService} fixes this. Setup takes under a day.\n\n15-minute call this week?\n\n${yourCompany}`;

        results.push({
          lead_id: lead.id,
          lead_email: lead.email,
          company_name: lead.company_name,
          subject,
          body,
          model: "Fallback",
          isFallback: true,
        });
      }
    }

    const aiCount = results.filter((r) => !r.isFallback).length;
    const fallbackCount = results.filter((r) => r.isFallback).length;

    return NextResponse.json({
      success: true,
      emails: results,
      stats: { total: results.length, ai: aiCount, fallback: fallbackCount, rateLimitHits },
    });
  } catch (error: any) {
    console.error("[generate-emails-bulk] error:", error);
    return NextResponse.json({ error: error.message ?? "Internal error" }, { status: 500 });
  }
}
