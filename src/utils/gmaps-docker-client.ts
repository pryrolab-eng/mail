/**
 * Client for gosom/google-maps-scraper (Docker on :8080).
 * https://github.com/gosom/google-maps-scraper
 *
 * Maps: gosom CSV first (`emails` column). When a website URL exists, we also
 * crawl the site to compare CSV vs website email (see GmapsEmailVerificationRow).
 *
 * Env:
 *   GMAPS_SCRAPER_URL=http://localhost:8080
 *   GMAPS_SCRAPER_API_KEY= (optional; SaaS / admin UI key)
 *   GMAPS_SCRAPER_MAX_DEPTH=5
 *   GMAPS_SCRAPER_POLL_MS=5000
 *   GMAPS_SCRAPER_JOB_TIMEOUT_MS=600000
 *   GMAPS_DOCKER_NO_WEBSITE_ENRICH (default on) — Bing + domain guess when CSV has no website
 */

import fs from 'fs/promises';
import path from 'path';

import { buildEnrichedLeadContext } from './lead-context-builder';
import { isJunkEmail } from './scrape-lead-quality';
import type { ScrapedLead } from './puppeteer-scraper';
import type { AIProviderConfig } from './ai-scraper-helper';

export type GmapsEmailVerifyStatus =
  | 'match'
  | 'mismatch'
  | 'csv_only'
  | 'website_only'
  | 'no_email'
  | 'no_website'
  | 'social_only'
  | 'needs_review';

/** One row per CSV business — for manual CSV vs website email checks. */
export interface GmapsEmailVerificationRow {
  company_name: string;
  website?: string;
  phone?: string;
  email_from_csv?: string;
  email_from_website?: string;
  /** All emails seen on site (mailto + visible), comma-separated */
  emails_found_on_website?: string;
  /** Subset that were mailto: links */
  email_from_mailto?: string;
  email_used?: string;
  /** scoring = rules only; ai = resolved with AI Settings LLM */
  email_picked_by?: 'scoring' | 'ai';
  status: GmapsEmailVerifyStatus;
  note?: string;
  saved_as_lead: boolean;
}

const SOCIAL_WEBSITE_HOSTS = new Set([
  'instagram.com',
  'facebook.com',
  'linkedin.com',
  'twitter.com',
  'x.com',
  'tiktok.com',
  'youtube.com',
  'wa.me',
]);

export interface GmapsDockerConfig {
  baseUrl: string;
  apiKey?: string;
  maxDepth: number;
  pollIntervalMs: number;
  jobTimeoutMs: number;
}

interface JobStatusResponse {
  id?: string;
  ID?: string;
  job_id?: string;
  name?: string;
  Name?: string;
  status?: string;
  /** gosom Go API serializes as "Status" (capital S) */
  Status?: string;
  keyword?: string;
  results?: GmapsPlace[];
  result_count?: number;
  error?: string;
}

/** Loose shape from gosom JSON export */
export interface GmapsPlace {
  title?: string;
  name?: string;
  address?: string;
  full_address?: string;
  phone?: string;
  website?: string;
  site?: string;
  link?: string;
  url?: string;
  emails?: string | string[];
  email?: string;
  rating?: string | number;
  review_count?: number;
  reviews_count?: number;
  [key: string]: unknown;
}

function pickEmailFromPlace(place: GmapsPlace, domain?: string): string | null {
  const candidates: string[] = [];
  if (typeof place.email === 'string') candidates.push(place.email);
  if (Array.isArray(place.emails)) {
    for (const e of place.emails) if (typeof e === 'string') candidates.push(e);
  } else if (typeof place.emails === 'string') {
    const raw = place.emails.trim();
    if (raw && raw.toLowerCase() !== 'null') {
      for (const part of raw.split(/[,;]/)) {
        const e = part.trim();
        if (e.includes('@')) candidates.push(e);
      }
    }
  }
  const blocked = [
    'noreply',
    'no-reply',
    'donotreply',
    'privacy',
    'example.com',
    'user@domain.com',
    'your@email',
    'email@example',
  ];
  const unique = Array.from(new Set(candidates.map((e) => e.toLowerCase())));
  const scored = unique
    .filter((e) => !blocked.some((b) => e.includes(b)) && !isJunkEmail(e))
    .sort((a, b) => {
      const score = (e: string) => {
        const local = e.split('@')[0];
        if (['info', 'contact', 'hello', 'sales'].includes(local)) return 10;
        if (local.includes('.')) return 6;
        return 3;
      };
      return score(b) - score(a);
    });
  if (!scored.length) return null;
  if (domain) {
    const onDomain = scored.find((e) => e.endsWith(`@${domain}`));
    if (onDomain) return onDomain;
  }
  return scored[0];
}

/** gosom sometimes puts JSON blobs in `website` — ignore those. */
function normalizePlaceWebsite(place: GmapsPlace): string | undefined {
  const raw =
    (typeof place.website === 'string' && place.website) ||
    (typeof place.site === 'string' && place.site) ||
    (typeof place.web_site === 'string' && place.web_site) ||
    '';
  const s = raw.trim();
  if (!s || s.startsWith('{') || s.startsWith('[')) return undefined;
  if (/^https?:\/\//i.test(s)) return s;
  if (/^www\./i.test(s) || /^[a-z0-9][-a-z0-9.]*\.[a-z]{2,}/i.test(s)) {
    return `https://${s}`;
  }
  return undefined;
}

function websiteEmailFallbackEnabled(): boolean {
  const v = process.env.GMAPS_DOCKER_WEBSITE_EMAIL_FALLBACK?.trim().toLowerCase();
  return v !== 'false' && v !== '0' && v !== 'no';
}

/** When true (default), crawl website even if CSV already has an email — for comparison. */
function websiteEmailVerifyEnabled(): boolean {
  const v = process.env.GMAPS_DOCKER_WEBSITE_EMAIL_VERIFY?.trim().toLowerCase();
  return v !== 'false' && v !== '0' && v !== 'no';
}

function isSocialWebsiteUrl(website: string): boolean {
  try {
    const host = new URL(website).hostname.replace(/^www\./, '').toLowerCase();
    return SOCIAL_WEBSITE_HOSTS.has(host) || host.endsWith('.instagram.com');
  } catch {
    return false;
  }
}

function normalizeEmailForCompare(email: string): string {
  return email.trim().toLowerCase();
}

function emailDomain(email: string): string | null {
  return email.split('@')[1]?.toLowerCase() ?? null;
}

/** Compare gosom CSV email vs email found on the business website. */
export function compareCsvAndWebsiteEmails(
  csvRaw?: string | null,
  websiteRaw?: string | null
): { status: GmapsEmailVerifyStatus; note?: string } {
  const csv = csvRaw ? normalizeEmailForCompare(csvRaw) : '';
  const web = websiteRaw ? normalizeEmailForCompare(websiteRaw) : '';

  if (!csv && !web) return { status: 'no_email' };
  if (csv && !web) {
    return { status: 'csv_only', note: 'Maps/CSV has email; website crawl found none' };
  }
  if (!csv && web) {
    return { status: 'website_only', note: 'No CSV email; found on website' };
  }
  if (csv === web) return { status: 'match' };

  const cd = emailDomain(csv);
  const wd = emailDomain(web);
  if (cd && wd && cd === wd) {
    return {
      status: 'match',
      note: `Same domain (${cd}): CSV=${csv} website=${web}`,
    };
  }
  return {
    status: 'mismatch',
    note: `CSV=${csv} vs website=${web}`,
  };
}

function pickLeadEmail(
  csvEmail: string | null,
  websiteEmail: string | null,
  status: GmapsEmailVerifyStatus,
  siteHost?: string
): string | null {
  if (status === 'no_email' || status === 'no_website' || status === 'social_only') {
    return csvEmail || websiteEmail;
  }
  if (status === 'website_only') return websiteEmail;
  if (status === 'match') return csvEmail || websiteEmail;
  if (status === 'csv_only') return csvEmail || websiteEmail;

  // mismatch / needs_review — prefer website (Maps CSV often wrong)
  if (status === 'mismatch' || status === 'needs_review') {
    if (websiteEmail && csvEmail && siteHost) {
      const csvDom = csvEmail.split('@')[1]?.toLowerCase() ?? '';
      const webDom = websiteEmail.split('@')[1]?.toLowerCase() ?? '';
      const host = siteHost.replace(/^www\./, '').toLowerCase();
      const csvOnSite =
        csvDom === host || csvDom.endsWith(`.${host}`) || host.includes(csvDom.split('.')[0] ?? '');
      const webOnSite =
        webDom === host || webDom.endsWith(`.${host}`) || host.includes(webDom.split('.')[0] ?? '');
      if (webOnSite && !csvOnSite) return websiteEmail;
      if (csvOnSite && !webOnSite) return csvEmail;
    }
    return websiteEmail || csvEmail;
  }

  return websiteEmail || csvEmail;
}

export function logGmapsEmailVerificationReport(rows: GmapsEmailVerificationRow[]): void {
  const withSite = rows.filter((r) => r.website);
  if (withSite.length === 0) return;

  console.log(`\n${'─'.repeat(72)}`);
  console.log(`📋 Website email verification (${withSite.length} businesses with a URL)`);
  console.log(`${'─'.repeat(72)}`);
  console.log(
    'Status       | Company (truncated)          | CSV email              | Website email'
  );
  for (const r of withSite) {
    const co = (r.company_name || '').slice(0, 28).padEnd(28);
    const csv = (r.email_from_csv || '—').slice(0, 22).padEnd(22);
    const web = (r.email_from_website || '—').slice(0, 22).padEnd(22);
    const st = r.status.padEnd(12);
    console.log(`${st} | ${co} | ${csv} | ${web}`);
    if (r.website) console.log(`             → ${r.website}`);
    if (r.note && r.status !== 'match') console.log(`             ↳ ${r.note}`);
  }
  const counts: Partial<Record<GmapsEmailVerifyStatus, number>> = {};
  for (const r of withSite) {
    counts[r.status] = (counts[r.status] ?? 0) + 1;
  }
  console.log(
    `\nSummary: ${counts.match} match, ${counts.mismatch} mismatch, ${counts.csv_only} CSV only, ${counts.website_only} website only, ${counts.needs_review} review, ${counts.social_only} social URL`
  );
  console.log(`${'─'.repeat(72)}\n`);
}

export async function writeGmapsEmailVerificationFile(
  rows: GmapsEmailVerificationRow[],
  jobId?: string
): Promise<string> {
  const dir = path.join(process.cwd(), 'gmapsdata');
  await fs.mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(
    dir,
    `email-verify-${jobId?.slice(0, 8) || stamp}.txt`
  );

  const lines: string[] = [
    'Website email verification — compare CSV (Maps/gosom) vs website crawl',
    'Use this list for manual spot-checks.',
    '',
    'company\twebsite\tphone\temail_csv\temail_website\temails_all\tmailto\tpicked_by\tstatus\temail_used\tsaved_as_lead\tnote',
  ];
  for (const r of rows) {
    lines.push(
      [
        r.company_name,
        r.website,
        r.phone ?? '',
        r.email_from_csv ?? '',
        r.email_from_website ?? '',
        r.emails_found_on_website ?? '',
        r.email_from_mailto ?? '',
        r.email_picked_by ?? '',
        r.status,
        r.email_used ?? '',
        r.saved_as_lead ? 'yes' : 'no',
        r.note ?? '',
      ]
        .map((c) => String(c).replace(/\t/g, ' '))
        .join('\t')
    );
  }
  await fs.writeFile(file, lines.join('\n'), 'utf8');
  console.log(`  📋 Verification list saved: ${file}`);
  return file;
}

export function getGmapsDockerConfig(): GmapsDockerConfig | null {
  const baseUrl = process.env.GMAPS_SCRAPER_URL?.trim();
  if (!baseUrl) return null;
  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    apiKey: process.env.GMAPS_SCRAPER_API_KEY?.trim() || undefined,
    maxDepth: Math.max(1, parseInt(process.env.GMAPS_SCRAPER_MAX_DEPTH || '5', 10) || 5),
    pollIntervalMs: Math.max(2000, parseInt(process.env.GMAPS_SCRAPER_POLL_MS || '5000', 10) || 5000),
    jobTimeoutMs: Math.max(60_000, parseInt(process.env.GMAPS_SCRAPER_JOB_TIMEOUT_MS || '600000', 10) || 600_000),
  };
}

export async function isGmapsDockerAvailable(): Promise<boolean> {
  const cfg = getGmapsDockerConfig();
  if (!cfg) return false;
  try {
    const res = await fetch(`${cfg.baseUrl}/api/docs`, {
      signal: AbortSignal.timeout(4000),
    });
    return res.ok;
  } catch {
    try {
      const res = await fetch(cfg.baseUrl, { signal: AbortSignal.timeout(4000) });
      return res.ok;
    } catch {
      return false;
    }
  }
}

async function apiRequest<T>(
  cfg: GmapsDockerConfig,
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) headers['X-API-Key'] = cfg.apiKey;

  const res = await fetch(`${cfg.baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GMaps API ${res.status}: ${text.slice(0, 200)}`);
  }

  return res.json() as Promise<T>;
}

/** gosom web API requires `name` + JobData (keywords, lang, depth, max_time, …). */
function buildGmapsJobPayload(keyword: string, maxDepth: number) {
  return {
    name: keyword.slice(0, 120) || 'maps-scrape',
    keywords: [keyword],
    lang: 'en',
    zoom: 15,
    lat: '0',
    lon: '0',
    fast_mode: false,
    radius: 10_000,
    depth: maxDepth,
    email: true,
    extra_reviews: false,
    max_time: 600,
  };
}

async function submitScrapeJob(cfg: GmapsDockerConfig, keyword: string): Promise<string> {
  const payload = buildGmapsJobPayload(keyword, cfg.maxDepth);

  try {
    const r = await apiRequest<{ id?: string; job_id?: string }>(
      cfg,
      'POST',
      '/api/v1/jobs',
      payload
    );
    const id = r.id || r.job_id;
    if (id) return id;
  } catch {
    /* try legacy scrape path */
  }

  const r2 = await apiRequest<{ job_id?: string; id?: string }>(
    cfg,
    'POST',
    '/api/v1/scrape',
    payload
  );
  const id = r2.id || r2.job_id;
  if (!id) throw new Error('GMaps API did not return job id');
  return id;
}

function normalizeJobStatus(raw: JobStatusResponse): string {
  return (raw.status || raw.Status || '').toLowerCase().trim();
}

/** gosom web UI uses StatusOK = "ok" (not "completed"). */
function isJobDone(status?: string): boolean {
  const s = (status || '').toLowerCase();
  return (
    s === 'ok' ||
    s === 'completed' ||
    s === 'complete' ||
    s === 'done' ||
    s === 'success'
  );
}

function isJobFailed(status?: string): boolean {
  const s = (status || '').toLowerCase();
  return s === 'failed' || s === 'error' || s === 'cancelled';
}

function isJobRunning(status?: string): boolean {
  const s = (status || '').toLowerCase();
  return s === 'pending' || s === 'working' || s === 'running';
}

/** RFC 4180 CSV — gosom rows include multiline JSON in review columns. */
function parseGosomCsvRecords(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (inQuotes) {
      if (c === '"') {
        if (csv[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      field = '';
      if (row.some((cell) => cell.trim().length > 0)) rows.push(row);
      row = [];
    } else if (c !== '\r') {
      field += c;
    }
  }
  row.push(field);
  if (row.some((cell) => cell.trim().length > 0)) rows.push(row);
  return rows;
}

function formatGosomCompleteAddress(raw: string): string | undefined {
  const s = raw.trim();
  if (!s || s.toLowerCase() === 'null') return undefined;
  if (!s.startsWith('{')) return s;
  try {
    const o = JSON.parse(s) as {
      street?: string;
      city?: string;
      state?: string;
      country?: string;
      borough?: string;
    };
    const parts = [o.street, o.borough, o.city, o.state, o.country].filter(Boolean);
    return parts.join(', ') || undefined;
  } catch {
    return undefined;
  }
}

function normalizeGosomRow(row: GmapsPlace): GmapsPlace {
  if (!row.title && row.name) row.title = row.name;
  const formattedAddr = formatGosomCompleteAddress(
    String(row.complete_address || row.address || '')
  );
  if (formattedAddr) {
    if (!row.address) row.address = formattedAddr;
    if (!row.full_address) row.full_address = formattedAddr;
  }
  if (!row.link && row.url) row.link = row.url;
  return row;
}

/** Parse gosom CSV from GET /api/v1/jobs/{id}/download (primary result format). */
export function parseCsvPlaces(csv: string): GmapsPlace[] {
  const records = parseGosomCsvRecords(csv);
  if (records.length < 2) return [];

  const headers = records[0].map((h) =>
    h.trim().replace(/^"|"$/g, '').toLowerCase()
  );
  const places: GmapsPlace[] = [];

  for (let i = 1; i < records.length; i++) {
    const cols = records[i];
    const row: GmapsPlace = {};
    headers.forEach((h, j) => {
      const raw = (cols[j] ?? '').trim().replace(/^"|"$/g, '').replace(/""/g, '"');
      if (raw && raw.toLowerCase() !== 'null') row[h] = raw;
    });
    normalizeGosomRow(row);
    if (row.title || row.name) places.push(row);
  }

  const withEmail = places.filter(
    (p) =>
      (typeof p.emails === 'string' && p.emails.includes('@')) ||
      (typeof p.email === 'string' && p.email.includes('@'))
  ).length;
  if (places.length > 0) {
    console.log(
      `  🐳 CSV parsed: ${places.length} businesses, ${withEmail} with emails column`
    );
  }
  return places;
}

async function downloadJobResults(cfg: GmapsDockerConfig, jobId: string): Promise<GmapsPlace[]> {
  const headers: Record<string, string> = {};
  if (cfg.apiKey) headers['X-API-Key'] = cfg.apiKey;
  const res = await fetch(`${cfg.baseUrl}/api/v1/jobs/${jobId}/download`, {
    headers,
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) return [];
  const text = await res.text();
  if (text.trim().startsWith('{') || text.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(text) as GmapsPlace[] | { results?: GmapsPlace[] };
      if (Array.isArray(parsed)) return parsed;
      if (Array.isArray(parsed.results)) return parsed.results;
    } catch {
      return [];
    }
  }
  const places = parseCsvPlaces(text);
  if (places.length > 0) {
    console.log(`  🐳 Downloaded CSV: ${places.length} rows`);
  }
  return places;
}

async function waitForJobResults(
  cfg: GmapsDockerConfig,
  jobId: string
): Promise<GmapsPlace[]> {
  const deadline = Date.now() + cfg.jobTimeoutMs;
  let lastLogged = '';

  while (Date.now() < deadline) {
    const job = await apiRequest<JobStatusResponse>(
      cfg,
      'GET',
      `/api/v1/jobs/${jobId}`
    );

    const st = normalizeJobStatus(job);

    if (st !== lastLogged) {
      console.log(`  🐳 Job ${jobId.slice(0, 8)}… status: ${st || 'unknown'}`);
      lastLogged = st;
    }

    if (isJobDone(st)) {
      // Finished jobs write {jobId}.csv on disk — Download button in :8080 UI
      const downloaded = await downloadJobResults(cfg, jobId);
      if (downloaded.length > 0) return downloaded;
      if (Array.isArray(job.results) && job.results.length > 0) {
        return job.results;
      }
      console.log(`  🐳 Job ${jobId.slice(0, 8)}… ok but 0 places in CSV`);
      return [];
    }
    if (isJobFailed(st)) {
      throw new Error(job.error || 'GMaps job failed');
    }

    if (!isJobRunning(st) && st) {
      console.log(`  🐳 Job ${jobId.slice(0, 8)}… unrecognized status "${st}" — keep polling`);
    }

    await new Promise((r) => setTimeout(r, cfg.pollIntervalMs));
  }

  throw new Error(`GMaps job timed out after ${cfg.jobTimeoutMs}ms (last status: ${lastLogged || 'unknown'})`);
}

async function resolvePlaceEmails(
  place: GmapsPlace,
  niche: string,
  leadLocation: string,
  mapsSearch: string,
  aiProvider: AIProviderConfig | null,
  fetchEmailFromSite?: (
    website: string,
    companyName: string,
    niche: string,
    location: string,
    ai: AIProviderConfig | null
  ) => Promise<string | null>
): Promise<{ verification: GmapsEmailVerificationRow; lead: ScrapedLead | null }> {
  const name = (place.title || place.name || '').trim();
  let website = normalizePlaceWebsite(place);
  const phone =
    typeof place.phone === 'string' ? place.phone : undefined;
  let enrichmentNote: string | undefined;

  const emptyVerification = (status: GmapsEmailVerifyStatus, note?: string) => ({
    verification: {
      company_name: name || 'Unknown',
      website,
      phone,
      status,
      note,
      saved_as_lead: false,
    } as GmapsEmailVerificationRow,
    lead: null as ScrapedLead | null,
  });

  if (!name) {
    return emptyVerification('no_email', 'Missing business name');
  }

  let domain: string | undefined;
  if (website) {
    try {
      domain = new URL(website).hostname.replace(/^www\./, '');
    } catch {
      domain = undefined;
    }
  }

  const csvEmail = pickEmailFromPlace(place, domain);
  let websiteEmail: string | null = null;
  let status: GmapsEmailVerifyStatus;
  let note: string | undefined;
  let sitePickAll: string[] = [];
  let sitePickMailto: string[] = [];

  if (!website) {
    const mapsPlaceUrl =
      typeof place.link === 'string' && place.link.includes('google.com/maps')
        ? place.link
        : undefined;
    const { enrichPlaceWithoutWebsite } = await import('./place-website-enrichment');
    const enriched = await enrichPlaceWithoutWebsite(
      name,
      leadLocation,
      niche,
      aiProvider,
      { phone, mapsPlaceUrl }
    );
    if (enriched.website) {
      website = enriched.website;
      try {
        domain = new URL(website).hostname.replace(/^www\./, '');
      } catch {
        domain = undefined;
      }
      enrichmentNote = enriched.note;
      console.log(`  🔎 ${name}: no CSV website — ${enriched.note ?? enriched.source ?? 'enriched'}`);
    }
    if (enriched.email && !csvEmail) {
      websiteEmail = enriched.email;
      sitePickAll = enriched.allEmails ?? [enriched.email];
      sitePickMailto = enriched.mailtoEmails ?? [];
    }
  }

  if (!website) {
    if (websiteEmail) {
      const compared = compareCsvAndWebsiteEmails(csvEmail, websiteEmail);
      status = compared.status === 'mismatch' ? 'needs_review' : compared.status;
      note = [compared.note, enrichmentNote].filter(Boolean).join(' · ');
      console.log(`  📧 ${name}: email from Bing enrich (no Maps website URL)`);
    } else {
      status = csvEmail ? 'csv_only' : 'no_website';
      note = csvEmail
        ? 'No valid website URL in CSV — Bing/domain enrich found nothing'
        : enrichmentNote ?? 'No website and no CSV email';
    }
  } else if (isSocialWebsiteUrl(website)) {
    status = csvEmail ? 'needs_review' : 'social_only';
    note =
      'Social/profile URL — open manually; automated site crawl skipped';
    if (!csvEmail) {
      return emptyVerification('social_only', note);
    }
  } else if (
    fetchEmailFromSite &&
    (websiteEmailVerifyEnabled() || (websiteEmailFallbackEnabled() && !csvEmail)) &&
    !websiteEmail
  ) {
    const { fetchEmailsFromSiteDetailed } = await import('./puppeteer-scraper');
    const sitePick = await fetchEmailsFromSiteDetailed(
      website,
      name,
      niche,
      leadLocation,
      aiProvider
    );
    websiteEmail = sitePick?.bestEmail ?? null;
    if (websiteEmail && isJunkEmail(websiteEmail)) websiteEmail = null;
    if (sitePick) {
      sitePickAll = sitePick.allEmails;
      sitePickMailto = sitePick.mailtoEmails;
    }

    const compared = compareCsvAndWebsiteEmails(csvEmail, websiteEmail);
    status = compared.status;
    note = compared.note;
    if (sitePickAll.length > 1) {
      note = [note, `all on site: ${sitePickAll.join(', ')}`]
        .filter(Boolean)
        .join(' · ');
    }
    if (sitePickMailto.length) {
      note = [note, `mailto: ${sitePickMailto.join(', ')}`]
        .filter(Boolean)
        .join(' · ');
    }

    if (status === 'mismatch') {
      status = 'needs_review';
      console.log(
        `  🔍 ${name}: CSV ${csvEmail ?? '—'} ≠ website ${websiteEmail ?? '—'} — needs review`
      );
    } else if (status === 'match' && csvEmail) {
      console.log(`  ✓ ${name}: CSV matches website (${csvEmail})`);
    } else if (status === 'website_only' && websiteEmail) {
      console.log(`  📧 ${name}: email from website (CSV empty)`);
    } else if (status === 'csv_only') {
      console.log(`  📧 ${name}: CSV email only (website had none)`);
    }
    if (enrichmentNote) {
      note = [note, enrichmentNote].filter(Boolean).join(' · ');
    }
  } else if (website && websiteEmail) {
    const compared = compareCsvAndWebsiteEmails(csvEmail, websiteEmail);
    status = compared.status === 'mismatch' ? 'needs_review' : compared.status;
    note = [compared.note, enrichmentNote].filter(Boolean).join(' · ');
    if (enrichmentNote) {
      console.log(`  📧 ${name}: email from discovered website (${websiteEmail})`);
    }
  } else {
    status = csvEmail ? 'csv_only' : 'no_email';
    note = 'Website verify disabled (GMAPS_DOCKER_WEBSITE_EMAIL_VERIFY=false)';
  }

  let email = pickLeadEmail(csvEmail, websiteEmail, status, domain);
  let pickedBy: 'scoring' | 'ai' = 'scoring';

  const candidates = Array.from(
    new Set(
      [csvEmail, websiteEmail, ...sitePickAll].filter(
        (e): e is string => typeof e === 'string' && e.includes('@')
      )
    )
  );

  if (aiProvider) {
    const { pickContactEmailWithAi, shouldUseAiEmailPickForScrape } = await import(
      './ai-scraper-helper'
    );
    if (shouldUseAiEmailPickForScrape(aiProvider, status, candidates)) {
      const aiEmail = await pickContactEmailWithAi({
        companyName: name,
        website,
        niche,
        location: leadLocation,
        phone,
        candidates,
        csvEmail,
        mailtoEmails: sitePickMailto,
        provider: aiProvider,
      });
      if (aiEmail && !isJunkEmail(aiEmail)) {
        email = aiEmail;
        pickedBy = 'ai';
        console.log(
          `  🤖 ${name}: AI picked ${aiEmail} (Settings: ${aiProvider.provider}/${aiProvider.active_model})`
        );
        note = [note, `AI selected: ${aiEmail}`].filter(Boolean).join(' · ');
      }
    }
  }

  const verification: GmapsEmailVerificationRow = {
    company_name: name,
    website,
    phone,
    email_from_csv: csvEmail ?? undefined,
    email_from_website: websiteEmail ?? undefined,
    emails_found_on_website:
      sitePickAll.length > 0 ? sitePickAll.join(', ') : undefined,
    email_from_mailto:
      sitePickMailto.length > 0 ? sitePickMailto.join(', ') : undefined,
    email_used: email ?? undefined,
    email_picked_by: pickedBy,
    status,
    note,
    saved_as_lead: false,
  };

  if (!email || isJunkEmail(email)) {
    const phoneStr = typeof phone === 'string' ? phone.trim() : '';
    if (phoneStr.length >= 6) {
      const enriched = await buildEnrichedLeadContext({
        companyName: name,
        niche,
        location: place.full_address || place.address || leadLocation,
        website,
        phone: place.phone,
        rating: place.rating != null ? String(place.rating) : undefined,
      });
      const phoneLead: ScrapedLead = {
        company_name: name,
        email: '',
        phoneOnly: true,
        niche: enriched.niche,
        location: leadLocation,
        business_address: place.full_address || place.address,
        company_context:
          enriched.context ||
          `${name} — Maps listing (phone only, no email found).`,
        source_url: place.link || place.url || website || mapsSearch,
        phone: phoneStr,
        website,
        email_verify_status: status,
      };
      verification.saved_as_lead = true;
      verification.note = [note, 'Saved to call list (phone only)']
        .filter(Boolean)
        .join(' · ');
      return { verification, lead: phoneLead };
    }
    return { verification, lead: null };
  }

  const enriched = await buildEnrichedLeadContext({
    companyName: name,
    niche,
    location: place.full_address || place.address || leadLocation,
    website,
    phone: place.phone,
    rating: place.rating != null ? String(place.rating) : undefined,
  });

  const lead: ScrapedLead = {
    company_name: name,
    email,
    emailIsReal: true,
    niche: enriched.niche,
    location: leadLocation,
    business_address: place.full_address || place.address,
    company_context: enriched.context,
    source_url: place.link || place.url || website || mapsSearch,
    phone: place.phone,
    website,
    email_from_csv: csvEmail ?? undefined,
    email_from_website: websiteEmail ?? undefined,
    email_verify_status: pickedBy === 'ai' ? 'ai_picked' : status,
  };

  return { verification, lead };
}

/**
 * Run one Maps search via Docker gosom scraper (replaces Puppeteer for that query).
 */
export interface GmapsDockerScrapeResult {
  leads: ScrapedLead[];
  emailVerification: GmapsEmailVerificationRow[];
  verificationFile?: string;
}

export async function scrapeGmapsDockerQuery(
  mapsSearch: string,
  niche: string,
  leadLocation: string,
  maxResults: number,
  seen: Set<string>,
  onLead: (l: ScrapedLead) => boolean,
  aiProvider: AIProviderConfig | null,
  fetchEmailFromSite?: (
    website: string,
    companyName: string,
    niche: string,
    location: string,
    ai: AIProviderConfig | null
  ) => Promise<string | null>
): Promise<GmapsDockerScrapeResult> {
  const cfg = getGmapsDockerConfig();
  if (!cfg) {
    return { leads: [], emailVerification: [] };
  }

  const collected: ScrapedLead[] = [];
  const emailVerification: GmapsEmailVerificationRow[] = [];
  console.log(`\n🐳 GMaps Docker: ${mapsSearch} (depth ${cfg.maxDepth})`);

  try {
    const jobId = await submitScrapeJob(cfg, mapsSearch);
    console.log(`  🐳 Job ${jobId} submitted — polling…`);
    const places = await waitForJobResults(cfg, jobId);
    console.log(`  🐳 Job ${jobId}: ${places.length} places`);

    let skippedNoEmail = 0;
    let cappedBeforeCheck = 0;

    for (const place of places) {
      const nameKey = (place.title || place.name || '').toLowerCase();
      if (!nameKey || seen.has(nameKey)) continue;

      const { verification, lead } = await resolvePlaceEmails(
        place,
        niche,
        leadLocation,
        mapsSearch,
        aiProvider,
        fetchEmailFromSite
      );
      emailVerification.push(verification);

      if (!lead) {
        skippedNoEmail++;
        continue;
      }

      const countsTowardCap = !lead.phoneOnly;
      if (countsTowardCap && collected.length >= maxResults) {
        cappedBeforeCheck++;
        continue;
      }

      seen.add(nameKey);
      if (onLead(lead)) {
        if (countsTowardCap) collected.push(lead);
        verification.saved_as_lead = true;
      }
    }

    logGmapsEmailVerificationReport(emailVerification);
    const verificationFile = await writeGmapsEmailVerificationFile(
      emailVerification,
      jobId
    );

    try {
      const { scrapeRunStats } = await import('./scrape-run-stats');
      scrapeRunStats.lastGmapsEmailVerification = emailVerification;
      scrapeRunStats.lastGmapsEmailVerificationFile = verificationFile;
    } catch {
      /* optional */
    }

    if (places.length > 0 && collected.length === 0) {
      console.log(
        `  🐳 0 leads saved (${skippedNoEmail} no email; ${cappedBeforeCheck} skipped after Maps cap)`
      );
    } else if (cappedBeforeCheck > 0) {
      console.log(
        `  🐳 Maps cap (${maxResults}): ${cappedBeforeCheck} extra rows still in verification file`
      );
    }

    return { leads: collected, emailVerification, verificationFile };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  ⚠️  GMaps Docker failed: ${msg.slice(0, 120)}`);
    return { leads: collected, emailVerification };
  }
}
