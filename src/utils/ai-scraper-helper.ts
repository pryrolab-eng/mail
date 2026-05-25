/**
 * AI Scraper Helper
 *
 * Uses the user's configured AI provider (server-side) to:
 *  1. Generate smarter search queries for a niche + location
 *  2. Extract/guess the most likely email for a business given its website content
 *  3. Generate a plausible email pattern when no email is visible on the site
 *  4. Pick the best contact email when Maps CSV, website crawl, and mailto disagree
 *
 * All calls go through the same AI provider the user configured in Settings.
 */

import { createServiceClient } from '../../supabase/service';
import {
  isExpansionAiAvailable,
  isScrapeAiAvailable,
  noteExpansionAiRateLimit,
  noteScrapeAiRateLimit,
} from './ai-scrape-rate-limit';
import { loadAIProviderForUser } from './load-ai-provider-server';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AIProviderConfig {
  provider: string;
  api_key: string;
  active_model: string;
}

// ─── Load active AI provider (server-side) ────────────────────────────────────

export async function getActiveAIProvider(userId: string): Promise<AIProviderConfig | null> {
  try {
    const service = createServiceClient();
    const row = await loadAIProviderForUser(service, userId);
    if (!row) return null;
    return {
      provider: row.provider,
      api_key: row.api_key,
      active_model: row.active_model ?? '',
    };
  } catch {
    return null;
  }
}

// ─── Core AI call (works with all providers) ─────────────────────────────────

async function callAI(
  provider: AIProviderConfig,
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 200
): Promise<string> {
  const { provider: name, active_model } = provider;
  const api_key = provider.api_key.trim();

  if (name === 'openai' || name === 'groq') {
    const baseUrl = name === 'openai'
      ? 'https://api.openai.com/v1/chat/completions'
      : 'https://api.groq.com/openai/v1/chat/completions';

    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${api_key}` },
      body: JSON.stringify({
        model: active_model || (name === 'groq' ? 'llama-3.1-8b-instant' : 'gpt-4o-mini'),
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.2,
        max_tokens: maxTokens,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const err = new Error(`${name} API error: ${res.status}`);
      noteScrapeAiRateLimit(err);
      throw err;
    }
    const data = await res.json();
    return data.choices[0].message.content.trim();
  }

  if (name === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': api_key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: active_model || 'claude-3-5-haiku-20241022',
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Anthropic API error: ${res.status}`);
    const data = await res.json();
    return data.content[0].text.trim();
  }

  if (name === 'gemini') {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${active_model || 'gemini-1.5-flash'}:generateContent?key=${api_key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: maxTokens },
        }),
        signal: AbortSignal.timeout(15_000),
      }
    );
    if (!res.ok) throw new Error(`Gemini API error: ${res.status}`);
    const data = await res.json();
    return data.candidates[0].content.parts[0].text.trim();
  }

  if (name === 'mistral') {
    const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${api_key}` },
      body: JSON.stringify({
        model: active_model || 'mistral-small',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.2,
        max_tokens: maxTokens,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Mistral API error: ${res.status}`);
    const data = await res.json();
    return data.choices[0].message.content.trim();
  }

  throw new Error(`Unsupported AI provider: ${name}`);
}

// ─── City → district/neighbourhood areas (Maps query expansion) ─────────────

const cityAreaCache = new Map<string, string[]>();
const EXPAND_AREAS_TIMEOUT_MS = 12_000;

export type ExpandAreasStatus =
  | 'success'
  | 'cached'
  | 'no_city'
  | 'no_provider'
  | 'rate_limited'
  | 'timeout'
  | 'api_error'
  | 'empty_array'
  | 'parse_failed';

export interface ExpandCityIntoAreasResult {
  areas: string[];
  status: ExpandAreasStatus;
  detail?: string;
}

/** Human-readable label for logs and tests. */
export function formatExpandAreasStatus(result: ExpandCityIntoAreasResult): string {
  const { status, detail, areas } = result;
  switch (status) {
    case 'success':
      return `${areas.length} areas from AI`;
    case 'cached':
      return `${areas.length} areas (cache)`;
    case 'no_city':
      return '0 — invalid city name';
    case 'no_provider':
      return `0 — no AI provider/key${detail ? ` (${detail})` : ''}`;
    case 'rate_limited':
      return `0 — AI rate limited${detail ? ` (${detail})` : ''}`;
    case 'timeout':
      return `0 — timeout${detail ? ` (${detail})` : ''}`;
    case 'api_error': {
      const hint =
        detail?.includes('401') || detail?.toLowerCase().includes('invalid api key')
          ? ' — re-save a valid Groq key in Settings → AI'
          : '';
      return `0 — AI call failed${detail ? ` (error: ${detail})` : ''}${hint}`;
    }
    case 'empty_array':
      return `0 — AI call succeeded but returned empty array${detail ? ` (${detail})` : ''}`;
    case 'parse_failed':
      return `0 — parse failed${detail ? ` (${detail})` : ''}`;
    default:
      return `0 — ${status}`;
  }
}

function parseAreasFromResponse(raw: string): string[] {
  let cleaned = raw.replace(/```json|```/gi, '').trim();

  const tryJson = (jsonStr: string): string[] => {
    try {
      const parsed = JSON.parse(jsonStr) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((s): s is string => typeof s === 'string' && s.trim().length > 2)
        .map((s) => s.trim());
    } catch {
      return [];
    }
  };

  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start !== -1 && end > start) {
    const fromJson = tryJson(cleaned.slice(start, end + 1));
    if (fromJson.length) return fromJson;
  }

  // Gemini sometimes truncates before closing `]` — recover quoted area strings
  const fromQuotes: string[] = [];
  const re = /"([^"\\]{3,120})"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    const s = m[1].trim();
    if (s.length > 2 && !/^city\s*:/i.test(s)) fromQuotes.push(s);
  }
  if (fromQuotes.length >= 3) return fromQuotes;

  // Last resort: close an unterminated array and parse
  if (start !== -1 && (end === -1 || end <= start)) {
    const partial = cleaned.slice(start).replace(/,\s*$/, '');
    const closed = partial.endsWith(']') ? partial : `${partial}]`;
    const repaired = tryJson(closed);
    if (repaired.length) return repaired;
  }

  return [];
}

/** Clear in-memory city area cache (tests / dev). */
export function clearCityAreaCache(): void {
  cityAreaCache.clear();
}

/**
 * Ask AI for well-known districts/neighbourhoods in a city (for Maps lead search).
 * Never throws.
 */
export async function expandCityIntoAreas(
  _niche: string,
  city: string,
  provider: AIProviderConfig | null
): Promise<ExpandCityIntoAreasResult> {
  const key = city.toLowerCase().trim();
  if (!key) {
    return { areas: [], status: 'no_city' };
  }

  const cached = cityAreaCache.get(key);
  if (cached) {
    return { areas: cached, status: 'cached' };
  }

  if (!provider?.api_key?.trim()) {
    return {
      areas: [],
      status: 'no_provider',
      detail: 'api_key missing or empty in ai_settings',
    };
  }

  if (!isExpansionAiAvailable()) {
    return {
      areas: [],
      status: 'rate_limited',
      detail: 'expansion AI paused after 429',
    };
  }

  const system = `You are a local geography expert. Given a city name, return a JSON array of the most important districts, neighbourhoods, or sub-areas within that city that would be useful for a business lead search.

Rules:
- Return ONLY a valid JSON array of strings, nothing else. No explanation, no markdown, no preamble.
- Each string should be: "{neighbourhood} {city}" — the neighbourhood name followed by the city name
- Return between 5 and 12 areas depending on how large the city is
- For small cities (population < 500k): return 5-7 areas
- For large cities (population > 1M): return 10-12 areas
- Only include real, well-known areas — not obscure ones
- Do not include the city itself as one of the areas (no "Kigali Kigali")

Examples of correct output:
- Input: "Kigali" → ["Nyarugenge Kigali", "Gasabo Kigali", "Kicukiro Kigali", "Nyamirambo Kigali", "Kimironko Kigali", "Remera Kigali", "Gikondo Kigali"]
- Input: "Nairobi" → ["Westlands Nairobi", "Karen Nairobi", "Kilimani Nairobi", "Eastleigh Nairobi", "Upperhill Nairobi", "Langata Nairobi", "Lavington Nairobi", "Parklands Nairobi"]
- Input: "Lagos" → ["Victoria Island Lagos", "Ikeja Lagos", "Lekki Lagos", "Surulere Lagos", "Yaba Lagos", "Apapa Lagos", "Ikoyi Lagos", "Agege Lagos", "Oshodi Lagos", "Mushin Lagos"]
- Input: "London" → ["Westminster London", "Shoreditch London", "Canary Wharf London", "Camden London", "Brixton London", "Hackney London", "Islington London", "Southwark London", "Hammersmith London", "Croydon London"]`;

  const fetchAreas = async (): Promise<ExpandCityIntoAreasResult> => {
    try {
      const response = await callAI(
        provider,
        system,
        `City: ${city}`,
        1024
      );
      const cityLower = key;
      const parsed = parseAreasFromResponse(response);
      const areas = parsed
        .filter((a) => {
          const lower = a.toLowerCase();
          if (lower === cityLower || lower === `${cityLower} ${cityLower}`) return false;
          return true;
        })
        .slice(0, 12);

      if (areas.length) {
        cityAreaCache.set(key, areas);
        return { areas, status: 'success' };
      }

      if (parsed.length === 0) {
        return {
          areas: [],
          status: 'parse_failed',
          detail: response.slice(0, 300),
        };
      }

      return {
        areas: [],
        status: 'empty_array',
        detail: response.slice(0, 300),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      noteExpansionAiRateLimit(err);
      if (msg.includes('429')) {
        return { areas: [], status: 'rate_limited', detail: msg };
      }
      return { areas: [], status: 'api_error', detail: msg };
    }
  };

  try {
    return await Promise.race([
      fetchAreas(),
      new Promise<ExpandCityIntoAreasResult>((resolve) =>
        setTimeout(
          () =>
            resolve({
              areas: [],
              status: 'timeout',
              detail: `${EXPAND_AREAS_TIMEOUT_MS}ms`,
            }),
          EXPAND_AREAS_TIMEOUT_MS
        )
      ),
    ]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { areas: [], status: 'api_error', detail: msg };
  }
}

// ─── Feature 1: Generate smart search queries ─────────────────────────────────

/**
 * Ask AI to generate 6 targeted search queries for finding businesses
 * with real email addresses in a given niche and location.
 */
export async function generateSearchQueries(
  niche: string,
  location: string,
  provider: AIProviderConfig
): Promise<string[]> {
  const system = `You are a lead generation expert. Generate search engine queries to find real business email addresses.
Rules:
- Each query must be designed to surface pages that contain actual email addresses
- Include email-specific terms like "contact@", "@gmail.com", "email us", "mailto:"
- Mix different query styles: directory listings, contact pages, business profiles
- Return ONLY the queries, one per line, no numbering, no explanation`;

  const user = `Generate 6 Google/Bing search queries to find ${niche} businesses in ${location} that have real email addresses publicly listed on their websites or directories.`;

  if (!isScrapeAiAvailable()) return [];

  try {
    const response = await callAI(provider, system, user, 300);
    const queries = response
      .split('\n')
      .map(q => q.trim())
      .filter(q => q.length > 10 && q.length < 200)
      .slice(0, 6);
    return queries;
  } catch (err) {
    noteScrapeAiRateLimit(err);
    return [];
  }
}

// ─── Feature 2: Extract email from website HTML ───────────────────────────────

/**
 * Given a chunk of website HTML/text, ask AI to find or infer the most
 * likely contact email address. Returns null if AI can't find one.
 */
export async function extractEmailFromContent(
  companyName: string,
  websiteText: string,
  domain: string,
  provider: AIProviderConfig
): Promise<string | null> {
  const system = `You are an email extraction specialist. Your job is to find real contact email addresses from website content.
Rules:
- Look for mailto: links, "contact us" sections, footer emails, team pages
- If you find a real email address, return ONLY that email address, nothing else
- If multiple emails exist, return the most likely business contact (info@, contact@, hello@, sales@)
- NEVER invent or guess emails (e.g. do NOT return info@${domain} unless that exact address appears in the content)
- NEVER return noreply@, donotreply@, or system emails
- If you truly cannot find any real email in the content, return exactly: NONE`;

  // Truncate to avoid token limits
  const truncated = websiteText.slice(0, 2000);

  const user = `Company: ${companyName}
Domain: ${domain}
Website content:
${truncated}

What is the contact email address for this business?`;

  if (!isScrapeAiAvailable()) return null;

  try {
    const response = await callAI(provider, system, user, 50);
    const cleaned = response.trim().toLowerCase();

    // Validate it looks like an email
    if (cleaned === 'none' || !cleaned.includes('@')) return null;

    const emailMatch = cleaned.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
    if (!emailMatch) return null;

    const email = emailMatch[0];

    // Reject blocked patterns
    const blockedPrefixes = ['noreply', 'no-reply', 'donotreply', 'privacy', 'test'];
    const local = email.split('@')[0];
    if (blockedPrefixes.some(p => local.startsWith(p))) return null;

    return email;
  } catch (err) {
    noteScrapeAiRateLimit(err);
    return null;
  }
}

// ─── Feature 3: Generate likely email for a business ─────────────────────────

/**
 * When we have a company name and domain but no visible email,
 * ask AI to predict the most likely email pattern.
 * This is smarter than just guessing info@ because AI considers
 * the company type, size, and naming conventions.
 */
export async function predictEmailPattern(
  companyName: string,
  domain: string,
  niche: string,
  location: string,
  provider: AIProviderConfig
): Promise<string | null> {
  const system = `You are an email pattern prediction expert. Given a business name and domain, predict the most likely contact email.
Rules:
- For small businesses: info@domain or contact@domain is most common
- For schools/education: info@domain, admissions@domain, admin@domain
- For hospitals/clinics: info@domain, contact@domain, appointments@domain
- For restaurants: info@domain, reservations@domain, hello@domain
- For tech companies: hello@domain, contact@domain, team@domain
- For NGOs/nonprofits: info@domain, contact@domain, admin@domain
- Return ONLY the email address, nothing else
- The email MUST use the exact domain provided`;

  const user = `Business: ${companyName}
Domain: ${domain}
Industry: ${niche}
Location: ${location}

What is the single most likely contact email for this business?`;

  if (!isScrapeAiAvailable()) return null;

  try {
    const response = await callAI(provider, system, user, 30);
    const cleaned = response.trim().toLowerCase();

    const emailMatch = cleaned.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
    if (!emailMatch) return null;

    const email = emailMatch[0];

    // Must use the correct domain
    if (!email.endsWith(`@${domain}`) && !email.includes(domain.split('.')[0])) return null;

    return email;
  } catch (err) {
    noteScrapeAiRateLimit(err);
    return null;
  }
}

// ─── Feature 4: Pick best email when CSV vs website vs mailto disagree ────────

export type AiEmailPickInput = {
  companyName: string;
  website?: string;
  niche: string;
  location: string;
  phone?: string;
  /** All candidate emails (Maps CSV, website crawl, mailto, visible). */
  candidates: string[];
  csvEmail?: string | null;
  mailtoEmails?: string[];
  provider: AIProviderConfig;
};

/**
 * Uses the user's AI Settings provider to choose one real contact email
 * when scoring/CSV/website disagree (e.g. wrong Maps email vs contact page Gmail).
 */
export async function pickContactEmailWithAi(
  input: AiEmailPickInput
): Promise<string | null> {
  const unique = Array.from(
    new Set(
      input.candidates
        .map((e) => e.trim().toLowerCase())
        .filter((e) => e.includes('@'))
    )
  );
  if (unique.length === 0) return null;
  if (unique.length === 1) return unique[0];

  if (!input.provider.api_key || !isScrapeAiAvailable()) return null;

  let siteHost = '';
  if (input.website) {
    try {
      siteHost = new URL(
        input.website.startsWith('http') ? input.website : `https://${input.website}`
      ).hostname.replace(/^www\./, '');
    } catch {
      siteHost = '';
    }
  }

  const system = `You choose the single best real contact email for outbound business outreach.
Rules:
- Prefer emails shown on the company's own website or mailto links over third-party or wrong-domain addresses from Google Maps.
- Prefer addresses on the business domain (${siteHost || 'see website'}) when valid; Gmail/Yahoo are OK for small local businesses if they appear on the contact section.
- Prefer info@, contact@, hello@, reservations@, sales@ over personal or unrelated inboxes.
- NEVER pick noreply@, no-reply@, privacy@, placeholder@, or emails on unrelated domains.
- Return ONLY one email address, lowercase, nothing else. If none are suitable, return exactly: NONE`;

  const lines = [
    `Business: ${input.companyName}`,
    `Website: ${input.website || 'unknown'}`,
    `Industry: ${input.niche}`,
    `Location: ${input.location}`,
    input.phone ? `Phone: ${input.phone}` : '',
    input.csvEmail ? `Google Maps CSV email: ${input.csvEmail}` : 'Google Maps CSV email: (none)',
    input.mailtoEmails?.length
      ? `mailto: links on site: ${input.mailtoEmails.join(', ')}`
      : '',
    `All candidates: ${unique.join(', ')}`,
    '',
    'Which ONE email should we use to contact this business?',
  ].filter(Boolean);

  try {
    const response = await callAI(input.provider, system, lines.join('\n'), 40);
    const cleaned = response.trim().toLowerCase();
    if (cleaned === 'none' || !cleaned.includes('@')) return null;

    const match = cleaned.match(
      /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/
    );
    if (!match) return null;

    const picked = match[0].toLowerCase();
    if (!unique.includes(picked)) {
      const fuzzy = unique.find(
        (c) => c === picked || c.split('@')[1] === picked.split('@')[1]
      );
      return fuzzy ?? picked;
    }
    return picked;
  } catch (err) {
    noteScrapeAiRateLimit(err);
    return null;
  }
}

/** When true, call Settings LLM to resolve multi-email conflicts during Docker Maps scrape. */
export function shouldUseAiEmailPickForScrape(
  provider: AIProviderConfig | null,
  status: string,
  candidates: string[]
): boolean {
  if (!provider?.api_key) return false;
  const v = process.env.GMAPS_DOCKER_AI_EMAIL_PICK?.trim().toLowerCase();
  if (v === 'false' || v === '0' || v === 'no') return false;
  const unique = new Set(candidates.filter((e) => e.includes('@')));
  if (unique.size < 2) return false;
  return (
    status === 'needs_review' ||
    status === 'mismatch' ||
    status === 'csv_only' ||
    status === 'website_only'
  );
}
