/**
 * High-Speed Email Scraper - Type Definitions
 */

export interface ScraperConfig {
  concurrency: number;
  timeout: number;
  retries: number;
  retryDelay: number;
  rateLimit: {
    maxRequestsPerSecond: number;
    maxRequestsPerMinute: number;
  };
  usePuppeteer: boolean;
  validateDNS: boolean;
  userAgent: string;
}

export interface EmailResult {
  email: string;
  score: number;
  source: 'mailto' | 'text' | 'obfuscated' | 'cloudflare';
}

export interface ScrapedWebsite {
  url: string;
  bestEmail: string | null;
  confidence: 'high' | 'medium' | 'low' | 'none';
  allEmails: EmailResult[];
  sourceUrl: string;
  scrapedAt: string;
  method: 'axios' | 'puppeteer';
  duration: number;
  success: boolean;
  error?: string;
}

export interface ScrapeJob {
  url: string;
  priority: number;
  retries: number;
  addedAt: number;
}

export interface ScrapeStats {
  total: number;
  completed: number;
  failed: number;
  inProgress: number;
  avgDuration: number;
  emailsFound: number;
  startTime: number;
  endTime?: number;
}

export interface DNSResult {
  domain: string;
  hasMX: boolean;
  cached: boolean;
}
