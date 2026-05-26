/**
 * Website Email Scraper
 * Scrapes real email addresses from company websites without using paid APIs
 */

import {
  buildWebsiteFetchUrls,
  extractEmailsFromHtml,
  pickFromAggregatedPages,
} from './business-email-picker';
import https from 'https';

export interface EmailScrapingResult {
  emails: string[];
  bestEmail: string | null;
  source: string;
  success: boolean;
}

const unreachableHosts = new Set<string>();

/**
 * Extract email addresses from HTML content
 */
function extractEmailsFromHTML(html: string): string[] {
  const emails = new Set<string>();
  
  // Method 1: Find mailto: links (most reliable)
  const mailtoRegex = /mailto:([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/gi;
  const mailtoMatches = html.matchAll(mailtoRegex);
  for (const match of mailtoMatches) {
    emails.add(match[1].toLowerCase());
  }
  
  // Method 2: Find plain email addresses in text
  const emailRegex = /\b([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})\b/g;
  const textMatches = html.matchAll(emailRegex);
  for (const match of textMatches) {
    const email = match[1].toLowerCase();
    
    // Filter out common false positives
    if (
      !email.includes('example.com') &&
      !email.includes('sentry.io') &&
      !email.includes('wixpress.com') &&
      !email.includes('squarespace.com') &&
      !email.includes('@2x') &&
      !email.includes('.png') &&
      !email.includes('.jpg') &&
      !email.includes('.gif') &&
      !email.includes('placeholder')
    ) {
      emails.add(email);
    }
  }
  
  return Array.from(emails);
}

/**
 * Score email addresses to find the best one
 */
function scoreEmail(email: string): number {
  const localPart = email.split('@')[0].toLowerCase();
  
  // Preferred email prefixes (higher score = better)
  if (['info', 'contact', 'hello', 'hi'].includes(localPart)) return 10;
  if (['sales', 'business', 'inquiries', 'inquiry'].includes(localPart)) return 8;
  if (['support', 'help', 'service'].includes(localPart)) return 6;
  if (['admin', 'office', 'team'].includes(localPart)) return 5;
  
  // Avoid these
  if (localPart.includes('noreply') || localPart.includes('no-reply')) return -10;
  if (localPart.includes('donotreply')) return -10;
  if (localPart.includes('marketing') || localPart.includes('newsletter')) return 2;
  
  // Personal emails (first.last@) are okay
  if (localPart.includes('.')) return 4;
  
  return 3; // Default score
}

/**
 * Find the best email from a list
 */
function findBestEmail(emails: string[]): string | null {
  if (emails.length === 0) return null;
  
  // Sort by score (highest first)
  const sorted = emails.sort((a, b) => scoreEmail(b) - scoreEmail(a));
  
  // Return the highest scored email
  return sorted[0];
}

/**
 * Fetch a webpage with proper headers
 */
export async function fetchWebpage(url: string, timeout: number = 10000): Promise<string | null> {
  const host = getUrlHost(url);
  if (host && unreachableHosts.has(host)) {
    return null;
  }

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'identity',
    'Connection': 'keep-alive',
  };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    const response = await fetch(url, {
      headers,
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) return null;
    
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) return null;
    
    return await response.text();
  } catch (error) {
    if (isTlsCertificateError(error) && url.startsWith('https://')) {
      const html = await fetchWebpageAllowBadCertificate(url, timeout, headers);
      if (!html) {
        console.warn(`[Email Scraper] Skipped ${url} (bad SSL certificate)`);
      }
      return html;
    }

    const reason = getFetchFailureReason(error);
    if (host && reason === 'dns not found') {
      unreachableHosts.add(host);
    }
    console.warn(`[Email Scraper] Skipped ${url} (${reason})`);
    return null;
  }
}

function getUrlHost(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

function getFetchFailureReason(error: unknown): string {
  const err = error as {
    name?: string;
    code?: string;
    cause?: { code?: string };
    message?: string;
  };
  const code = err.code || err.cause?.code || '';

  if (err.name === 'AbortError') return 'timeout';
  if (code === 'ENOTFOUND') return 'dns not found';
  if (code === 'ECONNREFUSED') return 'connection refused';
  if (code === 'ECONNRESET') return 'connection reset';
  if (code === 'ETIMEDOUT') return 'timeout';
  if (isTlsCertificateError(error)) return 'bad SSL certificate';

  return err.message?.slice(0, 120) || 'fetch failed';
}

function isTlsCertificateError(error: unknown): boolean {
  const err = error as { code?: string; cause?: { code?: string }; message?: string };
  const code = err.code || err.cause?.code || '';
  return (
    code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
    code === 'SELF_SIGNED_CERT_IN_CHAIN' ||
    code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
    /self-signed certificate|unable to verify/i.test(err.message ?? '')
  );
}

function fetchWebpageAllowBadCertificate(
  url: string,
  timeout: number,
  headers: Record<string, string>
): Promise<string | null> {
  return new Promise((resolve) => {
    const req = https.get(
      url,
      {
        headers,
        timeout,
        rejectUnauthorized: false,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const contentType = String(res.headers['content-type'] ?? '');
        if (status < 200 || status >= 300 || !contentType.includes('text/html')) {
          res.resume();
          resolve(null);
          return;
        }

        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
          if (body.length > 2_000_000) {
            req.destroy();
            resolve(body);
          }
        });
        res.on('end', () => resolve(body));
      }
    );

    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.on('error', () => resolve(null));
  });
}

/**
 * Generate possible URLs to check for a company
 */
function generateURLsToCheck(companyName: string, website?: string): string[] {
  const urls: string[] = [];

  if (website) {
    return buildWebsiteFetchUrls(website);
  } else {
    // Generate domain from company name
    const slug = companyName
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, '')
      .slice(0, 30);
    
    // Try common TLDs
    const domains = [
      `https://www.${slug}.com`,
      `https://${slug}.com`,
      `https://www.${slug}.org`,
      `https://${slug}.org`,
      `https://www.${slug}.net`,
    ];
    
    for (const domain of domains) {
      urls.push(domain);
      urls.push(`${domain}/contact`);
    }
  }
  
  return urls;
}

/**
 * Scrape email addresses from a company's website
 */
export async function scrapeEmailFromWebsite(
  companyName: string,
  website?: string
): Promise<EmailScrapingResult> {
  const urlsToCheck = generateURLsToCheck(companyName, website);
  const allEmails = new Set<string>();
  let successUrl = '';
  
  console.log(`[Email Scraper] Checking ${urlsToCheck.length} URLs for ${companyName}`);

  let siteHost = '';
  if (website) {
    try {
      siteHost = new URL(
        website.startsWith('http') ? website : `https://${website}`
      ).hostname.replace(/^www\./, '');
    } catch {
      siteHost = '';
    }
  }

  const pages: Array<{
    url: string;
    extracted: ReturnType<typeof extractEmailsFromHtml>;
  }> = [];

  for (const url of urlsToCheck) {
    console.log(`[Email Scraper] Fetching: ${url}`);
    const html = await fetchWebpage(url);
    if (!html) continue;
    const extracted = extractEmailsFromHtml(html);
    if (extracted.all.length > 0) {
      console.log(`[Email Scraper] Found ${extracted.all.length} emails on ${url}`);
      pages.push({ url, extracted });
      extracted.all.forEach((email) => allEmails.add(email));
      if (!successUrl) successUrl = url;
    }
  }

  const pick =
    siteHost && pages.length > 0
      ? pickFromAggregatedPages(pages, siteHost)
      : null;
  const emailArray = pick?.allEmails.length
    ? pick.allEmails
    : Array.from(allEmails);
  const bestEmail =
    pick?.bestEmail ?? findBestEmail(emailArray);
  
  console.log(`[Email Scraper] Results for ${companyName}:`, {
    totalFound: emailArray.length,
    bestEmail,
    allEmails: emailArray,
  });
  
  return {
    emails: emailArray,
    bestEmail,
    source: successUrl,
    success: emailArray.length > 0,
  };
}

/**
 * Batch scrape emails for multiple companies
 */
export async function batchScrapeEmails(
  companies: Array<{ name: string; website?: string }>,
  delayMs: number = 1000
): Promise<Map<string, EmailScrapingResult>> {
  const results = new Map<string, EmailScrapingResult>();
  
  for (const company of companies) {
    const result = await scrapeEmailFromWebsite(company.name, company.website);
    results.set(company.name, result);
    
    // Add delay to avoid rate limiting
    if (delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  
  return results;
}
