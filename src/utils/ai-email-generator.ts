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
  senderName?: string;   // Real name from SMTP account e.g. "Alice Smith"
  senderEmail?: string;  // Real email from SMTP account e.g. "alice@gmail.com"
  senderTitle?: string;  // Optional title e.g. "Executive Sales"
}

// ── System message ────────────────────────────────────────────────────────────
function buildSystemMessage(senderName: string, senderTitle: string): string {
  return `You are a senior B2B sales executive writing cold outreach emails on behalf of Pryro.

EXACT FORMAT TO FOLLOW — mirror this structure precisely:

---
[Opening line: one sentence that connects to what the recipient's company does or their industry. No flattery. State a relevant business context or opportunity.]

[Second paragraph: explain what Pryro does and how it directly helps their type of business. Be specific. Mention the core value — replacing manual workflows, Excel-based operations, or fragmented tools with a unified platform. If relevant, mention commission or partnership terms concisely.]

[Third paragraph: one soft, humble CTA — ask for a short meeting (10–15 minutes). Frame it as exploring fit, not selling.]

Best regards,
${senderName}
${senderTitle}
Pryro
---

SUBJECT LINE RULES:
- Pick ONE subject from this exact list — choose the most relevant for the recipient:
  · "Partnership Opportunity with [Company Name] in ERP Solutions"
  · "Exploring ERP Referral Collaboration with [Company Name]"
  · "Business Collaboration Opportunity for ERP Services"
  · "ERP Partnership Proposal for [Company Name]"
  · "Referral Partnership Opportunity with Pryro ERP"
  · "Commission-Based ERP Partnership Opportunity"
  · "ERP Solutions Partnership Discussion"
  · "Opportunity to Partner with Pryro ERP"
  · "Strategic ERP Referral Opportunity"
  · "Potential ERP Collaboration with [Company Name]"
  · "Partner with Pryro for ERP Referrals"
  · "ERP Consulting Partnership Opportunity"
  · "Revenue Partnership Opportunity in ERP"
  · "10-Minute Discussion on ERP Collaboration"
  · "ERP Referral Program for Consulting Partners"
  · "Partnership Discussion: ERP & Business Automation"
  · "ERP Business Expansion Opportunity"
  · "Short Discussion on ERP Partnership Opportunities"
  · "Collaborative ERP Opportunity for [Company Name]"
  · "Pryro ERP Partnership & Referral Program"
- Replace [Company Name] with the actual recipient company name
- Do NOT invent new subject lines — only use from the list above
- No questions, no clickbait, no symbols, no ALL CAPS, no exclamation marks

BANNED WORDS AND PHRASES (never use any of these):
- "reach out", "I noticed", "I came across", "I hope this email finds you well",
  "I wanted to", "just checking in", "touching base", "circle back",
  "synergy", "leverage", "game-changer", "revolutionary", "cutting-edge",
  "excited to", "thrilled to", "I am writing to", "please don't hesitate",
  "feel free to", "at your earliest convenience", "as per", "going forward",
  "Unlock", "Exploring Synergies"

TONE RULES:
- Humble but confident — like a professional colleague, not a salesperson
- Conversational and human — short sentences, plain language
- Never pushy, never desperate, never overly formal
- 100–160 words max for the body

ANTI-SPAM RULES:
- Plain text only. No markdown, no asterisks, no bold, no bullet points.
- Short paragraphs separated by blank lines.
- No spam words: free, guarantee, limited time, act now, click here, earn money, no risk, buy now, special offer, urgent, winner.
- No excessive punctuation (!!!, ???).
- One CTA only — a short meeting request.
- The signature MUST be exactly:
  Best regards,
  ${senderName}
  ${senderTitle}
  Pryro

Respond ONLY in this exact format:
SUBJECT: [subject line]
BODY: [email body]`;
}

// ── Tone additions ────────────────────────────────────────────────────────────
const TONE_ADDITIONS: Record<string, string> = {
  Direct:   `Tone: Direct and concise. Open with the business context in one sentence. State the value proposition clearly. End with a simple meeting request. No filler words. Max 120 words.`,
  Aggressive: `Tone: Confident and opportunity-focused. Open with a specific industry challenge or missed opportunity. Make the value proposition impossible to ignore. CTA: ask for a 10-minute call this week. Max 140 words.`,
  Surgical: `Tone: Hyper-personalized and consultative. Reference their specific industry and business context. Sound like a trusted advisor identifying a gap, not a vendor pitching a product. Max 150 words.`,
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
  const { lead, yourCompany, yourService, tone, customPainPoint, userId,
          senderName: paramSenderName, senderEmail: paramSenderEmail, senderTitle: paramSenderTitle } = params;

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

  // Fetch sender name from SMTP account if not provided
  let senderName = paramSenderName || '';
  let senderTitle = paramSenderTitle || 'Executive Sales';

  if (!senderName) {
    try {
      const supabase = (await import("../../supabase/client")).createClient();
      const { data: smtpAccounts } = await supabase
        .from('smtp_accounts')
        .select('email, sender_name')
        .eq('user_id', userId)
        .eq('status', 'active')
        .order('sent_today', { ascending: true })
        .limit(1);

      if (smtpAccounts && smtpAccounts.length > 0) {
        const account = smtpAccounts[0];
        // Use sender_name if set, otherwise derive from email
        senderName = account.sender_name ||
          account.email.split('@')[0]
            .replace(/[._\-]/g, ' ')
            .replace(/\b\w/g, (c: string) => c.toUpperCase());
      }
    } catch {
      // Fallback — use a generic name
    }
  }

  if (!senderName) senderName = 'Sales Team';

  const SYSTEM_MESSAGE = buildSystemMessage(senderName, senderTitle);

  // Build compact user prompt
  const companyContext = lead.company_context ? lead.company_context.slice(0, 300) : "";

  const userPrompt = `Write a Pryro outreach email.
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
