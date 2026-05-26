/**
 * Builds company_context strings for scraped/enriched leads.
 * Avoids useless placeholders when we have real snippets or facts.
 */

/** Company-name signals for membership/professional bodies (not venues/shops) */
export const PROFESSIONAL_ASSOCIATION_NAME_PATTERN =
  /\b(association|institute|federation|council|chamber|society|union)\b/i;

export const PROFESSIONAL_ASSOCIATION_NICHE = "Professional Association";
export const PROFESSIONAL_ASSOCIATION_INDUSTRY_KEY = "professional_association";

export const PROFESSIONAL_ASSOCIATION_PAIN_POINT =
  "Managing member records, dues collection, and event operations across spreadsheets creates gaps that cost staff hours every month.";

/** True when the name denotes a professional body (e.g. Bar Association ≠ bar/pub). */
export function isProfessionalAssociationName(companyName: string): boolean {
  return PROFESSIONAL_ASSOCIATION_NAME_PATTERN.test(companyName.trim());
}

/**
 * Override misclassified scraper niches before research or email generation.
 */
export function resolveDisambiguatedNiche(
  companyName: string,
  scrapedNiche: string | null | undefined
): string {
  if (isProfessionalAssociationName(companyName)) {
    return PROFESSIONAL_ASSOCIATION_NICHE;
  }
  return scrapedNiche?.trim() ?? "";
}

/** Industry key for pain-point map — company name wins over wrong Maps/scraper tags */
export function resolveDisambiguatedIndustryKey(
  companyName: string,
  niche: string | null | undefined
): string | null {
  if (isProfessionalAssociationName(companyName)) {
    return PROFESSIONAL_ASSOCIATION_INDUSTRY_KEY;
  }
  return null;
}

export interface LeadContextInput {
  companyName: string;
  niche: string;
  location: string;
  snippet?: string;
  website?: string;
  phone?: string;
  rating?: string;
  metaDescription?: string;
}

const GENERIC_PATTERN =
  /^[A-Za-z0-9\s.'&-]+ is a .+ (business )?in .+\.?\s*$/i;

/** Maps/scrape stub with only website + rating — no real research */
const MAPS_STUB_PATTERN =
  /^Website:\s*https?:\/\/[^\s·]+(\s*·\s*Phone:[^\n]*)?(\s*·\s*Google rating:[^\n]*)?$/i;

/** True when context is only "X is a niche in location" with no real detail. */
export function isWeakLeadContext(
  context: string | null | undefined,
  companyName?: string
): boolean {
  if (!context?.trim()) return true;
  const t = context.trim();
  if (t.includes("[RESEARCH]") || t.includes("[INTEL]")) return false;
  if (t.length < 50) return true;
  if (GENERIC_PATTERN.test(t)) return true;
  if (companyName && t === `${companyName} is a business in unknown.`) return true;
  if (MAPS_STUB_PATTERN.test(t.replace(/\s+/g, " ").trim())) return true;
  if (
    /^Website:\s*https?:\/\//i.test(t) &&
    !/How they describe|Business type|Operations:|Website evidence|Public evidence/i.test(t) &&
    t.length < 180
  ) {
    return true;
  }
  return false;
}

function cleanSnippet(snippet: string): string {
  return snippet.replace(/\s+/g, " ").trim().slice(0, 400);
}

export function buildLeadContext(input: LeadContextInput): string {
  const { companyName, location, snippet, website, phone, rating, metaDescription } =
    input;
  const niche = resolveDisambiguatedNiche(companyName, input.niche) || input.niche;

  const parts: string[] = [];

  const cleanSnip = snippet ? cleanSnippet(snippet) : "";
  if (cleanSnip.length > 35 && !GENERIC_PATTERN.test(cleanSnip)) {
    parts.push(cleanSnip);
  }

  if (metaDescription && metaDescription.length > 25) {
    const md = metaDescription.trim().slice(0, 200);
    if (!parts.some((p) => p.includes(md.slice(0, 40)))) parts.push(md);
  }

  const facts: string[] = [];
  if (website) facts.push(`Website: ${website}`);
  if (phone) facts.push(`Phone: ${phone}`);
  if (rating) facts.push(`Google rating: ${rating}`);
  if (facts.length) parts.push(facts.join(" · "));

  if (parts.length === 0) {
    if (isProfessionalAssociationName(companyName)) {
      return `${companyName} is a professional membership organization in ${location}. Focus on member records, dues collection, events, and staff admin — not hospitality, food service, or retail.`;
    }
    return `${companyName} is a ${niche} business in ${location}. Research their operations before pitching — focus on admin burden, disconnected tools, or manual tracking typical for ${niche} in that market.`;
  }

  return parts.join(" ").slice(0, 500);
}

export interface EnrichedLeadContextResult {
  context: string;
  niche: string;
  knowledgeGraphUsed: boolean;
}

/**
 * Build context and optionally enrich via Google Knowledge Graph (free API key).
 */
export async function buildEnrichedLeadContext(
  input: LeadContextInput
): Promise<EnrichedLeadContextResult> {
  let niche =
    resolveDisambiguatedNiche(input.companyName, input.niche) || input.niche;
  let context = buildLeadContext({ ...input, niche });
  let knowledgeGraphUsed = false;

  try {
    const { enrichViaKnowledgeGraph } = await import('./knowledge-graph-enricher');
    const kg = await enrichViaKnowledgeGraph(input.companyName, input.location);
    if (kg.description || kg.category || kg.website) {
      knowledgeGraphUsed = true;
      try {
        const { scrapeRunStats } = await import('./scrape-run-stats');
        scrapeRunStats.knowledgeGraphEnriched++;
      } catch {
        /* optional stats */
      }
    }
    if (kg.description) {
      context = `[KNOWLEDGE GRAPH] ${kg.description}\n${context}`.slice(0, 600);
    }
    if (kg.category) {
      niche = kg.category;
    }
  } catch {
    /* optional enrichment */
  }

  return { context, niche, knowledgeGraphUsed };
}
