/**
 * AI Scraper Helper
 *
 * Uses the user's configured AI provider (server-side) to:
 *  1. Generate smarter search queries for a niche + location
 *  2. Extract/guess the most likely email for a business given its website content
 *  3. Generate a plausible email pattern when no email is visible on the site
 *
 * All calls go through the same AI provider the user configured in Settings.
 */

import { createServiceClient } from '../../supabase/service';

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
    const { data } = await service
      .from('ai_settings')
      .select('provider, api_key, active_model')
      .eq('user_id', userId)
      .eq('is_active', true)
      .single();

    if (!data?.api_key) return null;
    return data as AIProviderConfig;
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
  const { provider: name, api_key, active_model } = provider;

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
    if (!res.ok) throw new Error(`${name} API error: ${res.status}`);
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

  try {
    const response = await callAI(provider, system, user, 300);
    const queries = response
      .split('\n')
      .map(q => q.trim())
      .filter(q => q.length > 10 && q.length < 200)
      .slice(0, 6);
    return queries;
  } catch (err) {
    console.warn('[AI Scraper] generateSearchQueries failed:', err);
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
- If no real email is visible but the domain is clear, you may suggest info@${domain} or contact@${domain}
- NEVER return noreply@, donotreply@, or system emails
- If you truly cannot find or infer any email, return exactly: NONE`;

  // Truncate to avoid token limits
  const truncated = websiteText.slice(0, 2000);

  const user = `Company: ${companyName}
Domain: ${domain}
Website content:
${truncated}

What is the contact email address for this business?`;

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
    console.warn('[AI Scraper] extractEmailFromContent failed:', err);
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
    console.warn('[AI Scraper] predictEmailPattern failed:', err);
    return null;
  }
}
