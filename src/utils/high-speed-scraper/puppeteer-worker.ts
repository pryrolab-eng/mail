/**
 * High-Speed Email Scraper - Puppeteer Worker (for JS-heavy sites)
 */

import puppeteer, { Browser, Page } from 'puppeteer';
import { ScraperConfig, ScrapedWebsite } from './types';
import { extractEmails, findBestEmail, getConfidence } from './email-extractor';
import { validateEmailDomain } from './dns-validator';

let browserInstance: Browser | null = null;

/**
 * Get or create browser instance (reuse for performance)
 */
async function getBrowser(): Promise<Browser> {
  if (!browserInstance || !browserInstance.isConnected()) {
    browserInstance = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920,1080',
      ],
    });
  }
  return browserInstance;
}

/**
 * Close browser instance
 */
export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}

/**
 * Scrape a single website using Puppeteer (for JS-rendered content)
 */
export async function scrapeWebsitePuppeteer(
  url: string,
  config: ScraperConfig
): Promise<ScrapedWebsite> {
  const startTime = Date.now();
  const normalizedUrl = normalizeUrl(url);
  let page: Page | null = null;

  try {
    const browser = await getBrowser();
    page = await browser.newPage();

    // Set user agent
    await page.setUserAgent(config.userAgent);

    // Set viewport
    await page.setViewport({ width: 1920, height: 1080 });

    // Block unnecessary resources for speed
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const resourceType = request.resourceType();
      if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
        request.abort();
      } else {
        request.continue();
      }
    });

    // Navigate to page
    await page.goto(normalizedUrl, {
      waitUntil: 'domcontentloaded',
      timeout: config.timeout,
    });

    // Wait for JS to execute
    await new Promise((r) => setTimeout(r, 1500));

    // Extract content
    const content = await page.evaluate(() => {
      // Remove script and style tags
      document.querySelectorAll('script, style, noscript').forEach(el => el.remove());

      return {
        html: document.documentElement.innerHTML,
        text: document.body.innerText,
      };
    });

    // Extract emails
    const allEmails = extractEmails(content.html + '\n' + content.text);

    // Validate domains if enabled
    let validatedEmails = allEmails;
    if (config.validateDNS && allEmails.length > 0) {
      const validDomains = new Set<string>();
      for (const emailResult of allEmails) {
        const dnsResult = await validateEmailDomain(emailResult.email);
        if (dnsResult.hasMX) {
          validDomains.add(emailResult.email.split('@')[1]);
        }
      }
      validatedEmails = allEmails.filter(e => validDomains.has(e.email.split('@')[1]));
    }

    // Find best email
    const best = findBestEmail(validatedEmails);
    const confidence = getConfidence(best);

    await page.close();

    return {
      url: normalizedUrl,
      bestEmail: best?.email || null,
      confidence,
      allEmails: validatedEmails,
      sourceUrl: normalizedUrl,
      scrapedAt: new Date().toISOString(),
      method: 'puppeteer',
      duration: Date.now() - startTime,
      success: true,
    };
  } catch (error) {
    if (page) await page.close().catch(() => {});

    return {
      url: normalizedUrl,
      bestEmail: null,
      confidence: 'none',
      allEmails: [],
      sourceUrl: normalizedUrl,
      scrapedAt: new Date().toISOString(),
      method: 'puppeteer',
      duration: Date.now() - startTime,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Normalize URL
 */
function normalizeUrl(url: string): string {
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return `https://${url}`;
  }
  return url;
}
