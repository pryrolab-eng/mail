/**
 * Pick the best business contact email from a website crawl.
 * Handles #contact anchors, many path variants, mailto vs visible text.
 */

const CONTACT_PATHS = [
  '/contact',
  '/contact-us',
  '/contact_us',
  '/contact.html',
  '/contacts',
  '/en/contact',
  '/fr/contact',
  '/get-in-touch',
  '/reach-us',
  '/kontakt',
  '/contacto',
  '/about',
  '/about-us',
  '/find-us',
  '/find-a-dealer',
  '/find-a-dealer.html',
  '/en/find-us',
  '/en/find-a-dealer',
  '/en/find-a-dealer.html',
  '/dealer-locator',
  '/dealers',
  '/locations',
  '/imprint',
  '/legal',
];

/** Anchor text / path hints for "contact us" pages that are not named /contact */
const CONTACT_LINK_HINT =
  /contact|dealer|find-us|find_us|find-a-dealer|about-us|about_us|get-in-touch|reach-us|kontakt|contacto|imprint|legal-notice|office-location|our-location|locations|find us|quote|service-info/i;

const BLOCKED_EMAIL_DOMAINS = [
  'example.com',
  'sentry.io',
  'wixpress.com',
  'squarespace.com',
  'wordpress.com',
  'cloudflare.com',
  'schema.org',
  'instagram.com',
  'facebook.com',
  'linkedin.com',
  'twitter.com',
  'youtube.com',
  'google.com',
  'googleusercontent.com',
  'tmbill.in',
  'faisalman.com',
];

const PERSONAL_MAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
  'live.com',
  'icloud.com',
]);

export type ExtractedPageEmails = {
  mailtos: string[];
  visible: string[];
  all: string[];
};

export function normalizeWebsiteUrl(website: string): string {
  const s = website.trim();
  if (!s) return s;
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}

/** URLs to fetch — #contact / #contact-us only change the client hash; server serves homepage. */
export function buildWebsiteFetchUrls(website: string): string[] {
  const normalized = normalizeWebsiteUrl(website);
  let origin = '';
  try {
    origin = new URL(normalized).origin;
  } catch {
    return [];
  }

  const urls: string[] = [];
  for (const path of CONTACT_PATHS) {
    urls.push(`${origin}${path}`);
  }
  // Homepage (and hash-only links like /#contact-us)
  urls.push(`${origin}/`);

  try {
    const u = new URL(normalized);
    const path = u.pathname;
    if (path && path !== '/' && !CONTACT_PATHS.includes(path)) {
      urls.push(`${origin}${path}`);
    }
  } catch {
    /* ignore */
  }

  return Array.from(new Set(urls));
}

/** Pull contact-like paths from /sitemap.xml (best-effort). */
export async function discoverSitemapContactUrls(
  website: string,
  maxUrls = 8
): Promise<string[]> {
  let origin = '';
  try {
    origin = new URL(normalizeWebsiteUrl(website)).origin;
  } catch {
    return [];
  }

  const sitemapUrl = `${origin}/sitemap.xml`;
  try {
    const res = await fetch(sitemapUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PryroScraper/1.0)' },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const locRe = /<loc>\s*([^<]+)\s*<\/loc>/gi;
    const found: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = locRe.exec(xml)) !== null && found.length < maxUrls * 3) {
      const loc = (m[1] ?? '').trim();
      if (!loc.startsWith(origin)) continue;
      const path = new URL(loc).pathname.toLowerCase();
      if (
        CONTACT_LINK_HINT.test(path) ||
        CONTACT_PATHS.some((p) => path === p || path.endsWith(p))
      ) {
        found.push(loc.split('#')[0] ?? loc);
      }
    }
    return Array.from(new Set(found)).slice(0, maxUrls);
  } catch {
    return [];
  }
}

/**
 * Parse internal links from a fetched page (usually homepage) and return
 * same-origin URLs that look like contact / dealer / find-us pages.
 */
export function discoverContactLikeUrls(
  html: string,
  pageUrl: string,
  maxUrls = 12
): string[] {
  let origin = '';
  try {
    origin = new URL(pageUrl).origin;
  } catch {
    return [];
  }

  const seen = new Set<string>();
  const scored: Array<{ url: string; score: number }> = [];
  const hrefRe = /<a\b[^>]*\bhref=["']([^"'#?]+[^"'#?]?)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;

  while ((m = hrefRe.exec(html)) !== null) {
    const rawHref = (m[1] ?? '').trim();
    const anchorText = (m[2] ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!rawHref || rawHref.startsWith('mailto:') || rawHref.startsWith('tel:')) continue;

    let abs: string;
    try {
      abs = new URL(rawHref, pageUrl).href.split('#')[0] ?? '';
    } catch {
      continue;
    }
    if (!abs.startsWith(origin)) continue;

    const path = new URL(abs).pathname.toLowerCase();
    if (path === '/' || seen.has(abs)) continue;
    seen.add(abs);

    let score = 0;
    if (CONTACT_LINK_HINT.test(path)) score += 12;
    if (CONTACT_LINK_HINT.test(anchorText)) score += 8;
    if (/find-a-dealer|find-us|dealer-locator|office.location/i.test(path)) score += 6;
    if (score <= 0) continue;

    scored.push({ url: abs, score });
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, maxUrls)
    .map((x) => x.url);
}

export function isContactPageUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return (
    /\/contact|\/kontakt|\/contacto|\/get-in-touch|\/reach-us|\/find-us|\/find-a-dealer|\/dealer|\/imprint|\/about-us|\/locations/i.test(
      lower
    ) || /#contact/i.test(lower)
  );
}

export function extractEmailsFromHtml(html: string): ExtractedPageEmails {
  let text = html
    .replace(/\s*\[at\]\s*/gi, '@')
    .replace(/\s*\(at\)\s*/gi, '@')
    .replace(/\s*\[dot\]\s*/gi, '.')
    .replace(/\s*\(dot\)\s*/gi, '.');

  const cfRe = /data-cfemail="([0-9a-f]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = cfRe.exec(html)) !== null) {
    const bytes = (m[1] ?? '').match(/.{2}/g) ?? [];
    if (bytes.length < 2) continue;
    const key = parseInt(bytes[0] ?? '0', 16);
    const dec = bytes
      .slice(1)
      .map((b) => String.fromCharCode(parseInt(b, 16) ^ key))
      .join('');
    if (dec.includes('@')) text += ` ${dec}`;
  }

  const mailtos: string[] = [];
  const mailtoRe = /mailto:([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/gi;
  while ((m = mailtoRe.exec(text)) !== null) {
    mailtos.push(m[1].toLowerCase());
  }

  const visible: string[] = [];
  const emailRe = /\b([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})\b/g;
  while ((m = emailRe.exec(text)) !== null) {
    visible.push(m[1].toLowerCase());
  }

  const all = Array.from(new Set([...mailtos, ...visible])).filter(isPlausibleEmail);
  return {
    mailtos: Array.from(new Set(mailtos.filter(isPlausibleEmail))),
    visible: Array.from(new Set(visible.filter(isPlausibleEmail))),
    all,
  };
}

function isPlausibleEmail(email: string): boolean {
  const [local, domain] = email.split('@');
  if (!local || !domain) return false;
  if (BLOCKED_EMAIL_DOMAINS.some((d) => domain.includes(d))) return false;
  if (/^(noreply|no-reply|donotreply|privacy|admin|webmaster|postmaster)$/.test(local)) {
    return false;
  }
  if (!/\.[a-z]{2,}$/i.test(domain)) return false;
  return true;
}

function hostMatchesEmailDomain(siteHost: string, emailDomain: string): boolean {
  const host = siteHost.replace(/^www\./, '').toLowerCase();
  const dom = emailDomain.toLowerCase();
  if (host === dom) return true;
  if (dom.endsWith(`.${host}`) || host.endsWith(`.${dom}`)) return true;
  const hostSld = host.split('.')[0] ?? '';
  const domSld = dom.split('.')[0] ?? '';
  if (hostSld && domSld) {
    if (hostSld.includes(domSld) || domSld.includes(hostSld)) return true;
    // e.g. volkswagen.rw + info@vw.rw
    if (domSld.length >= 2 && hostSld.startsWith(domSld)) return true;
  }
  const hostBase = host.split('.').slice(0, -1).join('.');
  const domBase = dom.split('.').slice(0, -1).join('.');
  if (hostBase && domBase && (hostBase.includes(domBase) || domBase.includes(hostBase))) {
    return true;
  }
  return false;
}

export type EmailCandidateMeta = {
  fromMailto: boolean;
  fromContactPage: boolean;
  /** Guessed by LLM when HTML had no address — low trust */
  fromAiGuess?: boolean;
};

/** Generic info@ / contact@ on the site hostname — often AI-invented, not on the page */
export function isSyntheticSiteEmail(email: string, siteHost: string): boolean {
  const local = email.split('@')[0]?.toLowerCase() ?? '';
  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  const host = siteHost.replace(/^www\./, '').toLowerCase();
  if (domain !== host) return false;
  return ['info', 'contact', 'hello', 'mail', 'office', 'enquiries', 'enquiry'].includes(local);
}

/** Higher score = more likely the real business contact email. */
export function scoreBusinessEmail(
  email: string,
  siteHost: string,
  meta: EmailCandidateMeta
): number {
  const local = email.split('@')[0].toLowerCase();
  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  let score = 0;

  if (meta.fromMailto) score += 18;
  if (meta.fromContactPage) score += 14;
  if (meta.fromAiGuess) score -= 45;
  if (isSyntheticSiteEmail(email, siteHost) && !meta.fromMailto) score -= 35;

  if (hostMatchesEmailDomain(siteHost, domain)) {
    score += 35;
  } else if (PERSONAL_MAIL_DOMAINS.has(domain)) {
    score += 8;
  } else {
    score -= 25;
  }

  if (['info', 'contact', 'hello', 'mail', 'enquiries', 'enquiry'].includes(local)) {
    score += 10;
  } else if (['reservations', 'booking', 'sales', 'office'].includes(local)) {
    score += 7;
  } else if (local.includes('.')) {
    score += 5;
  }

  if (local.includes('feedback') && !hostMatchesEmailDomain(siteHost, domain)) {
    score -= 15;
  }

  return score;
}

export function pickBestBusinessEmail(
  candidates: Map<string, EmailCandidateMeta>,
  siteHost: string
): string | null {
  let best: string | null = null;
  let bestScore = -Infinity;

  for (const [email, meta] of candidates.entries()) {
    const s = scoreBusinessEmail(email, siteHost, meta);
    if (s > bestScore) {
      bestScore = s;
      best = email;
    }
  }

  return bestScore > 0 ? best : null;
}

export interface WebsiteEmailPickResult {
  bestEmail: string | null;
  allEmails: string[];
  mailtoEmails: string[];
  pickedFromUrl?: string;
}

/** Merge emails from all crawled pages and pick the best for this site's domain. */
export function pickFromAggregatedPages(
  pages: Array<{
    url: string;
    extracted: ExtractedPageEmails;
  }>,
  siteHost: string
): WebsiteEmailPickResult {
  const candidates = new Map<string, EmailCandidateMeta>();
  const mailtoSet = new Set<string>();
  let pickedFromUrl: string | undefined;
  let bestUrlScore = -Infinity;

  for (const { url, extracted } of pages) {
    const onContact = isContactPageUrl(url);
    for (const e of extracted.mailtos) {
      mailtoSet.add(e);
      const prev = candidates.get(e);
      candidates.set(e, {
        fromMailto: true,
        fromContactPage: prev?.fromContactPage || onContact,
      });
    }
    for (const e of extracted.visible) {
      const prev = candidates.get(e);
      candidates.set(e, {
        fromMailto: prev?.fromMailto ?? false,
        fromContactPage: prev?.fromContactPage || onContact,
      });
    }
  }

  const hasAnyMailto = pages.some((p) => p.extracted.mailtos.length > 0);
  if (hasAnyMailto) {
    for (const email of [...candidates.keys()]) {
      const meta = candidates.get(email);
      if (meta && !meta.fromMailto && isSyntheticSiteEmail(email, siteHost)) {
        candidates.delete(email);
      }
    }
  }

  // Prefer real mailto on dealer/contact pages over guessed info@site-host
  let bestEmail: string | null = null;
  for (const { url, extracted } of pages) {
    if (!isContactPageUrl(url) || extracted.mailtos.length === 0) continue;
    const mailtoPick = pickBestBusinessEmail(
      new Map(
        extracted.mailtos.map((e) => [
          e,
          {
            fromMailto: true,
            fromContactPage: true,
            fromAiGuess: false,
          },
        ])
      ),
      siteHost
    );
    if (mailtoPick) {
      bestEmail = mailtoPick;
      break;
    }
  }
  if (!bestEmail) {
    bestEmail = pickBestBusinessEmail(candidates, siteHost);
  }

  if (bestEmail) {
    for (const { url, extracted } of pages) {
      if (!extracted.all.includes(bestEmail)) continue;
      const s =
        scoreBusinessEmail(bestEmail, siteHost, {
          fromMailto: extracted.mailtos.includes(bestEmail),
          fromContactPage: isContactPageUrl(url),
        }) + (isContactPageUrl(url) ? 5 : 0);
      if (s > bestUrlScore) {
        bestUrlScore = s;
        pickedFromUrl = url;
      }
    }
  }

  return {
    bestEmail,
    allEmails: Array.from(candidates.keys()),
    mailtoEmails: Array.from(mailtoSet),
    pickedFromUrl,
  };
}
