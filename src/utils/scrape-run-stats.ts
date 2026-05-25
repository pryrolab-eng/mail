import type { GmapsEmailVerificationRow } from './gmaps-docker-client';

/** In-memory counters for integration tests / debug runs */

export type ScrapeSessionSummary = {
  withEmail: number;
  phoneOnly: number;
  crmAdded: number;
  callListAdded: number;
  researched: number;
  realEmails: number;
  verifyRejected: number;
  knowledgeGraphHits: number;
};

export const scrapeRunStats = {
  mapsQueries: 0,
  commonCrawlHits: 0,
  knowledgeGraphEnriched: 0,
  verifyRejected: 0,
  verifyReasons: {} as Record<string, number>,
  session: {
    withEmail: 0,
    phoneOnly: 0,
    crmAdded: 0,
    callListAdded: 0,
    researched: 0,
    realEmails: 0,
  } as Omit<ScrapeSessionSummary, 'verifyRejected' | 'knowledgeGraphHits'>,
  /** Last Docker Maps run: CSV vs website email comparison (all rows with websites). */
  lastGmapsEmailVerification: [] as GmapsEmailVerificationRow[],
  lastGmapsEmailVerificationFile: '' as string,
};

export function resetScrapeRunStats(): void {
  scrapeRunStats.mapsQueries = 0;
  scrapeRunStats.commonCrawlHits = 0;
  scrapeRunStats.knowledgeGraphEnriched = 0;
  scrapeRunStats.verifyRejected = 0;
  scrapeRunStats.verifyReasons = {};
  scrapeRunStats.lastGmapsEmailVerification = [];
  scrapeRunStats.lastGmapsEmailVerificationFile = '';
  scrapeRunStats.session = {
    withEmail: 0,
    phoneOnly: 0,
    crmAdded: 0,
    callListAdded: 0,
    researched: 0,
    realEmails: 0,
  };
}

export function buildScrapeSessionSummary(): ScrapeSessionSummary {
  return {
    ...scrapeRunStats.session,
    verifyRejected: scrapeRunStats.verifyRejected,
    knowledgeGraphHits: scrapeRunStats.knowledgeGraphEnriched,
  };
}

export function recordVerifyRejection(reason: string): void {
  scrapeRunStats.verifyRejected++;
  scrapeRunStats.verifyReasons[reason] =
    (scrapeRunStats.verifyReasons[reason] ?? 0) + 1;
}
