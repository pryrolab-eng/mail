/**
 * Free email finder for any domain (replaces CommonCrawl for small/regional TLDs).
 *
 * Layers: website scraper → contact paths → Bing → pattern guesser
 */

import { scrapeEmailFromWebsite } from './website-email-scraper';
import { guessAndVerifyEmails } from './email-guesser';
import { fetchBingHtml, parseBingHits } from './search-engine-fetch';

export type FreeEmailSource =
  | 'website'
  | 'contact_page'
  | 'bing_search'
  | 'guessed';

export type FreeEmailHit = {
  email: string;
  source: FreeEmailSource;
};

const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

const CONTACT_PATHS = [
  '/contact',
  '/contact-us',
  '/about',
  '/about-us',
  '/team',
  '/reach-us',
  '/get-in-touch',
  '/info',
  '/kontakt',
  '/contacto',
];

const BLOCKED_LOCAL = new Set([
  'noreply',
  'no-reply',
  'donotreply',
  'privacy',
  'example',
  'test',
  'webmaster',
  'sentry',
]);

function normalizeDomain(domain: string): string {
  return domain
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .split('/')[0]
    .toLowerCase()
    .trim();
}

function extractEmailsFromHtml(html: string, domain: string): string[] {
  const found = new Set<string>();
  for (const m of html.match(EMAIL_RE) ?? []) {
    const e = m.toLowerCase();
    const local = e.split('@')[0];
    if (BLOCKED_LOCAL.has(local) || local.includes('noreply')) continue;
    if (e.endsWith(`@${domain}`) || domain && e.includes(`@${domain}`)) {
      found.add(e);
    }
  }
  return [...found];
}

function extractAnyEmails(html: string): string[] {
  const found = new Set<string>();
  for (const m of html.match(EMAIL_RE) ?? []) {
    const e = m.toLowerCase();
    const local = e.split('@')[0];
    if (BLOCKED_LOCAL.has(local) || e.includes('example.com')) continue;
    found.add(e);
  }
  return [...found];
}

async function layerContactPages(
  domain: string
): Promise<FreeEmailHit[]> {
  const origin = `https://${domain}`;
  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    Accept: 'text/html',
  };

  for (const path of CONTACT_PATHS) {
    try {
      const res = await fetch(`${origin}${path}`, {
        headers,
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) continue;
      const html = await res.text();
      const emails = extractEmailsFromHtml(html, domain);
      if (emails.length > 0) {
        return emails.map((email) => ({ email, source: 'contact_page' as const }));
      }
    } catch {
      /* try next path */
    }
  }
  return [];
}

async function layerBingSearch(
  domain: string
): Promise<FreeEmailHit[]> {
  const query = `"${domain}" email contact`;
  try {
    const { html } = await fetchBingHtml(query, '');
    const hits = parseBingHits(html, 20);
    const blob = hits.map((h) => `${h.snippet} ${h.title}`).join(' ');
    const onDomain = extractEmailsFromHtml(blob, domain);
    if (onDomain.length > 0) {
      return onDomain.map((email) => ({
        email,
        source: 'bing_search' as const,
      }));
    }
    const any = extractAnyEmails(blob).filter((e) => e.endsWith(`@${domain}`));
    if (any.length > 0) {
      return any.map((email) => ({ email, source: 'bing_search' as const }));
    }
  } catch {
    /* best-effort */
  }
  return [];
}

async function layerGuesser(
  domain: string,
  companyName: string
): Promise<FreeEmailHit[]> {
  try {
    const guesses = await guessAndVerifyEmails(domain, {
      companyName,
      maxGuesses: 4,
      smtpVerify: true,
    });
    if (guesses.length > 0 && guesses[0].email) {
      return [{ email: guesses[0].email.toLowerCase(), source: 'guessed' }];
    }
    const patterns = ['info', 'contact', 'hello', 'admin'];
    for (const p of patterns) {
      const email = `${p}@${domain}`;
      return [{ email, source: 'guessed' }];
    }
  } catch {
    const email = `info@${domain}`;
    return [{ email, source: 'guessed' }];
  }
  return [];
}

/**
 * Find emails for a domain using free layers (no CommonCrawl).
 */
export async function findEmailsForDomain(
  domain: string,
  companyName: string
): Promise<FreeEmailHit[]> {
  const host = normalizeDomain(domain);
  if (!host || !host.includes('.')) return [];

  const seen = new Set<string>();
  const out: FreeEmailHit[] = [];

  const add = (hits: FreeEmailHit[]) => {
    for (const h of hits) {
      const key = h.email.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push(h);
      }
    }
  };

  // Layer 1 — website scraper
  const web = await scrapeEmailFromWebsite(companyName || host, `https://${host}`);
  if (web.success && web.bestEmail) {
    add([{ email: web.bestEmail.toLowerCase(), source: 'website' }]);
    if (out.length > 0) return out;
  }
  for (const e of web.emails ?? []) {
    if (e.toLowerCase().endsWith(`@${host}`)) {
      add([{ email: e.toLowerCase(), source: 'website' }]);
      if (out.length > 0) return out;
    }
  }

  // Layer 2 — contact paths
  add(await layerContactPages(host));
  if (out.length > 0) return out;

  // Layer 3 — Bing
  add(await layerBingSearch(host));
  if (out.length > 0) return out;

  // Layer 4 — guesser
  add(await layerGuesser(host, companyName || host));
  return out;
}

/** @deprecated Use findEmailsForDomain */
export async function findEmailsViaCommonCrawl(domain: string): Promise<string[]> {
  const hits = await findEmailsForDomain(domain, domain);
  return hits.map((h) => h.email);
}
