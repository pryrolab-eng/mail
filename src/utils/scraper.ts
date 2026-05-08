/**
 * Lead Scraping Utilities (API-based)
 * Uses Google Custom Search and Google Places APIs to find business leads.
 */

import { findRealEmail } from './multi-source-email-finder';

export interface ScrapedLead {
  company_name: string;
  email: string;
  niche: string;
  location: string;
  company_context: string;
  source_url?: string;
  phone?: string;
  website?: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Extract unique email addresses from a block of text. */
export function extractEmails(text: string): string[] {
  const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  const matches = text.match(emailRegex);
  return matches ? Array.from(new Set(matches)) : [];
}

/** Clean up a raw company name scraped from a page title. */
function cleanCompanyName(raw: string): string {
  return raw
    .replace(/\s*[-|].*$/, '') // strip everything after – or |
    .trim();
}

// ─── Google Custom Search ────────────────────────────────────────────────────

/**
 * Scrape leads using the Google Custom Search JSON API.
 * Emails are extracted directly from search snippets, so results are limited
 * to companies that publish their address in meta descriptions / snippets.
 */
export async function scrapeWithGoogleSearch(
  niche: string,
  location: string,
  apiKey: string,
  cx: string
): Promise<ScrapedLead[]> {
  const leads: ScrapedLead[] = [];

  const queries = [
    `${niche} ${location} email contact`,
    `${niche} companies in ${location}`,
    `${niche} businesses ${location} contact information`,
  ];

  for (const query of queries) {
    try {
      const url =
        `https://www.googleapis.com/customsearch/v1` +
        `?key=${apiKey}&cx=${cx}&q=${encodeURIComponent(query)}&num=10`;

      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`[GoogleSearch] HTTP ${res.status} for query: ${query}`);
        continue;
      }

      const data = await res.json();

      for (const item of data.items ?? []) {
        const emails = extractEmails(item.snippet ?? '');
        if (emails.length === 0) continue;

        leads.push({
          company_name: cleanCompanyName(item.title ?? 'Unknown Company'),
          email: emails[0],
          niche,
          location,
          company_context: item.snippet ?? '',
          source_url: item.link,
          website: item.link,
        });
      }
    } catch (err) {
      console.error('[GoogleSearch] Error:', err);
    }

    // Respect rate limits
    await delay(500);
  }

  return leads;
}

// ─── Google Places ───────────────────────────────────────────────────────────

/**
 * Scrape leads using the Google Places API.
 * For each operational business found, it attempts to discover a REAL email
 * via multi-source lookup before falling back to a guessed address.
 */
export async function scrapeWithGooglePlaces(
  niche: string,
  location: string,
  apiKey: string
): Promise<ScrapedLead[]> {
  const leads: ScrapedLead[] = [];

  try {
    const searchUrl =
      `https://maps.googleapis.com/maps/api/place/textsearch/json` +
      `?query=${encodeURIComponent(`${niche} in ${location}`)}&key=${apiKey}`;

    const searchRes = await fetch(searchUrl);
    const searchData = await searchRes.json();

    for (const place of (searchData.results ?? []).slice(0, 15)) {
      try {
        const detailsUrl =
          `https://maps.googleapis.com/maps/api/place/details/json` +
          `?place_id=${place.place_id}` +
          `&fields=name,formatted_address,website,formatted_phone_number,business_status,rating,user_ratings_total` +
          `&key=${apiKey}`;

        const detailsRes = await fetch(detailsUrl);
        const detailsData = await detailsRes.json();
        const result = detailsData.result;

        if (!result || result.business_status !== 'OPERATIONAL') continue;

        // ── Try to find a REAL email ──────────────────────────────────────
        let email: string | null = null;

        console.log(`\n🔍 Finding real email for: ${result.name}`);

        try {
          const found = await findRealEmail(result.name, result.website, {
            useGoogle: true,
            useWebsite: true,
            useLinkedIn: true,
            timeout: 15_000,
          });

          if (found.email) {
            email = found.email;
            console.log(`✅ Real email: ${email} (${found.confidence}) via ${found.source}`);
          } else {
            console.log(`❌ No real email found for ${result.name}`);
          }
        } catch (e) {
          console.error('[Places] Email lookup failed:', e);
        }

        // ── Fallback only when nothing real was found ─────────────────────
        if (!email) {
          const domain = result.website
            ? new URL(result.website).hostname.replace('www.', '')
            : `${result.name.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`;
          email = `info@${domain}`;
          console.log(`⚠️  Fallback email: ${email}`);
        }

        leads.push({
          company_name: result.name,
          email,
          niche,
          location: result.formatted_address ?? location,
          company_context:
            `${result.name} is a ${niche} business at ${result.formatted_address ?? location}.` +
            (result.rating
              ? ` Rating: ${result.rating}/5 (${result.user_ratings_total} reviews)`
              : ''),
          source_url: result.website ?? undefined,
          phone: result.formatted_phone_number ?? undefined,
          website: result.website ?? undefined,
        });

        console.log(`✓ Lead added: ${result.name} — ${email}\n`);

        await delay(300);
      } catch (err) {
        console.error('[Places] Error fetching place details:', err);
      }
    }
  } catch (err) {
    console.error('[Places] Error:', err);
  }

  return leads;
}

// ─── LinkedIn stub ───────────────────────────────────────────────────────────

/**
 * LinkedIn scraping requires OAuth — placeholder for future implementation.
 */
export async function scrapeWithLinkedIn(
  _niche: string,
  _location: string,
  _accessToken: string
): Promise<ScrapedLead[]> {
  return [];
}

// ─── Main entry point ────────────────────────────────────────────────────────

/**
 * Orchestrate multiple API-based sources and return de-duplicated leads.
 */
export async function scrapeLeads(
  niche: string,
  location: string,
  options: {
    googleApiKey?: string;
    googleCx?: string;
    googlePlacesApiKey?: string;
    linkedInToken?: string;
  }
): Promise<ScrapedLead[]> {
  let allLeads: ScrapedLead[] = [];

  if (options.googlePlacesApiKey) {
    const placesLeads = await scrapeWithGooglePlaces(niche, location, options.googlePlacesApiKey);
    allLeads = [...allLeads, ...placesLeads];
  }

  if (allLeads.length < 10 && options.googleApiKey && options.googleCx) {
    const searchLeads = await scrapeWithGoogleSearch(
      niche,
      location,
      options.googleApiKey,
      options.googleCx
    );
    allLeads = [...allLeads, ...searchLeads];
  }

  // De-duplicate by email
  return allLeads.filter(
    (lead, idx, self) => idx === self.findIndex((l) => l.email === lead.email)
  );
}

// ─── Enrichment ──────────────────────────────────────────────────────────────

/** Normalise a lead's company name and validate its email format. */
export function enrichLead(lead: ScrapedLead): ScrapedLead {
  lead.company_name = lead.company_name
    .replace(/\s*-\s*.*$/, '')
    .replace(/\s*\|.*$/, '')
    .trim();

  const emailRegex = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;
  if (!emailRegex.test(lead.email)) {
    lead.email = `info@${lead.company_name.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`;
  }

  return lead;
}

// ─── Utility ─────────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
