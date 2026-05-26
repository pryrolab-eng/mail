/**
 * Bing / DuckDuckGo fetch + parse (HTTP with Puppeteer fallback when blocked).
 */

import puppeteer, { Browser } from 'puppeteer';

const BROWSER_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-blink-features=AutomationControlled',
  '--disable-gpu',
  '--window-size=1280,800',
];

export type SearchHit = {
  title: string;
  url: string;
  snippet: string;
};

export function randomSearchUA(): string {
  const uas = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  ];
  return uas[Math.floor(Math.random() * uas.length)];
}

function decodeHtmlEntities(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

export function isDdgBlockedHtml(html: string): boolean {
  return (
    !html.includes('result__a') &&
    (html.includes('anomaly-modal') ||
      html.includes('cc=botnet') ||
      html.includes('duckduckgo.com/anomaly') ||
      html.length < 20_000)
  );
}

export function isBingBlockedHtml(html: string): boolean {
  return (
    /captcha|challenges\.bing|verify you are human|unusual traffic/i.test(html) &&
    (html.match(/b_algo/g) ?? []).length < 2
  );
}

export function bingSearchUrl(query: string, location: string): string {
  const rw = /rwanda|kigali/i.test(location);
  const cc = rw ? 'RW' : 'US';
  const mkt = rw ? 'en-RW' : 'en-US';
  return `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=30&cc=${cc}&mkt=${mkt}&setlang=en`;
}

export function googleSearchUrl(query: string, location = ''): string {
  const rw = /rwanda|kigali/i.test(location);
  const gl = rw ? 'rw' : 'us';
  return `https://www.google.com/search?q=${encodeURIComponent(query)}&num=10&hl=en&gl=${gl}&filter=0`;
}

export function isGoogleBlockedHtml(html: string): boolean {
  return (
    /unusual traffic|sorry\/index|captcha|detected unusual|enable javascript/i.test(html) ||
    ((html.match(/<a /g) ?? []).length < 5 && html.length < 30_000)
  );
}

export function parseBingHits(html: string, max = 30): SearchHit[] {
  const decoded = html
    .replace(/\s*\[at\]\s*/gi, '@')
    .replace(/\s*\(at\)\s*/gi, '@')
    .replace(/\s*\[dot\]\s*/gi, '.')
    .replace(/\s*\(dot\)\s*/gi, '.');

  const blocks =
    decoded.match(/<li[^>]*class="[^"]*b_algo[^"]*"[^>]*>[\s\S]*?<\/li>/gi) ?? [];
  const hits: SearchHit[] = [];

  for (const block of blocks.slice(0, max)) {
    const titleMatch = block.match(/<h2[^>]*>.*?<a[^>]*>(.*?)<\/a>/i);
    const title = titleMatch?.[1]?.replace(/<[^>]+>/g, '').trim() ?? '';
    if (!title || title.length < 3) continue;

    const cite = block.match(/<cite[^>]*>([^<]*)<\/cite>/i)?.[1]?.trim();
    let url = '';
    if (cite) {
      const raw = decodeHtmlEntities(cite).split(/\s+/)[0] ?? '';
      url = raw.startsWith('http') ? raw : raw ? `https://${raw}` : '';
    }
    if (!url) {
      const hrefRe = /href="(https?:\/\/[^"]+)"/gi;
      let m: RegExpExecArray | null;
      while ((m = hrefRe.exec(block)) !== null) {
        const u = decodeHtmlEntities(m[1]);
        if (!/bing\.com|microsoft\.com|r\.bing\.com/i.test(u)) {
          url = u;
          break;
        }
      }
    }

    const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const snippet = snippetMatch?.[1]?.replace(/<[^>]+>/g, '').trim() ?? '';

    hits.push({ title, url, snippet });
  }

  return hits;
}

function cleanGoogleUrl(raw: string): string {
  const decoded = decodeHtmlEntities(raw);
  try {
    const url = new URL(decoded.startsWith('http') ? decoded : `https://www.google.com${decoded}`);
    if (url.pathname === '/url') {
      return url.searchParams.get('q') ?? '';
    }
    return decoded;
  } catch {
    return decoded;
  }
}

export function parseGoogleHits(html: string, max = 12): SearchHit[] {
  const decoded = html
    .replace(/\s*\[at\]\s*/gi, '@')
    .replace(/\s*\(at\)\s*/gi, '@')
    .replace(/\s*\[dot\]\s*/gi, '.')
    .replace(/\s*\(dot\)\s*/gi, '.');
  const hits: SearchHit[] = [];
  const seen = new Set<string>();

  const blockRe = /<div[^>]+class="[^"]*(?:MjjYud|g)[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]+class="[^"]*(?:MjjYud|g)[^"]*"|<\/body>)/gi;
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(decoded)) !== null && hits.length < max) {
    const block = match[1];
    const link = block.match(/<a[^>]+href="([^"]+)"[^>]*>[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>/i);
    if (!link) continue;
    const url = cleanGoogleUrl(link[1]);
    if (!/^https?:\/\//i.test(url) || /google\.(?:com|co|rw)\/(?:search|url|maps|imgres)/i.test(url)) {
      continue;
    }
    const title = link[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!title || seen.has(url)) continue;
    const snippet =
      block.match(/<div[^>]+class="[^"]*(?:VwiC3b|yXK7lf|lEBKkf)[^"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1]
        ?.replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim() ?? '';
    seen.add(url);
    hits.push({ title, url, snippet });
  }

  if (hits.length > 0) return hits;

  const anchorRe = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  while ((match = anchorRe.exec(decoded)) !== null && hits.length < max) {
    const url = cleanGoogleUrl(match[1]);
    if (!/^https?:\/\//i.test(url) || /google\./i.test(url) || seen.has(url)) continue;
    const title = match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (title.length < 4) continue;
    seen.add(url);
    hits.push({ title, url, snippet: '' });
  }

  return hits;
}

export function parseDdgHtmlHits(html: string, max = 25): SearchHit[] {
  const decoded = html
    .replace(/\s*\[at\]\s*/gi, '@')
    .replace(/\s*\(at\)\s*/gi, '@')
    .replace(/\s*\[dot\]\s*/gi, '.')
    .replace(/\s*\(dot\)\s*/gi, '.');

  const blocks =
    decoded.match(/<div class="result[^"]*"[\s\S]*?<\/div>\s*<\/div>/gi) ?? [];
  const hits: SearchHit[] = [];

  for (const block of blocks.slice(0, max)) {
    const titleMatch = block.match(
      /class="result__title"[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i
    );
    const title = titleMatch?.[1]?.replace(/<[^>]+>/g, '').trim() ?? '';
    if (!title || title.length < 3) continue;

    const urlMatch = block.match(/class="result__url"[^>]*>([\s\S]*?)<\/a>/i);
    const rawUrl = urlMatch?.[1]?.replace(/<[^>]+>/g, '').trim() ?? '';
    const url = rawUrl.startsWith('http') ? rawUrl : rawUrl ? `https://${rawUrl}` : '';

    const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/span>/i);
    const snippet = snippetMatch?.[1]?.replace(/<[^>]+>/g, '').trim() ?? '';

    hits.push({ title, url, snippet });
  }

  return hits;
}

/** DDG lite table rows (fallback when html POST is blocked). */
export function parseDdgLiteHits(html: string, max = 25): SearchHit[] {
  const hits: SearchHit[] = [];
  const rowRe =
    /<tr[^>]*>[\s\S]*?<a[^>]*href="[^"]*uddg=([^"&]+)[^"]*"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) !== null && hits.length < max) {
    try {
      const url = decodeURIComponent(m[1]);
      const title = m[2].replace(/<[^>]+>/g, '').trim();
      if (title && url.startsWith('http')) {
        hits.push({ title, url, snippet: '' });
      }
    } catch {
      /* skip bad row */
    }
  }
  return hits;
}

async function httpGetSearch(url: string): Promise<{ html: string; status: number }> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': randomSearchUA(),
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      Referer: url.includes('google.com') ? 'https://www.google.com/' : 'https://www.bing.com/',
    },
    signal: AbortSignal.timeout(15_000),
  });
  return { html: await res.text(), status: res.status };
}

async function httpPostDdg(query: string): Promise<{ html: string; status: number }> {
  const res = await fetch('https://html.duckduckgo.com/html/', {
    method: 'POST',
    headers: {
      'User-Agent': randomSearchUA(),
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'text/html',
      Referer: 'https://html.duckduckgo.com/',
    },
    body: `q=${encodeURIComponent(query)}`,
    signal: AbortSignal.timeout(15_000),
  });
  return { html: await res.text(), status: res.status };
}

/** Load a URL in headless Chrome — for sites that block plain fetch or need JS. */
export async function fetchHtmlWithBrowser(url: string, postBody?: string): Promise<string> {
  const { getActiveScrapeBrowserPool } = await import('./scrape-browser-pool');
  const pool = getActiveScrapeBrowserPool();
  if (pool) {
    return pool.fetchHtml(url, postBody);
  }

  let browser: Browser | undefined;
  try {
    browser = await puppeteer.launch({ headless: true, args: BROWSER_ARGS });
    const page = await browser.newPage();
    const ua = randomSearchUA();
    await page.setUserAgent(ua);
    await page.setViewport({ width: 1280, height: 800 });
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    if (postBody) {
      await page.goto('https://html.duckduckgo.com/html/', {
        waitUntil: 'domcontentloaded',
        timeout: 20_000,
      });
      await page.type('input[name="q"]', postBody, { delay: 30 });
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20_000 }).catch(() => null),
        page.keyboard.press('Enter'),
      ]);
      await delay(1500);
    } else {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25_000 });
      await delay(1000);
    }

    return await page.content();
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function puppeteerForced(engine: 'bing' | 'ddg' | 'google'): boolean {
  const v = process.env.SEARCH_USE_PUPPETEER?.trim().toLowerCase();
  if (v === 'all' || v === '1' || v === 'true') return true;
  return v === engine || (v?.split(',').map((s) => s.trim()).includes(engine) ?? false);
}

function puppeteerFallbackEnabled(): boolean {
  return process.env.SEARCH_PUPPETEER_FALLBACK !== 'false';
}

/** Fetch Bing SERP HTML (HTTP, optional Puppeteer if blocked or env). */
export async function fetchBingHtml(
  query: string,
  location: string
): Promise<{ html: string; via: 'http' | 'puppeteer' }> {
  const url = bingSearchUrl(query, location);
  const { html, status } = await httpGetSearch(url);
  if (
    status === 200 &&
    !isBingBlockedHtml(html) &&
    parseBingHits(html).length > 0
  ) {
    return { html, via: 'http' };
  }

  if (puppeteerForced('bing') || puppeteerFallbackEnabled()) {
    console.log('  🔵 Bing: HTTP weak — retry with browser…');
    const browserHtml = await fetchHtmlWithBrowser(url);
    return { html: browserHtml, via: 'puppeteer' };
  }

  return { html, via: 'http' };
}

/** Fetch DDG results (html POST → lite GET → Puppeteer). */
/** Fetch Google SERP HTML (HTTP, optional Puppeteer if blocked or env). */
export async function fetchGoogleHtml(
  query: string,
  location = ''
): Promise<{ html: string; via: 'http' | 'puppeteer'; blocked: boolean }> {
  const url = googleSearchUrl(query, location);
  const { html, status } = await httpGetSearch(url);
  if (
    status === 200 &&
    !isGoogleBlockedHtml(html) &&
    parseGoogleHits(html).length > 0
  ) {
    return { html, via: 'http', blocked: false };
  }

  if (puppeteerForced('google') || puppeteerFallbackEnabled()) {
    console.log('  🔎 Google: HTTP weak — retry with browser...');
    const browserHtml = await fetchHtmlWithBrowser(url);
    const blocked = isGoogleBlockedHtml(browserHtml);
    return { html: browserHtml, via: 'puppeteer', blocked };
  }

  return { html, via: 'http', blocked: true };
}

export async function fetchDdgHtml(query: string): Promise<{
  html: string;
  via: 'http' | 'lite' | 'puppeteer';
  blocked: boolean;
}> {
  const tryHttp = async () => {
    const { html, status } = await httpPostDdg(query);
    if (status === 200 && !isDdgBlockedHtml(html)) {
      return { html, via: 'http' as const, blocked: false };
    }
    return null;
  };

  const httpResult = await tryHttp();
  if (httpResult) return httpResult;

  await delay(800);
  const liteUrl = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
  const { html: liteHtml, status: liteStatus } = await httpGetSearch(liteUrl);
  if (liteStatus === 200 && !isDdgBlockedHtml(liteHtml)) {
    const liteHits = parseDdgLiteHits(liteHtml);
    if (liteHits.length > 0) {
      return { html: liteHtml, via: 'lite', blocked: false };
    }
  }

  if (puppeteerForced('ddg') || puppeteerFallbackEnabled()) {
    console.log('  🦆 DDG: HTTP/lite blocked — retry with browser…');
    const browserHtml = await fetchHtmlWithBrowser(
      'https://html.duckduckgo.com/html/',
      query
    );
    const blocked = isDdgBlockedHtml(browserHtml);
    return { html: browserHtml, via: 'puppeteer', blocked };
  }

  return { html: liteHtml || '', via: 'lite', blocked: true };
}

export function parseDdgHits(html: string, via: 'http' | 'lite' | 'puppeteer'): SearchHit[] {
  if (via === 'lite') return parseDdgLiteHits(html);
  return parseDdgHtmlHits(html);
}

/** Shorter queries — DDG blocks long "contact email" spam. */
export function buildDdgQueries(niche: string, location: string): string[] {
  const city = location.split(',')[0]?.trim() || location;
  return [
    `${niche} ${city}`,
    `${niche} ${location}`,
    `${niche} company ${city}`,
    `"${niche}" ${city} Rwanda`,
  ];
}

/** Business-focused Bing queries (exclude Wikipedia-style junk). */
export function buildBingQueries(niche: string, location: string): string[] {
  const city = location.split(',')[0]?.trim() || location;
  const rw = /rwanda|kigali/i.test(location);
  const exclude = '-wikipedia -linkedin -facebook -youtube';
  if (rw) {
    return [
      `${niche} ${city} Rwanda contact ${exclude}`,
      `${niche} "${city}" email site:.rw`,
      `${niche} Kigali business website ${exclude}`,
      `${niche} Nyarugenge OR Gasabo Kigali ${exclude}`,
      `${niche} company Rwanda "info@"`,
    ];
  }
  return [
    `${niche} ${location} contact email ${exclude}`,
    `"${niche}" "${location}" email ${exclude}`,
    `${niche} company ${location} website ${exclude}`,
    `${niche} near ${location} "contact us" ${exclude}`,
  ];
}
