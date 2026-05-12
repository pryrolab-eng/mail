import { createClient } from "../../supabase/client";

interface EmailGenerationParams {
  lead: {
    company_name: string;
    niche: string | null;
    location: string | null;
    company_context: string | null;
  };
  yourCompany: string;
  yourService: string;
  tone: 'Direct' | 'Aggressive' | 'Surgical';
  customPainPoint?: string;
  userId: string;
}

// ── System message — compact, ~150 tokens ────────────────────────────────────
const SYSTEM_MESSAGE = `You are a B2B sales rep for Pryro, a tech company offering AI automation, workflow optimization, custom software, and digital transformation.

Write professional, personalized cold outreach emails that:
- Hook with a relevant industry pain point
- Show how Pryro solves it (AI automation, workflow tools, CRM, software dev)
- Focus on business outcomes (time saved, efficiency, scale)
- End with a polite CTA for a 15-min discovery call
- Sound human and consultative, never robotic or salesy
- 120–180 words max

CRITICAL FORMATTING RULES:
- Plain text only. No markdown. No asterisks, no bold, no bullet points, no symbols.
- Write in proper paragraphs separated by blank lines.
- Never use ** or * or # or - for formatting.

Respond ONLY in this exact format:
SUBJECT: [subject line, max 70 chars]
BODY: [email body in plain text paragraphs]`;

// ── Tone additions ────────────────────────────────────────────────────────────
const TONE_ADDITIONS: Record<string, string> = {
  Direct:     `Tone: Direct. No filler. State the problem, solution, result, CTA. Max 130 words.`,
  Aggressive: `Tone: Urgent. Open with a bold industry pain stat. Create FOMO. Binary CTA: "Quick call this week — yes or no?"`,
  Surgical:   `Tone: Hyper-personalized. Reference their specific context. Sound like an advisor, not a salesperson.`,
};

// ── Strip markdown from AI output ────────────────────────────────────────────
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

export async function generateAIEmail(params: EmailGenerationParams): Promise<{ subject: string; body: string }> {
  const { lead, yourCompany, yourService, tone, customPainPoint, userId } = params;

  // Fetch active AI provider
  const providerRes = await fetch(`/api/ai-provider?userId=${userId}`);
  if (!providerRes.ok) {
    let msg = "No active AI provider configured. Please set up AI in Settings.";
    try {
      const err = await providerRes.json();
      msg = err.error || err.details || msg;
    } catch {}
    throw new Error(msg);
  }
  const aiProvider = await providerRes.json();

  // Build compact user prompt
  const companyContext = lead.company_context
    ? lead.company_context.slice(0, 300)
    : "";

  const userPrompt = `Write a Pryro outreach email.
Sender: ${yourCompany} — ${yourService}
Recipient: ${lead.company_name} | ${lead.niche || "Business"} | ${lead.location || ""}${companyContext ? `\nContext: ${companyContext}` : ""}${customPainPoint ? `\nPain point: ${customPainPoint}` : ""}
${TONE_ADDITIONS[tone]}`;

  // ── Call the active AI provider ───────────────────────────────────────────
  let aiResponse = "";

  if (aiProvider.provider === "openai") {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${aiProvider.api_key}` },
      body: JSON.stringify({
        model: aiProvider.active_model || "gpt-4o-mini",
        messages: [{ role: "system", content: SYSTEM_MESSAGE }, { role: "user", content: userPrompt }],
        temperature: 0.4,
        max_tokens: 400,
      }),
    });
    if (!res.ok) throw new Error(`OpenAI API error: ${res.statusText}`);
    const data = await res.json();
    aiResponse = data.choices[0].message.content;

  } else if (aiProvider.provider === "anthropic") {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": aiProvider.api_key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: aiProvider.active_model || "claude-3-5-haiku-20241022",
        max_tokens: 400,
        system: SYSTEM_MESSAGE,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic API error: ${res.statusText}`);
    const data = await res.json();
    aiResponse = data.content[0].text;

  } else if (aiProvider.provider === "groq") {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${aiProvider.api_key}` },
      body: JSON.stringify({
        model: aiProvider.active_model || "llama-3.1-8b-instant",
        messages: [{ role: "system", content: SYSTEM_MESSAGE }, { role: "user", content: userPrompt }],
        temperature: 0.4,
        max_tokens: 400,
      }),
    });
    if (!res.ok) {
      let errText = ""; try { errText = await res.text(); } catch {}
      let errJson: any = null; try { errJson = JSON.parse(errText); } catch {}
      const msg = errJson?.error?.message || errText.slice(0, 200) || res.statusText;
      if (res.status === 401) throw new Error("Groq API key is invalid. Check Settings.");
      if (res.status === 429) throw new Error("Groq rate limit hit. Wait a moment and try again.");
      if (res.status === 404) throw new Error(`Groq model "${aiProvider.active_model}" not found. Check Settings.`);
      throw new Error(`Groq API error (${res.status}): ${msg}`);
    }
    const data = await res.json();
    aiResponse = data.choices[0].message.content;

  } else if (aiProvider.provider === "gemini") {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${aiProvider.active_model || "gemini-1.5-flash"}:generateContent?key=${aiProvider.api_key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: SYSTEM_MESSAGE + "\n\n" + userPrompt }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 400 },
        }),
      }
    );
    if (!res.ok) throw new Error(`Gemini API error: ${res.statusText}`);
    const data = await res.json();
    aiResponse = data.candidates[0].content.parts[0].text;

  } else if (aiProvider.provider === "mistral") {
    const res = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${aiProvider.api_key}` },
      body: JSON.stringify({
        model: aiProvider.active_model || "mistral-small",
        messages: [{ role: "system", content: SYSTEM_MESSAGE }, { role: "user", content: userPrompt }],
        temperature: 0.4,
        max_tokens: 400,
      }),
    });
    if (!res.ok) throw new Error(`Mistral API error: ${res.statusText}`);
    const data = await res.json();
    aiResponse = data.choices[0].message.content;

  } else {
    throw new Error(`Unsupported AI provider: ${aiProvider.provider}`);
  }

  // ── Parse SUBJECT / BODY from response ────────────────────────────────────
  let subject = "";
  let body = "";

  const subjectMatch = aiResponse.match(/SUBJECT:\s*(.+?)(?:\n|$)/i);
  const bodyMatch = aiResponse.match(/BODY:\s*([\s\S]+?)$/i);

  if (subjectMatch && bodyMatch) {
    subject = subjectMatch[1].trim();
    body = bodyMatch[1].trim();
  } else {
    // Fallback: first line = subject, rest = body
    const lines = aiResponse.trim().split("\n");
    if (lines.length >= 2) {
      subject = lines[0].replace(/^(SUBJECT:|Subject:)/i, "").trim();
      body = lines.slice(1).join("\n").replace(/^(BODY:|Body:)/i, "").trim();
    } else {
      throw new Error("AI response format invalid. Expected 'SUBJECT: ...' and 'BODY: ...' format.");
    }
  }

  subject = stripMarkdown(subject.replace(/^["']|["']$/g, "").trim());
  body = stripMarkdown(body.replace(/^["']|["']$/g, "").trim());

  if (!subject || !body) {
    throw new Error("AI generated an empty subject or body. Try again.");
  }

  return { subject, body };
}
