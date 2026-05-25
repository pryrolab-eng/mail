/**
 * Structured lead intelligence for email generation.
 * Turns thin scrape data + website text into hook / pain / facts the LLM must use.
 */

import { isWeakLeadContext } from "./lead-context-builder";

type NicheCategory =
  | "school"
  | "restaurant"
  | "healthcare"
  | "retail"
  | "hospitality"
  | "professional"
  | "general";

const NICHE_KEYWORDS: Record<Exclude<NicheCategory, "general">, string[]> = {
  school: ["school", "academy", "college", "university", "education", "institute", "kindergarten"],
  restaurant: ["restaurant", "cafe", "café", "bakery", "food", "catering", "bar", "bistro"],
  healthcare: ["clinic", "hospital", "medical", "dental", "pharmacy", "health", "doctor"],
  retail: ["shop", "store", "retail", "boutique", "supermarket", "market"],
  hospitality: ["hotel", "motel", "lodge", "resort", "guest", "hostel"],
  professional: ["law", "legal", "accounting", "consulting", "agency", "construction", "logistics"],
};

function detectNicheCategory(niche: string | null | undefined): NicheCategory {
  const n = (niche ?? "").toLowerCase();
  for (const [cat, words] of Object.entries(NICHE_KEYWORDS) as [Exclude<NicheCategory, "general">, string[]][]) {
    if (words.some((w) => n.includes(w))) return cat;
  }
  return "general";
}

export interface LeadIntelInput {
  company_name: string;
  niche?: string | null;
  location?: string | null;
  company_context?: string | null;
  website?: string | null;
  phone?: string | null;
  rating?: string | null;
}

export interface LeadIntel {
  companyName: string;
  niche: string;
  location: string;
  whatTheyDo: string;
  likelyPain: string;
  hookLine: string;
  facts: string[];
  weak: boolean;
  /** How intel was produced */
  source?: "rules" | "ai";
}

export interface ResolveLeadIntelOptions {
  /** When set, may run one LLM call to sharpen intel */
  aiProvider?: { provider: string; api_key: string; active_model: string | null } | null;
  /** Default: true when aiProvider is set and context is weak or missing */
  useAi?: boolean;
}

const NICHE_PAIN: Record<NicheCategory, string> = {
  school:
    "enrollment, fees, and admin spread across spreadsheets instead of one system",
  restaurant:
    "inventory, sales, and supplier orders not visible in one place",
  healthcare:
    "appointments, billing, and stock handled in separate tools",
  retail:
    "stock levels and sales data that do not match day to day",
  hospitality:
    "bookings, housekeeping, and billing on disconnected systems",
  professional:
    "projects, invoicing, and expenses living in different spreadsheets",
  general:
    "duplicate data entry and no single view of operations",
};

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const normalised = url.startsWith("http") ? url : `https://${url}`;
    const res = await fetch(normalised, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("text/html")) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function metaDescription(html: string): string {
  const m =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
  return m?.[1]?.trim() ?? "";
}

function pageTitle(html: string): string {
  return html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ?? "";
}

function bestSentences(text: string, companyName: string, max = 2): string[] {
  const firstWord = companyName.split(/\s+/)[0]?.toLowerCase() ?? "";
  return text
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 45 && s.length < 220)
    .filter((s) => !/cookie|javascript|privacy|terms of use/i.test(s))
    .sort((a, b) => {
      const aHit = firstWord && a.toLowerCase().includes(firstWord) ? 1 : 0;
      const bHit = firstWord && b.toLowerCase().includes(firstWord) ? 1 : 0;
      return bHit - aHit;
    })
    .slice(0, max);
}

/** Fetch homepage/about text for intel (best-effort). */
export async function fetchLeadWebsiteSnippet(website: string): Promise<{
  meta: string;
  title: string;
  sentences: string[];
} | null> {
  const base = website.startsWith("http") ? website : `https://${website}`;
  let origin = base;
  try {
    origin = new URL(base).origin;
  } catch {
    return null;
  }

  for (const url of [base, `${origin}/about`, `${origin}/about-us`]) {
    const html = await fetchHtml(url);
    if (!html) continue;
    const text = htmlToText(html);
    const sentences = bestSentences(text, "");
    const meta = metaDescription(html);
    const title = pageTitle(html);
    if (meta || sentences.length > 0 || title) {
      return { meta, title, sentences };
    }
  }
  return null;
}

export function buildLeadIntel(
  input: LeadIntelInput,
  websiteSnippet?: { meta: string; title: string; sentences: string[] } | null
): LeadIntel {
  const companyName = input.company_name.trim();
  const niche = input.niche?.trim() || "Business";
  const location = input.location?.trim() || "their area";
  const context = input.company_context?.trim() ?? "";
  const weak = isWeakLeadContext(context, companyName);
  const category = detectNicheCategory(input.niche);

  const facts: string[] = [
    `Company name: ${companyName}`,
    `Industry: ${niche}`,
    `Location: ${location}`,
  ];
  if (input.website) facts.push(`Website: ${input.website}`);
  if (input.phone) facts.push(`Phone: ${input.phone}`);
  if (input.rating) facts.push(`Rating: ${input.rating}`);

  let whatTheyDo = "";
  if (websiteSnippet?.meta && websiteSnippet.meta.length > 25) {
    whatTheyDo = websiteSnippet.meta;
  } else if (websiteSnippet?.sentences?.[0]) {
    whatTheyDo = websiteSnippet.sentences[0];
  } else if (context && !weak) {
    whatTheyDo = context.slice(0, 280);
  } else if (websiteSnippet?.title) {
    whatTheyDo = `${companyName} — ${websiteSnippet.title}`;
  } else {
    whatTheyDo = `${companyName} operates in the ${niche} space in ${location}.`;
  }

  const likelyPain = NICHE_PAIN[category];

  let hookLine: string;
  if (!weak && context.length > 60) {
    const anchor = context.split(/[.!?]/)[0]?.trim().slice(0, 120) ?? companyName;
    hookLine = `${companyName} in ${location} — ${anchor}.`;
  } else if (websiteSnippet?.sentences?.[0]) {
    hookLine = `From your site: ${websiteSnippet.sentences[0].slice(0, 140)}`;
  } else if (input.rating) {
    hookLine = `${companyName} (${input.rating}) in ${location} — quick question about how you run ${niche} ops.`;
  } else {
    hookLine = `${companyName} in ${location} — one question about your ${niche} operations.`;
  }

  if (context && !weak) {
    const extra = context.slice(0, 200);
    if (!whatTheyDo.includes(extra.slice(0, 40))) {
      facts.push(`From research: ${extra}`);
    }
  }

  return {
    companyName,
    niche,
    location,
    whatTheyDo: whatTheyDo.slice(0, 320),
    likelyPain,
    hookLine: hookLine.slice(0, 200),
    facts,
    weak,
    source: "rules",
  };
}

/** Format intel block injected into the user prompt. */
export function formatLeadIntelForPrompt(intel: LeadIntel): string {
  const weakNote = intel.weak
    ? "\n⚠ LIMITED DATA — opening MUST use hookLine below; do NOT write \"businesses often\" or \"operators in your industry\"."
    : "\nUse hookLine for the opening sentence; cite at least one item from FACTS.";

  const src =
    intel.source === "ai"
      ? " (AI-analyzed from website/research)"
      : " (from website rules)";

  return `=== LEAD INTELLIGENCE (required — do not ignore)${src} ===
WHAT THEY DO: ${intel.whatTheyDo}
PLAUSIBLE PAIN (ask or reference naturally): ${intel.likelyPain}
OPENING HOOK (start body with this idea, in your own words): ${intel.hookLine}
FACTS (cite at least one):
${intel.facts.map((f) => `- ${f}`).join("\n")}${weakNote}`;
}

/** Build structured intel; fetches website when useful; optional LLM pass. */
export async function resolveLeadIntel(
  input: LeadIntelInput,
  options?: ResolveLeadIntelOptions
): Promise<LeadIntel> {
  const stored = parseStoredLeadIntel(input.company_context);
  if (stored?.hookLine && !options?.useAi) {
    const base = buildLeadIntel(input, null);
    return {
      ...base,
      whatTheyDo: stored.whatTheyDo || base.whatTheyDo,
      likelyPain: stored.likelyPain || base.likelyPain,
      hookLine: stored.hookLine,
      weak: false,
      source: "rules",
    };
  }

  const weak = isWeakLeadContext(input.company_context, input.company_name);
  let snippet: Awaited<ReturnType<typeof fetchLeadWebsiteSnippet>> = null;
  let websiteText = "";

  if (input.website && (weak || !input.company_context?.trim() || options?.useAi)) {
    snippet = await fetchLeadWebsiteSnippet(input.website);
    if (snippet) {
      websiteText = [snippet.meta, snippet.title, ...snippet.sentences]
        .filter(Boolean)
        .join(" ");
    }
    if (!websiteText && input.website) {
      const html = await fetchHtml(input.website);
      if (html) websiteText = htmlToText(html).slice(0, 2500);
    }
  }

  const ruleIntel = buildLeadIntel(input, snippet);

  const shouldUseAi =
    options?.useAi !== false &&
    options?.aiProvider?.api_key &&
    (weak || options?.useAi === true || !stored?.hookLine);

  if (shouldUseAi && options?.aiProvider) {
    const { enhanceLeadIntelWithAI } = await import("./lead-intel-ai");
    const enhanced = await enhanceLeadIntelWithAI(
      options.aiProvider,
      input,
      ruleIntel,
      websiteText || input.company_context || ""
    );
    if (enhanced) return enhanced.intel;
  }

  return ruleIntel;
}

/** Persist-friendly block stored in company_context after enrich. */
export function serializeLeadIntelForStorage(intel: LeadIntel): string {
  return [
    `[INTEL]`,
    `Source: ${intel.source || "rules"}`,
    `What they do: ${intel.whatTheyDo}`,
    `Pain: ${intel.likelyPain}`,
    `Hook: ${intel.hookLine}`,
    `Facts: ${intel.facts.join(" | ")}`,
    `[/INTEL]`,
  ].join("\n");
}

export function parseStoredLeadIntel(context: string | null | undefined): Partial<LeadIntel> | null {
  if (!context?.includes("[INTEL]")) return null;
  const block = context.match(/\[INTEL\]([\s\S]*?)\[\/INTEL\]/)?.[1] ?? "";
  const what = block.match(/What they do:\s*(.+)/i)?.[1]?.trim();
  const pain = block.match(/Pain:\s*(.+)/i)?.[1]?.trim();
  const hook = block.match(/Hook:\s*(.+)/i)?.[1]?.trim();
  if (!what && !hook) return null;
  return { whatTheyDo: what, likelyPain: pain, hookLine: hook };
}
