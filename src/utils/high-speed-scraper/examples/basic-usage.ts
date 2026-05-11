/**
 * High-Speed Email Scraper - Basic Usage Examples
 */

import { HighSpeedScraper, quickScrape, scrapeAndExport, logger, LogLevel } from '../index';

// ─── Example 1: Quick Scrape ─────────────────────────────────────────────────

async function example1_QuickScrape() {
  console.log('\n=== Example 1: Quick Scrape ===\n');

  const urls = [
    'https://example.com',
    'https://github.com',
    'https://stackoverflow.com',
  ];

  const results = await quickScrape(urls, {
    concurrency: 10,
    timeout: 5000,
  });

  results.forEach(result => {
    console.log(`${result.url} → ${result.bestEmail || 'No email found'}`);
  });
}

// ─── Example 2: Advanced Configuration ──────────────────────────────────────

async function example2_AdvancedConfig() {
  console.log('\n=== Example 2: Advanced Configuration ===\n');

  const scraper = new HighSpeedScraper({
    concurrency: 50,           // 50 parallel workers
    timeout: 10000,            // 10 second timeout
    retries: 3,                // Retry failed requests 3 times
    retryDelay: 2000,          // 2 second delay between retries
    rateLimit: {
      maxRequestsPerSecond: 20,
      maxRequestsPerMinute: 500,
    },
    usePuppeteer: true,        // Fallback to Puppeteer for JS-heavy sites
    validateDNS: true,         // Validate email domains with DNS MX lookup
  });

  const urls = [
    'https://company1.com',
    'https://company2.com',
    'https://company3.com',
  ];

  const results = await scraper.scrape(urls);

  console.log(`Found ${results.filter(r => r.bestEmail).length} emails`);

  await scraper.stop();
}

// ─── Example 3: Scrape and Export ───────────────────────────────────────────

async function example3_ScrapeAndExport() {
  console.log('\n=== Example 3: Scrape and Export ===\n');

  const urls = [
    'https://company1.com',
    'https://company2.com',
    'https://company3.com',
  ];

  const { results, stats, files } = await scrapeAndExport(urls, './output', {
    concurrency: 20,
    timeout: 8000,
  });

  console.log('Results exported to:');
  console.log(`  JSON: ${files.json}`);
  console.log(`  CSV: ${files.csv}`);
  console.log(`  Stats: ${files.stats}`);
  console.log(`  Emails Only: ${files.emailsOnly}`);
}

// ─── Example 4: Large Scale Scraping ────────────────────────────────────────

async function example4_LargeScale() {
  console.log('\n=== Example 4: Large Scale Scraping (10,000 URLs) ===\n');

  // Generate 10,000 test URLs
  const urls: string[] = [];
  for (let i = 1; i <= 10000; i++) {
    urls.push(`https://company${i}.com`);
  }

  const scraper = new HighSpeedScraper({
    concurrency: 100,          // 100 parallel workers for speed
    timeout: 5000,             // 5 second timeout
    retries: 1,                // Only 1 retry for speed
    retryDelay: 500,
    rateLimit: {
      maxRequestsPerSecond: 50,
      maxRequestsPerMinute: 2000,
    },
    usePuppeteer: false,       // Disable Puppeteer for speed
    validateDNS: false,        // Disable DNS validation for speed
  });

  const startTime = Date.now();
  const results = await scraper.scrape(urls);
  const duration = Date.now() - startTime;

  const stats = scraper.getStats();

  console.log('\nResults:');
  console.log(`  Total: ${stats.total}`);
  console.log(`  Completed: ${stats.completed}`);
  console.log(`  Failed: ${stats.failed}`);
  console.log(`  Emails Found: ${stats.emailsFound}`);
  console.log(`  Duration: ${(duration / 1000).toFixed(1)}s`);
  console.log(`  Speed: ${(stats.total / (duration / 1000)).toFixed(0)} URLs/sec`);

  await scraper.stop();
}

// ─── Example 5: Progress Tracking ───────────────────────────────────────────

async function example5_ProgressTracking() {
  console.log('\n=== Example 5: Progress Tracking ===\n');

  logger.setLevel(LogLevel.INFO);

  const scraper = new HighSpeedScraper({
    concurrency: 20,
    timeout: 5000,
  });

  // Listen to events
  scraper['queue'].on('job-complete', ({ result, stats }) => {
    if (result.success && result.bestEmail) {
      console.log(`✓ Found: ${result.bestEmail} (${result.confidence}) from ${result.url}`);
    }
  });

  const urls = Array.from({ length: 100 }, (_, i) => `https://company${i + 1}.com`);
  await scraper.scrape(urls);
  await scraper.stop();
}

// ─── Example 6: Filter Results ──────────────────────────────────────────────

async function example6_FilterResults() {
  console.log('\n=== Example 6: Filter Results ===\n');

  const urls = [
    'https://company1.com',
    'https://company2.com',
    'https://company3.com',
  ];

  const results = await quickScrape(urls);

  // Filter by confidence
  const highConfidence = results.filter(r => r.confidence === 'high');
  console.log(`High confidence emails: ${highConfidence.length}`);

  // Filter by email domain
  const comEmails = results.filter(r => r.bestEmail?.endsWith('.com'));
  console.log(`Emails ending in .com: ${comEmails.length}`);

  // Get all unique emails
  const allEmails = new Set<string>();
  results.forEach(r => {
    r.allEmails.forEach(e => allEmails.add(e.email));
  });
  console.log(`Total unique emails found: ${allEmails.size}`);
}

// ─── Run Examples ────────────────────────────────────────────────────────────

async function runExamples() {
  try {
    // Uncomment the example you want to run:
    
    // await example1_QuickScrape();
    // await example2_AdvancedConfig();
    // await example3_ScrapeAndExport();
    // await example4_LargeScale();
    // await example5_ProgressTracking();
    // await example6_FilterResults();

    console.log('\n✓ Examples completed\n');
  } catch (error) {
    console.error('Error running examples:', error);
  }
}

// Run if executed directly
if (require.main === module) {
  runExamples();
}

export {
  example1_QuickScrape,
  example2_AdvancedConfig,
  example3_ScrapeAndExport,
  example4_LargeScale,
  example5_ProgressTracking,
  example6_FilterResults,
};
