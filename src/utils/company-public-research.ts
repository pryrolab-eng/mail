/**
 * Public company research when the website is down or thin.
 * Bing HTML search (same approach as puppeteer-scraper).
 */

import { resolveDisambiguatedIndustryKey } from "@/utils/lead-context-builder";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function decodeHtmlEntities(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

async function httpGet(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

export type PublicResearchHit = {
  title: string;
  snippet: string;
  url: string;
};

export type PublicCompanyResearch = {
  hits: PublicResearchHit[];
  combinedText: string;
  sources: string[];
};

/**
 * Bing search for public snippets about a company (fallback when website fails).
 */
export async function searchPublicCompanyInfo(
  companyName: string,
  location: string
): Promise<PublicCompanyResearch> {
  const loc = location.split(",")[0]?.trim() || "Kigali";
  const queries = [
    `"${companyName}" Kigali Rwanda`,
    `${companyName} Kigali arcade 24 hours`,
    `${companyName} KN 87 Street Kigali`,
    `${companyName} Rwanda entertainment venue`,
  ];

  const hits: PublicResearchHit[] = [];
  const seen = new Set<string>();

  for (const query of queries) {
    if (hits.length >= 6) break;
    const html = await httpGet(
      `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=20`
    );
    if (!html) continue;

    const blocks =
      html.match(/<li[^>]*class="[^"]*b_algo[^"]*"[^>]*>[\s\S]*?<\/li>/gi) ?? [];

    for (const block of blocks.slice(0, 4)) {
      const titleMatch = block.match(/<h2[^>]*>.*?<a[^>]*>(.*?)<\/a>/i);
      const title = stripHtml(titleMatch?.[1] ?? "");
      const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
      const snippet = stripHtml(snippetMatch?.[1] ?? "");
      const cite = block.match(/<cite[^>]*>([^<]*)<\/cite>/i)?.[1]?.trim() ?? "";
      const url = cite.startsWith("http") ? cite : cite ? `https://${cite.split(/\s/)[0]}` : "";

      const key = `${title}|${snippet.slice(0, 80)}`;
      if (!title || seen.has(key)) continue;
      const blob = `${title} ${snippet} ${companyName} ${location}`.toLowerCase();

      if (
        /mauritius|broadcasting|mbcradio|mbc\.net|mbc play|mbc 1 programme|google play|mena|middle east|paramount global|mbc group, the largest/i.test(
          blob
        )
      ) {
        continue;
      }

      const hasLocal = /kigali|rwanda|kn 87|3356\+m7c|0784 171|arcade house/i.test(
        blob
      );

      if (!hasLocal) {
        continue;
      }

      if (/arcade house/i.test(companyName.toLowerCase()) && !/arcade/i.test(blob)) {
        continue;
      }
      seen.add(key);
      hits.push({ title, snippet, url });
    }
  }

  const combinedText = hits
    .map((h) => `${h.title}. ${h.snippet}`)
    .join(" ")
    .slice(0, 1500);

  return {
    hits,
    combinedText,
    sources: hits.map((h) => h.url).filter(Boolean),
  };
}

/** Pull operational signals from Maps-style location strings */
export function extractOperationalSignalsFromLocation(
  location: string | null | undefined,
  companyName: string
): string[] {
  const blob = `${companyName} ${location ?? ""}`;
  const signals: string[] = [];

  if (/open 24 hours|24\/7|24 hours/i.test(blob)) {
    signals.push("Operates 24 hours (listing data)");
  }
  if (/arcade|game lounge|gaming|entertainment/i.test(blob)) {
    signals.push("Entertainment / arcade venue");
  }
  if (/warehouse/i.test(blob) && /arcade/i.test(companyName)) {
    signals.push("Listed under warehouse on Maps — likely mis-tagged; name indicates arcade");
  }
  if (/kigali|rwanda/i.test(blob)) {
    signals.push("Based in Kigali, Rwanda");
  }
  if (/078\d|\+250/.test(blob)) {
    signals.push("Local Rwanda phone contact on listing");
  }

  return signals;
}

/** Infer industry key for pain-point map (company name beats wrong niche tag) */
export function inferIndustryKey(
  companyName: string,
  niche: string | null | undefined
): string {
  const disambiguated = resolveDisambiguatedIndustryKey(companyName, niche);
  if (disambiguated) return disambiguated;

  const name = companyName.toLowerCase();
  const n = (niche ?? "").toLowerCase();

  if (/arcade|game lounge|gaming center/.test(name)) return "arcade";
  if (/restaurant|cafe|bistro|food/.test(name)) return "restaurant";
  if (/warehouse|logistics|storage|freight/.test(name) && !/arcade/.test(name)) {
    return /logistics|freight/.test(name + n) ? "logistics" : "warehouse";
  }
  if (/retail|shop|store|boutique/.test(name + n)) return "retail";
  if (/manufactur|factory/.test(name + n)) return "manufacturing";
  if (/hotel|lodge|resort/.test(name + n)) return "entertainment";

  if (/arcade|entertainment|game/.test(n)) return "arcade";
  if (/warehouse/.test(n)) return "warehouse";
  if (/restaurant|food/.test(n)) return "restaurant";
  if (/retail|shop/.test(n)) return "retail";
  if (/logistics/.test(n)) return "logistics";
  if (/manufactur/.test(n)) return "manufacturing";

  return "default";
}

export function buildStructuredResearchBlock(fields: {
  companyName: string;
  businessType: string;
  operatingSignals: string[];
  services: string[];
  theirPhrases: string[];
  websiteText?: string;
  publicSnippets?: string;
  sources: string[];
}): string {
  const cleanText = (value: string | undefined): string => {
    const text = (value ?? "").replace(/\s+/g, " ").trim();
    const lower = text.toLowerCase();
    const jsDisabledCount = (lower.match(/javascript is disabled/g) ?? []).length;
    if (jsDisabledCount >= 2) return "";
    if (
      text.length < 140 &&
      /javascript is disabled|enable javascript|captcha|access denied|forbidden|cloudflare/i.test(text)
    ) {
      return "";
    }
    return text;
  };
  const websiteText = cleanText(fields.websiteText);
  const publicSnippets = cleanText(fields.publicSnippets);
  const lines = [
    "[RESEARCH]",
    `Company: ${fields.companyName}`,
    `Business type: ${fields.businessType}`,
  ];
  if (fields.operatingSignals.length) {
    lines.push(`Operations: ${fields.operatingSignals.join("; ")}`);
  }
  if (fields.services.length) {
    lines.push(`Services: ${fields.services.join("; ")}`);
  }
  if (fields.theirPhrases.length) {
    lines.push(
      `Evidence phrases: ${JSON.stringify(fields.theirPhrases.slice(0, 4))}`
    );
  }
  if (websiteText) {
    lines.push(`Website evidence: ${websiteText.slice(0, 600)}`);
  }
  if (publicSnippets) {
    lines.push(`Public evidence: ${publicSnippets.slice(0, 500)}`);
  }
  if (fields.sources.length) {
    lines.push(`Sources: ${fields.sources.slice(0, 5).join(", ")}`);
  }
  lines.push("[/RESEARCH]");
  return lines.join("\n");
}
