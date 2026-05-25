/**
 * One headless Chrome per scrape job — reused for Maps, place pages, and site fallbacks.
 * Avoids launch/close per URL (much faster on Windows/Docker).
 */

import puppeteer, { type Browser, type Page } from 'puppeteer';

export const SCRAPE_BROWSER_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-blink-features=AutomationControlled',
  '--disable-gpu',
  '--window-size=1280,800',
];

const MAPS_SKIP_DOMAINS = [
  'google.com',
  'google.rw',
  'maps.google',
  'goo.gl',
  'facebook.com',
  'instagram.com',
  'twitter.com',
  'youtube.com',
  'linkedin.com',
];

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function poolEnabled(): boolean {
  const v = process.env.SCRAPE_BROWSER_POOL?.trim().toLowerCase();
  return v !== 'false' && v !== '0' && v !== 'no';
}

let activePool: ScrapeBrowserPool | null = null;

export function getActiveScrapeBrowserPool(): ScrapeBrowserPool | null {
  return activePool;
}

/** Run fn with a shared browser for the whole scrape session. */
export async function runWithScrapeBrowserPool<T>(fn: () => Promise<T>): Promise<T> {
  if (!poolEnabled()) return fn();

  const pool = await ScrapeBrowserPool.create();
  activePool = pool;
  console.log('🌐 Scrape browser pool: one Chrome for this job (reuse across Maps/sites/search)');
  try {
    return await fn();
  } finally {
    await pool.close();
    activePool = null;
  }
}

export class ScrapeBrowserPool {
  private browser: Browser | null = null;
  /** Serialize short HTML fetches so we do not open dozens of tabs at once. */
  private fetchChain: Promise<void> = Promise.resolve();

  static async create(): Promise<ScrapeBrowserPool> {
    const pool = new ScrapeBrowserPool();
    pool.browser = await puppeteer.launch({
      headless: true,
      args: SCRAPE_BROWSER_ARGS,
    });
    return pool;
  }

  async getBrowser(): Promise<Browser> {
    if (!this.browser) {
      throw new Error('Scrape browser pool is closed');
    }
    return this.browser;
  }

  private async withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
    const browser = await this.getBrowser();
    const run = this.fetchChain.then(async () => {
      const page = await browser.newPage();
      try {
        await page.setUserAgent(
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        );
        await page.setViewport({ width: 1280, height: 800 });
        await page.evaluateOnNewDocument(() => {
          Object.defineProperty(navigator, 'webdriver', { get: () => false });
        });
        return await fn(page);
      } finally {
        await page.close().catch(() => undefined);
      }
    });
    this.fetchChain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  async fetchHtml(url: string, postBody?: string): Promise<string> {
    return this.withPage(async (page) => {
      if (postBody) {
        await page.goto('https://html.duckduckgo.com/html/', {
          waitUntil: 'domcontentloaded',
          timeout: 20_000,
        });
        await page.type('input[name="q"]', postBody, { delay: 30 });
        await Promise.all([
          page
            .waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20_000 })
            .catch(() => null),
          page.keyboard.press('Enter'),
        ]);
        await delay(1500);
      } else {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25_000 });
        await delay(1000);
      }
      return await page.content();
    });
  }

  async fetchWebsiteFromMapsPlaceLink(placeUrl: string): Promise<string | null> {
    if (!placeUrl?.includes('google.com/maps')) return null;

    return this.withPage(async (page) => {
      await page.goto(placeUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      await delay(1500);

      return page.evaluate((skipList) => {
        const skip = skipList as string[];
        const auth = document.querySelector<HTMLAnchorElement>(
          '[data-item-id="authority"] a'
        );
        if (
          auth?.href?.startsWith('http') &&
          !skip.some((s) => auth.href.includes(s))
        ) {
          return auth.href;
        }
        for (const a of Array.from(
          document.querySelectorAll<HTMLAnchorElement>('a[href^="http"]')
        )) {
          const h = a.href;
          if (skip.some((s) => h.includes(s))) continue;
          if (/wikipedia|yelp|tripadvisor|yellowpages/i.test(h)) continue;
          return h;
        }
        return null;
      }, MAPS_SKIP_DOMAINS);
    });
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close().catch(() => undefined);
      this.browser = null;
    }
  }
}
