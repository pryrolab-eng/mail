/**
 * Optional Brave Search API (replaces blocked DDG HTML when BRAVE_SEARCH_API_KEY is set).
 * https://api.search.brave.com/
 */

import type { SearchHit } from './search-engine-fetch';

export async function braveWebSearch(
  query: string,
  count = 15
): Promise<SearchHit[]> {
  const key = process.env.BRAVE_SEARCH_API_KEY?.trim();
  if (!key) return [];

  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(Math.min(count, 20)));

  const res = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
      'X-Subscription-Token': key,
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    console.log(`  🦁 Brave API HTTP ${res.status}`);
    return [];
  }

  const data = (await res.json()) as {
    web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
  };

  return (data.web?.results ?? [])
    .filter((r) => r.title && r.url)
    .map((r) => ({
      title: r.title!,
      url: r.url!,
      snippet: r.description ?? '',
    }));
}

export function hasBraveSearchApi(): boolean {
  return Boolean(process.env.BRAVE_SEARCH_API_KEY?.trim());
}
