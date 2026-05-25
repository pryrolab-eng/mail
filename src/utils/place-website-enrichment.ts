/**
 * When gosom CSV has no website URL, try to find one (and email) like Puppeteer Maps does:
 *  1. Google Maps place link (if in CSV)
 *  2. Brave / Bing / DuckDuckGo search
 *  3. Guess domain from company name + probe contact pages
 */

import { inferDomainsFromName } from './email-guesser';
import type { AIProviderConfig } from './ai-scraper-helper';
import type { SearchHit } from './search-engine-fetch';

export type PlaceEnrichmentResult = {
  website?: string;
  email?: string;
  allEmails?: string[];
  mailtoEmails?: string[];
  source?:
    | 'maps_link'
    | 'knowledge_graph'
    | 'bing_website'
    | 'bing_snippet'
    | 'domain_guess'
    | 'brave';
  note?: string;
};

const SKIP_DOMAINS = [
  'google.com',
  'google.rw',
  'maps.google',
  'goo.gl',
  'bing.com',
  'microsoft.com',
  'facebook.com',
  'instagram.com',
  'linkedin.com',
  'twitter.com',
  'youtube.com',
  'wikipedia.org',
  'yelp.com',
  'tripadvisor.com',
  'yellowpages',
  'zoominfo.com',
];

function normName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Loose match — search titles rarely equal Maps names exactly. */
export function companyMatchesSearchHit(companyName: string, hitTitle: string): boolean {
  const company = normName(companyName);
  const title = normName(hitTitle.replace(/\s*[-|–|·].*$/, '').trim());
  if (company.length < 4 || title.length < 4) return false;
  if (company === title) return true;
  const cShort = company.slice(0, Math.min(company.length, 14));
  const tShort = title.slice(0, Math.min(title.length, 14));
  return company.includes(tShort) || title.includes(cShort);
}

function isSkippableUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return SKIP_DOMAINS.some((d) => lower.includes(d));
}

function normalizeUrl(url: string): string | undefined {
  const s = url.trim();
  if (!s) return undefined;
  if (/^https?:\/\//i.test(s)) return s.split('#')[0];
  if (/^www\./i.test(s) || /^[a-z0-9][-a-z0-9.]*\.[a-z]{2,}/i.test(s)) {
    return `https://${s}`.split('#')[0];
  }
  return undefined;
}

function pickBestWebsiteHit(
  companyName: string,
  hits: SearchHit[]
): { url: string; title: string } | null {
  for (const hit of hits) {
    const url = normalizeUrl(hit.url);
    if (!url || isSkippableUrl(url)) continue;
    if (!companyMatchesSearchHit(companyName, hit.title)) continue;
    return { url, title: hit.title };
  }
  for (const hit of hits) {
    const url = normalizeUrl(hit.url);
    if (!url || isSkippableUrl(url)) continue;
    return { url, title: hit.title };
  }
  return null;
}

function extractEmailFromText(text: string): string | null {
  const re = /\b([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})\b/g;
  const blocked = ['example.com', 'wixpress.com', 'sentry.io', 'google.com'];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const e = m[1].toLowerCase();
    if (blocked.some((b) => e.includes(b))) continue;
    if (/^(noreply|no-reply|donotreply|privacy)@/.test(e)) continue;
    return e;
  }
  return null;
}

export function websiteEnrichmentEnabled(): boolean {
  const v = process.env.GMAPS_DOCKER_NO_WEBSITE_ENRICH?.trim().toLowerCase();
  return v !== 'false' && v !== '0' && v !== 'no';
}

async function searchWebForCompany(
  companyName: string,
  location: string
): Promise<{ hits: SearchHit[]; source: string }> {
  const loc = location.trim() || 'Rwanda';
  const query = `"${companyName}" ${loc} official website`;

  const { hasBraveSearchApi, braveWebSearch } = await import('./brave-search-api');
  if (hasBraveSearchApi()) {
    const hits = await braveWebSearch(query, 12);
    if (hits.length > 0) return { hits, source: 'brave' };
  }

  const {
    fetchBingHtml,
    parseBingHits,
    isBingBlockedHtml,
    fetchDdgHtml,
    parseDdgLiteHits,
    parseDdgHtmlHits,
  } = await import('./search-engine-fetch');

  try {
    const { html } = await fetchBingHtml(query, loc);
    const hits = parseBingHits(html, 15);
    if (hits.length > 0) return { hits, source: 'bing' };
    if (isBingBlockedHtml(html)) {
      console.log(`  ⚠️  Bing blocked/empty for enrich: ${companyName}`);
    }
  } catch (err) {
    console.log(
      `  ⚠️  Bing enrich error (${companyName}): ${(err as Error).message?.slice(0, 50)}`
    );
  }

  try {
    const ddg = await fetchDdgHtml(`${companyName} ${loc} website contact`);
    let hits = parseDdgLiteHits(ddg.html, 12);
    if (hits.length === 0) hits = parseDdgHtmlHits(ddg.html, 12);
    if (hits.length > 0) return { hits, source: 'ddg' };
  } catch {
    /* best-effort */
  }

  return { hits: [], source: 'none' };
}

async function crawlSiteForEmail(
  website: string,
  companyName: string,
  niche: string,
  location: string,
  aiProvider: AIProviderConfig | null
): Promise<PlaceEnrichmentResult | null> {
  const { fetchEmailsFromSiteDetailed } = await import('./puppeteer-scraper');
  const sitePick = await fetchEmailsFromSiteDetailed(
    website,
    companyName,
    niche,
    location,
    aiProvider
  );
  if (sitePick?.bestEmail) {
    return {
      website,
      email: sitePick.bestEmail,
      allEmails: sitePick.allEmails,
      mailtoEmails: sitePick.mailtoEmails,
      note: `Crawled ${website}`,
    };
  }
  if (sitePick && sitePick.allEmails.length > 0) {
    return {
      website,
      email: sitePick.bestEmail ?? undefined,
      allEmails: sitePick.allEmails,
      mailtoEmails: sitePick.mailtoEmails,
      note: `Found on site (no best pick): ${website}`,
    };
  }
  return { website, note: `Website found but no email on site: ${website}` };
}

/**
 * Find website + email for a Maps CSV row with no website column.
 */
export async function enrichPlaceWithoutWebsite(
  companyName: string,
  location: string,
  niche: string,
  aiProvider: AIProviderConfig | null,
  options?: { phone?: string; mapsPlaceUrl?: string }
): Promise<PlaceEnrichmentResult> {
  if (!websiteEnrichmentEnabled()) return {};

  if (options?.mapsPlaceUrl) {
    const { fetchWebsiteFromMapsPlaceLink } = await import('./maps-place-website');
    const fromMaps = await fetchWebsiteFromMapsPlaceLink(options.mapsPlaceUrl);
    if (fromMaps) {
      console.log(`  🗺️  ${companyName}: website from Maps place page → ${fromMaps}`);
      const crawled = await crawlSiteForEmail(
        fromMaps,
        companyName,
        niche,
        location,
        aiProvider
      );
      if (crawled) {
        return { ...crawled, source: 'maps_link', note: `Maps listing: ${fromMaps}` };
      }
    }
  }

  try {
    const { enrichViaKnowledgeGraph } = await import('./knowledge-graph-enricher');
    const kg = await enrichViaKnowledgeGraph(companyName, location);
    if (kg.website) {
      const { scrapeRunStats } = await import('./scrape-run-stats');
      scrapeRunStats.knowledgeGraphEnriched++;
      console.log(`  📚 ${companyName}: Knowledge Graph website → ${kg.website}`);
      const crawled = await crawlSiteForEmail(
        kg.website,
        companyName,
        niche,
        location,
        aiProvider
      );
      if (crawled?.email) {
        return {
          ...crawled,
          source: 'knowledge_graph',
          note: [
            kg.description ? `KG: ${kg.description.slice(0, 80)}` : null,
            `Website from Knowledge Graph`,
          ]
            .filter(Boolean)
            .join(' · '),
        };
      }
      if (crawled?.website) {
        return { ...crawled, source: 'knowledge_graph', note: 'KG website, no email on crawl' };
      }
    }
  } catch {
    /* optional */
  }

  const { hits, source } = await searchWebForCompany(companyName, location);

  const blob = hits.map((h) => `${h.title} ${h.snippet}`).join(' ');
  const snippetEmail = extractEmailFromText(blob);
  if (snippetEmail && hits.length > 0) {
    const matchTitle = hits.find((h) => companyMatchesSearchHit(companyName, h.title))?.title;
    if (matchTitle || hits.length <= 3) {
      return {
        email: snippetEmail,
        allEmails: [snippetEmail],
        source: source === 'brave' ? 'brave' : 'bing_snippet',
        note: `Email in search snippet (${source})`,
      };
    }
  }

  const best = pickBestWebsiteHit(companyName, hits);
  if (best) {
    const crawled = await crawlSiteForEmail(best.url, companyName, niche, location, aiProvider);
    if (crawled) {
      return {
        ...crawled,
        source: source === 'brave' ? 'brave' : 'bing_website',
        note: `Website from ${source}: ${best.url}`,
      };
    }
  }

  for (const domain of inferDomainsFromName(companyName, location).slice(0, 3)) {
    const candidate = `https://${domain}`;
    try {
      const crawled = await crawlSiteForEmail(
        candidate,
        companyName,
        niche,
        location,
        aiProvider
      );
      if (crawled?.email) {
        return {
          ...crawled,
          source: 'domain_guess',
          note: `Guessed domain: ${domain}`,
        };
      }
    } catch {
      /* next */
    }
  }

  console.log(
    `  ✗ Enrich failed: ${companyName} (search=${source}, hits=${hits.length}) — Bing/DDG had no usable link; browser crawl may still work if website is known`
  );
  return {};
}
