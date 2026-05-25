import puppeteer, { Browser } from 'puppeteer';

import { buildEnrichedLeadContext } from './lead-context-builder';
import { guessAndVerifyEmails, inferDomainsFromName } from './email-guesser';
import {
  finalizeScrapedLead,
  finalizePhoneOnlyScrapeLead,
  isJunkScrapeLead,
} from './scrape-lead-quality';
import {
  expandCityIntoAreas,
  formatExpandAreasStatus,
  type AIProviderConfig,
} from './ai-scraper-helper';
import type { WebsiteEmailPickResult } from './business-email-picker';
import {
  buildWebsiteFetchUrls,
  discoverContactLikeUrls,
  discoverSitemapContactUrls,
  extractEmailsFromHtml,
  pickFromAggregatedPages,
} from './business-email-picker';

/**
 * Lead Scraper — Parallel Google Maps + Website + AI email finding
 *
 * HOW IT WORKS:
 * 1. Google Maps — Docker (gosom) when GMAPS_SCRAPER_URL is reachable, else Puppeteer.
 *    Website email fetch uses HTTP fetch (not Puppeteer).
 * 2. Bing Search (HTTP fetch) — extracts emails from search snippets + sites.
 * 3. DuckDuckGo (HTTP fetch) — additional search source.
 * 4. Business directories — Yelp, YellowPages, BBB.
 * 5. AI email extraction — when a website is found but no email is visible,
 *    AI reads the page content and finds/predicts the real email.
 *
 * Only leads with REAL found emails are returned — no guesses.
 */

export type { ScrapedLead } from '@/types/platform';
import type { ScrapedLead } from '@/types/platform';

/** Options for a single scrape pass (shared across chunk rounds) */
export interface ScrapeRunOptions {
  /** Dedupe company names across multiple chunk rounds */
  seen?: Set<string>;
  /** 1-based round index — rotates queries and deepens Maps scroll */
  round?: number;
}

function appendRoundQueries(
  queries: string[],
  niche: string,
  location: string,
  round: number
): string[] {
  if (round <= 1) return queries;
  const locRw = /rwanda|kigali/i.test(location);
  const byRound: string[][] = [
    [],
    locRw
      ? [
          `${niche} Rwanda business email contact`,
          `${niche} Kigali company website`,
          `"${niche}" Rwanda "@gmail.com" OR "info@"`,
        ]
      : [
          `${niche} ${location} business directory email`,
          `${niche} ${location} contact page`,
        ],
    locRw
      ? [
          `${niche} Gikondo Kigali email`,
          `${niche} Nyarugenge Rwanda contact`,
          `site:.rw ${niche} email`,
        ]
      : [
          `${niche} near ${location} email`,
          `${niche} services "${location}" contact us`,
        ],
    locRw
      ? [
          `${niche} warehouse Rwanda list`,
          `${niche} logistics Kigali companies`,
          `${niche} Magerwa OR TrAC contact`,
        ]
      : [
          `best ${niche} in ${location}`,
          `${niche} company ${location} official website`,
        ],
  ];
  const extras = byRound[Math.min(round - 1, byRound.length - 1)] ?? [];
  return [...extras, ...queries];
}

/** Use the user's location as-is for every scrape round. */
export function resolveScrapeLocationForRound(
  location: string,
  _round?: number
): string {
  return location.trim();
}

// ─── City district expansion (any city, AI-generated areas) ───────────────────

const TRAILING_COUNTRY_WORDS = new Set([
  'rwanda', 'kenya', 'france', 'germany', 'italy', 'spain', 'portugal', 'netherlands',
  'belgium', 'austria', 'switzerland', 'sweden', 'norway', 'denmark', 'finland', 'poland',
  'greece', 'turkey', 'egypt', 'morocco', 'tunisia', 'algeria', 'nigeria', 'ghana',
  'ethiopia', 'uganda', 'tanzania', 'zambia', 'zimbabwe', 'mozambique', 'angola',
  'cameroon', 'senegal', 'ivory', 'coast', 'côte', "d'ivoire", 'mali', 'niger', 'chad',
  'usa', 'us', 'u.s.a.', 'u.s.', 'america', 'canada', 'mexico', 'brazil', 'argentina',
  'chile', 'colombia', 'peru', 'venezuela', 'ecuador', 'bolivia', 'paraguay', 'uruguay',
  'uk', 'england', 'scotland', 'wales', 'ireland', 'australia', 'zealand', 'india',
  'pakistan', 'bangladesh', 'china', 'japan', 'korea', 'thailand', 'vietnam', 'philippines',
  'indonesia', 'malaysia', 'singapore', 'uae', 'emirates', 'dubai', 'qatar', 'kuwait',
  'israel', 'jordan', 'lebanon', 'iraq', 'iran', 'saudi', 'arabia', 'russia', 'ukraine',
]);

const TRAILING_COUNTRY_PHRASES = [
  'south africa', 'united states', 'united kingdom', 'new zealand', 'south korea',
  'north korea', 'saudi arabia', 'costa rica', 'el salvador', 'puerto rico',
  'sri lanka', 'sierra leone', 'burkina faso', 'cape verde', 'hong kong',
  'ivory coast', "cote d'ivoire", 'côte d\'ivoire',
];

/** Extract primary city name from a user location string. */
export function extractCityFromLocation(location: string): string {
  let s = location.trim();
  if (!s) return location;

  const commaIdx = s.indexOf(',');
  if (commaIdx >= 0) {
    const first = s.slice(0, commaIdx).trim();
    if (first.length >= 2) return first;
  }

  let lower = s.toLowerCase();
  for (const phrase of [...TRAILING_COUNTRY_PHRASES].sort((a, b) => b.length - a.length)) {
    if (lower.endsWith(` ${phrase}`)) {
      s = s.slice(0, -(phrase.length + 1)).trim();
      lower = s.toLowerCase();
    }
  }

  const parts = s.split(/\s+/);
  while (parts.length > 1) {
    const last = parts[parts.length - 1].toLowerCase().replace(/\./g, '');
    if (TRAILING_COUNTRY_WORDS.has(last) || /^[a-z]{2}$/i.test(last)) {
      parts.pop();
    } else {
      break;
    }
  }

  return parts.join(' ').trim() || location.trim();
}

/** True when the location is only a country name (e.g. "Rwanda", "Kenya"). */
function isCountryOnlyLocation(location: string): boolean {
  const t = location.trim().toLowerCase().replace(/\./g, '');
  if (!t) return false;
  if (TRAILING_COUNTRY_WORDS.has(t)) return true;
  return TRAILING_COUNTRY_PHRASES.some((phrase) => t === phrase.toLowerCase());
}

/**
 * Build deduplicated Google Maps search queries: full location + AI sub-areas.
 * Always includes at least `{niche} in {location}`.
 */
export async function expandLocationQueries(
  niche: string,
  location: string,
  aiProvider: AIProviderConfig | null
): Promise<string[]> {
  const primary = `${niche} in ${location}`;
  const seen = new Set<string>([primary.toLowerCase()]);
  const queries: string[] = [primary];

  const city = extractCityFromLocation(location);
  if (!city) return queries;

  const expansion = await expandCityIntoAreas(niche, city, aiProvider);
  if (expansion.areas.length === 0 && expansion.status !== 'cached') {
    console.log(`[EXPANSION] ${city}: ${formatExpandAreasStatus(expansion)}`);
  } else if (expansion.areas.length > 0) {
    console.log(
      `[EXPANSION] ${city}: ${expansion.areas.length} areas (${expansion.status})`
    );
  }

  for (const area of expansion.areas) {
    const q = `${niche} in ${area}`;
    const key = q.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      queries.push(q);
    }
  }

  return queries;
}

/** Kigali districts for Maps query expansion (no AI required). */
const KIGALI_MAP_AREAS = [
  'Nyarugenge Kigali',
  'Gasabo Kigali',
  'Kicukiro Kigali',
  'Nyamirambo Kigali',
  'Kimironko Kigali',
  'Remera Kigali',
  'Gikondo Kigali',
  'Kacyiru Kigali',
  'Kanombe Kigali',
  'Gisozi Kigali',
];

/**
 * Step 1: One Maps query per Kigali district when location mentions Kigali.
 * Always includes the original `{niche} in {location}` first.
 */
export function expandKigaliQueries(niche: string, location: string): string[] {
  const primary = `${niche} in ${location}`;
  if (!/kigali/i.test(location)) {
    return [primary];
  }

  const seen = new Set<string>([primary.toLowerCase()]);
  const queries: string[] = [primary];

  for (const area of KIGALI_MAP_AREAS) {
    const q = `${niche} in ${area}`;
    const key = q.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      queries.push(q);
    }
  }

  return queries;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const UA_LIST = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
];
const randomUA = () => UA_LIST[Math.floor(Math.random() * UA_LIST.length)];

const BLOCKED_DOMAINS = [
  'example.com','example.org','sentry.io','wixpress.com','squarespace.com',
  'wordpress.com','localhost','w3.org','schema.org','google.com','bing.com',
  'yahoo.com','duckduckgo.com',
];
const BLOCKED_PREFIXES = ['noreply','no-reply','donotreply','privacy','test','webmaster'];
const BLOCKED_SUBSTRINGS = ['.png','.jpg','.jpeg','.gif','@2x','placeholder'];

// ─── Email helpers ────────────────────────────────────────────────────────────

function extractEmails(text: string): string[] {
  const raw = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) ?? [];
  return Array.from(new Set(raw.map(e => e.toLowerCase()))).filter(e => {
    const [local, domain] = e.split('@');
    if (!domain) return false;
    if (BLOCKED_DOMAINS.some(d => domain.includes(d))) return false;
    if (BLOCKED_PREFIXES.some(p => local.startsWith(p))) return false;
    if (BLOCKED_SUBSTRINGS.some(s => e.includes(s))) return false;
    if (!/\.[a-z]{2,}$/i.test(e)) return false;
    return true;
  });
}

function scoreEmail(email: string): number {
  const local = email.split('@')[0].toLowerCase();
  if (['info','contact','hello','hi','mail'].includes(local)) return 10;
  if (['sales','business','enquiries','enquiry','admissions'].includes(local)) return 8;
  if (['support','help','office','admin','director','manager'].includes(local)) return 6;
  if (local.includes('.')) return 5;
  return 4;
}

function bestEmail(emails: string[]): string | null {
  if (!emails.length) return null;
  return [...emails].sort((a, b) => scoreEmail(b) - scoreEmail(a))[0];
}

function delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ─── AI email extraction (server-side) ───────────────────────────────────────

/**
 * Given website text content, ask AI to find the contact email.
 * Falls back gracefully if no AI provider is configured.
 */
async function aiExtractEmail(
  companyName: string,
  domain: string,
  pageText: string,
  niche: string,
  aiProvider: AIProviderConfig | null
): Promise<string | null> {
  if (!aiProvider?.api_key) return null;
  const { isScrapeAiAvailable } = await import('./ai-scrape-rate-limit');
  if (!isScrapeAiAvailable()) return null;

  const { extractEmailFromContent } = await import('./ai-scraper-helper');
  try {
    return await extractEmailFromContent(companyName, pageText, domain, aiProvider);
  } catch {
    return null;
  }
}

/**
 * When we have a domain but no visible email, ask AI to predict the pattern.
 */
async function aiPredictEmail(
  companyName: string,
  domain: string,
  niche: string,
  location: string,
  aiProvider: AIProviderConfig | null
): Promise<string | null> {
  if (!aiProvider?.api_key) return null;
  const { isScrapeAiAvailable } = await import('./ai-scrape-rate-limit');
  if (!isScrapeAiAvailable()) return null;

  const { predictEmailPattern } = await import('./ai-scraper-helper');
  try {
    return await predictEmailPattern(companyName, domain, niche, location, aiProvider);
  } catch {
    return null;
  }
}

// ─── HTTP email fetcher (parallel contact paths + homepage; domain-aware pick) ─

/**
 * Crawl contact paths + homepage (#contact is same HTML as /).
 * Aggregates all emails, scores by domain + mailto + contact page — not "first page wins".
 */
export async function fetchEmailsFromSiteDetailed(
  website: string,
  companyName = '',
  niche = '',
  location = '',
  aiProvider: AIProviderConfig | null = null
): Promise<WebsiteEmailPickResult | null> {
  const normalized = website.startsWith('http') ? website : `https://${website}`;
  let siteHost = '';
  try {
    siteHost = new URL(normalized).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }

  const urls = new Set(buildWebsiteFetchUrls(normalized));
  const headers = {
    'User-Agent': randomUA(),
    Accept: 'text/html',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  const pages: Array<{ url: string; extracted: ReturnType<typeof extractEmailsFromHtml> }> =
    [];
  const htmlByUrl = new Map<string, string>();

  // Discover dealer/find-us links from homepage (e.g. volkswagen.rw → /en/find-a-dealer.html)
  try {
    const homeUrl = `${new URL(normalized).origin}/`;
    const homeRes = await fetch(homeUrl, { headers, signal: AbortSignal.timeout(12_000) });
    if (homeRes.ok) {
      const homeHtml = await homeRes.text();
      for (const u of discoverContactLikeUrls(homeHtml, homeUrl)) {
        urls.add(u);
      }
    }
    for (const u of await discoverSitemapContactUrls(normalized)) {
      urls.add(u);
    }
  } catch {
    /* best-effort discovery */
  }

  const fetchOne = async (url: string) => {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(12_000) });
      if (!res.ok) return;
      const html = await res.text();
      htmlByUrl.set(url, html);
      const extracted = extractEmailsFromHtml(html);
      if (extracted.all.length > 0) {
        pages.push({ url, extracted });
      }
    } catch {
      /* next url */
    }
  };

  await Promise.all(Array.from(urls).slice(0, 24).map((url) => fetchOne(url)));

  const websitePuppeteerFallback = (): boolean => {
    const v = process.env.WEBSITE_FETCH_PUPPETEER?.trim().toLowerCase();
    if (v === 'false' || v === '0' || v === 'no') return false;
    return true;
  };

  const mergePage = (url: string, html: string) => {
    htmlByUrl.set(url, html);
    const extracted = extractEmailsFromHtml(html);
    if (extracted.all.length === 0) return;
    const existing = pages.find((p) => p.url === url);
    if (existing) {
      existing.extracted = extracted;
    } else {
      pages.push({ url, extracted });
    }
    for (const u of discoverContactLikeUrls(html, url)) {
      urls.add(u);
    }
  };

  let pick = pages.length > 0 ? pickFromAggregatedPages(pages, siteHost) : null;

  if (!pick?.bestEmail && websitePuppeteerFallback()) {
    const { fetchHtmlWithBrowser } = await import('./search-engine-fetch');
    const tryUrls = [
      `${new URL(normalized).origin}/`,
      normalized,
      ...Array.from(urls).filter((u) => /contact|dealer|find-us|about|imprint/i.test(u)),
    ].slice(0, 5);
    const seenTry = new Set<string>();
    for (const url of tryUrls) {
      if (seenTry.has(url)) continue;
      seenTry.add(url);
      try {
        console.log(`  🌐 Browser fetch (JS site): ${url.replace(/^https?:\/\//, '').slice(0, 60)}`);
        const html = await fetchHtmlWithBrowser(url);
        mergePage(url, html);
      } catch (err) {
        console.log(
          `  ⚠️  Browser fetch failed: ${(err as Error).message?.slice(0, 50)}`
        );
      }
    }
    const extraUrls = Array.from(urls).filter((u) => !htmlByUrl.has(u));
    await Promise.all(extraUrls.slice(0, 8).map((url) => fetchOne(url)));
    pick = pages.length > 0 ? pickFromAggregatedPages(pages, siteHost) : pick;
  }

  const { isSyntheticSiteEmail } = await import('./business-email-picker');
  const pickLooksGuessed =
    pick?.bestEmail &&
    isSyntheticSiteEmail(pick.bestEmail, siteHost) &&
    !pick.mailtoEmails.includes(pick.bestEmail);

  if (
    (!pick?.bestEmail || pickLooksGuessed) &&
    aiProvider &&
    (await import('./ai-scrape-rate-limit')).isScrapeAiAvailable()
  ) {
    const combined = Array.from(htmlByUrl.values())
      .map((html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '))
      .join(' ')
      .slice(0, 6000);
    const aiEmail = await aiExtractEmail(
      companyName,
      siteHost,
      combined,
      niche,
      aiProvider
    );
    if (aiEmail && !isSyntheticSiteEmail(aiEmail, siteHost)) {
      pages.push({
        url: normalized,
        extracted: {
          mailtos: [],
          visible: [aiEmail.toLowerCase()],
          all: [aiEmail.toLowerCase()],
        },
      });
      pick = pickFromAggregatedPages(pages, siteHost);
    }
  }

  if (
    !pick?.bestEmail &&
    !pick?.mailtoEmails.length &&
    aiProvider &&
    (await import('./ai-scrape-rate-limit')).isScrapeAiAvailable()
  ) {
    const predicted = await aiPredictEmail(companyName, siteHost, niche, location, aiProvider);
    if (predicted && !isSyntheticSiteEmail(predicted.toLowerCase(), siteHost)) {
      pick = {
        bestEmail: predicted.toLowerCase(),
        allEmails: [predicted.toLowerCase()],
        mailtoEmails: [],
      };
    }
  }

  if (!pick?.bestEmail) {
    try {
      const { findEmailsForDomain } = await import('./free-email-finder');
      const freeHits = await findEmailsForDomain(siteHost, companyName);
      if (freeHits.length) {
        const guessed = freeHits[0].email.toLowerCase();
        console.log(`  📧 Free finder (${freeHits[0].source}) for ${siteHost}: ${guessed}`);
        try {
          const { scrapeRunStats } = await import('./scrape-run-stats');
          scrapeRunStats.commonCrawlHits++;
        } catch {
          /* optional */
        }
        pick = {
          bestEmail: guessed,
          allEmails: [guessed],
          mailtoEmails: [],
        };
      }
    } catch {
      /* best-effort */
    }
  }

  return pick;
}

async function fetchEmailFromSite(
  website: string,
  companyName = '',
  niche = '',
  location = '',
  aiProvider: AIProviderConfig | null = null
): Promise<string | null> {
  const pick = await fetchEmailsFromSiteDetailed(
    website,
    companyName,
    niche,
    location,
    aiProvider
  );
  return pick?.bestEmail ?? null;
}

// ─── HTTP helper ──────────────────────────────────────────────────────────────

async function httpGet(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': randomUA(),
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function decodeHtmlEntities(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

const SEARCH_SKIP_DOMAINS = [
  'bing.com', 'microsoft.com', 'duckduckgo.com', 'facebook.com', 'linkedin.com',
  'twitter.com', 'instagram.com', 'youtube.com', 'wikipedia.org', 'wikimedia.org',
  'investopedia.com', 'britannica.com', 'courierslist.com', 'zoominfo.com',
  'africabizinfo.com', 'yellowpages.com', 'yelp.com', 'hotfrog.com', 'bbb.org',
  'hunter.io', 'apollo.io', 'tripadvisor.com',
];

async function leadFromSearchHit(
  hit: { title: string; url: string; snippet: string },
  niche: string,
  location: string,
  seen: Set<string>,
  onLead: (l: ScrapedLead) => boolean,
  aiProvider: AIProviderConfig | null,
  leads: ScrapedLead[]
): Promise<boolean> {
  const cleanName = hit.title.replace(/\s*[-|–|·].*$/, '').trim();
  if (!cleanName || cleanName.length < 3 || seen.has(cleanName.toLowerCase())) {
    return false;
  }

  const url = hit.url?.trim() || '';
  if (url && SEARCH_SKIP_DOMAINS.some((s) => url.includes(s))) return false;

  if (
    isJunkScrapeLead(
      {
        company_name: cleanName,
        email: 'pending@local',
        website: url || undefined,
        source_snippet: hit.snippet,
      },
      location
    )
  ) {
    return false;
  }

  let email = bestEmail(extractEmails(`${hit.snippet} ${hit.title}`));
  if (!email && url) {
    email = await fetchEmailFromSite(url, cleanName, niche, location, aiProvider);
  }
  if (!email) return false;

  const enriched = await buildEnrichedLeadContext({
    companyName: cleanName,
    niche,
    location,
    snippet: hit.snippet,
    website: url || undefined,
  });
  const lead: ScrapedLead = {
    company_name: cleanName,
    email,
    emailIsReal: true,
    niche: enriched.niche,
    location,
    source_snippet: hit.snippet,
    company_context: enriched.context,
    source_url: url,
    website: url || undefined,
  };
  if (onLead(lead)) {
    seen.add(cleanName.toLowerCase());
    leads.push(lead);
    return true;
  }
  return false;
}

// ─── Source 1: Bing Search ────────────────────────────────────────────────────

async function scrapeBing(
  niche: string, location: string, needed: number,
  seen: Set<string>, onLead: (l: ScrapedLead) => boolean,
  aiProvider: AIProviderConfig | null,
  round = 1
): Promise<ScrapedLead[]> {
  const leads: ScrapedLead[] = [];
  const { buildBingQueries, fetchBingHtml, parseBingHits, isBingBlockedHtml } =
    await import('./search-engine-fetch');

  let queries = buildBingQueries(niche, location);
  if (aiProvider) {
    try {
      const { generateSearchQueries } = await import('./ai-scraper-helper');
      const aiQueries = await generateSearchQueries(niche, location, aiProvider);
      if (aiQueries.length > 0) queries = [...aiQueries.slice(0, 4), ...queries];
    } catch { /* fallback */ }
  }
  queries = appendRoundQueries(queries, niche, location, round);

  let totalHits = 0;
  let noEmail = 0;

  for (const query of queries) {
    if (leads.length >= needed) break;
    try {
      console.log(`  🔵 Bing: ${query}`);
      const { html, via } = await fetchBingHtml(query, location);
      if (isBingBlockedHtml(html)) {
        console.log(`  ⚠️  Bing: captcha/block detected (${via})`);
        continue;
      }
      const hits = parseBingHits(html, needed * 3);
      totalHits += hits.length;
      console.log(`  🔵 Bing: ${hits.length} results (${via})`);

      for (const hit of hits) {
        if (leads.length >= needed) break;
        const before = leads.length;
        await leadFromSearchHit(hit, niche, location, seen, onLead, aiProvider, leads);
        if (leads.length === before) noEmail++;
      }
      await delay(700);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  ⚠️  Bing query failed: ${msg.slice(0, 60)}`);
    }
  }

  if (leads.length === 0 && totalHits > 0) {
    console.log(
      `  🔵 Bing: ${totalHits} hits but 0 emails (${noEmail} had no extractable email — try Maps/Docker)`
    );
  }
  return leads;
}

// ─── Source 2: DuckDuckGo (or Brave API) ──────────────────────────────────────

async function scrapeDDG(
  niche: string, location: string, needed: number,
  seen: Set<string>, onLead: (l: ScrapedLead) => boolean,
  aiProvider: AIProviderConfig | null,
  round = 1
): Promise<ScrapedLead[]> {
  const leads: ScrapedLead[] = [];
  const { braveWebSearch, hasBraveSearchApi } = await import('./brave-search-api');
  const { buildDdgQueries, fetchDdgHtml, parseDdgHits } = await import('./search-engine-fetch');

  let queries = buildDdgQueries(niche, location);
  queries = appendRoundQueries(queries, niche, location, round);

  let consecutiveBlocks = 0;
  const useBrave = hasBraveSearchApi();

  if (useBrave) {
    console.log('  🦁 DDG slot: using Brave Search API (BRAVE_SEARCH_API_KEY)');
  }

  for (const query of queries) {
    if (leads.length >= needed) break;
    if (!useBrave && consecutiveBlocks >= 3) {
      console.log('  ⚠️  DuckDuckGo blocked after 3 tries — skipping remaining DDG queries');
      break;
    }

    try {
      console.log(`  🦆 ${useBrave ? 'Brave' : 'DDG'}: ${query}`);
      let hits: { title: string; url: string; snippet: string }[] = [];

      if (useBrave) {
        hits = await braveWebSearch(query, 15);
      } else {
        const { html, via, blocked } = await fetchDdgHtml(query);
        if (blocked) {
          consecutiveBlocks++;
          console.log(`  ⚠️  DDG bot-check (${via}) — query skipped`);
          await delay(1200);
          continue;
        }
        consecutiveBlocks = 0;
        hits = parseDdgHits(html, via);
        console.log(`  🦆 DDG: ${hits.length} results (${via})`);
      }

      for (const hit of hits) {
        if (leads.length >= needed) break;
        await leadFromSearchHit(hit, niche, location, seen, onLead, aiProvider, leads);
      }
      await delay(useBrave ? 400 : 900);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  ⚠️  DDG/Brave query failed: ${msg.slice(0, 60)}`);
    }
  }

  if (!useBrave && consecutiveBlocks >= 3) {
    console.log(
      '  💡 DDG blocks server fetch. Free fix: SEARCH_USE_PUPPETEER=ddg in .env (or wait for Bing browser retry)'
    );
  }

  return leads;
}

/** Run Maps across district-expanded queries (round 1) or a single query (later rounds). */
async function scrapeGoogleMapsMultiQuery(
  niche: string,
  scrapeLocation: string,
  leadLocation: string,
  mapsTarget: number,
  seen: Set<string>,
  onLead: (l: ScrapedLead) => boolean,
  aiProvider: AIProviderConfig | null,
  round: number
): Promise<ScrapedLead[]> {
  let locationQueries: string[];
  if (round !== 1) {
    locationQueries = [`${niche} in ${scrapeLocation}`];
  } else if (/kigali/i.test(scrapeLocation)) {
    locationQueries = expandKigaliQueries(niche, scrapeLocation);
    try {
      const { scrapeRunStats } = await import('./scrape-run-stats');
      scrapeRunStats.mapsQueries = locationQueries.length;
    } catch {
      /* optional stats */
    }
    console.log(
      `🗺  Maps Kigali expansion: ${locationQueries.length} queries (${locationQueries.length - 1} districts)`
    );
    locationQueries.forEach((q, i) => console.log(`   ${i + 1}. ${q}`));
  } else if (isCountryOnlyLocation(scrapeLocation)) {
    locationQueries = [`${niche} in ${scrapeLocation}`];
    console.log(`🗺  Maps: 1 query (country location, no expansion)`);
    try {
      const { scrapeRunStats } = await import('./scrape-run-stats');
      scrapeRunStats.mapsQueries = 1;
    } catch {
      /* optional stats */
    }
  } else {
    locationQueries = await expandLocationQueries(niche, scrapeLocation, aiProvider);
    try {
      const { scrapeRunStats } = await import('./scrape-run-stats');
      scrapeRunStats.mapsQueries = locationQueries.length;
    } catch {
      /* optional stats */
    }
    if (locationQueries.length > 1) {
      const city = extractCityFromLocation(scrapeLocation);
      console.log(
        `🗺  Maps district expansion: ${locationQueries.length} queries (${locationQueries.length - 1} areas in ${city})`
      );
      locationQueries.forEach((q, i) => console.log(`   ${i + 1}. ${q}`));
    }
  }

  const maxPerQuery = Math.max(1, Math.ceil(mapsTarget / locationQueries.length));
  const collected: ScrapedLead[] = [];

  const { getGmapsDockerConfig, isGmapsDockerAvailable, scrapeGmapsDockerQuery } =
    await import('./gmaps-docker-client');
  const dockerCfg = getGmapsDockerConfig();
  const useGmapsDocker = dockerCfg ? await isGmapsDockerAvailable() : false;
  if (useGmapsDocker && dockerCfg) {
    console.log(
      `🐳 Maps: Docker (${dockerCfg.baseUrl}) · Bing/DDG/dirs: HTTP (Puppeteer not used for Maps)`
    );
  } else if (dockerCfg) {
    console.log(
      `⚠️  GMAPS_SCRAPER_URL=${dockerCfg.baseUrl} unreachable — Maps fallback to Puppeteer; Bing/DDG/dirs unchanged`
    );
  }

  for (const query of locationQueries) {
    if (collected.length >= mapsTarget) break;
    const need = mapsTarget - collected.length;
    const limit = Math.min(maxPerQuery, need);
    if (useGmapsDocker) {
      const dockerResult = await scrapeGmapsDockerQuery(
        query,
        niche,
        leadLocation,
        limit,
        seen,
        onLead,
        aiProvider,
        fetchEmailFromSite
      );
      collected.push(...dockerResult.leads);
    } else {
      const batch = await scrapeGoogleMaps(
        query,
        niche,
        leadLocation,
        limit,
        seen,
        onLead,
        aiProvider,
        round
      );
      collected.push(...batch);
    }
  }

  return collected;
}

// ─── Source 3: Google Maps (Puppeteer) ───────────────────────────────────────
// Website fetch runs IN PARALLEL with Maps listing extraction

async function scrapeGoogleMaps(
  mapsSearch: string,
  niche: string,
  leadLocation: string,
  maxResults: number,
  seen: Set<string>, onLead: (l: ScrapedLead) => boolean,
  aiProvider: AIProviderConfig | null,
  round = 1
): Promise<ScrapedLead[]> {
  const leads: ScrapedLead[] = [];
  let browser: Browser | undefined;
  let browserFromPool = false;

  try {
    const { getActiveScrapeBrowserPool } = await import('./scrape-browser-pool');
    const pool = getActiveScrapeBrowserPool();
    if (pool) {
      browser = await pool.getBrowser();
      browserFromPool = true;
    } else {
      browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage',
               '--disable-blink-features=AutomationControlled','--disable-gpu',
               '--window-size=1280,800'],
      });
    }

    const page = await browser.newPage();
    const ua = randomUA();
    await page.setUserAgent(ua);
    await page.setViewport({ width: 1280, height: 800 });
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      (window as any).chrome = { runtime: {} };
    });

    const mapsUrl = `https://www.google.com/maps/search/${encodeURIComponent(mapsSearch)}`;
    console.log(`\n🗺  Google Maps: ${mapsSearch}`);

    await page.goto(mapsUrl, { waitUntil: 'networkidle2', timeout: 30_000 });

    const feedLoaded = await page.waitForSelector('[role="feed"]', { timeout: 8_000 })
      .then(() => true).catch(() => false);

    if (!feedLoaded) {
      console.log('  ⚠️  Maps feed not found — skipping');
      return [];
    }

    // Scroll to load listings — deeper scroll on later chunk rounds
    let prev = 0, stale = 0;
    const maxScrolls = Math.min(
      Math.ceil(maxResults / 4) + 10 + (round - 1) * 30,
      150
    );
    for (let i = 0; i < maxScrolls; i++) {
      await page.evaluate(() => {
        const f = document.querySelector('[role="feed"]');
        if (f) f.scrollTop = f.scrollHeight;
      });
      await delay(1000);
      const count = await page.evaluate(() => document.querySelectorAll('[role="article"]').length);
      if (count >= maxResults) break;
      if (count === prev) { if (++stale >= 4) break; } else stale = 0;
      prev = count;
    }

    const businesses = await page.evaluate((max: number) => {
      const out: any[] = [];
      document.querySelectorAll('[role="article"]').forEach((el, i) => {
        if (i >= max) return;
        const name = el.querySelector('[class*="fontHeadline"]')?.textContent?.trim()
                  ?? el.querySelector('h3')?.textContent?.trim();
        const address = el.querySelector('[class*="fontBody"]')?.textContent?.trim() ?? '';
        const rating = el.querySelector('[role="img"][aria-label*="stars"]')?.getAttribute('aria-label') ?? '';
        const phone = (el.querySelector('a[href^="tel:"]') as HTMLAnchorElement)?.textContent?.trim() ?? '';
        const placeUrl = (el.querySelector('a[href*="/maps/place/"]') as HTMLAnchorElement)?.href ?? '';
        if (name) out.push({ name, address, rating, phone, placeUrl });
      });
      return out;
    }, maxResults);

    console.log(`  Found ${businesses.length} Maps listings (round ${round})`);

    const listStart = round > 1 ? (round - 1) * Math.max(8, Math.floor(maxResults * 0.75)) : 0;

    // Process in parallel batches of 5
    // For each business: open place page to get website, then fetch website email — all in parallel
    for (let i = listStart; i < businesses.length; i += 5) {
      const batch = businesses.slice(i, i + 5);

      await Promise.all(batch.map(async (biz: any) => {
        if (seen.has(biz.name.toLowerCase())) return;

        let website: string | null = null;
        let phone = biz.phone;
        let email: string | null = null;

        // Step 1: Open the Maps place page — website, phone, and any visible email
        try {
          const p = await browser!.newPage();
          await p.setUserAgent(ua);
          try {
            await p.goto(biz.placeUrl, { waitUntil: 'domcontentloaded', timeout: 10_000 });
            await delay(500);
            const d = await p.evaluate(() => {
              const skip = ['google.com','facebook.com','instagram.com','twitter.com','maps.google'];
              const auth = document.querySelector<HTMLAnchorElement>('[data-item-id="authority"] a');
              let site = auth?.href ?? null;
              if (!site) {
                for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
                  if (a.href.startsWith('http') && !skip.some(s => a.href.includes(s))) {
                    site = a.href; break;
                  }
                }
              }
              const tel = document.querySelector<HTMLAnchorElement>('a[href^="tel:"]');
              const mailtos: string[] = [];
              for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href^="mailto:"]'))) {
                const e = a.href.replace(/^mailto:/i, '').split('?')[0]?.trim();
                if (e) mailtos.push(e);
              }
              const bodyText = document.body?.innerText ?? '';
              const textEmails = bodyText.match(
                /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g
              ) ?? [];
              return {
                site,
                tel: tel?.textContent?.trim() ?? '',
                emails: [...mailtos, ...textEmails],
              };
            });
            website = d.site;
            if (d.tel) phone = d.tel;
            if (d.emails?.length) {
              email = bestEmail(extractEmails(d.emails.join(' ')));
            }
          } finally { await p.close().catch(() => {}); }
        } catch {}

        // Step 2: Fetch email from business website
        if (!email && website) {
          email = await fetchEmailFromSite(website, biz.name, niche, leadLocation, aiProvider);
        }

        // Step 3: Try inferred domain when Maps has no website link
        if (!email && !website) {
          for (const domain of inferDomainsFromName(biz.name, leadLocation).slice(0, 3)) {
            const candidate = `https://${domain}`;
            email = await fetchEmailFromSite(candidate, biz.name, niche, leadLocation, aiProvider);
            if (email) {
              website = candidate;
              break;
            }
          }
        }

        // Step 4: SMTP-based email guesser on known domain
        if (!email && website) {
          try {
            const guesses = await guessAndVerifyEmails(website, {
              companyName: biz.name, location: leadLocation, maxGuesses: 5, smtpVerify: false,
            });
            if (guesses[0]) email = guesses[0].email;
          } catch {}
        }

        if (!email) {
          const phoneStr = phone?.trim();
          if (phoneStr && phoneStr.length >= 6) {
            const phoneLead = finalizePhoneOnlyScrapeLead(
              {
                company_name: biz.name,
                phone: phoneStr,
                website: website || undefined,
                business_address: biz.address?.trim(),
                source_url: biz.placeUrl || website || '',
                source_snippet: biz.address,
              },
              leadLocation
            );
            if (phoneLead && !isJunkScrapeLead({ ...phoneLead, phoneOnly: true }, leadLocation)) {
              seen.add(biz.name.toLowerCase());
              const payload: ScrapedLead = {
                ...phoneLead,
                niche,
                source_url: biz.placeUrl || website || '',
              };
              if (onLead(payload)) leads.push(payload);
              console.log(`  📞 ${biz.name} — call list (phone only)`);
              return;
            }
          }
          console.log(`  ⏭  ${biz.name} — no email found`);
          return;
        }

        seen.add(biz.name.toLowerCase());
        const enriched = await buildEnrichedLeadContext({
          companyName: biz.name,
          niche,
          location: biz.address || leadLocation,
          website: website || undefined,
          phone: phone || undefined,
          rating: biz.rating || undefined,
        });
        const lead: ScrapedLead = {
          company_name: biz.name,
          email,
          emailIsReal: true,
          niche: enriched.niche,
          location: leadLocation,
          business_address: biz.address?.trim() || undefined,
          company_context: enriched.context,
          source_url: biz.placeUrl || website || '',
          phone: phone || undefined,
          website: website || undefined,
        };
        if (onLead(lead)) leads.push(lead);
      }));
    }

  } catch (err) {
    console.error('[Maps] Error:', err);
  } finally {
    if (!browserFromPool) {
      await browser?.close();
    }
  }

  return leads;
}

// ─── Source 4: Directories (Yelp, YP, BBB) ───────────────────────────────────

async function scrapeDirectories(
  niche: string, location: string, needed: number,
  seen: Set<string>, onLead: (l: ScrapedLead) => boolean,
  aiProvider: AIProviderConfig | null,
  round = 1
): Promise<ScrapedLead[]> {
  const leads: ScrapedLead[] = [];

  const sources = [
    `https://www.yellowpages.com/search?search_terms=${encodeURIComponent(niche)}&geo_location_terms=${encodeURIComponent(location)}`,
    `https://www.yelp.com/search?find_desc=${encodeURIComponent(niche)}&find_loc=${encodeURIComponent(location)}`,
    `https://www.bbb.org/search?find_text=${encodeURIComponent(niche)}&find_loc=${encodeURIComponent(location)}`,
    `https://www.hotfrog.com/search/${encodeURIComponent(location)}/${encodeURIComponent(niche)}`,
  ];

  for (const url of sources) {
    if (leads.length >= needed) break;
    try {
      console.log(`  📒 Directory: ${url.split('?')[0]}`);
      const html = await httpGet(url);

      const namePatterns = [
        /<h\d[^>]*class="[^"]*(?:business|company|name|title)[^"]*"[^>]*>([\s\S]*?)<\/h\d>/gi,
        /<a[^>]*class="[^"]*(?:business-name|company-name|biz-name)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi,
        /<span[^>]*class="[^"]*(?:business-name|company-name)[^"]*"[^>]*>([\s\S]*?)<\/span>/gi,
      ];

      const names: string[] = [];
      for (const pattern of namePatterns) {
        let m: RegExpExecArray | null;
        while ((m = pattern.exec(html)) !== null) {
          const n = m[1].replace(/<[^>]+>/g, '').trim();
          if (n && n.length > 2 && n.length < 100) names.push(n);
        }
      }

      const pageEmails = extractEmails(html);

      for (let i = 0; i < Math.min(names.length, needed - leads.length); i++) {
        const name = names[i];
        if (seen.has(name.toLowerCase())) continue;
        seen.add(name.toLowerCase());

        const email = bestEmail(pageEmails) ?? null;
        if (!email) continue;

        const enriched = await buildEnrichedLeadContext({
          companyName: name,
          niche,
          location,
        });
        const lead: ScrapedLead = {
          company_name: name,
          email,
          emailIsReal: true,
          niche: enriched.niche,
          location,
          company_context: enriched.context,
          source_url: url,
        };
        if (onLead(lead)) leads.push(lead);
      }

      await delay(600);
    } catch (err: any) {
      console.log(`  ⚠️  Directory failed: ${err?.message?.slice(0, 60)}`);
    }
  }

  return leads;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Scrape leads for a niche + location using all sources in parallel.
 *
 * @param aiProvider  Optional AI provider config (from user's AI Settings).
 *                    When provided, AI helps generate search queries and
 *                    extract emails from website content.
 */
export async function scrapeWithoutAPI(
  niche: string,
  location: string,
  maxLeads = 100,
  onLead?: (lead: ScrapedLead) => void,
  aiProvider: AIProviderConfig | null = null,
  options?: ScrapeRunOptions
): Promise<ScrapedLead[]> {
  const round = options?.round ?? 1;
  const scrapeLocation = resolveScrapeLocationForRound(location, round);
  console.log(`\n${'='.repeat(60)}`);
  console.log(
    `🚀 Scraping: "${niche}" in "${scrapeLocation}" (target: ${maxLeads}${round > 1 ? `, round ${round}` : ""})` +
      (scrapeLocation !== location ? ` [search area: ${location}]` : "")
  );
  if (aiProvider) console.log(`🤖 AI-assisted: ${aiProvider.provider}/${aiProvider.active_model}`);
  console.log(`${'='.repeat(60)}\n`);

  if (round === 1) {
    const { resetScrapeAiSession, resetExpansionAiSession } = await import(
      './ai-scrape-rate-limit'
    );
    resetScrapeAiSession();
    resetExpansionAiSession();
  }

  const all: ScrapedLead[] = [];
  const seen = options?.seen ?? new Set<string>();

  let junkSkipped = 0;
  const emit = (lead: ScrapedLead): boolean => {
    if (lead.phoneOnly) {
      const finalized = finalizePhoneOnlyScrapeLead(lead, location);
      if (!finalized || isJunkScrapeLead({ ...finalized, phoneOnly: true }, location)) {
        junkSkipped++;
        return false;
      }
      onLead?.(finalized);
      console.log(`  📞 ${finalized.company_name} → call list @ ${finalized.location}`);
      return true;
    }
    const finalized = finalizeScrapedLead(lead, location);
    if (!finalized || isJunkScrapeLead(finalized, location)) {
      junkSkipped++;
      console.log(`  🗑  Junk skipped: ${lead.company_name} (${lead.email})`);
      return false;
    }
    all.push(finalized);
    onLead?.(finalized);
    console.log(`  ✅ ${finalized.company_name} → ${finalized.email} @ ${finalized.location}`);
    return true;
  };

  // For large targets (200+), give each source a bigger slice.
  // Maps can scroll deep; Bing/DDG run multiple query pages.
  const mapsTarget  = Math.ceil(maxLeads * 0.45);   // ~45% from Maps
  const bingTarget  = Math.ceil(maxLeads * 0.35);   // ~35% from Bing
  const ddgTarget   = Math.ceil(maxLeads * 0.25);   // ~25% from DDG
  const dirTarget   = Math.ceil(maxLeads * 0.20);   // ~20% from directories

  // All 4 sources run in parallel
  const [mapsRes, bingRes, ddgRes, dirRes] = await Promise.allSettled([
    scrapeGoogleMapsMultiQuery(niche, scrapeLocation, location, mapsTarget, seen, emit, aiProvider, round),
    scrapeBing(niche, scrapeLocation, bingTarget, seen, emit, aiProvider, round),
    scrapeDDG(niche, scrapeLocation, ddgTarget, seen, emit, aiProvider, round),
    scrapeDirectories(niche, scrapeLocation, dirTarget, seen, emit, aiProvider, round),
  ]);

  const counts = {
    maps: mapsRes.status === 'fulfilled' ? mapsRes.value.length : 0,
    bing: bingRes.status === 'fulfilled' ? bingRes.value.length : 0,
    ddg:  ddgRes.status  === 'fulfilled' ? ddgRes.value.length  : 0,
    dir:  dirRes.status  === 'fulfilled' ? dirRes.value.length  : 0,
  };

  console.log(`\n${'='.repeat(60)}`);
  console.log(
    `📊 Results: ${all.length} leads | Maps:${counts.maps} Bing:${counts.bing} DDG:${counts.ddg} Dir:${counts.dir}` +
      (junkSkipped ? ` | ${junkSkipped} junk filtered` : "")
  );
  console.log(`${'='.repeat(60)}\n`);

  // Deduplicate by email
  const deduped = Array.from(
    new Map(all.map(l => [l.email.toLowerCase(), l])).values()
  );

  return deduped.slice(0, maxLeads);
}

export { scrapeGoogleMaps, scrapeGoogleMapsMultiQuery };
