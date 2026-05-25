/**
 * Email source + confidence for CRM and email generation gating.
 */

import type { ScrapedLead } from '@/types/platform';

export type EmailSource =
  | 'maps_csv'
  | 'website_mailto'
  | 'website_visible'
  | 'website_crawl'
  | 'bing_snippet'
  | 'domain_guess'
  | 'free_finder'
  | 'ai_predicted'
  | 'unknown';

export type EmailConfidence = 'high' | 'medium' | 'low';

export function inferEmailMetaFromScrapedLead(lead: ScrapedLead): {
  email_source: EmailSource;
  email_confidence: EmailConfidence;
} {
  if (lead.phoneOnly || !lead.email?.trim()) {
    return { email_source: 'unknown', email_confidence: 'low' };
  }

  const status = (lead.email_verify_status ?? '').toLowerCase();
  const mailto =
    lead.email_from_website &&
    lead.email?.toLowerCase() === lead.email_from_website.toLowerCase();

  if (status === 'match' || status === 'ai_picked') {
    return {
      email_source: lead.email_from_csv ? 'maps_csv' : 'website_crawl',
      email_confidence: 'high',
    };
  }

  if (lead.emailIsReal === true) {
    if (mailto || status === 'website_only') {
      return { email_source: 'website_mailto', email_confidence: 'high' };
    }
    return { email_source: 'website_crawl', email_confidence: 'high' };
  }

  if (lead.email_from_csv) {
    return { email_source: 'maps_csv', email_confidence: 'medium' };
  }

  return { email_source: 'unknown', email_confidence: 'low' };
}

/** Minimum confidence for bulk / pipeline email generation (default high+medium). */
export function emailConfidenceRank(c: EmailConfidence): number {
  if (c === 'high') return 3;
  if (c === 'medium') return 2;
  return 1;
}

export function meetsMinEmailConfidence(
  confidence: string | null | undefined,
  min: EmailConfidence = 'medium'
): boolean {
  const c = (confidence ?? 'low') as EmailConfidence;
  return emailConfidenceRank(c) >= emailConfidenceRank(min);
}
