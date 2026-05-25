/**
 * Loads Pryro's value proposition from the live website (not hardcoded copy).
 * Cached in memory to avoid hitting pryro.com on every email generation.
 */

const DEFAULT_WEBSITE = "https://pryro.com";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export interface PryroProfile {
  company: string;
  website: string;
  /** Full text fallback */
  serviceOffer: string;
  oneLiner: string;
  whoItsFor: string;
  outcomes: string[];
  proof: string;
  fetchedAt: number;
}

let cache: PryroProfile | null = null;

export function getPryroWebsiteUrl(): string {
  return (
    process.env.PRYRO_WEBSITE_URL ||
    process.env.NEXT_PUBLIC_PRYRO_WEBSITE_URL ||
    DEFAULT_WEBSITE
  ).replace(/\/$/, "");
}

function extractText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function extractMeta(html: string, name: string): string {
  const re = new RegExp(
    `<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']+)["']`,
    "i"
  );
  const m = html.match(re);
  if (m?.[1]) return m[1].trim();
  const re2 = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${name}["']`,
    "i"
  );
  return html.match(re2)?.[1]?.trim() ?? "";
}

function extractTitle(html: string): string {
  return html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ?? "";
}

function extractOfferSentences(text: string): string[] {
  const keywords = [
    "erp", "platform", "software", "automate", "manage", "business", "operations",
    "inventory", "sales", "reporting", "spreadsheet", "excel", "workflow",
    "commission", "partner", "unified", "system", "solution",
  ];

  return text
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 35 && s.length < 280)
    .filter((s) => !/cookie|javascript|privacy policy|terms of/i.test(s))
    .map((s) => ({
      s,
      score: keywords.reduce((n, k) => (s.toLowerCase().includes(k) ? n + 1 : n), 0),
    }))
    .filter((x) => x.score >= 2)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.s)
    .slice(0, 5);
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(12_000),
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("text/html")) return null;
    return await res.text();
  } catch {
    return null;
  }
}

interface ScrapeRaw {
  meta: string;
  title: string;
  sentences: string[];
  fullText: string;
}

async function scrapePryroRaw(website: string): Promise<ScrapeRaw> {
  const urls = [website, `${website}/about`, `${website}/about-us`];
  let meta = "";
  let title = "";
  const sentences: string[] = [];
  let fullText = "";

  for (const url of urls) {
    const html = await fetchHtml(url);
    if (!html) continue;

    meta =
      meta ||
      extractMeta(html, "description") ||
      extractMeta(html, "og:description") ||
      extractMeta(html, "twitter:description");
    title = title || extractTitle(html);
    const text = extractText(html);
    if (text.length > fullText.length) fullText = text;
    for (const s of extractOfferSentences(text)) {
      if (!sentences.includes(s)) sentences.push(s);
    }
    if (meta && sentences.length >= 2) break;
  }

  return { meta, title, sentences, fullText };
}

function structureProfile(website: string, raw: ScrapeRaw): PryroProfile {
  const oneLiner =
    raw.meta?.slice(0, 200) ||
    raw.sentences[0]?.slice(0, 200) ||
    "Pryro is business software that unifies operations, sales, and reporting in one system.";

  const whoItsFor =
    raw.sentences.find((s) => /business|company|team|industry|sector/i.test(s))?.slice(0, 120) ||
    "Small and mid-sized businesses replacing spreadsheets and scattered apps";

  const outcomes = raw.sentences
    .filter((s) => s !== oneLiner && !s.includes(whoItsFor.slice(0, 30)))
    .slice(0, 3)
    .map((s) => s.slice(0, 140));

  if (outcomes.length === 0) {
    outcomes.push(
      "Replace Excel and manual workflows with one connected system",
      "See operations, sales, and reports in one place",
      "Reduce duplicate data entry between teams"
    );
  }

  const proofMatch = raw.fullText.match(
    /\d+\s*[-–]?\s*\d*\s*%|commission|partner|referral/gi
  );
  const proof = proofMatch
    ? raw.sentences.find((s) => /commission|partner|refer|%/i.test(s))?.slice(0, 120) ?? ""
    : "";

  const serviceOffer = [oneLiner, ...outcomes, proof].filter(Boolean).join(" ").slice(0, 600);

  return {
    company: "Pryro",
    website,
    serviceOffer,
    oneLiner,
    whoItsFor,
    outcomes,
    proof,
    fetchedAt: Date.now(),
  };
}

const MINIMAL: PryroProfile = {
  company: "Pryro",
  website: DEFAULT_WEBSITE,
  oneLiner: "Pryro is business management software (ERP) for operations, sales, and reporting.",
  whoItsFor: "Businesses outgrowing spreadsheets and multiple disconnected tools",
  outcomes: [
    "One system instead of Excel plus separate apps",
    "Clear view of stock, sales, and cash flow",
    "Less manual reconciliation between teams",
  ],
  proof: "",
  serviceOffer:
    "Pryro is business management software (ERP) for operations, sales, and reporting.",
  fetchedAt: 0,
};

/** Structured block for LLM — use instead of raw scrape blob. */
export function formatPryroOfferForPrompt(profile: PryroProfile): string {
  const lines = [
    `One-liner: ${profile.oneLiner}`,
    `Who it's for: ${profile.whoItsFor}`,
    "Key outcomes (use 1–2 in the email, plain language):",
    ...profile.outcomes.map((o) => `  • ${o}`),
  ];
  if (profile.proof) lines.push(`Proof / partner note (only if relevant): ${profile.proof}`);
  lines.push(`Website: ${profile.website}`);
  return lines.join("\n");
}

export async function getPryroProfile(forceRefresh = false): Promise<PryroProfile> {
  const website = getPryroWebsiteUrl();
  const now = Date.now();

  if (!forceRefresh && cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return cache;
  }

  const raw = await scrapePryroRaw(website);
  if (!raw.meta && raw.sentences.length === 0) {
    console.warn("[Pryro profile] Website scrape thin or failed; using minimal fallback");
    cache = { ...MINIMAL, website, fetchedAt: now };
    return cache;
  }

  cache = structureProfile(website, raw);
  cache.fetchedAt = now;
  return cache;
}

export function clearPryroProfileCache(): void {
  cache = null;
}
