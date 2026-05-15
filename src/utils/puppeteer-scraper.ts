/**
 * Lead Scraper — No API keys required.
 *
 * HOW IT WORKS:
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. Google Maps (Puppeteer) — best quality, has phone/address/website
 *    Uses stealth mode + waits for real page load
 *
 * 2. Bing Search (HTTP fetch) — no bot detection, returns business listings
 *    Searches: "niche location email contact" → extracts emails from snippets
 *
 * 3. DuckDuckGo (HTTP fetch) — no bot detection
 *    Multiple query variations to find businesses with emails
 *
 * 4. Business directories (HTTP fetch) — Yelp, YellowPages, BBB
 *    Extracts business names + websites, then fetches emails from those sites
 *
 * 5. Email guessing — for businesses with a website but no visible email
 *    Generates info@, contact@, hello@ patterns from the domain
 *
 * WHY THIS GETS MORE RESULTS:
 * - All sources run in parallel
 * - Every business is returned (verified email OR guessed fallback)
 * - No single point of failure — if Maps is blocked, Bing + DDG fill the gap
 * ─────────────────────────────────────────────────────────────────────────────
 */

import puppeteer, { Browser, Page } from 'puppeteer';
import { guessAndVerifyEmails } from './email-guesser';

// ─── Types ────────────────────────────────────────────────────────────────────

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

const BLOCKED_DOMAINS = ['example.com','example.org','sentry.io','wixpress.com',
  'squarespace.com','wordpress.com','localhost','w3.org','schema.org',
  'google.com','bing.com','yahoo.com','duckduckgo.com'];
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

function guessedEmail(name: string, website?: string | null): string {
  if (website) {
    try { return `info@${new URL(website).hostname.replace('www.','')}` } catch {}
  }
  return `info@${name.toLowerCase().replace(/[^a-z0-9]/g,'')}.com`;
}

function delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ─── HTTP email fetcher ───────────────────────────────────────────────────────

async function fetchEmailFromSite(website: string): Promise<string | null> {
  if (!website.startsWith('http')) website = `https://${website}`;
  let origin = '';
  try { origin = new URL(website).origin; } catch { return null; }

  const urls = [`${origin}/contact`, `${origin}/contact-us`, `${origin}/about`, website];
  const headers = { 'User-Agent': randomUA(), 'Accept': 'text/html', 'Accept-Language': 'en-US,en;q=0.9' };

  for (const url of urls) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(7_000) });
      if (!res.ok) continue;
      let html = await res.text();

      // Decode obfuscation
      html = html
        .replace(/\s*\[at\]\s*/gi,'@').replace(/\s*\(at\)\s*/gi,'@')
        .replace(/\s*\[dot\]\s*/gi,'.').replace(/\s*\(dot\)\s*/gi,'.');

      // Cloudflare decode
      const cfRe = /data-cfemail="([0-9a-f]+)"/gi;
      let m: RegExpExecArray | null;
      while ((m = cfRe.exec(html)) !== null) {
        const bytes = (m[1]??'').match(/.{2}/g)??[];
        if (bytes.length < 2) continue;
        const key = parseInt(bytes[0]??'0',16);
        const dec = bytes.slice(1).map((b:string)=>String.fromCharCode(parseInt(b,16)^key)).join('');
        if (dec.includes('@')) html += ` ${dec}`;
      }

      // mailto links
      const mailtos: string[] = [];
      const mr = /mailto:([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/gi;
      while ((m = mr.exec(html)) !== null) mailtos.push(m[1].toLowerCase());

      const found = bestEmail([...mailtos, ...extractEmails(html)]);
      if (found) return found;
    } catch {}
  }
  return null;
}

// ─── HTTP search helpers ──────────────────────────────────────────────────────

async function httpGet(url: string, ua?: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': ua ?? randomUA(),
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// ─── Source 1: Bing Search (no bot detection) ─────────────────────────────────

async function scrapeBing(
  niche: string, location: string, needed: number,
  seen: Set<string>, onLead: (l: ScrapedLead) => void
): Promise<ScrapedLead[]> {
  const leads: ScrapedLead[] = [];

  const queries = [
    `${niche} ${location} email contact site:*.com`,
    `"${niche}" "${location}" email`,
    `${niche} company ${location} contact us email`,
    `list of ${niche} businesses in ${location} email`,
    `${niche} ${location} "@gmail.com" OR "@yahoo.com" OR "@outlook.com"`,
    `${niche} ${location} "contact@" OR "info@" OR "hello@"`,
    `${niche} services ${location} email address`,
    `top ${niche} ${location} website email`,
  ];

  for (const query of queries) {
    if (leads.length >= needed) break;
    try {
      console.log(`  🔵 Bing: ${query}`);
      const html = await httpGet(`https://www.bing.com/search?q=${encodeURIComponent(query)}&count=50`);

      // Decode obfuscation in Bing results
      const decoded = html
        .replace(/\s*\[at\]\s*/gi,'@').replace(/\s*\(at\)\s*/gi,'@')
        .replace(/\s*\[dot\]\s*/gi,'.').replace(/\s*\(dot\)\s*/gi,'.');

      // Extract result blocks
      const blocks = decoded.match(/<li[^>]*class="[^"]*b_algo[^"]*"[^>]*>[\s\S]*?<\/li>/gi) ?? [];

      for (const block of blocks) {
        if (leads.length >= needed) break;

        // Get title
        const titleMatch = block.match(/<h2[^>]*>.*?<a[^>]*>(.*?)<\/a>/i);
        const name = titleMatch?.[1]?.replace(/<[^>]+>/g,'').trim() ?? '';
        if (!name || name.length < 3) continue;

        const cleanName = name.replace(/\s*[-|–|·].*$/,'').trim();
        if (seen.has(cleanName.toLowerCase())) continue;

        // Get URL
        const urlMatch = block.match(/href="(https?:\/\/[^"]+)"/i);
        const url = urlMatch?.[1] ?? '';

        // Get snippet
        const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
        const snippet = snippetMatch?.[1]?.replace(/<[^>]+>/g,'').trim() ?? '';

        // Check snippet for email first
        const snippetEmails = extractEmails(snippet + ' ' + block);
        let email = bestEmail(snippetEmails);

        // Fetch website if no email in snippet
        const skipDomains = ['bing.com','microsoft.com','facebook.com','linkedin.com',
                             'twitter.com','instagram.com','youtube.com','wikipedia.org'];
        if (!email && url && !skipDomains.some(s => url.includes(s))) {
          try { email = await fetchEmailFromSite(url); } catch {}
        }

        // Guess from domain if still nothing
        if (!email && url) {
          try {
            const guesses = await guessAndVerifyEmails(url, { companyName: cleanName, location, maxGuesses: 2, smtpVerify: false });
            if (guesses[0]) email = guesses[0].email;
          } catch {}
        }

        seen.add(cleanName.toLowerCase());
        const hasReal = !!email && !email.startsWith('info@') || (!!email && extractEmails(snippet).length > 0);
        const finalEmail = email ?? guessedEmail(cleanName, url);

        const lead: ScrapedLead = {
          company_name: cleanName,
          email: finalEmail,
          emailIsReal: !!email,
          niche, location,
          company_context: snippet || `${cleanName} is a ${niche} in ${location}.`,
          source_url: url,
          website: url || undefined,
        };
        leads.push(lead);
        onLead(lead);
        console.log(`    ${!!email ? '✅' : '⚠️ '} ${cleanName} → ${finalEmail}`);
      }

      await delay(600);
    } catch (err: any) {
      console.log(`  ⚠️  Bing query failed: ${err?.message?.slice(0,60)}`);
    }
  }

  return leads;
}

// ─── Source 2: DuckDuckGo (no bot detection) ──────────────────────────────────

async function scrapeDDG(
  niche: string, location: string, needed: number,
  seen: Set<string>, onLead: (l: ScrapedLead) => void
): Promise<ScrapedLead[]> {
  const leads: ScrapedLead[] = [];

  const queries = [
    `${niche} ${location} contact email`,
    `"${niche}" "${location}" email address`,
    `${niche} business ${location} "contact us"`,
    `${niche} ${location} site:yellowpages.com OR site:yelp.com`,
    `${niche} ${location} "@gmail.com" OR "@yahoo.com"`,
    `${niche} company ${location} official website`,
  ];

  for (const query of queries) {
    if (leads.length >= needed) break;
    try {
      console.log(`  🦆 DDG: ${query}`);
      const html = await httpGet(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`);

      const decoded = html
        .replace(/\s*\[at\]\s*/gi,'@').replace(/\s*\(at\)\s*/gi,'@')
        .replace(/\s*\[dot\]\s*/gi,'.').replace(/\s*\(dot\)\s*/gi,'.');

      // DDG result blocks
      const blocks = decoded.match(/<div class="result[^"]*"[\s\S]*?<\/div>\s*<\/div>/gi) ?? [];

      for (const block of blocks) {
        if (leads.length >= needed) break;

        const titleMatch = block.match(/class="result__title"[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i);
        const name = titleMatch?.[1]?.replace(/<[^>]+>/g,'').trim() ?? '';
        if (!name || name.length < 3) continue;

        const cleanName = name.replace(/\s*[-|–|·].*$/,'').trim();
        if (seen.has(cleanName.toLowerCase())) continue;

        const urlMatch = block.match(/class="result__url"[^>]*>([\s\S]*?)<\/a>/i);
        const rawUrl = urlMatch?.[1]?.replace(/<[^>]+>/g,'').trim() ?? '';
        const url = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;

        const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/span>/i);
        const snippet = snippetMatch?.[1]?.replace(/<[^>]+>/g,'').trim() ?? '';

        const snippetEmails = extractEmails(snippet + ' ' + block);
        let email = bestEmail(snippetEmails);

        const skipDomains = ['duckduckgo.com','facebook.com','linkedin.com','twitter.com',
                             'instagram.com','youtube.com','wikipedia.org'];
        if (!email && url && !skipDomains.some(s => url.includes(s))) {
          try { email = await fetchEmailFromSite(url); } catch {}
        }

        if (!email && url) {
          try {
            const guesses = await guessAndVerifyEmails(url, { companyName: cleanName, location, maxGuesses: 2, smtpVerify: false });
            if (guesses[0]) email = guesses[0].email;
          } catch {}
        }

        seen.add(cleanName.toLowerCase());
        const finalEmail = email ?? guessedEmail(cleanName, url);

        const lead: ScrapedLead = {
          company_name: cleanName,
          email: finalEmail,
          emailIsReal: !!email,
          niche, location,
          company_context: snippet || `${cleanName} is a ${niche} in ${location}.`,
          source_url: url,
          website: url || undefined,
        };
        leads.push(lead);
        onLead(lead);
        console.log(`    ${!!email ? '✅' : '⚠️ '} ${cleanName} → ${finalEmail}`);
      }

      await delay(500);
    } catch (err: any) {
      console.log(`  ⚠️  DDG query failed: ${err?.message?.slice(0,60)}`);
    }
  }

  return leads;
}

// ─── Source 3: Google Maps (Puppeteer) ───────────────────────────────────────

async function scrapeGoogleMaps(
  niche: string, location: string, maxResults: number,
  seen: Set<string>, onLead: (l: ScrapedLead) => void
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
      console.log('  ⚠️  Maps blocked — skipping');
      return [];
    }

    // Scroll to load listings
    let prev = 0, stale = 0;
    for (let i = 0; i < Math.min(Math.ceil(maxResults / 5) + 5, 40); i++) {
      await page.evaluate(() => {
        const f = document.querySelector('[role="feed"]');
        if (f) f.scrollTop = f.scrollHeight;
      });
      await delay(1200);
      const count = await page.evaluate(() => document.querySelectorAll('[role="article"]').length);
      if (count >= maxResults) break;
      if (count === prev) { if (++stale >= 3) break; } else stale = 0;
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

    // Process in parallel batches of 6
    for (let i = 0; i < businesses.length; i += 6) {
      const batch = businesses.slice(i, i + 6);
      await Promise.all(batch.map(async (biz: any) => {
        if (seen.has(biz.name.toLowerCase())) return;

        let website: string | null = null;
        let phone = biz.phone;

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
                  if (a.href.startsWith('http') && !skip.some(s => a.href.includes(s))) { site = a.href; break; }
                }
              }
              const tel = document.querySelector<HTMLAnchorElement>('a[href^="tel:"]');
              return { site, tel: tel?.textContent?.trim() ?? '' };
            });
            website = d.site;
            if (d.tel) phone = d.tel;
          } finally { await p.close().catch(() => {}); }
        } catch {}

        let email: string | null = null;
        if (website) { try { email = await fetchEmailFromSite(website); } catch {} }
        if (!email) {
          try {
            const guesses = await guessAndVerifyEmails(website ?? null, { companyName: biz.name, location, maxGuesses: 3, smtpVerify: false });
            if (guesses[0]) email = guesses[0].email;
          } catch {}
        }

        seen.add(biz.name.toLowerCase());
        const finalEmail = email ?? guessedEmail(biz.name, website);
        const lead: ScrapedLead = {
          company_name: biz.name,
          email: finalEmail,
          emailIsReal: !!email,
          niche,
          location: biz.address || location,
          company_context: `${biz.name} is a ${niche} in ${location}. ${biz.rating}`.trim(),
          source_url: biz.placeUrl || website || '',
          phone: phone || undefined,
          website: website || undefined,
        };
        leads.push(lead);
        onLead(lead);
        console.log(`  ${!!email ? '✅' : '⚠️ '} ${biz.name} → ${finalEmail}`);
      }));
    }

  } catch (err) {
    console.error('[Maps] Error:', err);
  } finally {
    await browser?.close();
  }

  return leads;
}

// ─── Source 4: Directory scraper (Yelp, YP, BBB) ─────────────────────────────

async function scrapeDirectories(
  niche: string, location: string, needed: number,
  seen: Set<string>, onLead: (l: ScrapedLead) => void
): Promise<ScrapedLead[]> {
  const leads: ScrapedLead[] = [];

  const sources = [
    // Yellow Pages
    `https://www.yellowpages.com/search?search_terms=${encodeURIComponent(niche)}&geo_location_terms=${encodeURIComponent(location)}`,
    // Yelp
    `https://www.yelp.com/search?find_desc=${encodeURIComponent(niche)}&find_loc=${encodeURIComponent(location)}`,
    // BBB
    `https://www.bbb.org/search?find_text=${encodeURIComponent(niche)}&find_loc=${encodeURIComponent(location)}`,
    // Hotfrog
    `https://www.hotfrog.com/search/${encodeURIComponent(location)}/${encodeURIComponent(niche)}`,
  ];

  for (const url of sources) {
    if (leads.length >= needed) break;
    try {
      console.log(`  📒 Directory: ${url.split('?')[0]}`);
      const html = await httpGet(url);

      // Extract business names and websites from directory pages
      // Generic patterns that work across most directories
      const namePatterns = [
        /<h\d[^>]*class="[^"]*(?:business|company|name|title)[^"]*"[^>]*>([\s\S]*?)<\/h\d>/gi,
        /<a[^>]*class="[^"]*(?:business-name|company-name|biz-name)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi,
        /<span[^>]*class="[^"]*(?:business-name|company-name)[^"]*"[^>]*>([\s\S]*?)<\/span>/gi,
      ];

      const names: string[] = [];
      for (const pattern of namePatterns) {
        let m: RegExpExecArray | null;
        while ((m = pattern.exec(html)) !== null) {
          const n = m[1].replace(/<[^>]+>/g,'').trim();
          if (n && n.length > 2 && n.length < 100) names.push(n);
        }
      }

      // Also extract any emails directly from the page
      const pageEmails = extractEmails(html);

      for (let i = 0; i < Math.min(names.length, needed - leads.length); i++) {
        const name = names[i];
        if (seen.has(name.toLowerCase())) continue;
        seen.add(name.toLowerCase());

        const email = bestEmail(pageEmails) ?? null;
        const finalEmail = email ?? guessedEmail(name);

        const lead: ScrapedLead = {
          company_name: name,
          email: finalEmail,
          emailIsReal: !!email,
          niche, location,
          company_context: `${name} is a ${niche} in ${location}.`,
          source_url: url,
        };
        leads.push(lead);
        onLead(lead);
      }

      await delay(800);
    } catch (err: any) {
      console.log(`  ⚠️  Directory failed: ${err?.message?.slice(0,60)}`);
    }
  }

  return leads;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function scrapeWithoutAPI(
  niche: string,
  location: string,
  maxLeads = 100,
  onLead?: (lead: ScrapedLead) => void
): Promise<ScrapedLead[]> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🚀 Scraping: "${niche}" in "${location}" (target: ${maxLeads})`);
  console.log(`${'='.repeat(60)}\n`);

  const all: ScrapedLead[] = [];
  const seen = new Set<string>();
  const emit = (lead: ScrapedLead) => { all.push(lead); onLead?.(lead); };

  // Run all sources in parallel for maximum speed
  const chunkSize = Math.ceil(maxLeads / 3);

  const [mapsLeads, bingLeads, ddgLeads, dirLeads] = await Promise.allSettled([
    scrapeGoogleMaps(niche, location, chunkSize, seen, emit),
    scrapeBing(niche, location, chunkSize, seen, emit),
    scrapeDDG(niche, location, chunkSize, seen, emit),
    scrapeDirectories(niche, location, Math.ceil(maxLeads / 4), seen, emit),
  ]);

  const counts = {
    maps: mapsLeads.status === 'fulfilled' ? mapsLeads.value.length : 0,
    bing: bingLeads.status === 'fulfilled' ? bingLeads.value.length : 0,
    ddg: ddgLeads.status === 'fulfilled' ? ddgLeads.value.length : 0,
    dir: dirLeads.status === 'fulfilled' ? dirLeads.value.length : 0,
  };

  const realCount = all.filter(l => l.emailIsReal).length;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`📊 Results: ${all.length} leads | Maps:${counts.maps} Bing:${counts.bing} DDG:${counts.ddg} Dir:${counts.dir}`);
  console.log(`   Verified emails: ${realCount} | Guessed: ${all.length - realCount}`);
  console.log(`${'='.repeat(60)}\n`);

  // Deduplicate by company name
  const deduped = Array.from(
    new Map(all.map(l => [l.company_name.toLowerCase(), l])).values()
  );

  return deduped.slice(0, maxLeads);
}

// Keep scrapeGoogleMaps exported for direct use
export { scrapeGoogleMaps };
