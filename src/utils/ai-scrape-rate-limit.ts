/** Shared backoff when Groq/OpenAI returns 429 during scrape (many parallel site fetches). */

let disabledUntil = 0;
let logged = false;

let expansionDisabledUntil = 0;
let expansionLogged = false;

export function isScrapeAiAvailable(): boolean {
  return Date.now() >= disabledUntil;
}

/** Separate from scrape email helpers — district expansion is not blocked by their 429 pause. */
export function isExpansionAiAvailable(): boolean {
  return Date.now() >= expansionDisabledUntil;
}

export function noteScrapeAiRateLimit(err: unknown): void {
  const msg = String(err);
  if (!msg.includes("429")) return;
  disabledUntil = Date.now() + 120_000;
  if (!logged) {
    console.warn(
      "[AI Scraper] Rate limited (429) — pausing AI email helper for 2 minutes"
    );
    logged = true;
  }
}

export function noteExpansionAiRateLimit(err: unknown): void {
  const msg = String(err);
  if (!msg.includes("429")) return;
  expansionDisabledUntil = Date.now() + 120_000;
  if (!expansionLogged) {
    console.warn(
      "[EXPANSION] Rate limited (429) — pausing city area AI for 2 minutes"
    );
    expansionLogged = true;
  }
}

export function resetScrapeAiSession(): void {
  disabledUntil = 0;
  logged = false;
}

export function resetExpansionAiSession(): void {
  expansionDisabledUntil = 0;
  expansionLogged = false;
}
