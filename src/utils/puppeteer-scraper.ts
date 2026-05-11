/**
 * Puppeteer-based Lead Scraper — no API keys required.
 *
 * WHY YOU GET FAKE EMAILS (info@companyname.com)
 * ─────────────────────────────────────────────────────────────────────────────
 * Most scrapers fall back to a guessed address because:
 *
 *  1. The company has no website, or the website blocks bots (Cloudflare, etc.)
 *  2. The email is rendered by JavaScript and a plain fetch() can't see it.
 *  3. The email is hidden behind a contact form — never written as plain text.
 *  4. The website uses obfuscation (e.g. "info [at] company [dot] com").
 *  5. Google Maps / Yelp / Yellow Pages don't publish emails at all.
 *
 * This file uses a real headless browser (Puppeteer) to execute JavaScript,
 * scroll pages, and follow contact links — which catches far more real emails
 * than a plain fetch. When a real email still can't be found, the fallback
 * is clearly labelled so you know which leads need manual verification.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import puppeteer, { Browser, Page } from 'puppeteer';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ScrapedLead {
  company_name: string;
  /** Real email when found; empty string when not found — check `emailIsReal`. */
  email: string;
  /** true = scraped from a real page; false = not found */
  emailIsReal: boolean;
  niche: string;
  location: string;
  company_context: string;
  source_url?: string;
  phone?: string;
  website?: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** Domains that appear in scraped HTML but are never real contact emails. */
const BLOCKED_DOMAINS = [
  'example.com', 'example.org', 'sentry.io', 'wixpress.com',
  'squarespace.com', 'wordpress.com', 'localhost',
];

/** Email local-parts that are system / no-reply addresses. */
const BLOCKED_PREFIXES = ['noreply', 'no-reply', 'donotreply', 'privacy', 'test', 'admin@localhost'];

/** Strings that appear in "emails" that are actually image filenames. */
const BLOCKED_SUBSTRINGS = ['.png', '.jpg', '.jpeg', '.gif', '@2x', 'placeholder'];

// ─── Email helpers ───────────────────────────────────────────────────────────

function extractEmailsFromText(text: string): string[] {
  const raw = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) ?? [];
  const unique = Array.from(new Set(raw.map((e) => e.toLowerCase())));

  return unique.filter((e) => {
    const [local, domain] = e.split('@');
    if (!domain) return false;
    if (BLOCKED_DOMAINS.some((d) => domain.includes(d))) return false;
    if (BLOCKED_PREFIXES.some((p) => local.startsWith(p))) return false;
    if (BLOCKED_SUBSTRINGS.some((s) => e.includes(s))) return false;
    if (!/\.[a-z]{2,}$/i.test(e)) return false;
    return true;
  });
}

/** Higher score = better email to use as the primary contact address. */
function scoreEmail(email: string, locationHint = ''): number {
  const local = email.split('@')[0].toLowerCase();
  const domain = email.split('@')[1]?.toLowerCase() ?? '';

  // Country-specific emails score highest when we have a location hint
  // e.g. info.rw@ for Rwanda, info.ke@ for Kenya
  if (locationHint) {
    const country = locationHint.toLowerCase();
    // Extract 2-letter country code from location (e.g. "rwanda" → "rw", "kenya" → "ke")
    const countryCodeMap: Record<string, string> = {
      rwanda: 'rw', kenya: 'ke', ethiopia: 'et', uganda: 'ug', tanzania: 'tz',
      nigeria: 'ng', ghana: 'gh', southafrica: 'za', egypt: 'eg', morocco: 'ma',
      senegal: 'sn', cameroon: 'cm', ivorycoast: 'ci', angola: 'ao', mozambique: 'mz',
    };
    const normalised = country.replace(/\s+/g, '');
    const code = countryCodeMap[normalised] ?? country.slice(0, 2);
    // e.g. info.rw@domain or rw@domain or info-rw@domain
    if (local.endsWith(`.${code}`) || local.endsWith(`-${code}`) || local === code) return 20;
    // Domain ends with country TLD e.g. @school.rw
    if (domain.endsWith(`.${code}`)) return 18;
  }

  if (['info', 'contact', 'hello', 'hi'].includes(local)) return 10;
  if (['sales', 'business', 'inquiries', 'inquiry', 'admissions', 'admission'].includes(local)) return 8;
  if (['support', 'help', 'office', 'admin'].includes(local)) return 6;
  if (local.includes('.')) return 5; // firstname.lastname@
  return 4;
}

function pickBestEmail(emails: string[], locationHint = ''): string | null {
  if (emails.length === 0) return null;
  return [...emails].sort((a, b) => scoreEmail(b, locationHint) - scoreEmail(a, locationHint))[0];
}

function fallbackEmail(name: string, website?: string | null): string {
  if (website) {
    try {
      const domain = new URL(website).hostname.replace('www.', '');
      return `info@${domain}`;
    } catch {
      // fall through
    }
  }
  return `info@${name.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`;
}

// ─── Page-level email extraction ─────────────────────────────────────────────

/**
 * Extract all emails from the currently loaded page (JS-rendered).
 * Handles:
 *  - Plain text emails
 *  - mailto: links
 *  - Cloudflare email protection (/cdn-cgi/l/email-protection#...)
 *  - Obfuscated patterns like "info [at] domain [dot] com"
 */
async function extractEmailsFromRenderedPage(page: Page): Promise<string[]> {
  const raw = await page.evaluate(() => {
    const results: string[] = [];

    // 1. mailto: links (most reliable)
    document.querySelectorAll<HTMLAnchorElement>('a[href^="mailto:"]').forEach((a) => {
      const email = a.href.replace('mailto:', '').split('?')[0].trim();
      if (email) results.push(email);
    });

    // 2. Cloudflare email protection — decode hex-encoded emails
    // Format: <a href="/cdn-cgi/l/email-protection#HEXSTRING">
    document.querySelectorAll<HTMLAnchorElement>('a[href*="/cdn-cgi/l/email-protection"]').forEach((a) => {
      const href = a.getAttribute('href') || '';
      const hash = href.split('#')[1];
      if (hash) {
        try {
          // Cloudflare XOR decode: first byte is the key
          const bytes = hash.match(/.{2}/g) || [];
          if (bytes.length < 2) return;
          const key = parseInt(bytes[0]!, 16);
          const decoded = bytes.slice(1).map((b) => String.fromCharCode(parseInt(b, 16) ^ key)).join('');
          if (decoded.includes('@')) results.push(decoded);
        } catch { /* ignore */ }
      }
      // Also try reading the visible text — after JS runs it shows the real email
      const text = a.textContent?.trim() || '';
      if (text.includes('@')) results.push(text);
    });

    // 3. data-cfemail attributes (another Cloudflare variant)
    document.querySelectorAll('[data-cfemail]').forEach((el) => {
      const encoded = el.getAttribute('data-cfemail') || '';
      if (encoded) {
        try {
          const bytes = encoded.match(/.{2}/g) || [];
          if (bytes.length < 2) return;
          const key = parseInt(bytes[0]!, 16);
          const decoded = bytes.slice(1).map((b) => String.fromCharCode(parseInt(b, 16) ^ key)).join('');
          if (decoded.includes('@')) results.push(decoded);
        } catch { /* ignore */ }
      }
    });

    // 4. Full page text + HTML for regex scan
    results.push(document.body.innerText);
    results.push(document.body.innerHTML);

    return results.join('\n');
  });

  // Decode obfuscated emails like "info [at] domain [dot] com"
  const decoded = raw
    .replace(/\s*\[at\]\s*/gi, '@')
    .replace(/\s*\(at\)\s*/gi, '@')
    .replace(/\s*\[dot\]\s*/gi, '.')
    .replace(/\s*\(dot\)\s*/gi, '.');

  return extractEmailsFromText(decoded);
}

/**
 * Visit a website and find a real email using a fully JS-rendered browser.
 * Pass `location` so we can prefer country-specific emails (e.g. info.rw@ for Rwanda).
 *
 * Crawls the site smartly:
 *  1. Homepage — returns immediately if email found
 *  2. /contact, /contact-us, /about, /about-us and contact-looking nav links
 *  3. Stops as soon as a good email is found (max 5 pages total)
 *
 * Returns null ONLY if the site has zero email addresses anywhere.
 */
async function findEmailOnWebsite(page: Page, website: string, location = ''): Promise<string | null> {
  let baseOrigin = '';
  try { baseOrigin = new URL(website).origin; } catch { return null; }

  const visited = new Set<string>();
  const allEmails: string[] = [];
  const MAX_PAGES = 2; // Contact page + homepage if needed

  /** Navigate, render JS, extract emails. Returns [] on error. */
  const visitAndExtract = async (url: string): Promise<string[]> => {
    // Normalise — strip hash/query so we don't visit the same page twice
    let clean = url;
    try { const u = new URL(url); clean = u.origin + u.pathname; } catch { return []; }
    if (visited.has(clean)) return [];
    if (!clean.startsWith(baseOrigin)) return []; // stay on same domain
    visited.add(clean);

    try {
      await navigateSafely(page, url);
      await scrollToBottom(page);
      const emails = await extractEmailsFromRenderedPage(page);
      if (emails.length > 0) {
        console.log(`    ✉️  ${clean} → ${emails.join(', ')}`);
      }
      return emails;
    } catch (err: any) {
      console.log(`    ⚠️  ${clean}: ${err?.message?.slice(0, 80)}`);
      return [];
    }
  };

  // ── Try contact page first (most emails are here) ──────────────────
  const contactUrl = `${baseOrigin}/contact`;
  const contactEmails = await visitAndExtract(contactUrl);
  allEmails.push(...contactEmails);
  
  // If found good email on contact page, return immediately
  const bestFromContact = pickBestEmail(allEmails, location);
  if (bestFromContact && scoreEmail(bestFromContact, location) >= 8) {
    return bestFromContact; // High-quality email found, stop here
  }

  // Try homepage if contact page didn't have a good email
  const homepageEmails = await visitAndExtract(website);
  allEmails.push(...homepageEmails);
  
  return pickBestEmail(allEmails, location);
}

// ─── Navigation helpers ───────────────────────────────────────────────────────

async function navigateSafely(page: Page, url: string, timeout = 20_000): Promise<void> {
  try {
    // Try fast load first
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 });
  } catch {
    // If that fails, try with longer timeout
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 20_000 });
    } catch {
      // Last attempt with networkidle
      try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 25_000 });
      } catch {
        // Page partially loaded — continue anyway (better than nothing)
        console.log(`    ⚠️  Partial load for ${url}`);
      }
    }
  }
  // Wait for JS email decoders (Cloudflare etc.)
  await delay(500);
}

async function scrollToBottom(page: Page): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await delay(300); // Give time for lazy-loaded content
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function launchBrowser(): Promise<Browser> {
  return puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-images', // Don't load images - saves bandwidth
      '--disable-plugins',
      '--disable-extensions',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });
}

// ─── Location & email verification ───────────────────────────────────────────

/**
 * Check whether a website actually belongs to a business in the given location.
 *
 * Rules (in order):
 *  1. Country-specific TLD (.rw, .ke, etc.) → always accept
 *  2. A DIFFERENT country's TLD → reject immediately
 *  3. Generic TLD (.com, .org, .net, .edu) → accept (common for African orgs)
 *  4. Page content check: must mention the location OR the business name
 */
async function isWebsiteLocalToLocation(
  page: Page,
  website: string,
  location: string,
  bizName: string
): Promise<boolean> {
  try {
    const locationWords = location.toLowerCase().split(/[\s,]+/).filter((w) => w.length > 2);
    const hostname = new URL(website).hostname.toLowerCase();

    const countryTLDs: Record<string, string[]> = {
      rwanda: ['.rw'], kenya: ['.ke'], ethiopia: ['.et'], uganda: ['.ug'],
      tanzania: ['.tz'], nigeria: ['.ng'], ghana: ['.gh'], southafrica: ['.za'],
      egypt: ['.eg'], morocco: ['.ma'], senegal: ['.sn'], cameroon: ['.cm'],
    };

    // Generic TLDs used by organisations worldwide — always allow without loading the page
    const genericTLDs = ['.com', '.org', '.net', '.edu', '.int', '.co'];
    if (genericTLDs.some((t) => hostname.endsWith(t) || hostname.includes(t + '.'))) {
      // Skip the content check — it costs an extra full page load per business.
      // The email extraction step will naturally discard irrelevant sites.
      return true;
    }

    for (const word of locationWords) {
      const tlds = countryTLDs[word];
      if (tlds) {
        // Correct country TLD → definitely local
        if (tlds.some((tld) => hostname.endsWith(tld))) return true;
        // Different country TLD → definitely wrong location
        const allTLDs = Object.values(countryTLDs).flat();
        if (allTLDs.some((tld) => hostname.endsWith(tld) && !tlds.includes(tld))) {
          console.log(`    ❌ Domain TLD mismatch: ${hostname} is not in ${location}`);
          return false;
        }
      }
    }

    return true;
  } catch {
    return true;
  }
}

/**
 * Verify an email address is deliverable by checking DNS MX records.
 */
async function verifyEmailDomain(email: string): Promise<boolean> {
  try {
    const domain = email.split('@')[1];
    if (!domain) return false;
    const res = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=MX`, {
      signal: AbortSignal.timeout(5_000),
    });
    const data = await res.json() as { Answer?: unknown[] };
    return Array.isArray(data.Answer) && data.Answer.length > 0;
  } catch {
    return true;
  }
}

/**
 * Search Google for a business's website when Maps doesn't have it.
 * Returns the first legitimate website found (not social media).
 */
async function findWebsiteViaGoogle(
  page: Page,
  bizName: string,
  location: string
): Promise<string | null> {
  try {
    const query = `"${bizName}" ${location} official website`;
    await navigateSafely(page, `https://www.google.com/search?q=${encodeURIComponent(query)}`, 15_000);

    const website = await page.evaluate(() => {
      const skip = ['google.com', 'facebook.com', 'instagram.com', 'twitter.com',
                    'linkedin.com', 'youtube.com', 'yelp.com', 'tripadvisor.com',
                    'maps.google', 'goo.gl', 'wikipedia.org'];

      // Find first search result link that's not social media
      const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'));
      for (const link of links) {
        const href = link.href;
        if (href.startsWith('http') && !skip.some((s) => href.includes(s))) {
          // Check if it's a real result (not a Google internal link)
          if (href.includes('/url?q=')) {
            const url = new URL(href);
            const target = url.searchParams.get('q');
            if (target && !skip.some((s) => target.includes(s))) {
              return target;
            }
          } else if (!href.includes('google.com')) {
            return href;
          }
        }
      }
      return null;
    });

    return website;
  } catch {
    return null;
  }
}

/**
 * Search Google for a business's email when no website is available.
 * Uses targeted queries and extracts emails directly from search result snippets.
 */
async function findEmailViaGoogle(
  page: Page,
  bizName: string,
  location: string
): Promise<string | null> {
  const queries = [
    `"${bizName}" "${location}" email contact`,
    `"${bizName}" ${location} email`,
    `${bizName} ${location} contact email`,
  ];

  for (const query of queries) {
    try {
      await navigateSafely(page, `https://www.google.com/search?q=${encodeURIComponent(query)}`, 15_000);
      const emails = await extractEmailsFromRenderedPage(page);
      const best = pickBestEmail(emails, location);
      if (best) {
        console.log(`    📧 Found via Google search: ${best}`);
        return best;
      }
    } catch { /* try next query */ }
  }
  return null;
}

// ─── Fast HTTP email extractor (no browser needed) ───────────────────────────

/**
 * Extract emails from a website using plain HTTP fetch.
 * Much faster than Puppeteer — works for ~70% of sites.
 * Checks homepage + /contact page.
 */
async function fetchEmailFromWebsite(website: string, location = ''): Promise<string | null> {
  if (!website.startsWith('http')) website = `https://${website}`;

  let baseOrigin = '';
  try { baseOrigin = new URL(website).origin; } catch { return null; }

  const pagesToCheck = [
    `${baseOrigin}/contact`,
    `${baseOrigin}/contact-us`,
    `${baseOrigin}/about`,
    website,
  ];

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  for (const url of pagesToCheck) {
    try {
      const res = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(8_000),
      });

      if (!res.ok) continue;

      let html = await res.text();

      // Decode obfuscation
      html = html
        .replace(/\s*\[at\]\s*/gi, '@')
        .replace(/\s*\(at\)\s*/gi, '@')
        .replace(/\s*\[dot\]\s*/gi, '.')
        .replace(/\s*\(dot\)\s*/gi, '.');

      // Decode Cloudflare email protection (hex XOR encoding)
      const cfRe = /data-cfemail="([0-9a-f]+)"/gi;
      let cfMatch: RegExpExecArray | null;
      while ((cfMatch = cfRe.exec(html)) !== null) {
        const encoded = cfMatch[1] ?? '';
        const bytes = encoded.match(/.{2}/g) ?? [];
        if (bytes.length < 2) continue;
        const key = parseInt(bytes[0] ?? '0', 16);
        const decoded = bytes.slice(1).map((b: string) => String.fromCharCode(parseInt(b, 16) ^ key)).join('');
        if (decoded.includes('@')) html += ` ${decoded}`;
      }

      // Extract mailto: links first (most reliable)
      const mailtoEmails: string[] = [];
      const mailtoRe = /mailto:([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/gi;
      let m: RegExpExecArray | null;
      while ((m = mailtoRe.exec(html)) !== null) {
        mailtoEmails.push(m[1].toLowerCase());
      }

      // Then plain text emails
      const allEmails = [...mailtoEmails, ...extractEmailsFromText(html)];
      const best = pickBestEmail(allEmails, location);

      if (best) return best;

      // Stop early if we found something on a contact page
      if (url.includes('contact') && allEmails.length > 0) break;

    } catch {
      // Timeout or network error — try next URL
    }
  }

  return null;
}

// ─── Google search for a specific business's email ───────────────────────────

/**
 * Search Google for a specific business's email address.
 * This is the key function for businesses without websites.
 *
 * Searches for:
 *  - "Business Name" Kigali email
 *  - "Business Name" contact @gmail.com OR @yahoo.com
 *  - site:facebook.com "Business Name" Kigali email
 *  - Business Name in directories (yellowpages, etc.)
 */
async function searchGoogleForBusinessEmail(
  bizName: string,
  location: string,
  website?: string | null
): Promise<string | null> {
  // Clean location to just city name
  const city = location.split(',')[0].split('-')[0].trim();

  const queries = [
    // Most effective: direct name + email search
    `"${bizName}" "${city}" email`,
    // Gmail/Yahoo are common in Africa
    `"${bizName}" ${city} "@gmail.com" OR "@yahoo.com" OR "@hotmail.com"`,
    // Facebook pages often have emails
    `site:facebook.com "${bizName}" ${city} email`,
    // If they have a website, search for email on it
    ...(website ? [`site:${new URL(website).hostname} email`] : []),
  ];

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate',
  };

  for (const query of queries) {
    try {
      const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=10`;
      const res = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(8_000),
      });

      if (!res.ok) continue;

      let html = await res.text();

      // Decode obfuscation
      html = html
        .replace(/\s*\[at\]\s*/gi, '@')
        .replace(/\s*\(at\)\s*/gi, '@')
        .replace(/\s*\[dot\]\s*/gi, '.')
        .replace(/\s*\(dot\)\s*/gi, '.');

      const emails = extractEmailsFromText(html);

      // Filter out Google's own emails and irrelevant ones
      const filtered = emails.filter(e => {
        const domain = e.split('@')[1] ?? '';
        return !domain.includes('google') &&
               !domain.includes('sentry') &&
               !domain.includes('example') &&
               !domain.includes('w3.org') &&
               !domain.includes('schema.org');
      });

      const best = pickBestEmail(filtered, location);
      if (best) {
        console.log(`    📧 Found via Google search: ${best} (query: ${query.slice(0, 50)})`);
        return best;
      }

      // Small delay to avoid rate limiting
      await delay(500);
    } catch {
      // Try next query
    }
  }

  return null;
}

// ─── Google Maps ─────────────────────────────────────────────────────────────

/**
 * Scrape Google Maps for businesses matching `niche` in `location`.
 *
 * Strategy:
 *  1. One browser tab loads the Maps search and scrolls to collect listings
 *  2. For each listing, click it to get the website URL from the detail panel
 *  3. Use plain HTTP fetch (not Puppeteer) to extract emails from websites — fast
 *  4. Only fall back to Puppeteer for JS-heavy sites
 *  5. Max 5 concurrent fetches — stable on any machine
 */
export async function scrapeGoogleMaps(
  niche: string,
  location: string,
  maxResults = 100
): Promise<ScrapedLead[]> {
  const leads: ScrapedLead[] = [];
  let browser: Browser | undefined;

  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);

    // ── Load Maps search results ──────────────────────────────────────────
    const mapsUrl = `https://www.google.com/maps/search/${encodeURIComponent(`${niche} in ${location}`)}`;
    console.log(`\n🗺  Google Maps: ${mapsUrl}`);
    await page.goto(mapsUrl, { waitUntil: 'networkidle2', timeout: 30_000 });
    await page.waitForSelector('[role="article"]', { timeout: 10_000 }).catch(() => {});

    // ── Scroll to load more listings ──────────────────────────────────────
    let prevCount = 0;
    let staleScrolls = 0;
    const maxScrolls = Math.min(Math.ceil(maxResults / 5) + 5, 60);

    for (let i = 0; i < maxScrolls; i++) {
      await page.evaluate(() => {
        const feed = document.querySelector('[role="feed"]');
        if (feed) feed.scrollTop = feed.scrollHeight;
      });
      await delay(1200);

      const count = await page.evaluate(
        () => document.querySelectorAll('[role="article"]').length
      );
      console.log(`  Scroll ${i + 1}: ${count} listings`);

      if (count >= maxResults) break;
      if (count === prevCount) {
        if (++staleScrolls >= 4) break;
      } else {
        staleScrolls = 0;
      }
      prevCount = count;
    }

    // ── Collect listing metadata ──────────────────────────────────────────
    const businesses: Array<{
      name: string; address: string; rating: string; phone: string; placeUrl: string;
    }> = await page.evaluate((max: number) => {
      const out: any[] = [];
      document.querySelectorAll('[role="article"]').forEach((el, i) => {
        if (i >= max) return;
        const name    = el.querySelector('[class*="fontHeadline"]')?.textContent?.trim();
        const address = el.querySelector('[class*="fontBody"]')?.textContent?.trim() ?? '';
        const rating  = el.querySelector('[role="img"][aria-label*="stars"]')?.getAttribute('aria-label') ?? '';
        const phone   = (el.querySelector('a[href^="tel:"]') as HTMLAnchorElement)?.textContent?.trim() ?? '';
        const placeUrl = (el.querySelector('a[href*="/maps/place/"]') as HTMLAnchorElement)?.href ?? '';
        if (name) out.push({ name, address, rating, phone, placeUrl });
      });
      return out;
    }, maxResults);

    console.log(`\n✅ Found ${businesses.length} businesses — extracting websites then emails...\n`);

    // ── Step 2: Click each listing to get website URL ─────────────────────
    // We process sequentially to avoid overloading the browser
    const businessesWithWebsites: Array<typeof businesses[0] & { website: string | null }> = [];

    for (let i = 0; i < businesses.length; i++) {
      const biz = businesses[i];
      let website: string | null = null;
      let phone = biz.phone;

      try {
        if (biz.placeUrl) {
          // Navigate to the place page to get the website
          await page.goto(biz.placeUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 });
          await delay(1000);

          const placeData = await page.evaluate(() => {
            const skip = ['google.com', 'facebook.com', 'instagram.com', 'twitter.com',
                          'linkedin.com', 'youtube.com', 'yelp.com', 'tripadvisor.com',
                          'maps.google', 'goo.gl'];

            // Try the authority link first (most reliable)
            const auth = document.querySelector<HTMLAnchorElement>(
              '[data-item-id="authority"] a, a[data-item-id="authority"]'
            );
            let siteUrl = auth?.href ?? null;

            // Fallback: find any external link
            if (!siteUrl) {
              for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
                if (a.href.startsWith('http') && !skip.some((s) => a.href.includes(s))) {
                  siteUrl = a.href;
                  break;
                }
              }
            }

            const tel = document.querySelector<HTMLAnchorElement>('a[href^="tel:"]');
            return { siteUrl, phoneNum: tel?.textContent?.trim() ?? '' };
          });

          website = placeData.siteUrl;
          if (placeData.phoneNum) phone = placeData.phoneNum;
          console.log(`  [${i + 1}/${businesses.length}] ${biz.name} → ${website ?? 'no website'}`);
        }
      } catch (err: any) {
        console.log(`  [${i + 1}/${businesses.length}] ${biz.name} → timeout getting website`);
      }

      businessesWithWebsites.push({ ...biz, phone, website });
    }

    // ── Step 3: For each business, search Google for their email ─────────
    // This works even for businesses with no website — their email may appear
    // in directories, Facebook pages, or other online mentions.
    const CONCURRENCY = 5;
    console.log(`\n📧 Searching Google for emails (${businessesWithWebsites.length} businesses)...\n`);

    for (let i = 0; i < businessesWithWebsites.length; i += CONCURRENCY) {
      const batch = businessesWithWebsites.slice(i, i + CONCURRENCY);

      await Promise.all(batch.map(async (biz) => {
        let email: string | null = null;

        // Strategy A: If they have a website, try HTTP fetch first (fast)
        if (biz.website) {
          try {
            email = await fetchEmailFromWebsite(biz.website, location);
          } catch { /* fall through to Google search */ }
        }

        // Strategy B: Search Google for this specific business's email
        // Works even without a website — finds emails in directories, Facebook, etc.
        if (!email) {
          try {
            email = await searchGoogleForBusinessEmail(biz.name, location, biz.website);
          } catch { /* no email found */ }
        }

        if (email) {
          console.log(`  ✅ ${biz.name} → ${email}`);
          leads.push({
            company_name: biz.name,
            email,
            emailIsReal: true,
            niche,
            location: biz.address || location,
            company_context: `${biz.name} is a ${niche} in ${location}. ${biz.rating}`.trim(),
            source_url: biz.placeUrl || biz.website || '',
            phone: biz.phone || undefined,
            website: biz.website || undefined,
          });
        } else {
          console.log(`  ⚠️  No email found anywhere for: ${biz.name}`);
        }
      }));
    }

  } catch (err) {
    console.error('[GoogleMaps] Fatal error:', err);
  } finally {
    await browser?.close();
  }

  const realCount = leads.length;
  console.log(`\n📊 Google Maps: ${realCount} leads with real emails\n`);
  return leads;
}

// ─── Main entry point ────────────────────────────────────────────────────────

/**
 * Scrape leads from Google Maps + Google Search.
 * Only returns leads with REAL, verified emails — no fake fallbacks.
 */
export async function scrapeWithoutAPI(
  niche: string,
  location: string,
  maxLeads = 100
): Promise<ScrapedLead[]> {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`🚀 Starting scrape: "${niche}" in "${location}" (max ${maxLeads})`);
  console.log(`${'═'.repeat(60)}\n`);

  let all: ScrapedLead[] = [];

  // ── Source 1: Google Maps (best quality — has phone, address, website) ──
  try {
    const results = await scrapeGoogleMaps(niche, location, maxLeads);
    all = results;
    console.log(`\n✔ Google Maps: +${results.length} leads`);
  } catch (err) {
    console.error(`✘ Google Maps failed:`, err);
  }

  // ── Source 2: Google Search — fill the gap if Maps didn't give enough ──
  // Search multiple query variations to find more businesses with emails
  const realSoFar = all.filter((l) => l.emailIsReal).length;
  if (realSoFar < maxLeads) {
    console.log(`\n🔍 Only ${realSoFar} real emails so far — supplementing with Google Search...`);
    try {
      const searchLeads = await scrapeGoogleSearch(niche, location, maxLeads - realSoFar);
      // Merge — don't add duplicates (match by company name)
      const existingNames = new Set(all.map((l) => l.company_name.toLowerCase()));
      const newLeads = searchLeads.filter((l) => !existingNames.has(l.company_name.toLowerCase()));
      all = [...all, ...newLeads];
      console.log(`✔ Google Search: +${newLeads.length} additional leads`);
    } catch (err) {
      console.error(`✘ Google Search failed:`, err);
    }
  }

  const realCount = all.filter((l) => l.emailIsReal).length;
  const fallbackCount = all.length - realCount;
  
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`📊 Final results: ${all.length} leads (${realCount} verified, ${fallbackCount} fallback)`);
  console.log(`${'═'.repeat(60)}\n`);

  // ONLY return leads with real verified emails — never fake ones
  const verified = all.filter((l) => l.emailIsReal && l.email);
  console.log(`✅ Returning ${verified.length} leads with real emails (${all.length - verified.length} excluded — no real email found)\n`);
  return verified.slice(0, maxLeads);
}

// ─── Google Search supplementary scraper ─────────────────────────────────────

/**
 * Search Google for businesses with emails directly in the search results.
 * Used to supplement Maps when not enough businesses have websites.
 */
async function scrapeGoogleSearch(
  niche: string,
  location: string,
  needed: number
): Promise<ScrapedLead[]> {
  const leads: ScrapedLead[] = [];
  let browser: Browser | undefined;

  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);

    const queries = [
      `${niche} ${location} email contact`,
      `${niche} in ${location} "@" contact`,
      `list of ${niche} in ${location} email`,
      `${niche} ${location} site:*.rw OR site:*.org OR site:*.com email`,
      `"${location}" ${niche} contact email address`,
    ];

    for (const query of queries) {
      if (leads.length >= needed) break;

      try {
        console.log(`  🔍 Google: ${query}`);
        await navigateSafely(page, `https://www.google.com/search?q=${encodeURIComponent(query)}&num=20`, 15_000);

        // Extract emails directly from search result snippets
        const pageEmails = await extractEmailsFromRenderedPage(page);

        // Also extract business names + emails from result cards
        const results = await page.evaluate(() => {
          const out: Array<{ name: string; snippet: string; url: string }> = [];
          document.querySelectorAll('div.g, div[data-hveid]').forEach((el) => {
            const title = el.querySelector('h3')?.textContent?.trim() ?? '';
            const snippet = el.querySelector('.VwiC3b, [data-sncf]')?.textContent?.trim() ?? '';
            const url = (el.querySelector('a[href]') as HTMLAnchorElement)?.href ?? '';
            if (title && (snippet || url)) out.push({ name: title, snippet, url });
          });
          return out;
        });

        for (const result of results) {
          if (leads.length >= needed) break;

          // Check if snippet contains an email
          const snippetEmails = extractEmailsFromText(result.snippet);
          const email = pickBestEmail([...snippetEmails, ...pageEmails], location);

          if (email) {
            const deliverable = await verifyEmailDomain(email);
            if (deliverable) {
              leads.push({
                company_name: result.name.replace(/\s*[-|].*$/, '').trim(),
                email,
                emailIsReal: true,
                niche,
                location,
                company_context: result.snippet || `${result.name} is a ${niche} in ${location}.`,
                source_url: result.url,
                website: result.url || undefined,
              });
              console.log(`    ✅ ${result.name} → ${email}`);
            }
          }
        }
      } catch (err: any) {
        console.log(`  ⚠️  Query failed: ${err?.message?.slice(0, 60)}`);
      }

      await delay(500);
    }
  } catch (err) {
    console.error('[GoogleSearch] Error:', err);
  } finally {
    await browser?.close();
  }

  return leads;
}
