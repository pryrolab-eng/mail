/**
 * Shared cold-email prompts for Pryro outreach.
 * Used by single, bulk, and scrape-and-generate flows.
 */

import { formatLeadIntelForPrompt, type LeadIntel } from "./lead-intel";
import {
  isProfessionalAssociationName,
  PROFESSIONAL_ASSOCIATION_PAIN_POINT,
  resolveDisambiguatedNiche,
} from "./lead-context-builder";

export type EmailTone = "Direct" | "Aggressive" | "Surgical";

export interface EmailLeadInput {
  company_name: string;
  niche: string | null;
  location: string | null;
  company_context: string | null;
  website?: string | null;
  phone?: string | null;
  rating?: string | null;
  source_url?: string | null;
  contact_name?: string | null;
  contact_role?: string | null;
  company_size?: string | null;
}

/** Params for pipeline cold-email generation (Step 4) */
export interface PryroPipelineEmailParams {
  company_name: string;
  niche: string | null;
  contact_name: string;
  contact_role: string;
  location: string | null;
  company_size: string;
  company_context: string;
  rep_name: string;
}

export interface EmailPromptParams {
  lead: EmailLeadInput;
  yourCompany: string;
  /** Structured Pryro offer (use formatPryroOfferForPrompt) */
  yourService: string;
  tone: EmailTone;
  customPainPoint?: string;
  /** Structured lead research — required for best results */
  leadIntel?: LeadIntel;
  /** Rotates subject style across bulk sends */
  subjectFormulaIndex?: number;
}

export const DEFAULT_YOUR_COMPANY = "Pryro";

export type NicheCategory =
  | "school"
  | "restaurant"
  | "healthcare"
  | "retail"
  | "hospitality"
  | "professional"
  | "general";

const NICHE_KEYWORDS: Record<Exclude<NicheCategory, "general">, string[]> = {
  school: [
    "school", "academy", "college", "university", "education", "institute", "kindergarten",
    "ece", "learning center", "tuition",
  ],
  restaurant: [
    "restaurant", "cafe", "café", "bakery", "food", "catering", "bar", "bistro", "pizzeria",
    "kitchen", "diner", "eatery",
  ],
  healthcare: [
    "clinic", "hospital", "medical", "dental", "pharmacy", "health", "doctor", "physician",
    "vet", "veterinary", "therapy",
  ],
  retail: [
    "shop", "store", "retail", "boutique", "supermarket", "market", "wholesale", "dealer",
  ],
  hospitality: [
    "hotel", "motel", "lodge", "resort", "guest", "hostel", "travel", "tour",
  ],
  professional: [
    "law", "legal", "accounting", "consulting", "agency", "real estate", "construction",
    "logistics", "manufacturing", "tech", "software", "finance",
  ],
};

export function detectNicheCategory(niche: string | null | undefined): NicheCategory {
  const n = (niche ?? "").toLowerCase();
  if (!n) return "general";
  for (const [cat, words] of Object.entries(NICHE_KEYWORDS) as [
    Exclude<NicheCategory, "general">,
    string[],
  ][]) {
    if (words.some((w) => n.includes(w))) return cat;
  }
  return "general";
}

const NICHE_GUIDANCE: Record<NicheCategory, string> = {
  school: `NICHE ANGLE (schools/education):
- Likely pains: enrollment/admin on spreadsheets, fee tracking, parent communication scattered, timetables vs finance not connected.
- Tie Pryro to: one system for admin, fees, and operations — less manual reconciliation between departments.
- Do NOT invent specific student counts or accreditation unless in the research block.`,

  restaurant: `NICHE ANGLE (food/hospitality ops):
- Likely pains: inventory vs sales in different tools, staff scheduling, supplier orders tracked manually, thin margins eaten by admin time.
- Tie Pryro to: stock, sales, and costs in one place — owners see what's actually profitable.
- Sound practical, not corporate.`,

  healthcare: `NICHE ANGLE (clinics/health):
- Likely pains: appointments, billing, and inventory on separate systems; compliance-friendly record keeping; front desk overload.
- Tie Pryro carefully: operations and billing visibility — do NOT claim medical record compliance unless context says so.`,

  retail: `NICHE ANGLE (retail/shops):
- Likely pains: stock vs POS mismatch, multi-location visibility, supplier orders by phone/WhatsApp, no real-time margin view.
- Tie Pryro to: inventory, sales, and purchasing connected.`,

  hospitality: `NICHE ANGLE (hotels/lodging):
- Likely pains: bookings vs housekeeping vs billing disconnected, seasonal staffing, owner can't see occupancy + revenue in one view.
- Tie Pryro to: reservations, operations, and finance aligned.`,

  professional: `NICHE ANGLE (B2B services):
- Likely pains: projects, invoicing, and expenses in separate spreadsheets; hard to see cash flow and delivery margin per client.
- Tie Pryro to: projects, billing, and reporting in one system.`,

  general: `NICHE ANGLE (general business):
- Identify the most plausible operational pain for this industry and city size (admin overload, duplicate data entry, no single source of truth).
- Be specific to the research block — if thin, ask a curious question rather than inventing facts.`,
};

const TONE_INSTRUCTIONS: Record<EmailTone, string> = {
  Direct: `TONE — Direct (90–110 words body):
- Open with ONE concrete observation from the research block (or a sharp industry question if research is thin).
- One sentence on what Pryro does for businesses like theirs — plain language, no buzzwords.
- Close with a low-pressure 10-minute call ask.`,

  Aggressive: `TONE — Urgent (100–120 words body):
- Open with the pain from LEAD INTELLIGENCE — ask if it matches their setup (do not say "businesses often").
- One concrete outcome from the Offer section (visibility, fewer manual steps).
- CTA: yes/no on a short call this week — still respectful, not rude.`,

  Surgical: `TONE — Consultative (100–125 words body):
- Open using OPENING HOOK from LEAD INTELLIGENCE.
- Tie PLAUSIBLE PAIN to one outcome from the Offer — ask if that resonates.
- Position Pryro as the logical next step only if they want one system instead of spreadsheets + apps.`,
};

const GOLDEN_EXAMPLE = `EXAMPLE OF A STRONG EMAIL (match this specificity and tone — do not copy verbatim):

SUBJECT: Fees and timetables still on Excel?

BODY:
Green Hills Academy runs a lot on goodwill and long days — I imagine enrollment and fee tracking still touch more than one spreadsheet.

Pryro pulls admin, fees, and reporting into one system so teams stop reconciling the same numbers twice.

If that's even partly true for you, worth a 10-minute call to see if it fits?

Best regards,
Alex Morgan
Executive Sales
Pryro`;

const WEAK_DATA_RULES = `WHEN LEAD INTELLIGENCE says LIMITED DATA:
- BANNED in body: "businesses often", "companies often", "operators in your industry", "in your sector", "organizations like yours", "I noticed", "I came across"
- REQUIRED: open using OPENING HOOK idea; one direct question; one sentence from Offer; soft CTA
- Do NOT invent website details, awards, or team size`;

/** Derive greeting name + role from lead email / company */
export function deriveLeadContactFields(lead: {
  email?: string | null;
  company_name: string;
}): { contact_name: string; contact_role: string; first_name: string } {
  const local = (lead.email?.split("@")[0] ?? "").toLowerCase();
  const generic = new Set([
    "info",
    "contact",
    "hello",
    "hi",
    "sales",
    "admin",
    "office",
    "support",
    "enquiries",
    "enquiry",
  ]);

  let first_name = "there";
  if (local && !generic.has(local)) {
    if (local.includes(".")) {
      const part = local.split(".")[0];
      if (part.length >= 2) {
        first_name = part.charAt(0).toUpperCase() + part.slice(1);
      }
    } else if (local.length >= 2 && local.length <= 20) {
      first_name = local.charAt(0).toUpperCase() + local.slice(1);
    }
  }

  const contact_role =
    generic.has(local) || first_name === "there"
      ? "Team"
      : "Operations";

  return {
    contact_name: first_name === "there" ? "Team" : first_name,
    contact_role,
    first_name,
  };
}

export const INDUSTRY_PAIN_POINTS: Record<string, string> = {
  arcade:
    "Managing shift handovers, cash reconciliation, and game inventory across a 24-hour operation is a manual headache for most entertainment venues.",
  entertainment:
    "Most entertainment venues in Kigali struggle with disconnected systems for ticketing, cash, and inventory — everything lives in a different spreadsheet.",
  warehouse:
    "Stock discrepancies that only surface at month-end cost warehouse teams hours of manual reconciliation every time.",
  retail:
    "Stockouts and overselling happen when your POS, inventory, and finance systems are not talking to each other.",
  restaurant:
    "Food cost overruns are invisible until the end of the month when your inventory and your sales figures finally meet.",
  logistics:
    "By the time a delivery discrepancy shows up in the system, the client has already called to complain.",
  manufacturing:
    "Raw material consumption rarely matches production records — the gap lives in spreadsheets nobody fully trusts.",
  professional_association: PROFESSIONAL_ASSOCIATION_PAIN_POINT,
  default:
    "Most operations teams in Kigali tell us the same thing — by the time a data problem surfaces, it has already cost them hours to untangle.",
};

const SOCIAL_PROOF_LINE =
  "Teams using Pryro typically reduce manual reconciliation time significantly in the first 60 days.";

/** Match niche / company name to industry pain fallback key */
export function resolveIndustryPainKey(
  companyName: string,
  niche: string | null | undefined
): string {
  if (isProfessionalAssociationName(companyName)) {
    return "professional_association";
  }
  const name = companyName.toLowerCase();
  const n = (niche ?? "").toLowerCase();
  if (/arcade|game lounge|gaming/.test(name + n)) return "arcade";
  if (/entertainment|amusement/.test(name + n)) return "entertainment";
  if (/warehouse|storage/.test(n) && !/arcade/.test(name)) return "warehouse";
  if (/retail|shop|store/.test(name + n)) return "retail";
  if (/restaurant|cafe|food/.test(name + n)) return "restaurant";
  if (/logistics|freight|courier/.test(name + n)) return "logistics";
  if (/manufactur|factory/.test(name + n)) return "manufacturing";
  return "default";
}

export function getIndustryPainFallback(
  companyName: string,
  niche: string | null | undefined
): string {
  const key = resolveIndustryPainKey(companyName, niche);
  return INDUSTRY_PAIN_POINTS[key] ?? INDUSTRY_PAIN_POINTS.default;
}

export function isThinCompanyContext(context: string | null | undefined): boolean {
  const t = (context ?? "").trim();
  if (!t) return true;
  if (t.includes("[RESEARCH]") || t.includes("[INTEL]")) return t.length < 50;
  return t.length < 50;
}

/** Step 4 system prompt — Pryro pipeline cold email copywriter */
export function buildPryroPipelineSystemPrompt(repName: string): string {
  return `STRICT RULES — violating any of these means the email fails:

NEVER start with "I help businesses like yours"
NEVER start with "I came across your company"
NEVER use a subject line that could apply to any company (e.g. "Operations Simplified", "Streamline Your Business")
ALWAYS include one social proof sentence (use: "${SOCIAL_PROOF_LINE}" unless real stats appear in context)
ALWAYS open with a pain point specific to this company's industry and operations
Subject line MUST reference the company name or a specific operational detail

You are a cold email copywriter for Pryro, a B2B SaaS platform that helps businesses manage finance, inventory, and operations in one unified platform.
You write short, personalised cold emails that get replies. Every email must:

Open with a specific pain point based on the company's industry and what you know about their operations — never use "I came across your company"
Mention Pryro's value in 1–2 sentences tied directly to that pain point
Include one social proof line (use real stats from context if available, otherwise: "${SOCIAL_PROOF_LINE}")
End with a soft CTA: a 10-minute call, no pressure
Be 100–150 words total (body only, between greeting and "Best regards")
Use the contact's first name in the greeting

Never use: "cutting-edge", "synergy", "innovative", "solutions", "leverage", "I help businesses like yours"
Never flatter the company.
Write like a knowledgeable peer, not a vendor.

Subject line rules:
- Must be 6–9 words
- Must reference the company name OR a specific operational detail from their context
- Must feel like it was written for them specifically
Good examples:
- "Cutting shift reconciliation time at MBC Arcade"
- "How MBC Arcade House tracks cash across shifts"
- "Finance and ops in one place — MBC Arcade"
Bad examples (never use):
- "Operations Simplified"
- "Streamline Your Business"
- "Pryro for [Company Name]"

Return ONLY the email in this format (no preamble):
SUBJECT: [subject line]
Hi [First Name],
[body]
Best regards,
${repName}
Executive Sales, Pryro`;
}

/** Step 4 user prompt — uses company_context from research */
export function buildPryroPipelineUserPrompt(params: PryroPipelineEmailParams): string {
  const context = params.company_context.trim();
  const thin = isThinCompanyContext(context);
  const niche = resolveDisambiguatedNiche(params.company_name, params.niche);
  const painFallback = getIndustryPainFallback(params.company_name, niche);

  const contextSection = thin
    ? `What we know about this company: LIMITED — use this industry pain as your opening angle (do not invent website facts):
${painFallback}`
    : `What we know about this company (scraped from their website and public listings):
${context}`;

  return `Company name: ${params.company_name}
Industry: ${niche || "Business"}
Contact name: ${params.contact_name}
Contact role: ${params.contact_role}
Location: ${params.location?.trim() || "Unknown"}
Company size: ${params.company_size}
${contextSection}

${/arcade|24.hour|entertainment/i.test(context + params.company_name) ? "The opening pain MUST reference their arcade/entertainment operations (e.g. 24-hour shifts, cash across shifts) using facts from context.\n" : ""}${isProfessionalAssociationName(params.company_name) ? "This is a professional/membership organization — NOT a bar, restaurant, or retail shop. Opening pain MUST reference members, dues, events, or admin operations.\n" : ""}Write one cold email for this lead.
Return ONLY the email in this format:
SUBJECT: [subject line]
Hi ${params.contact_name === "Team" ? "there" : params.contact_name.split(" ")[0]},
[body]
Best regards,
${params.rep_name}
Executive Sales, Pryro`;
}

const BANNED_BODY_OPENERS = [
  /^i help businesses like yours/i,
  /^i came across your company/i,
  /^i help companies like yours/i,
];

const GENERIC_SUBJECT_PATTERNS = [
  /operations simplified/i,
  /streamline your business/i,
  /^streamlining\b/i,
  /^simplifying\b/i,
  /^pryro for /i,
  /unified platform$/i,
  /one platform$/i,
];

export type PipelineEmailValidation = {
  ok: boolean;
  reasons: string[];
};

/** Deterministic subject when the model keeps using banned generic words */
export function buildPipelineSubjectFallback(
  companyName: string,
  niche: string | null | undefined
): string {
  const name = companyName.trim();
  const key = resolveIndustryPainKey(companyName, niche);
  if (key === "arcade" || key === "entertainment") {
    return `How ${name} tracks cash across shifts`;
  }
  if (key === "warehouse") {
    return `Month-end stock reconciliation at ${name.split(/\s+/)[0]}`;
  }
  if (key === "restaurant") {
    return `Food cost visibility before month-end at ${name.split(/\s+/)[0]}`;
  }
  if (key === "professional_association") {
    return `Member dues and events at ${name.split(/\s+/)[0]}`;
  }
  return `Finance and ops in one place — ${name.split(/\s+/)[0]}`;
}

export function buildPipelineValidationRetryHint(reasons: string[]): string {
  return `\n\nREJECTED — fix these issues:\n${reasons.map((r) => `- ${r}`).join("\n")}\nSubject must NOT contain: Simplifying, Streamlining, Operations Simplified, Streamline, Unified Platform. Use a concrete ops detail (shifts, cash, inventory) and the company name.`;
}

export function validatePipelineEmail(
  subject: string,
  body: string,
  companyName: string
): PipelineEmailValidation {
  const reasons: string[] = [];
  const bodyOnly = body
    .replace(/^Hi\s+[^,\n]+,?\s*/i, "")
    .replace(/Best regards[\s\S]*$/i, "")
    .trim();
  const words = bodyOnly.split(/\s+/).filter(Boolean).length;

  const firstSentence = bodyOnly.split(/[.!?]/)[0]?.trim() ?? "";
  for (const pat of BANNED_BODY_OPENERS) {
    if (pat.test(firstSentence) || pat.test(bodyOnly.slice(0, 80))) {
      reasons.push('Body must not start with "I help businesses like yours" or similar');
      break;
    }
  }

  if (!/teams using pryro|reduce manual reconciliation|first 60 days/i.test(body)) {
    reasons.push("Missing social proof line about Pryro");
  }

  for (const pat of GENERIC_SUBJECT_PATTERNS) {
    if (pat.test(subject)) {
      reasons.push(`Subject line too generic: "${subject}"`);
      break;
    }
  }

  const companyShort = companyName.split(/\s+/)[0];
  if (
    companyShort.length >= 3 &&
    !subject.toLowerCase().includes(companyShort.toLowerCase()) &&
    !/shift|cash|24.hour|arcade|inventory|reconcil/i.test(subject)
  ) {
    reasons.push("Subject must include company name or a specific operational detail");
  }

  if (words < 70 || words > 180) {
    reasons.push(`Body should be 100–150 words (currently ~${words})`);
  }

  return { ok: reasons.length === 0, reasons };
}

/** Parse Step 4 email format (SUBJECT + Hi greeting, no BODY: prefix) */
export function parsePryroPipelineEmailResponse(
  raw: string,
  repName: string,
  firstName: string,
  senderTitle = "Executive Sales"
): { subject: string; body: string } {
  const subjectMatch = raw.match(/SUBJECT:\s*(.+?)(?:\n|$)/i);
  const subject = subjectMatch
    ? stripMarkdown(subjectMatch[1].replace(/^["']|["']$/g, "").trim())
    : "";

  const hiLine = firstName === "there" ? "Hi there," : `Hi ${firstName},`;
  const bodyMatch = raw.match(/Hi\s+[^,\n]+,?\s*\n([\s\S]+)/i);

  let body = "";
  if (bodyMatch) {
    body = `${hiLine}\n${stripMarkdown(bodyMatch[1].trim())}`;
  } else {
    const afterSubject = raw.replace(/SUBJECT:\s*.+?\n/i, "").trim();
    body = stripMarkdown(afterSubject);
    if (!/^Hi\s/i.test(body)) {
      body = `${hiLine}\n${body}`;
    }
  }

  if (!/Best regards/i.test(body)) {
    body = `${body.trim()}\n\nBest regards,\n${repName}\n${senderTitle}\n${DEFAULT_YOUR_COMPANY}`;
  }

  body = applySenderPlaceholders(body, repName, senderTitle, DEFAULT_YOUR_COMPANY);

  if (!subject) {
    throw new Error("Could not parse AI response — missing SUBJECT line");
  }
  if (!body || body.length < 40) {
    throw new Error("Could not parse AI response — email body too short");
  }

  return { subject, body };
}

export function buildSystemMessage(senderName: string, senderTitle: string): string {
  return `You write short, high-converting B2B cold emails for ${DEFAULT_YOUR_COMPANY}.

GOAL: Make the reader think a real person who understands their business sent this — not a mass blast.

STRUCTURE (3 short paragraphs + signature):
1) Hook — use LEAD INTELLIGENCE "OPENING HOOK" (required). Must mention ${DEFAULT_YOUR_COMPANY}'s recipient by name or one FACT from LEAD INTELLIGENCE.
2) Value — 1–2 sentences from the Offer section only. Plain language; no invented features.
3) CTA — one soft 10-minute call ask.

BODY RULES:
- 90–125 words for the body (excluding signature). Count before finishing.
- Use "I" more than "we". Short sentences. No bullet points, no markdown, no bold.
- NEVER invent facts (awards, revenue, headcount, "I saw your post").
- Opening sentence MUST reference the recipient company name OR a fact from LEAD INTELLIGENCE FACTS.
- Sound like a peer, not a marketing department.

${WEAK_DATA_RULES}

SUBJECT LINE (6–9 words):
- MUST include the recipient company name OR one specific word from WHAT THEY DO.
- Mild curiosity; not clickbait. No ALL CAPS, no emojis, no "Quick question".

AVOID these overused cold-email phrases:
"I hope this email finds you well", "I wanted to reach out", "touching base", "synergy", "leverage", "game-changer", "revolutionary", "excited to announce", "don't hesitate to reach out"

${GOLDEN_EXAMPLE}

SIGNATURE (exactly):
Best regards,
${senderName}
${senderTitle}
${DEFAULT_YOUR_COMPANY}

OUTPUT FORMAT (only this, no preamble):
SUBJECT: [subject line]
BODY: [email body including signature]`;
}

export function buildUserPrompt(params: EmailPromptParams): string {
  const {
    lead,
    yourCompany,
    yourService,
    tone,
    customPainPoint,
    leadIntel,
    subjectFormulaIndex = 0,
  } = params;

  const name = lead.company_name.trim();
  const niche = lead.niche?.trim() || "Business";
  const location = lead.location?.trim() || "their area";
  const category = detectNicheCategory(lead.niche);

  const subjectStyles = [
    `Include "${name}" and hint at admin/ops pain`,
    `"${name}" + spreadsheet or systems angle`,
    `Question about how ${name} runs ${niche} ops`,
    `"Worth 10 minutes" + ${name}`,
    `${niche} ops at ${name}`,
    `Less manual work at ${name}?`,
    `One system for ${name}?`,
  ];
  const subjectHint = subjectStyles[subjectFormulaIndex % subjectStyles.length];

  const intelBlock = leadIntel
    ? formatLeadIntelForPrompt(leadIntel)
    : `=== LEAD INTELLIGENCE ===\nMISSING — use company name ${name}, location ${location}, niche ${niche} only; ask one honest question; do not use generic industry filler.`;

  return `Write one cold outreach email.

=== SENDER (Pryro — from website) ===
Company: ${yourCompany}
Offer:
${yourService}

${intelBlock}

=== NICHE PLAYBOOK ===
${NICHE_GUIDANCE[category]}

=== TONE ===
${TONE_INSTRUCTIONS[tone]}
${customPainPoint ? `\nExtra angle to weave in (if relevant): ${customPainPoint}` : ""}

=== SUBJECT ===
Style hint: ${subjectHint}
Must include "${name}" OR a specific word from WHAT THEY DO.

Write the email now.`;
}

export function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/`(.+?)`/g, "$1")
    .replace(/_{1,2}(.+?)_{1,2}/g, "$1")
    .trim();
}

export function parseEmailResponse(raw: string): { subject: string; body: string } {
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

  throw new Error("Could not parse AI response — expected SUBJECT: and BODY:");
}

export function applySenderPlaceholders(
  body: string,
  senderName: string,
  senderTitle: string,
  yourCompany = DEFAULT_YOUR_COMPANY
): string {
  return body
    .replace(/\[Sender Name\]/gi, senderName)
    .replace(/\[Your Name\]/gi, senderName)
    .replace(/\[Name\]/gi, senderName)
    .replace(/\[Title\]/gi, senderTitle)
    .replace(/\[Your Title\]/gi, senderTitle)
    .replace(/\[Company\]/gi, yourCompany)
    .replace(/\[Your Company\]/gi, yourCompany);
}

/** Prefer capable models for copywriting when user left default instant model */
export function resolveGenerationModel(provider: string, activeModel: string | null): string {
  if (provider === "groq") {
    const m = activeModel || "";
    if (!m || m.includes("8b-instant") || m.includes("1.8b")) {
      return "llama-3.3-70b-versatile";
    }
    return m;
  }
  if (provider === "openai") return activeModel || "gpt-4o-mini";
  if (provider === "anthropic") return activeModel || "claude-3-5-haiku-20241022";
  if (provider === "gemini") return activeModel || "gemini-1.5-flash";
  if (provider === "mistral") return activeModel || "mistral-small-latest";
  return activeModel || "gpt-4o-mini";
}

