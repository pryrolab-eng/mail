/**
 * High-Speed Email Scraper - Worker (Axios + Cheerio)
 */

import axios, { AxiosError } from 'axios';
import * as cheerio from 'cheerio';
import { ScraperConfig, ScrapedWebsite, EmailResult } from './types';
import { extractEmails, findBestEmail, getConfidence } from './email-extractor';
import { validateEmailDomain } from './dns-validator';

/**
 * Scrape a single website using Axios + Cheerio (fast)
 */
export async function scrapeWebsiteAxios(
  url: string,
  config: ScraperConfig
): Promise<ScrapedWebsite> {
  const startTime = Date.now();
  const normalizedUrl = normalizeUrl(url);

  try {
    // Fetch HTML
    const response = await axios.get(normalizedUrl, {
      timeout: config.timeout,
      headers: {
        'User-Agent': config.userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      },
      maxRedirects: 5,
      validateStatus: (status) => status >= 200 && status < 400,
    });

    // Parse HTML
    const $ = cheerio.load(response.data);

    // Remove script and style tags
    $('script, style, noscript').remove();

    // Get text content
    const html = $.html();
    const text = $('body').text();

    // Extract emails
    const allEmails = extractEmails(html + '\n' + text);

    // Validate domains if enabled
    let validatedEmails = allEmails;
    if (config.validateDNS && allEmails.length > 0) {
      validatedEmails = await filterValidDomains(allEmails);
    }

    // Find best email
    const best = findBestEmail(validatedEmails);
    const confidence = getConfidence(best);

    return {
      url: normalizedUrl,
      bestEmail: best?.email || null,
      confidence,
      allEmails: validatedEmails,
      sourceUrl: normalizedUrl,
      scrapedAt: new Date().toISOString(),
      method: 'axios',
      duration: Date.now() - startTime,
      success: true,
    };
  } catch (error) {
    return {
      url: normalizedUrl,
      bestEmail: null,
      confidence: 'none',
      allEmails: [],
      sourceUrl: normalizedUrl,
      scrapedAt: new Date().toISOString(),
      method: 'axios',
      duration: Date.now() - startTime,
      success: false,
      error: getErrorMessage(error),
    };
  }
}

/**
 * Scrape with retry logic
 */
export async function scrapeWithRetry(
  url: string,
  config: ScraperConfig
): Promise<ScrapedWebsite> {
  let lastError: string | undefined;

  for (let attempt = 0; attempt <= config.retries; attempt++) {
    try {
      const result = await scrapeWebsiteAxios(url, config);

      // If successful or non-retryable error, return
      if (result.success || !isRetryableError(result.error)) {
        return result;
      }

      lastError = result.error;

      // Wait before retry
      if (attempt < config.retries) {
        await new Promise(resolve => setTimeout(resolve, config.retryDelay * (attempt + 1)));
      }
    } catch (error) {
      lastError = getErrorMessage(error);

      if (attempt < config.retries) {
        await new Promise(resolve => setTimeout(resolve, config.retryDelay * (attempt + 1)));
      }
    }
  }

  // All retries failed
  return {
    url: normalizeUrl(url),
    bestEmail: null,
    confidence: 'none',
    allEmails: [],
    sourceUrl: normalizeUrl(url),
    scrapedAt: new Date().toISOString(),
    method: 'axios',
    duration: 0,
    success: false,
    error: lastError || 'Max retries exceeded',
  };
}

// ─── Helper Functions ────────────────────────────────────────────────────────

/**
 * Normalize URL (add https:// if missing)
 */
function normalizeUrl(url: string): string {
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return `https://${url}`;
  }
  return url;
}

/**
 * Filter emails by valid DNS MX records
 */
async function filterValidDomains(emails: EmailResult[]): Promise<EmailResult[]> {
  const validEmails: EmailResult[] = [];

  for (const emailResult of emails) {
    const dnsResult = await validateEmailDomain(emailResult.email);
    if (dnsResult.hasMX) {
      validEmails.push(emailResult);
    }
  }

  return validEmails;
}

/**
 * Check if error is retryable
 */
function isRetryableError(error?: string): boolean {
  if (!error) return false;

  const retryablePatterns = [
    'ECONNRESET',
    'ETIMEDOUT',
    'ECONNREFUSED',
    'ENOTFOUND',
    'timeout',
    '429', // Too Many Requests
    '500', // Internal Server Error
    '502', // Bad Gateway
    '503', // Service Unavailable
    '504', // Gateway Timeout
  ];

  return retryablePatterns.some(pattern => error.includes(pattern));
}

/**
 * Extract error message from various error types
 */
function getErrorMessage(error: unknown): string {
  if (error instanceof AxiosError) {
    if (error.code) return error.code;
    if (error.response?.status) return `HTTP ${error.response.status}`;
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
