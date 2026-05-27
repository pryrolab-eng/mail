/**
 * Pipeline Step 4: generate personalised email from company_context → generated_emails.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PipelineStage } from "@/types/platform";
import {
  applySenderPlaceholders,
  DEFAULT_YOUR_COMPANY,
  deriveLeadContactFields,
  resolveGenerationModel,
} from "@/utils/email-prompts";
import {
  isWeakLeadContext,
} from "@/utils/lead-context-builder";
import { scoreEmailQuality } from "@/utils/email-quality";
import { loadAIProviderForUser } from "@/utils/load-ai-provider-server";
import type { AIProviderConfig } from "@/utils/lead-intel-ai";
import { runSkill } from "@/utils/skill-registry";
export type GenerateEmailResult = {
  success: boolean;
  leadId: string;
  pipeline_stage: PipelineStage;
  emailId?: string;
  subject?: string;
  body?: string;
  model?: string;
  error?: string;
  /** Set when options.preview — email not saved */
  preview?: boolean;
  company_context_used?: string;
};

type LeadRow = {
  id: string;
  user_id: string;
  company_name: string;
  email: string | null;
  niche: string | null;
  location: string | null;
  company_context: string | null;
  pipeline_stage: string | null;
  notes: string | null;
  automation_score?: number | null;
  automation_fit_reason?: string | null;
  agent_draft_allowed?: boolean | null;
  agent_recommended_action?: string | null;
};

type EvidenceFact = {
  fact: string;
  source: string;
  confidence: "high" | "medium" | "low";
  category?: string;
  salesRelevance?: "high" | "medium" | "low";
};

type OwnerNameContext = {
  ownerName: string | null;
  firstName: string | null;
  title: string | null;
  source: string | null;
  confidence: "high" | "medium" | "low";
  salutation: string | null;
  fallbackUsed: boolean;
  autoSendAllowed: boolean;
  reason?: string;
};

type EmailDraft = {
  subject: string;
  body: string;
  warnings?: string[];
  parserRecovered?: boolean;
};

type EmailValidation = {
  passed: boolean;
  failures: string[];
};

async function callPipelineAI(
  provider: AIProviderConfig,
  systemMessage: string,
  userPrompt: string,
  attempt = 0
): Promise<string> {
  const MAX_ATTEMPTS = 4;
  const model = resolveGenerationModel(provider.provider, provider.active_model);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  let url = "";
  let body: object;

  if (provider.provider === "openai" || provider.provider === "groq") {
    url =
      provider.provider === "openai"
        ? "https://api.openai.com/v1/chat/completions"
        : "https://api.groq.com/openai/v1/chat/completions";
    headers.Authorization = `Bearer ${provider.api_key}`;
    body = {
      model,
      messages: [
        { role: "system", content: systemMessage },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.5,
      max_tokens: 600,
    };
  } else if (provider.provider === "anthropic") {
    url = "https://api.anthropic.com/v1/messages";
    headers["x-api-key"] = provider.api_key;
    headers["anthropic-version"] = "2023-06-01";
    body = {
      model: provider.active_model || "claude-3-5-haiku-20241022",
      max_tokens: 600,
      system: systemMessage,
      messages: [{ role: "user", content: userPrompt }],
    };
  } else if (provider.provider === "gemini") {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${provider.api_key}`;
    body = {
      contents: [{ parts: [{ text: `${systemMessage}\n\n${userPrompt}` }] }],
      generationConfig: { temperature: 0.5, maxOutputTokens: 600 },
    };
  } else if (provider.provider === "mistral") {
    url = "https://api.mistral.ai/v1/chat/completions";
    headers.Authorization = `Bearer ${provider.api_key}`;
    body = {
      model,
      messages: [
        { role: "system", content: systemMessage },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.5,
      max_tokens: 600,
    };
  } else {
    throw new Error(`Unsupported AI provider: ${provider.provider}`);
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45_000),
  });

  if (res.status === 429 && attempt < MAX_ATTEMPTS) {
    const waitMs = Math.min(5000 * 2 ** attempt, 45_000);
    await new Promise((r) => setTimeout(r, waitMs));
    return callPipelineAI(provider, systemMessage, userPrompt, attempt + 1);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`AI API error ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  if (provider.provider === "anthropic") {
    return data.content[0].text as string;
  }
  if (provider.provider === "gemini") {
    return data.candidates[0].content.parts[0].text as string;
  }
  return data.choices[0].message.content as string;
}

async function resolveSenderName(
  supabase: SupabaseClient,
  userId: string
): Promise<string> {
  const { data } = await supabase
    .from("smtp_accounts")
    .select("email, sender_name")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("sent_today", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (data?.sender_name?.trim()) return data.sender_name.trim();
  if (data?.email) {
    return data.email
      .split("@")[0]
      .replace(/[._\-]/g, " ")
      .replace(/\b\w/g, (c: string) => c.toUpperCase());
  }
  return "Sales Team";
}

async function loadEvidenceFacts(
  supabase: SupabaseClient,
  userId: string,
  leadId: string,
  _fallbackContext: string
): Promise<EvidenceFact[]> {
  const { data } = await supabase
    .from("lead_evidence")
    .select("source_url, source_type, confidence, snippet, extracted_facts")
    .eq("user_id", userId)
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(12);

  const facts: EvidenceFact[] = [];
  for (const item of data ?? []) {
    const extracted = item.extracted_facts as
      | {
          facts?: unknown[];
          businessFacts?: unknown[];
          emails?: unknown[];
          phones?: unknown[];
        }
      | null;
    for (const fact of extracted?.businessFacts ?? []) {
      if (!fact || typeof fact !== "object") continue;
      const row = fact as {
        fact?: unknown;
        source?: unknown;
        confidence?: unknown;
        category?: unknown;
        salesRelevance?: unknown;
      };
      if (typeof row.fact !== "string") continue;
      const clean = row.fact.replace(/\s+/g, " ").trim();
      if (clean.length < 20) continue;
      facts.push({
        fact: clean.slice(0, 220),
        source: String(row.source ?? item.source_url ?? item.source_type ?? "evidence"),
        confidence:
          row.confidence === "high" || row.confidence === "medium" || row.confidence === "low"
            ? row.confidence
            : item.confidence === "high" || item.confidence === "medium"
              ? item.confidence
              : "low",
        category: typeof row.category === "string" ? row.category : undefined,
        salesRelevance:
          row.salesRelevance === "high" || row.salesRelevance === "medium" || row.salesRelevance === "low"
            ? row.salesRelevance
            : undefined,
      });
    }
  }

  const ranked = Array.from(new Map(facts.map((fact) => [fact.fact.toLowerCase(), fact])).values())
    .filter((fact) => fact.salesRelevance === "high" || fact.salesRelevance === "medium")
    .sort((a, b) => {
      const relevance = { high: 0, medium: 1, low: 2 } as const;
      const category = {
        payment_model: 0,
        services_offered: 1,
        team_size: 2,
        specializations: 3,
        founder_background: 4,
        years_in_operation: 5,
        contact: 6,
        location: 7,
      } as Record<string, number>;
      return (
        relevance[a.salesRelevance ?? "low"] - relevance[b.salesRelevance ?? "low"] ||
        (category[a.category ?? ""] ?? 99) - (category[b.category ?? ""] ?? 99)
      );
    });

  if (typeof (ranked as unknown) === "string") {
    throw new Error("compileLLMContext must return typed array, not raw text");
  }

  return ranked.slice(0, 5);
}

async function loadOwnerNameContext(
  supabase: SupabaseClient,
  userId: string,
  leadId: string,
  fallbackContext: string
): Promise<OwnerNameContext | null> {
  const { data } = await supabase
    .from("agent_runs")
    .select("output")
    .eq("user_id", userId)
    .eq("lead_id", leadId)
    .eq("run_type", "research")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const output = data?.output as { ownerName?: Partial<OwnerNameContext> } | null | undefined;
  const owner = output?.ownerName;
  if (owner && typeof owner === "object") {
    return {
      ownerName: typeof owner.ownerName === "string" ? owner.ownerName : null,
      firstName: typeof owner.firstName === "string" ? owner.firstName : null,
      title: typeof owner.title === "string" ? owner.title : null,
      source: typeof owner.source === "string" ? owner.source : null,
      confidence:
        owner.confidence === "high" || owner.confidence === "medium" || owner.confidence === "low"
          ? owner.confidence
          : "low",
      salutation: typeof owner.salutation === "string" ? owner.salutation : null,
      fallbackUsed: Boolean(owner.fallbackUsed),
      autoSendAllowed: owner.autoSendAllowed === true,
      reason: typeof owner.reason === "string" ? owner.reason : undefined,
    };
  }

  const contextMatch = fallbackContext.match(/Owner name:\s*(.+)/i);
  if (contextMatch && !/not found/i.test(contextMatch[1] ?? "")) {
    const name = contextMatch[1].trim();
    const salutationMatch = fallbackContext.match(/Owner salutation:\s*(.+)/i);
    const confidenceMatch = fallbackContext.match(/Owner confidence:\s*(high|medium|low)/i);
    return {
      ownerName: name,
      firstName: name.split(/\s+/)[0] ?? null,
      title: null,
      source: null,
      confidence: (confidenceMatch?.[1]?.toLowerCase() as OwnerNameContext["confidence"]) ?? "low",
      salutation: salutationMatch && !/not found/i.test(salutationMatch[1]) ? salutationMatch[1].trim() : name.split(/\s+/)[0],
      fallbackUsed: false,
      autoSendAllowed: confidenceMatch?.[1]?.toLowerCase() === "high",
    };
  }

  return null;
}

function roleSalutationForLead(lead: LeadRow): string {
  const blob = `${lead.company_name} ${lead.niche ?? ""}`.toLowerCase();
  if (/dermatology|clinic|dental|hospital|medical|health|doctor/.test(blob)) return "Doctor";
  if (/pharmacy|pharmacist/.test(blob)) return "Pharmacist";
  if (/school|academy|college|education/.test(blob)) return "Director";
  if (/restaurant|cafe|kitchen|chef/.test(blob)) return "Chef";
  return "Team";
}

function resolveEmailSalutation(ownerName: OwnerNameContext | null, lead: LeadRow, fallbackFirstName: string): string {
  if (ownerName?.confidence === "high" && ownerName.salutation) return ownerName.salutation;
  if (ownerName?.confidence === "medium" && ownerName.firstName) return ownerName.firstName;
  const role = roleSalutationForLead(lead);
  if (role !== "Team") return role;
  return fallbackFirstName && fallbackFirstName !== "Team" ? fallbackFirstName : "Team";
}

function buildWriteEmailSystemPrompt(senderName: string): string {
  return `You are the writeEmail skill for a B2B outreach agent.
Return ONLY valid JSON: {"subject":"...","body":"...","warnings":[]}
Use \\n for line breaks inside JSON strings. Never put raw newlines inside a string.
No markdown, no backticks, no prose before or after the JSON.

Rules:
- Use only the evidence facts provided by the user. Do not invent facts, performance claims, awards, revenue, staff size, or pain points.
- Body must begin with a greeting line: Hi [contactName],
- The first content paragraph after the greeting MUST explicitly use at least one concrete evidence fact.
- If the evidence is thin, write a cautious email or add a warning; never fill with compliments.
- Subject must be under 10 words.
- Subject must reference business context and must not use solutions, partnership, or opportunity.
- Body must be 65-115 words excluding signature.
- Body must use 3-5 short paragraphs before the signature, separated by blank lines.
- No one giant paragraph.
- Tone: calm, warm, specific, professional.
- Frame operational pain as a common possibility, not as a diagnosis.
- Do not praise the business with words like impressed, exceptional, friendly, knowledgeable, top-notch, dedicated, or seamless unless those exact claims are in evidence.
- Never write Hi there, Dear Sir, or Dear Madam.
- Include a simple 10-minute call CTA.
- End with this exact signature:
Best regards,
${senderName}
Executive Sales, Pryro`;
}

function buildWriteEmailPrompt(params: {
  lead: LeadRow;
  facts: EvidenceFact[];
  senderName: string;
  salutation: string;
  ownerName: OwnerNameContext | null;
  repair?: { previousDraft: EmailDraft; failures: string[] };
}): string {
  return JSON.stringify(
    {
      skill: "writeEmail",
      lead: {
        companyName: params.lead.company_name,
        niche: params.lead.niche,
        location: params.lead.location,
        salutation: params.salutation,
      },
      ownerName: params.ownerName,
      senderProfile: {
        name: params.senderName,
        title: "Executive Sales",
        company: "Pryro",
      },
      requiredBodyFormat: [
        `Hi ${params.salutation},`,
        "One short paragraph using a concrete evidence fact.",
        "One short paragraph connecting Pryro to a cautious operational workflow point.",
        "One short paragraph with a 10-minute call CTA.",
        `Best regards,\n${params.senderName}\nExecutive Sales, Pryro`,
      ],
      evidence: params.facts,
      evidenceRequirement:
        "The first content paragraph after the greeting must mention one concrete fact from evidence, such as a service, opening hours, address, team role, or appointment/contact detail.",
      forbiddenClaims: [
        "guaranteed",
        "first 60 days",
        "60 days",
        "reduce manual reconciliation time significantly",
        "increase revenue",
        "save money instantly",
      ],
      repair: params.repair ?? null,
    },
    null,
    2
  );
}

function normalizeGreeting(body: string, contactName: string): string {
  const salutation = contactName.trim() || "Team";
  const greeting = `Hi ${salutation},`;
  const trimmed = body.trim();
  if (/^Hi\s+[^,\n]+,?\s*(?:\n|$)/i.test(trimmed)) {
    return trimmed.replace(/^Hi\s+[^,\n]+,?\s*/i, `${greeting}\n\n`);
  }
  return `${greeting}\n\n${trimmed}`;
}

function extractJson(raw: string): unknown {
  const cleaned = raw.replace(/```json|```/gi, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      const objectText = cleaned.slice(start, end + 1);
      try {
        return JSON.parse(cleanJsonControlChars(objectText));
      } catch {
        return JSON.parse(repairJsonStringLiterals(objectText));
      }
    }
    throw new Error("AI did not return JSON");
  }
}

function cleanJsonControlChars(value: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (const char of value) {
    if (escaped) {
      out += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      out += char;
      escaped = true;
      continue;
    }
    if (char === '"') {
      out += char;
      inString = !inString;
      continue;
    }
    if (inString) {
      const code = char.charCodeAt(0);
      if (code < 0x20) {
        if (char === "\n") out += "\\n";
        else if (char === "\r") out += "\\r";
        else if (char === "\t") out += "\\t";
        else out += " ";
        continue;
      }
    }
    out += char;
  }
  return out;
}

function repairJsonStringLiterals(value: string): string {
  const subject = extractJsonStringField(value, "subject") ?? "";
  const body = extractJsonStringField(value, "body") ?? "";
  const warningsRaw = value.match(/"warnings"\s*:\s*(\[[\s\S]*?\])/i)?.[1] ?? "[]";
  let warnings: unknown[] = [];
  try {
    const parsed = JSON.parse(cleanJsonControlChars(warningsRaw));
    warnings = Array.isArray(parsed) ? parsed : [];
  } catch {
    warnings = [];
  }
  return JSON.stringify({ subject, body, warnings });
}

function extractJsonStringField(raw: string, field: string): string | null {
  const start = raw.search(new RegExp(`"?${field}"?\\s*:`, "i"));
  if (start < 0) return null;
  const firstQuote = raw.indexOf('"', raw.indexOf(":", start));
  if (firstQuote < 0) return null;
  let out = "";
  let escaped = false;
  for (let i = firstQuote + 1; i < raw.length; i++) {
    const char = raw[i];
    if (escaped) {
      out += char === "n" ? "\n" : char === "r" ? "\r" : char === "t" ? "\t" : char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') return out.trim();
    out += char;
  }
  return null;
}

function parseWriteEmailOutput(raw: string, senderName: string, contactName: string): EmailDraft {
  let parsed: Partial<EmailDraft>;
  let parserRecovered = false;
  try {
    parsed = extractJson(raw) as Partial<EmailDraft>;
  } catch (error) {
    const subject = extractJsonStringField(raw, "subject");
    const body = extractJsonStringField(raw, "body");
    if (!subject || !body) throw error;
    parserRecovered = true;
    parsed = {
      subject,
      body,
      warnings: ["AI returned malformed JSON; parser recovered subject/body."],
    };
  }
  const subject = String(parsed.subject ?? "").replace(/^["']|["']$/g, "").trim();
  let body = String(parsed.body ?? "").trim();
  if (!subject) throw new Error("writeEmail returned no subject");
  if (!body) throw new Error("writeEmail returned no body");
  body = normalizeGreeting(body, contactName);
  if (!/Best regards/i.test(body)) {
    body = `${body}\n\nBest regards,\n${senderName}\nExecutive Sales, Pryro`;
  }
  return {
    subject,
    body: applySenderPlaceholders(body, senderName, "Executive Sales", DEFAULT_YOUR_COMPANY),
    warnings: Array.isArray(parsed.warnings)
      ? parsed.warnings.map((warning) => String(warning)).filter(Boolean)
      : [],
    parserRecovered,
  };
}

function evidenceKeywords(facts: EvidenceFact[]): string[] {
  const stop = new Set([
    "about",
    "address",
    "appointment",
    "business",
    "clinic",
    "company",
    "contact",
    "customer",
    "dental",
    "email",
    "hours",
    "learn",
    "people",
    "phone",
    "service",
    "services",
    "their",
    "website",
    "working",
  ]);
  return Array.from(
    new Set(
      facts
        .flatMap((fact) => fact.fact.toLowerCase().split(/[^a-z0-9]+/))
        .filter((token) => token.length >= 6 && !stop.has(token))
    )
  ).slice(0, 40);
}

function validateEmailDraft(draft: EmailDraft, facts: EvidenceFact[]): EmailValidation {
  const failures: string[] = [];
  if (facts.length === 0) {
    failures.push("no sourced evidence facts available; rerun research before drafting");
  }
  const subjectWords = draft.subject.split(/\s+/).filter(Boolean).length;
  if (subjectWords === 0 || subjectWords > 10) {
    failures.push(`subject must be under 10 words (currently ${subjectWords})`);
  }
  if (/\b(solutions?|partnership|opportunity)\b/i.test(draft.subject)) {
    failures.push("subject uses forbidden generic wording");
  }

  const bodyWithoutSignature = draft.body.replace(/Best regards[\s\S]*$/i, "").trim();
  const words = bodyWithoutSignature.split(/\s+/).filter(Boolean).length;
  if (words > 140) failures.push(`body is ${words} words; max is 140`);
  if (words < 65) failures.push(`body is ${words} words; minimum is 65`);
  if (!/^Hi\s+[^,\n]+,\s*(?:\n|$)/i.test(bodyWithoutSignature)) {
    failures.push("greeting is missing or malformed");
  }
  if (/^Hi\s+there,|Dear Sir|Dear Madam/i.test(bodyWithoutSignature)) {
    failures.push("forbidden salutation");
  }

  const paragraphs = bodyWithoutSignature
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const contentParagraphs = paragraphs.filter((paragraph) => !/^hi\b/i.test(paragraph));
  if (contentParagraphs.length < 3 || contentParagraphs.length > 5) {
    failures.push(`body must have 3-5 short content paragraphs (currently ${contentParagraphs.length})`);
  }
  if (paragraphs.length <= 2) failures.push("body is formatted like one large paragraph");
  if (!/\b(10[- ]?minute|ten[- ]?minute|quick call|short call|brief call)\b/i.test(draft.body)) {
    failures.push("CTA for a short call is missing");
  }
  if (!/Best regards,\s*\n.+\nExecutive Sales,\s*Pryro/i.test(draft.body)) {
    failures.push("signature is missing or malformed");
  }
  if (/guarantee|guaranteed|first 60 days|60 days|increase revenue|save money instantly|reduce manual reconciliation time significantly/i.test(draft.body)) {
    failures.push("contains forbidden or unsupported performance claim");
  }
  const evidenceBlob = facts.map((fact) => fact.fact.toLowerCase()).join(" ");
  const unsupportedPraise = [
    "impressed",
    "exceptional care",
    "friendly",
    "knowledgeable",
    "top-notch",
    "dedicated",
    "seamless experiences",
    "high quality",
    "best in class",
  ].filter((phrase) => draft.body.toLowerCase().includes(phrase) && !evidenceBlob.includes(phrase));
  if (unsupportedPraise.length > 0) {
    failures.push(`unsupported praise/quality claims: ${unsupportedPraise.join(", ")}`);
  }
  if (/\blikely\b|\bprone to errors\b/i.test(draft.body)) {
    failures.push("uses assumptive language about the lead's problems");
  }

  const bodyTokens = new Set(
    draft.body
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 6)
  );
  const matchedKeywords = evidenceKeywords(facts).filter((token) => bodyTokens.has(token));
  if (matchedKeywords.length < Math.min(2, Math.max(1, facts.length))) {
    failures.push("body does not use enough concrete sourced evidence facts");
  }

  return { passed: failures.length === 0, failures };
}

function reviewEmailSafety(draft: EmailDraft, facts: EvidenceFact[]): EmailValidation {
  const failures: string[] = [];
  const evidenceBlob = facts.map((fact) => fact.fact.toLowerCase()).join(" ");
  const contentOnly = draft.body
    .replace(/^Hi\s+[^,\n]+,?\s*/i, "")
    .replace(/Best regards[\s\S]*$/i, "")
    .trim();
  const riskyPhrases = [
    "i saw your revenue",
    "your team is struggling",
    "you are losing money",
    "your errors",
    "your cash flow problem",
  ];
  for (const phrase of riskyPhrases) {
    if (contentOnly.toLowerCase().includes(phrase)) {
      failures.push(`unsafe unsupported claim: ${phrase}`);
    }
  }
  if (/founder|director|owner|doctor|dr\./i.test(contentOnly) && !/founder|director|owner|doctor|dr\./i.test(evidenceBlob)) {
    failures.push("mentions a person/role that is not supported by evidence");
  }
  if (/^Hi\s+there,|Dear Sir|Dear Madam/i.test(draft.body.trim())) {
    failures.push("salutation is generic or forbidden");
  }
  if (/support your efforts|explore this further|quality services|your business needs/i.test(contentOnly)) {
    failures.push("value prop or CTA is too generic");
  }
  return { passed: failures.length === 0, failures };
}

async function markPipelineFailed(
  supabase: SupabaseClient,
  leadId: string,
  userId: string,
  message: string
): Promise<void> {
  await supabase
    .from("leads")
    .update({
      pipeline_stage: "failed",
      pipeline_error: message,
      pipeline_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", leadId)
    .eq("user_id", userId);
}

/**
 * Generate one cold email for a lead using researched company_context.
 */
export async function runGenerateEmailForLead(
  supabase: SupabaseClient,
  userId: string,
  leadId: string,
  options?: { preview?: boolean; tone?: string }
): Promise<GenerateEmailResult> {
  const { data: lead, error: loadError } = await supabase
    .from("leads")
    .select(
      "id, user_id, company_name, email, niche, location, company_context, pipeline_stage, notes, automation_score, automation_fit_reason, agent_draft_allowed, agent_recommended_action"
    )
    .eq("id", leadId)
    .eq("user_id", userId)
    .single();

  if (loadError || !lead) {
    return {
      success: false,
      leadId,
      pipeline_stage: "failed",
      error: loadError?.message ?? "Lead not found",
    };
  }

  const row = lead as LeadRow;
  const context = row.company_context?.trim() ?? "";

  const hasResearch =
    context.includes("[RESEARCH]") ||
    context.includes("[INTEL]") ||
    (!isWeakLeadContext(context, row.company_name) && context.length >= 80);

  if (!hasResearch) {
    const msg =
      "Lead needs company research first — run Research before generating email";
    if (!options?.preview) {
      await markPipelineFailed(supabase, leadId, userId, msg);
    }
    return { success: false, leadId, pipeline_stage: "failed", error: msg };
  }

  if (row.agent_draft_allowed === false) {
    const msg =
      "Agent blocked drafting for this lead — add/verify an email or rerun research";
    if (!options?.preview) {
      await markPipelineFailed(supabase, leadId, userId, msg);
    }
    return { success: false, leadId, pipeline_stage: "failed", error: msg };
  }

    const aiProvider = await loadAIProviderForUser(supabase, userId);
  if (!aiProvider?.api_key) {
    const msg = "No AI provider configured — set up AI in Settings";
    await markPipelineFailed(supabase, leadId, userId, msg);
    return { success: false, leadId, pipeline_stage: "failed", error: msg };
  }

  try {
    const repName = await resolveSenderName(supabase, userId);
    const { contact_name, first_name } = deriveLeadContactFields({
      email: row.email,
      company_name: row.company_name,
    });
    const ownerName = await loadOwnerNameContext(supabase, userId, leadId, context);
    const salutation = resolveEmailSalutation(ownerName, row, contact_name === "Team" ? first_name : contact_name);

    const facts = await loadEvidenceFacts(supabase, userId, leadId, context);
    if (facts.length === 0) {
      const msg = "No sourced evidence facts found. Rerun research before generating an email.";
      if (!options?.preview) {
        await markPipelineFailed(supabase, leadId, userId, msg);
      }
      return { success: false, leadId, pipeline_stage: "failed", error: msg };
    }
    const hasSalesUsableEvidence = facts.some((fact) =>
      [
        "payment_model",
        "services_offered",
        "team_size",
        "founder_background",
        "years_in_operation",
        "contact",
      ].includes(fact.category ?? "")
    );
    if (!hasSalesUsableEvidence) {
      const msg = "Incomplete research facts for writeEmail: no usable business facts. Rerun research.";
      if (!options?.preview) {
        await markPipelineFailed(supabase, leadId, userId, msg);
      }
      return { success: false, leadId, pipeline_stage: "failed", error: msg };
    }
    const missingContextWarnings = [
      facts.some((fact) => fact.category === "payment_model") ? "" : "payment_model not found",
      facts.some((fact) => fact.category === "services_offered") ? "" : "services_offered not found",
    ].filter(Boolean);
    const systemMessage = buildWriteEmailSystemPrompt(repName);
    const promptBase = {
      lead: row,
      facts,
      senderName: repName,
      salutation,
      ownerName,
    };

    let raw = "";
    const writeSkill = await runSkill({
      id: "writeEmail",
      input: {
        leadId,
        companyName: row.company_name,
        evidenceFacts: facts.length,
        missingContextWarnings,
        repair: false,
      },
      run: async () => {
        raw = await callPipelineAI(
          aiProvider,
          systemMessage,
          buildWriteEmailPrompt(promptBase)
        );
        const parsed = parseWriteEmailOutput(raw, repName, promptBase.salutation);
        return {
          output: {
            subject: parsed.subject,
            body: parsed.body,
            warnings: parsed.warnings ?? [],
            parserRecovered: !!parsed.parserRecovered,
          },
          confidence: parsed.parserRecovered ? "medium" : "high",
          warnings: [...(parsed.warnings ?? []), ...missingContextWarnings],
        };
      },
    });
    let draft: EmailDraft = {
      subject: String(writeSkill.output.subject ?? ""),
      body: String(writeSkill.output.body ?? ""),
      warnings: Array.isArray(writeSkill.output.warnings)
        ? writeSkill.output.warnings.map((warning) => String(warning))
        : [],
      parserRecovered: Boolean(writeSkill.output.parserRecovered),
    };
    if (draft.parserRecovered) {
      console.warn("[writeEmail] AI returned malformed JSON; recovered draft", {
        leadId,
        rawResponse: raw.slice(0, 200),
      });
    }
    const validationSkill = await runSkill({
      id: "validateOutput",
      input: {
        leadId,
        subject: draft.subject,
        bodyWords: draft.body.replace(/Best regards[\s\S]*$/i, "").split(/\s+/).filter(Boolean).length,
      },
      run: () => {
        const result = validateEmailDraft(draft, facts);
        return {
          output: {
            passed: result.passed,
            failures: result.failures,
          },
          confidence: result.passed ? "high" : "medium",
          warnings: result.failures,
        };
      },
    });
    let validation: EmailValidation = {
      passed: validationSkill.output.passed === true,
      failures: Array.isArray(validationSkill.output.failures)
        ? validationSkill.output.failures.map((failure) => String(failure))
        : [],
    };

    if (!validation.passed) {
      const repairSkill = await runSkill({
        id: "writeEmail",
        input: {
          leadId,
          companyName: row.company_name,
          evidenceFacts: facts.length,
          missingContextWarnings,
          repair: true,
          failures: validation.failures,
        },
        run: async () => {
          raw = await callPipelineAI(
            aiProvider,
            systemMessage,
            buildWriteEmailPrompt({
              ...promptBase,
              repair: {
                previousDraft: draft,
                failures: validation.failures,
              },
            })
          );
          const parsed = parseWriteEmailOutput(raw, repName, promptBase.salutation);
          return {
            output: {
              subject: parsed.subject,
              body: parsed.body,
              warnings: parsed.warnings ?? [],
              parserRecovered: !!parsed.parserRecovered,
            },
            confidence: parsed.parserRecovered ? "medium" : "high",
            warnings: [...(parsed.warnings ?? []), ...missingContextWarnings],
          };
        },
      });
      const repaired: EmailDraft = {
        subject: String(repairSkill.output.subject ?? ""),
        body: String(repairSkill.output.body ?? ""),
        warnings: Array.isArray(repairSkill.output.warnings)
          ? repairSkill.output.warnings.map((warning) => String(warning))
          : [],
        parserRecovered: Boolean(repairSkill.output.parserRecovered),
      };
      if (repaired.parserRecovered) {
        console.warn("[writeEmail] AI returned malformed JSON during repair; recovered draft", {
          leadId,
          rawResponse: raw.slice(0, 200),
        });
      }
      const repairedValidation = validateEmailDraft(repaired, facts);
      draft = repaired;
      validation = repairedValidation;
    }

    const safetySkill = await runSkill({
      id: "reviewEmailSafety",
      input: { leadId, subject: draft.subject, facts: facts.length },
      run: () => {
        const result = reviewEmailSafety(draft, facts);
        return {
          output: {
            passed: result.passed,
            failures: result.failures,
          },
          confidence: result.passed ? "high" : "medium",
          warnings: result.failures,
        };
      },
    });
    const safety = {
      passed: Boolean(safetySkill.output.passed),
      failures: Array.isArray(safetySkill.output.failures)
        ? safetySkill.output.failures.map((failure) => String(failure))
        : [],
    };
    const subject = draft.subject;
    const body = draft.body;
    const warnings = [...validation.failures, ...safety.failures];

    const modelLabel =
      aiProvider.active_model ?? aiProvider.provider;
    const quality = scoreEmailQuality(subject, body, row.company_name);

    if (options?.preview) {
      return {
        success: true,
        leadId,
        pipeline_stage: row.pipeline_stage as PipelineStage,
        subject,
        body,
        model: modelLabel,
        preview: true,
        company_context_used: context,
        ...(warnings.length === 0
          ? {}
          : { error: `Quality warnings: ${warnings.join("; ")}` }),
      };
    }

    const { data: saved, error: insertError } = await supabase
      .from("generated_emails")
      .insert({
        user_id: userId,
        lead_id: leadId,
        subject,
        body,
        tone: "Direct",
        model_used: modelLabel,
        approval_status: "pending",
        quality_score: quality.score,
        ai_score: row.automation_score ?? null,
        ai_score_reason:
          warnings.length > 0
            ? `writeEmail warnings: ${warnings.join("; ")}`
            : row.automation_fit_reason ?? null,
      })
      .select("id")
      .single();

    if (insertError) {
      throw new Error(insertError.message);
    }

    const now = new Date().toISOString();
    const { error: updateError } = await supabase
      .from("leads")
      .update({
        pipeline_stage: "approval_pending",
        pipeline_updated_at: now,
        pipeline_error: warnings.length ? `writeEmail review needed: ${warnings.join("; ")}` : null,
        updated_at: now,
      })
      .eq("id", leadId)
      .eq("user_id", userId);

    if (updateError) throw new Error(updateError.message);

    const resultWarnings = [
      ...warnings.map((warning) => `review: ${warning}`),
      ...(quality.score < 50 ? [`low quality score (${quality.score})`] : []),
    ];

    return {
      success: true,
      leadId,
      pipeline_stage: "approval_pending",
      emailId: saved?.id,
      subject,
      body,
      model: modelLabel,
      company_context_used: context,
      ...(resultWarnings.length > 0
        ? { error: `Saved with warnings: ${resultWarnings.join("; ")}` }
        : {}),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Email generation failed";
    await markPipelineFailed(supabase, leadId, userId, msg);
    return { success: false, leadId, pipeline_stage: "failed", error: msg };
  }
}
