/**
 * Read business website from a Google Maps place URL (gosom CSV `link` column).
 * Same idea as Puppeteer Maps scrape — many CSV rows have link but empty website.
 */

import puppeteer, { type Browser } from 'puppeteer';

const SKIP = [
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

function mapsPlaceFetchEnabled(): boolean {
  const v = process.env.GMAPS_MAPS_LINK_WEBSITE?.trim().toLowerCase();
  return v !== 'false' && v !== '0' && v !== 'no';
}

export async function fetchWebsiteFromMapsPlaceLink(
  placeUrl: string
): Promise<string | null> {
  if (!mapsPlaceFetchEnabled()) return null;
  if (!placeUrl?.includes('google.com/maps')) return null;

  try {
    const { getActiveScrapeBrowserPool } = await import('./scrape-browser-pool');
    const pool = getActiveScrapeBrowserPool();
    if (pool) {
      return pool.fetchWebsiteFromMapsPlaceLink(placeUrl);
    }

    let browser: Browser | undefined;
    try {
      browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      });
      const page = await browser.newPage();
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
      );
      await page.goto(placeUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      await new Promise((r) => setTimeout(r, 1500));

      const site = await page.evaluate((skipList) => {
        const skip = skipList as string[];
        const auth = document.querySelector<HTMLAnchorElement>(
          '[data-item-id="authority"] a'
        );
        if (auth?.href?.startsWith('http') && !skip.some((s) => auth.href.includes(s))) {
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
      }, SKIP);

      return site;
    } finally {
      await browser?.close().catch(() => undefined);
    }
  } catch (err) {
    console.log(
      `  ⚠️  Maps place page: could not read website (${(err as Error).message?.slice(0, 60)})`
    );
    return null;
  }
}
