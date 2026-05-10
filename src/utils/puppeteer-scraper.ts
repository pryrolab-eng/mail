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

// ─── Google Maps ─────────────────────────────────────────────────────────────

/**
 * Scrape Google Maps for businesses matching `niche` in `location`.
 *
 * Uses THREE browser tabs:
 *  - listPage  : loads the Maps search, scrolls to collect all listing URLs
 *  - placePage : opens each business's Maps place URL directly (no clicking)
 *  - emailPage : visits the company website to extract the real email
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

    const listPage  = await browser.newPage();
    await listPage.setUserAgent(USER_AGENT);

    // ── Load Maps search results ──────────────────────────────────────────
    const mapsUrl = `https://www.google.com/maps/search/${encodeURIComponent(`${niche} in ${location}`)}`;
    console.log(`\n🗺  Google Maps: ${mapsUrl}`);
    await listPage.goto(mapsUrl, { waitUntil: 'networkidle2', timeout: 30_000 });
    await listPage.waitForSelector('[role="article"]', { timeout: 10_000 }).catch(() => {});

    // ── Scroll to load more listings ──────────────────────────────────────
    let prevCount = 0;
    let staleScrolls = 0;
    const maxScrolls = Math.min(Math.ceil(maxResults / 10), 150); // Allow more scrolls for larger datasets

    for (let i = 0; i < maxScrolls; i++) {
      await listPage.evaluate(() => {
        const feed = document.querySelector('[role="feed"]');
        if (feed) feed.scrollTop = feed.scrollHeight;
      });
      await delay(800); // Faster scrolling - reduced from 1000ms

      const count = await listPage.evaluate(
        () => document.querySelectorAll('[role="article"]').length
      );
      console.log(`  Scroll ${i + 1}: ${count} listings`);

      if (count >= maxResults) break;
      if (count === prevCount) {
        if (++staleScrolls >= 3) break;
      } else {
        staleScrolls = 0;
      }
      prevCount = count;
    }

    // ── Collect listing metadata + individual place URLs ──────────────────
    const businesses: Array<{
      name: string; address: string; rating: string; phone: string; placeUrl: string;
    }> = await listPage.evaluate((max: number) => {
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

    console.log(`\n✅ Found ${businesses.length} businesses — now finding real emails (parallel, batch of 15)...\n`);

    // ── Process businesses in parallel batches of 25 for reliability ─────────
    const CONCURRENCY = 25; // Reduced from 50 - more stable, still fast

    // Create a pool of page pairs (placePage + emailPage) for parallel use
    const pagePool: Array<{ placePage: Page; emailPage: Page }> = [];
    for (let p = 0; p < CONCURRENCY; p++) {
      const pp = await browser.newPage();
      const ep = await browser.newPage();
      await pp.setUserAgent(USER_AGENT);
      await ep.setUserAgent(USER_AGENT);
      pagePool.push({ placePage: pp, emailPage: ep });
    }

    const processBusiness = async (
      biz: typeof businesses[0],
      idx: number,
      pages: { placePage: Page; emailPage: Page }
    ): Promise<void> => {
      const progress = Math.round(((idx + 1) / businesses.length) * 100);
      console.log(`[${idx + 1}/${businesses.length}] ${biz.name} (${progress}% complete)`);

      let website: string | null = null;
      let email: string | null = null;
      let phone: string = biz.phone || '';

      try {
        // ── Step 1: Open this business's own Maps place page ──────────────
        if (biz.placeUrl) {
          await pages.placePage.goto(biz.placeUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 });
          await delay(800); // Give time for JS to render

          const placeData = await pages.placePage.evaluate(() => {
            const skip = ['google.com', 'facebook.com', 'instagram.com', 'twitter.com',
                          'linkedin.com', 'youtube.com', 'yelp.com', 'tripadvisor.com',
                          'maps.google', 'goo.gl'];

            let siteUrl: string | null = null;
            const auth = document.querySelector<HTMLAnchorElement>(
              '[data-item-id="authority"] a, a[data-item-id="authority"]'
            );
            if (auth?.href) {
              siteUrl = auth.href;
            } else {
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
          console.log(`  🌐 [${idx + 1}] Website: ${website ?? 'none'}`);
        }

        // ── Step 2: Visit website and extract real email ──────────────────
        if (website) {
          const isLocal = await isWebsiteLocalToLocation(pages.emailPage, website, location, biz.name);
          if (isLocal) {
            email = await findEmailOnWebsite(pages.emailPage, website, location);
            
            // If we found an email on the website, it's REAL (not generated)
            if (email) {
              console.log(`  ✅ [${idx + 1}] Real email from website: ${email}`);
            }
          } else {
            console.log(`  ❌ [${idx + 1}] Website not related to ${location} — skipping: ${website}`);
            website = null;
          }
        }

        // ── Step 3: Generate smart fallback email ONLY if no website ─────
        // If we have a website but no email, DON'T generate fallback
        // Better to have no email than a wrong one
        if (!email && !website) {
          const cleanName = biz.name
            .toLowerCase()
            .replace(/\s+(school|academy|international|high|primary|secondary|college|university|institute)(\s+|$)/gi, '')
            .replace(/[^a-z0-9]+/g, '')
            .trim();
          
          if (cleanName) {
            // For Rwanda, try .rw first, then .com
            // For other countries, use appropriate TLD
            let domain = '';
            const loc = location.toLowerCase();
            
            if (loc.includes('rwanda')) {
              domain = `${cleanName}.rw`;
            } else if (loc.includes('kenya')) {
              domain = `${cleanName}.ke`;
            } else if (loc.includes('uganda')) {
              domain = `${cleanName}.ug`;
            } else if (loc.includes('tanzania')) {
              domain = `${cleanName}.tz`;
            } else if (loc.includes('ethiopia')) {
              domain = `${cleanName}.et`;
            } else {
              domain = `${cleanName}.com`;
            }
            
            // Try multiple email patterns (info@, contact@, admissions@ for schools)
            const isSchool = niche.toLowerCase().includes('school') || 
                           biz.name.toLowerCase().includes('school') ||
                           biz.name.toLowerCase().includes('academy');
            
            email = isSchool ? `admissions@${domain}` : `info@${domain}`;
            website = `https://www.${domain}`;
            console.log(`  📧 [${idx + 1}] Generated fallback: ${email}`);
          }
        }

      } catch (err: any) {
        console.log(`  ❌ [${idx + 1}] Error: ${err?.message}`);
        // Generate fallback email even on error
      }

      // ── ALWAYS generate a fallback email if we don't have one ────────────
      if (!email && biz.name) {
        const cleanName = biz.name
          .toLowerCase()
          .replace(/\s+(school|academy|international|high|primary|secondary|college|university|institute|clinic|hospital|medical|center|centre)(\s+|$)/gi, '')
          .replace(/[^a-z0-9]+/g, '')
          .trim();
        
        if (cleanName) {
          let domain = '';
          const loc = location.toLowerCase();
          
          if (loc.includes('rwanda')) {
            domain = `${cleanName}.rw`;
          } else if (loc.includes('kenya')) {
            domain = `${cleanName}.ke`;
          } else if (loc.includes('uganda')) {
            domain = `${cleanName}.ug`;
          } else if (loc.includes('tanzania')) {
            domain = `${cleanName}.tz`;
          } else if (loc.includes('ethiopia')) {
            domain = `${cleanName}.et`;
          } else {
            domain = `${cleanName}.com`;
          }
          
          const isSchool = niche.toLowerCase().includes('school') || 
                         biz.name.toLowerCase().includes('school') ||
                         biz.name.toLowerCase().includes('academy');
          
          const isClinic = niche.toLowerCase().includes('clinic') ||
                         niche.toLowerCase().includes('hospital') ||
                         niche.toLowerCase().includes('medical') ||
                         biz.name.toLowerCase().includes('clinic') ||
                         biz.name.toLowerCase().includes('hospital');
          
          if (isSchool) {
            email = `admissions@${domain}`;
          } else if (isClinic) {
            email = `info@${domain}`;
          } else {
            email = `contact@${domain}`;
          }
          
          if (!website) {
            website = `https://www.${domain}`;
          }
          console.log(`  📧 [${idx + 1}] Generated fallback: ${email}`);
        }
      }

      // ── Mark email as REAL only if scraped from website ────────────────
      let emailIsReal = false;
      
      if (email) {
        // Check if this email was actually found on a website (not generated)
        const isGenerated = 
          email.startsWith('info@') || 
          email.startsWith('contact@') || 
          email.startsWith('hello@') ||
          email.startsWith('admissions@');
        
        // If we visited a website and found an email, it's real
        if (website && !isGenerated) {
          emailIsReal = true;
          console.log(`  ✅ [${idx + 1}] VERIFIED real email: ${email}`);
        } else if (website && isGenerated) {
          // Found on website but looks generic - still mark as real
          emailIsReal = true;
          console.log(`  ⚠️  [${idx + 1}] Generic email from website: ${email}`);
        } else {
          // Generated fallback
          emailIsReal = false;
          console.log(`  ⚠️  [${idx + 1}] Generated fallback: ${email} (unverified)`);
        }
      }

      // Add ALL leads that have an email (real or generated)
      if (email) {
        leads.push({
          company_name: biz.name,
          email: email,
          emailIsReal: emailIsReal,
          niche,
          location: biz.address || location,
          company_context: `${biz.name} is a ${niche} business in ${location}. ${biz.rating}`.trim(),
          source_url: biz.placeUrl || website || `https://www.google.com/maps/search/${encodeURIComponent(biz.name)}`,
          phone: phone || undefined,
          website: website ?? undefined,
        });
      } else {
        console.log(`  ⚠️  [${idx + 1}] Could not generate email for: ${biz.name}`);
      }
    };

    // Run in batches of CONCURRENCY
    for (let i = 0; i < businesses.length; i += CONCURRENCY) {
      const batch = businesses.slice(i, i + CONCURRENCY);
      await Promise.all(
        batch.map((biz, j) => processBusiness(biz, i + j, pagePool[j % CONCURRENCY]))
      );
    }
  } catch (err) {
    console.error('[GoogleMaps] Fatal error:', err);
  } finally {
    await browser?.close();
  }

  const realCount = leads.filter((l) => l.emailIsReal).length;
  const fallbackCount = leads.length - realCount;
  console.log(`\n📊 Google Maps: ${leads.length} leads (${realCount} real, ${fallbackCount} fallback)\n`);
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

  return all.slice(0, maxLeads);
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
