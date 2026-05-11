/**
 * High-Speed Email Scraper - DNS MX Record Validation
 */

import { DNSResult } from './types';

// ─── DNS Cache ───────────────────────────────────────────────────────────────

const dnsCache = new Map<string, { hasMX: boolean; timestamp: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Validate email domain has MX records (with caching)
 */
export async function validateEmailDomain(email: string): Promise<DNSResult> {
  const domain = email.split('@')[1];
  if (!domain) {
    return { domain: '', hasMX: false, cached: false };
  }

  // Check cache first
  const cached = dnsCache.get(domain);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return { domain, hasMX: cached.hasMX, cached: true };
  }

  // Validate via DNS
  const hasMX = await checkMXRecords(domain);

  // Cache result
  dnsCache.set(domain, { hasMX, timestamp: Date.now() });

  return { domain, hasMX, cached: false };
}

/**
 * Check if domain has MX records using Google DNS API
 */
async function checkMXRecords(domain: string): Promise<boolean> {
  try {
    const url = `https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=MX`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) return false;

    const data = await response.json() as { Answer?: unknown[] };
    return Array.isArray(data.Answer) && data.Answer.length > 0;
  } catch {
    // On error, assume valid (don't discard potentially good emails)
    return true;
  }
}

/**
 * Batch validate multiple email domains
 */
export async function batchValidateDomains(
  emails: string[],
  concurrency: number = 10
): Promise<Map<string, boolean>> {
  const results = new Map<string, boolean>();
  const domains = Array.from(new Set(emails.map(e => e.split('@')[1]).filter(Boolean)));

  // Process in batches
  for (let i = 0; i < domains.length; i += concurrency) {
    const batch = domains.slice(i, i + concurrency);
    const promises = batch.map(async domain => {
      const result = await validateEmailDomain(`test@${domain}`);
      return { domain, hasMX: result.hasMX };
    });

    const batchResults = await Promise.all(promises);
    batchResults.forEach(({ domain, hasMX }) => {
      results.set(domain, hasMX);
    });
  }

  return results;
}

/**
 * Clear DNS cache (useful for testing)
 */
export function clearDNSCache(): void {
  dnsCache.clear();
}

/**
 * Get DNS cache stats
 */
export function getDNSCacheStats() {
  return {
    size: dnsCache.size,
    entries: Array.from(dnsCache.entries()).map(([domain, data]) => ({
      domain,
      hasMX: data.hasMX,
      age: Date.now() - data.timestamp,
    })),
  };
}
