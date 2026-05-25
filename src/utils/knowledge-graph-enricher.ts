/**
 * Google Knowledge Graph Search API (free tier, requires API key — no billing).
 */

export interface KnowledgeGraphEnrichment {
  description: string | null;
  category: string | null;
  website: string | null;
  detailedType: string[];
}

const TYPE_TO_NICHE: Record<string, string> = {
  Restaurant: 'restaurant',
  FoodEstablishment: 'restaurant',
  LodgingBusiness: 'hotel',
  Hospital: 'healthcare',
  School: 'education',
  CollegeOrUniversity: 'education',
  LocalBusiness: 'local business',
  Organization: 'organisation',
  GovernmentOrganization: 'government',
  NGO: 'ngo',
  LegalService: 'professional_association',
  FinancialService: 'finance',
  Store: 'retail',
  WholesaleStore: 'wholesale',
  MedicalOrganization: 'healthcare',
  MedicalClinic: 'healthcare',
  Pharmacy: 'healthcare',
};

function mapTypesToNiche(types: string[]): string | null {
  for (const t of types) {
    const key = t.replace(/^.*\//, '').trim();
    if (TYPE_TO_NICHE[key]) return TYPE_TO_NICHE[key];
  }
  for (const t of types) {
    const bare = t.replace(/^.*\//, '');
    for (const [typeKey, niche] of Object.entries(TYPE_TO_NICHE)) {
      if (bare.toLowerCase().includes(typeKey.toLowerCase())) return niche;
    }
  }
  return null;
}

function parseKgResult(
  best: Record<string, unknown> | undefined
): KnowledgeGraphEnrichment | null {
  if (!best) return null;

  const rawType = best['@type'];
  const detailedType = Array.isArray(rawType)
    ? rawType.map(String)
    : rawType
      ? [String(rawType)]
      : [];

  const detailedDesc = best.detailedDescription as
    | { articleBody?: string }
    | undefined;
  const articleBody = detailedDesc?.articleBody?.trim();
  const shortDesc =
    typeof best.description === 'string' ? best.description.trim() : '';
  const description =
    (articleBody?.slice(0, 200) || shortDesc || null) ?? null;

  const category =
    mapTypesToNiche(detailedType) || shortDesc || null;

  const website =
    typeof best.url === 'string' ? best.url.trim() || null : null;

  if (!description && !category && !website && detailedType.length === 0) {
    return null;
  }

  return {
    description,
    category,
    website,
    detailedType,
  };
}

/**
 * Enrich company facts from Knowledge Graph. Never throws.
 */
export async function enrichViaKnowledgeGraph(
  companyName: string,
  location: string
): Promise<KnowledgeGraphEnrichment> {
  const empty: KnowledgeGraphEnrichment = {
    description: null,
    category: null,
    website: null,
    detailedType: [],
  };

  const apiKey = process.env.GOOGLE_KNOWLEDGE_GRAPH_API_KEY?.trim();
  if (!apiKey) {
    console.warn(
      '[KNOWLEDGE GRAPH] API key missing — skipping enrichment. Get free key: console.cloud.google.com → Enable "Knowledge Graph Search API" → Create credentials → No billing needed.'
    );
    return empty;
  }

  const query = `${companyName} ${location}`.trim();
  if (!query) return empty;

  try {
    const url = new URL('https://kgsearch.googleapis.com/v1/entities:search');
    url.searchParams.set('query', query);
    url.searchParams.set('key', apiKey);
    url.searchParams.set('limit', '3');
    url.searchParams.set('indent', 'True');

    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.warn(
        `[KNOWLEDGE GRAPH] API HTTP ${res.status}: ${errText.slice(0, 120)}`
      );
      return empty;
    }

    const data = (await res.json()) as {
      itemListElement?: Array<{ result?: Record<string, unknown> }>;
    };

    const items = data.itemListElement ?? [];
    if (items.length === 0) return empty;

    for (const item of items) {
      const parsed = parseKgResult(item.result);
      if (parsed) return parsed;
    }

    return empty;
  } catch (err) {
    console.warn(
      `[KNOWLEDGE GRAPH] Request failed:`,
      err instanceof Error ? err.message : String(err)
    );
    return empty;
  }
}
