/**
 * Streaming bulk email generation via Server-Sent Events.
 * Each email is sent to the client as soon as it's ready —
 * the user sees emails appear one by one instead of waiting for all.
 */

import { NextRequest } from "next/server";
import { createClient } from "../../../../supabase/server";
import { createServiceClient } from "../../../../supabase/service";

export const runtime = "nodejs";
export const maxDuration = 300;

interface LeadInput {
  id: string;
  company_name: string;
  niche: string | null;
  location: string | null;
  company_context: string | null;
  email: string | null;
}

// ─── System message ───────────────────────────────────────────────────────────
const SYSTEM_MESSAGE = `You are a senior B2B sales executive writing cold outreach emails on behalf of Pryro.

EXACT FORMAT TO FOLLOW:

[Opening line: one sentence connecting to the recipient's industry or business context. No flattery.]

[Second paragraph: explain what Pryro does and how it helps their type of business. Mention replacing manual workflows, Excel-based operations, or fragmented tools with a unified ERP platform. Mention 20-30% commission for referrals where relevant.]

[Third paragraph: one humble CTA — ask for a 10-15 minute meeting to explore fit.]

Best regards,
[Sender Name]
Executive Sales
Pryro

SUBJECT LINE RULES:
- Pick ONE subject from this exact list — choose the most relevant:
  · "Partnership Opportunity with [Company Name] in ERP Solutions"
  · "Exploring ERP Referral Collaboration with [Company Name]"
  · "Business Collaboration Opportunity for ERP Services"
  · "ERP Partnership Proposal for [Company Name]"
  · "Referral Partnership Opportunity with Pryro ERP"
  · "Commission-Based ERP Partnership Opportunity"
  · "ERP Solutions Partnership Discussion with [Company Name]"
  · "Opportunity to Partner with Pryro ERP"
  · "Strategic ERP Referral Opportunity for [Company Name]"
  · "Potential ERP Collaboration with [Company Name]"
  · "Partner with Pryro for ERP Referrals"
  · "ERP Consulting Partnership Opportunity for [Company Name]"
  · "Revenue Partnership Opportunity in ERP Solutions"
  · "10-Minute Discussion on ERP Collaboration"
  · "ERP Referral Program for Consulting Partners"
  · "Partnership Discussion: ERP and Business Automation"
  · "ERP Business Expansion Opportunity for [Company Name]"
  · "Short Discussion on ERP Partnership Opportunities"
  · "Collaborative ERP Opportunity for [Company Name]"
  · "Pryro ERP Partnership and Referral Program"
- Replace [Company Name] with the actual recipient company name
- NEVER invent a new subject — only use from the list above
- NEVER use generic subjects like "Streamline Your Operations" or "Quick Question"
- Subject MUST be 5 to 8 words — count before using
- No questions, no symbols, no ALL CAPS, no exclamation marks

BANNED WORDS: "reach out", "I noticed", "I came across", "I hope this email finds you well",
"I wanted to", "touching base", "synergy", "leverage", "game-changer", "excited to",
"thrilled to", "I am writing to", "Streamline", "I'd love to", "would love to", "Unlock"

SIGNATURE FORMAT — always on separate lines, never on one line:
Best regards,
[Sender Name]
Executive Sales
Pryro

ANTI-SPAM: Plain text only. No markdown. No bullet points. Short paragraphs. One CTA only.
100-160 words max for the body.

Respond ONLY in this exact format:
SUBJECT: [subject from approved list, 5-8 words]
BODY: [email body]`;

const TONE_ADDITIONS: Record<string, string> = {
  Direct:     `Tone: Direct and concise. Open with business context in one sentence. State value clearly. End with simple meeting request. No filler. Max 120 words.`,
  Aggressive: `Tone: Confident and opportunity-focused. Open with a specific industry challenge. Make the value impossible to ignore. CTA: ask for a 10-minute call this week. Max 140 words.`,
  Surgical:   `Tone: Hyper-personalized and consultative. Reference their specific industry and context. Sound like a trusted advisor, not a vendor. Max 150 words.`,
};

function buildPrompt(lead: LeadInput, yourCompany: string, yourService: string, tone: string, customPainPoint?: string): string {
  const context = lead.company_context?.slice(0, 300) ?? "";
  const toneInstruction = TONE_ADDITIONS[tone] ?? TONE_ADDITIONS["Direct"];
  return `Write a Pryro outreach email.
Sender: ${yourCompany} — ${yourService}
Recipient: ${lead.company_name} | ${lead.niche ?? "Business"} | ${lead.location ?? ""}${context ? `\nContext: ${context}` : ""}${customPainPoint ? `\nPain point: ${customPainPoint}` : ""}
${toneInstruction}`;
}

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
    body = { model: provider.active_model ?? "gpt-4o-mini", messages: [{ role: "system", content: SYSTEM_MESSAGE }, { role: "user", content: prompt }], temperature: 0.4, max_tokens: 400 };
  } else if (provider.provider === "anthropic") {
    url = "https://api.anthropic.com/v1/messages";
    headers["x-api-key"] = provider.api_key;
    headers["anthropic-version"] = "2023-06-01";
    body = { model: provider.active_model ?? "claude-3-5-haiku-20241022", max_tokens: 400, system: SYSTEM_MESSAGE, messages: [{ role: "user", content: prompt }] };
  } else {
    url = "https://api.groq.com/openai/v1/chat/completions";
    headers["Authorization"] = `Bearer ${provider.api_key}`;
    body = { model: provider.active_model ?? "llama-3.1-8b-instant", messages: [{ role: "system", content: SYSTEM_MESSAGE }, { role: "user", content: prompt }], temperature: 0.4, max_tokens: 400 };
  }

  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });

  if (res.status === 429) {
    if (attempt >= MAX_ATTEMPTS) throw new Error("rate_limit_exhausted");
    const retryAfter = res.headers.get("retry-after");
    const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 + 500 : Math.min(2000 * 2 ** attempt, 30000);
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

function parseResponse(raw: string): { subject: string; body: string } {
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

// ─── SSE streaming POST handler ───────────────────────────────────────────────
export async function POST(request: NextRequest) {
  // Auth
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const { leads, yourCompany, yourService, tone, customPainPoint } = await request.json() as {
    leads: LeadInput[];
    yourCompany: string;
    yourService: string;
    tone: string;
    customPainPoint?: string;
  };

  if (!leads?.length) {
    return new Response(JSON.stringify({ error: "No leads provided" }), { status: 400 });
  }

  // Fetch AI provider
  const serviceSupabase = createServiceClient();
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

  const provider = aiProvider;
  const CONCURRENCY = 15;

  const makeFallback = (lead: LeadInput) => ({
    lead_id: lead.id,
    lead_email: lead.email,
    company_name: lead.company_name,
    subject: `Helping ${lead.company_name} improve operations with AI`,
    body: `Dear ${lead.company_name} Team,\n\nMany ${lead.niche ?? "businesses"} in ${lead.location ?? "your region"} are facing challenges with operational efficiency and workflow management.\n\nAt Pryro, we help companies like yours save time, reduce manual work, and scale effectively through AI automation and custom software solutions.\n\nWould you be open to a quick 15-minute discovery call this week?\n\nBest regards,\n${yourCompany}`,
    model: "Fallback",
    isFallback: true,
  });

  // ── SSE stream ────────────────────────────────────────────────────────────
  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();

      const send = (event: string, data: object) => {
        controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      // Send total count so client can show progress
      send("start", { total: leads.length });

      let done = 0;
      let fallbacks = 0;

      const processLead = async (lead: LeadInput) => {
        try {
          const prompt = buildPrompt(lead, yourCompany, yourService, tone, customPainPoint);
          const raw = await callAI(provider, prompt);
          const { subject, body } = parseResponse(raw);
          const email = {
            lead_id: lead.id,
            lead_email: lead.email,
            company_name: lead.company_name,
            subject,
            body,
            model: provider.active_model ?? provider.provider,
            isFallback: false,
          };
          done++;
          send("email", { email, done, total: leads.length });
          return email;
        } catch {
          const email = makeFallback(lead);
          done++;
          fallbacks++;
          send("email", { email, done, total: leads.length });
          return email;
        }
      };

      // Process in parallel batches, stream each result immediately
      for (let i = 0; i < leads.length; i += CONCURRENCY) {
        const batch = leads.slice(i, i + CONCURRENCY);
        await Promise.all(batch.map(processLead));
        if (i + CONCURRENCY < leads.length) {
          await new Promise((r) => setTimeout(r, 200));
        }
      }

      send("done", {
        total: leads.length,
        ai: leads.length - fallbacks,
        fallback: fallbacks,
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
