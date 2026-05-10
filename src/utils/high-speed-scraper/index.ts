/**
 * High-Speed Email Scraper - Main Entry Point
 * 
 * Production-grade email scraper for thousands of websites
 * Features:
 * - Async parallel processing with worker queues
 * - Axios + Cheerio for fast scraping
 * - Puppeteer fallback for JS-heavy sites
 * - Email extraction from mailto, text, obfuscated formats
 * - Cloudflare email protection decoding
 * - Email quality scoring
 * - DNS MX validation
 * - Retry system with exponential backoff
 * - Rate limiting
 * - Progress tracking
 * - Export to JSON and CSV
 */

import { ScraperConfig, ScrapedWebsite, ScrapeStats } from './types';
import { WorkerQueue } from './worker-queue';
import { closeBrowser } from './puppeteer-worker';
import { exportToJSON, exportToCSV, exportStats, exportEmailsOnly } from './exporter';
import { logger, LogLevel } from './logger';
import { clearDNSCache, getDNSCacheStats } from './dns-validator';

export * from './types';
export { logger, LogLevel };

/**
 * High-Speed Email Scraper
 */
export class HighSpeedScraper {
  private config: ScraperConfig;
  private queue: WorkerQueue;

  constructor(config?: Partial<ScraperConfig>) {
    this.config = {
      concurrency: config?.concurrency || 50,
      timeout: config?.timeout || 10000,
      retries: config?.retries || 2,
      retryDelay: config?.retryDelay || 1000,
      rateLimit: {
        maxRequestsPerSecond: config?.rateLimit?.maxRequestsPerSecond || 20,
        maxRequestsPerMinute: config?.rateLimit?.maxRequestsPerMinute || 500,
      },
      usePuppeteer: config?.usePuppeteer ?? false,
      validateDNS: config?.validateDNS ?? false,
      userAgent: config?.userAgent || 
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    };

    this.queue = new WorkerQueue(this.config);
    this.setupEventListeners();
  }

  /**
   * Scrape multiple websites
   */
  async scrape(urls: string[]): Promise<ScrapedWebsite[]> {
    logger.info(`Starting scrape of ${urls.length} websites`);
    logger.info(`Config: ${this.config.concurrency} workers, ${this.config.timeout}ms timeout`);

    this.queue.clear();
    this.queue.addUrls(urls);

    const results = await this.queue.start();

    logger.info('Scraping complete');
    logger.stats(this.queue.getStats());

    return results;
  }

  /**
   * Scrape and export results
   */
  async scrapeAndExport(
    urls: string[],
    outputDir: string = './output'
  ): Promise<{
    results: ScrapedWebsite[];
    stats: ScrapeStats;
    files: {
      json: string;
      csv: string;
      stats: string;
      emailsOnly: string;
    };
  }> {
    const results = await this.scrape(urls);
    const stats = this.queue.getStats();

    // Create output directory if needed
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const baseFilename = `scrape-${timestamp}`;

    const files = {
      json: `${outputDir}/${baseFilename}.json`,
      csv: `${outputDir}/${baseFilename}.csv`,
      stats: `${outputDir}/${baseFilename}-stats.json`,
      emailsOnly: `${outputDir}/${baseFilename}-emails-only.json`,
    };

    // Export results
    logger.info('Exporting results...');
    await Promise.all([
      exportToJSON(results, stats, files.json),
      exportToCSV(results, files.csv),
      exportStats(stats, files.stats),
      exportEmailsOnly(results, files.emailsOnly, 'json'),
    ]);

    logger.info(`Results exported to ${outputDir}`);

    return { results, stats, files };
  }

  /**
   * Get current statistics
   */
  getStats(): ScrapeStats {
    return this.queue.getStats();
  }

  /**
   * Get DNS cache statistics
   */
  getDNSStats() {
    return getDNSCacheStats();
  }

  /**
   * Clear DNS cache
   */
  clearDNSCache(): void {
    clearDNSCache();
  }

  /**
   * Stop scraping (graceful shutdown)
   */
  async stop(): Promise<void> {
    logger.info('Stopping scraper...');
    await this.queue.stop();
    await closeBrowser();
    logger.info('Scraper stopped');
  }

  /**
   * Setup event listeners for progress tracking
   */
  private setupEventListeners(): void {
    this.queue.on('start', (stats: ScrapeStats) => {
      logger.info(`Queue started: ${stats.total} URLs`);
    });

    this.queue.on('job-complete', ({ result, stats }) => {
      if (stats.completed % 10 === 0) {
        logger.progress(
          stats.completed + stats.failed,
          stats.total,
          `${stats.emailsFound} emails found`
        );
      }

      if (result.success && result.bestEmail) {
        logger.debug(`✓ ${result.url} → ${result.bestEmail} (${result.confidence})`);
      } else if (!result.success) {
        logger.debug(`✗ ${result.url} → ${result.error}`);
      }
    });

    this.queue.on('complete', (stats: ScrapeStats) => {
      logger.info('Queue complete');
      logger.stats({
        total: stats.total,
        completed: stats.completed,
        failed: stats.failed,
        emailsFound: stats.emailsFound,
        successRate: `${((stats.completed / stats.total) * 100).toFixed(1)}%`,
        emailFoundRate: `${((stats.emailsFound / stats.completed) * 100).toFixed(1)}%`,
        avgDuration: `${Math.round(stats.avgDuration)}ms`,
        totalDuration: stats.endTime ? `${((stats.endTime - stats.startTime) / 1000).toFixed(1)}s` : 'N/A',
      });
    });
  }
}

/**
 * Quick scrape function (convenience wrapper)
 */
export async function quickScrape(
  urls: string[],
  options?: {
    concurrency?: number;
    timeout?: number;
    usePuppeteer?: boolean;
    validateDNS?: boolean;
  }
): Promise<ScrapedWebsite[]> {
  const scraper = new HighSpeedScraper(options);
  const results = await scraper.scrape(urls);
  await scraper.stop();
  return results;
}

/**
 * Scrape and export (convenience wrapper)
 */
export async function scrapeAndExport(
  urls: string[],
  outputDir: string = './output',
  options?: {
    concurrency?: number;
    timeout?: number;
    usePuppeteer?: boolean;
    validateDNS?: boolean;
  }
) {
  const scraper = new HighSpeedScraper(options);
  const result = await scraper.scrapeAndExport(urls, outputDir);
  await scraper.stop();
  return result;
}
