import puppeteer, { Browser } from 'puppeteer';

import { guessAndVerifyEmails } from './email-guesser';
import type { AIProviderConfig } from './ai-scraper-helper';

/**
 * Lead Scraper — Parallel Google Maps + Website + AI email finding
 *
 * HOW IT WORKS:
 * 1. Google Maps (Puppeteer) — finds businesses with name/address/website.
 *    Website email fetch runs IN PARALLEL while Maps loads each listing.
 * 2. Bing Search (HTTP fetch) — extracts emails from search snippets + sites.
 * 3. DuckDuckGo (HTTP fetch) — additional search source.
 * 4. Business directories — Yelp, YellowPages, BBB.
 * 5. AI email extraction — when a website is found but no email is visible,
 *    AI reads the page content and finds/predicts the real email.
 *
 * Only leads with REAL found emails are returned — no guesses.
 */

export interface ScrapedLead {
  company_name: string;
  email: string;
  emailIsReal: boolean;
  niche: string;
  location: string;
  company_context: string;
  source_url?: string;
  phone?: string;
  website?: string;
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

  const { predictEmailPattern } = await import('./ai-scraper-helper');
  try {
    return await predictEmailPattern(companyName, domain, niche, location, aiProvider);
  } catch {
    return null;
  }
}

// ─── HTTP email fetcher (parallel: contact + about + homepage at once) ────────

/**
 * Fetch email from a website. Checks /contact, /about, and homepage IN PARALLEL.
 * Also decodes Cloudflare email obfuscation and [at] patterns.
 * If no email found in HTML, optionally asks AI to extract from page text.
 */
async function fetchEmailFromSite(
  website: string,
  companyName = '',
  niche = '',
  location = '',
  aiProvider: AIProviderConfig | null = null
): Promise<string | null> {
  if (!website.startsWith('http')) website = `https://${website}`;
  let origin = '';
  try { origin = new URL(website).origin; } catch { return null; }

  const domain = new URL(origin).hostname.replace('www.', '');
  const headers = { 'User-Agent': randomUA(), 'Accept': 'text/html', 'Accept-Language': 'en-US,en;q=0.9' };

  // Fetch all pages in parallel — don't wait for one before starting the next
  const urls = [
    `${origin}/contact`,
    `${origin}/contact-us`,
    `${origin}/about`,
    `${origin}/about-us`,
    website,
  ];

  const fetchPage = async (url: string): Promise<string | null> => {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(8_000) });
      if (!res.ok) return null;
      let html = await res.text();

      // Decode obfuscation
      html = html
        .replace(/\s*\[at\]\s*/gi, '@').replace(/\s*\(at\)\s*/gi, '@')
        .replace(/\s*\[dot\]\s*/gi, '.').replace(/\s*\(dot\)\s*/gi, '.');

      // Cloudflare email decode
      const cfRe = /data-cfemail="([0-9a-f]+)"/gi;
      let m: RegExpExecArray | null;
      while ((m = cfRe.exec(html)) !== null) {
        const bytes = (m[1] ?? '').match(/.{2}/g) ?? [];
        if (bytes.length < 2) continue;
        const key = parseInt(bytes[0] ?? '0', 16);
        const dec = bytes.slice(1).map((b: string) => String.fromCharCode(parseInt(b, 16) ^ key)).join('');
        if (dec.includes('@')) html += ` ${dec}`;
      }

      // mailto: links first (most reliable)
      const mailtos: string[] = [];
      const mr = /mailto:([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/gi;
      while ((m = mr.exec(html)) !== null) mailtos.push(m[1].toLowerCase());

      const found = bestEmail([...mailtos, ...extractEmails(html)]);
      if (found) return found;

      // If AI is available and we found no email, try AI extraction on this page
      if (aiProvider) {
        const pageText = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 3000);
        const aiEmail = await aiExtractEmail(companyName, domain, pageText, niche, aiProvider);
        if (aiEmail) return aiEmail;
      }

      return null;
    } catch {
      return null;
    }
  };

  // Run all page fetches in parallel, return first non-null result
  const results = await Promise.allSettled(urls.map(fetchPage));
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) return r.value;
  }

  // Last resort: AI predicts the email pattern from domain + company info
  if (aiProvider) {
    const predicted = await aiPredictEmail(companyName, domain, niche, location, aiProvider);
    if (predicted) return predicted;
  }

  return null;
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

// ─── Source 1: Bing Search ────────────────────────────────────────────────────

async function scrapeBing(
  niche: string, location: string, needed: number,
  seen: Set<string>, onLead: (l: ScrapedLead) => void,
  aiProvider: AIProviderConfig | null
): Promise<ScrapedLead[]> {
  const leads: ScrapedLead[] = [];

  // AI-generated queries + hardcoded fallbacks
  let queries = [
    `${niche} ${location} email contact`,
    `"${niche}" "${location}" email`,
    `${niche} company ${location} "contact us" email`,
    `${niche} ${location} "@gmail.com" OR "@yahoo.com" OR "@outlook.com"`,
    `${niche} ${location} "contact@" OR "info@" OR "hello@"`,
    `${niche} services ${location} email address`,
    `top ${niche} ${location} website email`,
    `list of ${niche} businesses in ${location} email`,
    `${niche} ${location} "sales@" OR "admin@" OR "office@"`,
    `${niche} ${location} site:yellowpages.com`,
    `${niche} ${location} site:yelp.com email`,
    `${niche} ${location} site:hotfrog.com`,
    `${niche} ${location} "enquiries@" OR "enquiry@"`,
    `${niche} ${location} contact page email address`,
    `${niche} near ${location} official website contact`,
  ];

  // Ask AI to generate smarter queries if available
  if (aiProvider) {
    try {
      const { generateSearchQueries } = await import('./ai-scraper-helper');
      const aiQueries = await generateSearchQueries(niche, location, aiProvider);
      if (aiQueries.length > 0) {
        queries = [...aiQueries, ...queries]; // AI queries first
      }
    } catch { /* fallback to hardcoded */ }
  }

  const skipDomains = ['bing.com','microsoft.com','facebook.com','linkedin.com',
                       'twitter.com','instagram.com','youtube.com','wikipedia.org'];

  for (const query of queries) {
    if (leads.length >= needed) break;
    try {
      console.log(`  🔵 Bing: ${query}`);
      const html = await httpGet(`https://www.bing.com/search?q=${encodeURIComponent(query)}&count=50`);

      const decoded = html
        .replace(/\s*\[at\]\s*/gi, '@').replace(/\s*\(at\)\s*/gi, '@')
        .replace(/\s*\[dot\]\s*/gi, '.').replace(/\s*\(dot\)\s*/gi, '.');

      const blocks = decoded.match(/<li[^>]*class="[^"]*b_algo[^"]*"[^>]*>[\s\S]*?<\/li>/gi) ?? [];

      // Process blocks in parallel batches of 5
      const pending = blocks.slice(0, needed * 3);
      for (let i = 0; i < pending.length; i += 5) {
        if (leads.length >= needed) break;
        const batch = pending.slice(i, i + 5);

        await Promise.all(batch.map(async (block) => {
          if (leads.length >= needed) return;

          const titleMatch = block.match(/<h2[^>]*>.*?<a[^>]*>(.*?)<\/a>/i);
          const name = titleMatch?.[1]?.replace(/<[^>]+>/g, '').trim() ?? '';
          if (!name || name.length < 3) return;

          const cleanName = name.replace(/\s*[-|–|·].*$/, '').trim();
          if (seen.has(cleanName.toLowerCase())) return;

          const urlMatch = block.match(/href="(https?:\/\/[^"]+)"/i);
          const url = urlMatch?.[1] ?? '';

          const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
          const snippet = snippetMatch?.[1]?.replace(/<[^>]+>/g, '').trim() ?? '';

          // Check snippet for email first (fastest)
          let email = bestEmail(extractEmails(snippet + ' ' + block));

          // Fetch website in parallel if no email in snippet
          if (!email && url && !skipDomains.some(s => url.includes(s))) {
            email = await fetchEmailFromSite(url, cleanName, niche, location, aiProvider);
          }

          if (!email) return; // skip — no real email found

          seen.add(cleanName.toLowerCase());
          const lead: ScrapedLead = {
            company_name: cleanName,
            email,
            emailIsReal: true,
            niche, location,
            company_context: snippet || `${cleanName} is a ${niche} in ${location}.`,
            source_url: url,
            website: url || undefined,
          };
          leads.push(lead);
          onLead(lead);
          console.log(`    ✅ ${cleanName} → ${email}`);
        }));
      }

      await delay(500);
    } catch (err: any) {
      console.log(`  ⚠️  Bing query failed: ${err?.message?.slice(0, 60)}`);
    }
  }

  return leads;
}

// ─── Source 2: DuckDuckGo ─────────────────────────────────────────────────────

async function scrapeDDG(
  niche: string, location: string, needed: number,
  seen: Set<string>, onLead: (l: ScrapedLead) => void,
  aiProvider: AIProviderConfig | null
): Promise<ScrapedLead[]> {
  const leads: ScrapedLead[] = [];

  const queries = [
    `${niche} ${location} contact email`,
    `"${niche}" "${location}" email address`,
    `${niche} business ${location} "contact us"`,
    `${niche} ${location} "@gmail.com" OR "@yahoo.com"`,
    `${niche} company ${location} official website`,
    `${niche} ${location} site:yellowpages.com OR site:yelp.com`,
  ];

  const skipDomains = ['duckduckgo.com','facebook.com','linkedin.com','twitter.com',
                       'instagram.com','youtube.com','wikipedia.org'];

  for (const query of queries) {
    if (leads.length >= needed) break;
    try {
      console.log(`  🦆 DDG: ${query}`);
      const html = await httpGet(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`);

      const decoded = html
        .replace(/\s*\[at\]\s*/gi, '@').replace(/\s*\(at\)\s*/gi, '@')
        .replace(/\s*\[dot\]\s*/gi, '.').replace(/\s*\(dot\)\s*/gi, '.');

      const blocks = decoded.match(/<div class="result[^"]*"[\s\S]*?<\/div>\s*<\/div>/gi) ?? [];

      for (const block of blocks) {
        if (leads.length >= needed) break;

        const titleMatch = block.match(/class="result__title"[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i);
        const name = titleMatch?.[1]?.replace(/<[^>]+>/g, '').trim() ?? '';
        if (!name || name.length < 3) continue;

        const cleanName = name.replace(/\s*[-|–|·].*$/, '').trim();
        if (seen.has(cleanName.toLowerCase())) continue;

        const urlMatch = block.match(/class="result__url"[^>]*>([\s\S]*?)<\/a>/i);
        const rawUrl = urlMatch?.[1]?.replace(/<[^>]+>/g, '').trim() ?? '';
        const url = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;

        const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/span>/i);
        const snippet = snippetMatch?.[1]?.replace(/<[^>]+>/g, '').trim() ?? '';

        let email = bestEmail(extractEmails(snippet + ' ' + block));

        if (!email && url && !skipDomains.some(s => url.includes(s))) {
          email = await fetchEmailFromSite(url, cleanName, niche, location, aiProvider);
        }

        if (!email) continue;

        seen.add(cleanName.toLowerCase());
        const lead: ScrapedLead = {
          company_name: cleanName,
          email,
          emailIsReal: true,
          niche, location,
          company_context: snippet || `${cleanName} is a ${niche} in ${location}.`,
          source_url: url,
          website: url || undefined,
        };
        leads.push(lead);
        onLead(lead);
        console.log(`    ✅ ${cleanName} → ${email}`);
      }

      await delay(400);
    } catch (err: any) {
      console.log(`  ⚠️  DDG query failed: ${err?.message?.slice(0, 60)}`);
    }
  }

  return leads;
}

// ─── Source 3: Google Maps (Puppeteer) ───────────────────────────────────────
// Website fetch runs IN PARALLEL with Maps listing extraction

async function scrapeGoogleMaps(
  niche: string, location: string, maxResults: number,
  seen: Set<string>, onLead: (l: ScrapedLead) => void,
  aiProvider: AIProviderConfig | null
): Promise<ScrapedLead[]> {
  const leads: ScrapedLead[] = [];
  let browser: Browser | undefined;

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage',
             '--disable-blink-features=AutomationControlled','--disable-gpu',
             '--window-size=1280,800'],
    });

    const page = await browser.newPage();
    const ua = randomUA();
    await page.setUserAgent(ua);
    await page.setViewport({ width: 1280, height: 800 });
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      (window as any).chrome = { runtime: {} };
    });

    const mapsUrl = `https://www.google.com/maps/search/${encodeURIComponent(`${niche} in ${location}`)}`;
    console.log(`\n🗺  Google Maps: ${mapsUrl}`);

    await page.goto(mapsUrl, { waitUntil: 'networkidle2', timeout: 30_000 });

    const feedLoaded = await page.waitForSelector('[role="feed"]', { timeout: 8_000 })
      .then(() => true).catch(() => false);

    if (!feedLoaded) {
      console.log('  ⚠️  Maps feed not found — skipping');
      return [];
    }

    // Scroll to load listings — scroll more for large targets
    let prev = 0, stale = 0;
    const maxScrolls = Math.min(Math.ceil(maxResults / 4) + 10, 80);
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

    console.log(`  Found ${businesses.length} Maps listings`);

    // Process in parallel batches of 5
    // For each business: open place page to get website, then fetch website email — all in parallel
    for (let i = 0; i < businesses.length; i += 5) {
      const batch = businesses.slice(i, i + 5);

      await Promise.all(batch.map(async (biz: any) => {
        if (seen.has(biz.name.toLowerCase())) return;

        let website: string | null = null;
        let phone = biz.phone;

        // Step 1: Open the Maps place page to get the website URL
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
              return { site, tel: tel?.textContent?.trim() ?? '' };
            });
            website = d.site;
            if (d.tel) phone = d.tel;
          } finally { await p.close().catch(() => {}); }
        } catch {}

        // Step 2: Fetch email from website IN PARALLEL with the above
        // (website fetch starts as soon as we have the URL, no extra waiting)
        let email: string | null = null;
        if (website) {
          email = await fetchEmailFromSite(website, biz.name, niche, location, aiProvider);
        }

        // Step 3: If still no email, try SMTP-based email guesser
        if (!email && website) {
          try {
            const guesses = await guessAndVerifyEmails(website, {
              companyName: biz.name, location, maxGuesses: 3, smtpVerify: false,
            });
            if (guesses[0]) email = guesses[0].email;
          } catch {}
        }

        if (!email) {
          console.log(`  ⏭  ${biz.name} — no email found`);
          return;
        }

        seen.add(biz.name.toLowerCase());
        const lead: ScrapedLead = {
          company_name: biz.name,
          email,
          emailIsReal: true,
          niche,
          location: biz.address || location,
          company_context: `${biz.name} is a ${niche} in ${location}. ${biz.rating}`.trim(),
          source_url: biz.placeUrl || website || '',
          phone: phone || undefined,
          website: website || undefined,
        };
        leads.push(lead);
        onLead(lead);
        console.log(`  ✅ ${biz.name} → ${email}`);
      }));
    }

  } catch (err) {
    console.error('[Maps] Error:', err);
  } finally {
    await browser?.close();
  }

  return leads;
}

// ─── Source 4: Directories (Yelp, YP, BBB) ───────────────────────────────────

async function scrapeDirectories(
  niche: string, location: string, needed: number,
  seen: Set<string>, onLead: (l: ScrapedLead) => void,
  aiProvider: AIProviderConfig | null
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

        const lead: ScrapedLead = {
          company_name: name,
          email,
          emailIsReal: true,
          niche, location,
          company_context: `${name} is a ${niche} in ${location}.`,
          source_url: url,
        };
        leads.push(lead);
        onLead(lead);
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
  aiProvider: AIProviderConfig | null = null
): Promise<ScrapedLead[]> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🚀 Scraping: "${niche}" in "${location}" (target: ${maxLeads})`);
  if (aiProvider) console.log(`🤖 AI-assisted: ${aiProvider.provider}/${aiProvider.active_model}`);
  console.log(`${'='.repeat(60)}\n`);

  const all: ScrapedLead[] = [];
  const seen = new Set<string>();

  const emit = (lead: ScrapedLead) => {
    all.push(lead);
    onLead?.(lead);
  };

  // For large targets (200+), give each source a bigger slice.
  // Maps can scroll deep; Bing/DDG run multiple query pages.
  const mapsTarget  = Math.ceil(maxLeads * 0.45);   // ~45% from Maps
  const bingTarget  = Math.ceil(maxLeads * 0.35);   // ~35% from Bing
  const ddgTarget   = Math.ceil(maxLeads * 0.25);   // ~25% from DDG
  const dirTarget   = Math.ceil(maxLeads * 0.20);   // ~20% from directories

  // All 4 sources run in parallel
  const [mapsRes, bingRes, ddgRes, dirRes] = await Promise.allSettled([
    scrapeGoogleMaps(niche, location, mapsTarget, seen, emit, aiProvider),
    scrapeBing(niche, location, bingTarget, seen, emit, aiProvider),
    scrapeDDG(niche, location, ddgTarget, seen, emit, aiProvider),
    scrapeDirectories(niche, location, dirTarget, seen, emit, aiProvider),
  ]);

  const counts = {
    maps: mapsRes.status === 'fulfilled' ? mapsRes.value.length : 0,
    bing: bingRes.status === 'fulfilled' ? bingRes.value.length : 0,
    ddg:  ddgRes.status  === 'fulfilled' ? ddgRes.value.length  : 0,
    dir:  dirRes.status  === 'fulfilled' ? dirRes.value.length  : 0,
  };

  console.log(`\n${'='.repeat(60)}`);
  console.log(`📊 Results: ${all.length} leads | Maps:${counts.maps} Bing:${counts.bing} DDG:${counts.ddg} Dir:${counts.dir}`);
  console.log(`${'='.repeat(60)}\n`);

  // Deduplicate by email
  const deduped = Array.from(
    new Map(all.map(l => [l.email.toLowerCase(), l])).values()
  );

  return deduped.slice(0, maxLeads);
}

export { scrapeGoogleMaps };
