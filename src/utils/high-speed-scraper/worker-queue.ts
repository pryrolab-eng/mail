/**
 * High-Speed Email Scraper - Worker Queue System
 */

import { EventEmitter } from 'events';
import { ScraperConfig, ScrapeJob, ScrapedWebsite, ScrapeStats } from './types';
import { scrapeWithRetry } from './scraper-worker';
import { scrapeWebsitePuppeteer } from './puppeteer-worker';
import { RateLimiter } from './rate-limiter';

export class WorkerQueue extends EventEmitter {
  private queue: ScrapeJob[] = [];
  private inProgress = new Map<string, Promise<ScrapedWebsite>>();
  private results: ScrapedWebsite[] = [];
  private config: ScraperConfig;
  private rateLimiter: RateLimiter;
  private stats: ScrapeStats;
  private isRunning = false;

  constructor(config: ScraperConfig) {
    super();
    this.config = config;
    this.rateLimiter = new RateLimiter(
      config.rateLimit.maxRequestsPerSecond,
      config.rateLimit.maxRequestsPerMinute
    );
    this.stats = {
      total: 0,
      completed: 0,
      failed: 0,
      inProgress: 0,
      avgDuration: 0,
      emailsFound: 0,
      startTime: Date.now(),
    };
  }

  /**
   * Add URLs to queue
   */
  addUrls(urls: string[], priority: number = 0): void {
    const jobs: ScrapeJob[] = urls.map(url => ({
      url,
      priority,
      retries: 0,
      addedAt: Date.now(),
    }));

    this.queue.push(...jobs);
    this.stats.total += jobs.length;

    // Sort by priority (higher first)
    this.queue.sort((a, b) => b.priority - a.priority);

    this.emit('urls-added', jobs.length);
  }

  /**
   * Start processing queue
   */
  async start(): Promise<ScrapedWebsite[]> {
    if (this.isRunning) {
      throw new Error('Queue is already running');
    }

    this.isRunning = true;
    this.stats.startTime = Date.now();
    this.emit('start', this.stats);

    // Start workers
    const workers: Promise<void>[] = [];
    for (let i = 0; i < this.config.concurrency; i++) {
      workers.push(this.worker(i));
    }

    // Wait for all workers to complete
    await Promise.all(workers);

    this.stats.endTime = Date.now();
    this.isRunning = false;
    this.emit('complete', this.stats);

    return this.results;
  }

  /**
   * Worker function (processes jobs from queue)
   */
  private async worker(workerId: number): Promise<void> {
    while (this.queue.length > 0 || this.inProgress.size > 0) {
      // Get next job
      const job = this.queue.shift();
      if (!job) {
        // No jobs available, wait a bit
        await new Promise(resolve => setTimeout(resolve, 100));
        continue;
      }

      // Wait for rate limit
      await this.rateLimiter.waitForSlot();

      // Process job
      const promise = this.processJob(job, workerId);
      this.inProgress.set(job.url, promise);
      this.stats.inProgress = this.inProgress.size;

      // Don't await here - let it run in background
      promise.finally(() => {
        this.inProgress.delete(job.url);
        this.stats.inProgress = this.inProgress.size;
      });
    }
  }

  /**
   * Process a single job
   */
  private async processJob(job: ScrapeJob, workerId: number): Promise<ScrapedWebsite> {
    this.emit('job-start', { job, workerId });

    let result: ScrapedWebsite;

    try {
      // Try Axios first (faster)
      result = await scrapeWithRetry(job.url, this.config);

      // If Axios failed and Puppeteer is enabled, try Puppeteer
      if (!result.success && this.config.usePuppeteer) {
        this.emit('job-retry-puppeteer', { job, workerId });
        result = await scrapeWebsitePuppeteer(job.url, this.config);
      }
    } catch (error) {
      result = {
        url: job.url,
        bestEmail: null,
        confidence: 'none',
        allEmails: [],
        sourceUrl: job.url,
        scrapedAt: new Date().toISOString(),
        method: 'axios',
        duration: 0,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    // Update stats
    if (result.success) {
      this.stats.completed++;
      if (result.bestEmail) this.stats.emailsFound++;
    } else {
      this.stats.failed++;
    }

    // Update average duration
    const totalDuration = this.stats.avgDuration * (this.stats.completed + this.stats.failed - 1);
    this.stats.avgDuration = (totalDuration + result.duration) / (this.stats.completed + this.stats.failed);

    // Store result
    this.results.push(result);

    this.emit('job-complete', { job, result, workerId, stats: this.stats });

    return result;
  }

  /**
   * Get current stats
   */
  getStats(): ScrapeStats {
    return { ...this.stats };
  }

  /**
   * Get results
   */
  getResults(): ScrapedWebsite[] {
    return [...this.results];
  }

  /**
   * Clear queue and results
   */
  clear(): void {
    this.queue = [];
    this.results = [];
    this.inProgress.clear();
    this.stats = {
      total: 0,
      completed: 0,
      failed: 0,
      inProgress: 0,
      avgDuration: 0,
      emailsFound: 0,
      startTime: Date.now(),
    };
  }

  /**
   * Stop processing (graceful shutdown)
   */
  async stop(): Promise<void> {
    this.isRunning = false;
    this.queue = [];

    // Wait for in-progress jobs to complete
    await Promise.all(Array.from(this.inProgress.values()));

    this.emit('stopped', this.stats);
  }
}
