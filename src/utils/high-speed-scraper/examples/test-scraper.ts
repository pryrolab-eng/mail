/**
 * High-Speed Email Scraper - Test Script
 * 
 * Run this to test the scraper with real websites
 */

import { HighSpeedScraper, logger, LogLevel } from '../index';

async function testScraper() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║         High-Speed Email Scraper - Test Run               ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  // Set log level
  logger.setLevel(LogLevel.INFO);

  // Test URLs (mix of different types)
  const testUrls = [
    // Tech companies (likely to have emails)
    'https://github.com',
    'https://stackoverflow.com',
    'https://npmjs.com',
    
    // Business websites
    'https://stripe.com',
    'https://shopify.com',
    'https://mailchimp.com',
    
    // Open source projects
    'https://nodejs.org',
    'https://reactjs.org',
    'https://vuejs.org',
    
    // News sites
    'https://techcrunch.com',
    'https://theverge.com',
    'https://arstechnica.com',
  ];

  console.log(`Testing with ${testUrls.length} URLs\n`);

  // Create scraper with balanced settings
  const scraper = new HighSpeedScraper({
    concurrency: 10,           // 10 parallel workers
    timeout: 8000,             // 8 second timeout
    retries: 2,                // 2 retries
    retryDelay: 1000,          // 1 second between retries
    rateLimit: {
      maxRequestsPerSecond: 5,
      maxRequestsPerMinute: 100,
    },
    usePuppeteer: false,       // Disable for speed
    validateDNS: false,        // Disable for speed
  });

  // Track progress
  let lastProgress = 0;
  scraper['queue'].on('job-complete', ({ result, stats }) => {
    const progress = Math.floor((stats.completed + stats.failed) / stats.total * 100);
    
    if (progress !== lastProgress && progress % 10 === 0) {
      console.log(`\n[${progress}%] Progress: ${stats.completed + stats.failed}/${stats.total}`);
      console.log(`  ✓ Completed: ${stats.completed}`);
      console.log(`  ✗ Failed: ${stats.failed}`);
      console.log(`  📧 Emails found: ${stats.emailsFound}`);
      lastProgress = progress;
    }

    if (result.success && result.bestEmail) {
      console.log(`  ✓ ${result.url}`);
      console.log(`    → ${result.bestEmail} (${result.confidence}, ${result.duration}ms)`);
    } else if (!result.success) {
      console.log(`  ✗ ${result.url} - ${result.error}`);
    }
  });

  // Start scraping
  const startTime = Date.now();
  const results = await scraper.scrape(testUrls);
  const duration = Date.now() - startTime;

  // Get stats
  const stats = scraper.getStats();

  // Display results
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║                      Results Summary                       ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  console.log(`Total URLs:        ${stats.total}`);
  console.log(`Successful:        ${stats.completed} (${((stats.completed / stats.total) * 100).toFixed(1)}%)`);
  console.log(`Failed:            ${stats.failed} (${((stats.failed / stats.total) * 100).toFixed(1)}%)`);
  console.log(`Emails Found:      ${stats.emailsFound} (${((stats.emailsFound / stats.completed) * 100).toFixed(1)}% of successful)`);
  console.log(`Avg Duration:      ${Math.round(stats.avgDuration)}ms per URL`);
  console.log(`Total Duration:    ${(duration / 1000).toFixed(1)}s`);
  console.log(`Speed:             ${(stats.total / (duration / 1000)).toFixed(1)} URLs/sec`);

  // Show emails found
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║                     Emails Found                           ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  const withEmails = results.filter(r => r.bestEmail);
  if (withEmails.length > 0) {
    withEmails.forEach((result, i) => {
      console.log(`${i + 1}. ${result.url}`);
      console.log(`   Email: ${result.bestEmail}`);
      console.log(`   Confidence: ${result.confidence}`);
      console.log(`   Method: ${result.method}`);
      console.log(`   All emails: ${result.allEmails.map(e => e.email).join(', ')}`);
      console.log('');
    });
  } else {
    console.log('No emails found in test URLs');
  }

  // Show confidence breakdown
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║                  Confidence Breakdown                      ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  const confidenceCounts = {
    high: results.filter(r => r.confidence === 'high').length,
    medium: results.filter(r => r.confidence === 'medium').length,
    low: results.filter(r => r.confidence === 'low').length,
    none: results.filter(r => r.confidence === 'none').length,
  };

  console.log(`High:     ${confidenceCounts.high} (${((confidenceCounts.high / stats.total) * 100).toFixed(1)}%)`);
  console.log(`Medium:   ${confidenceCounts.medium} (${((confidenceCounts.medium / stats.total) * 100).toFixed(1)}%)`);
  console.log(`Low:      ${confidenceCounts.low} (${((confidenceCounts.low / stats.total) * 100).toFixed(1)}%)`);
  console.log(`None:     ${confidenceCounts.none} (${((confidenceCounts.none / stats.total) * 100).toFixed(1)}%)`);

  // Cleanup
  await scraper.stop();

  console.log('\n✓ Test completed successfully\n');
}

// Run test
if (require.main === module) {
  testScraper().catch(error => {
    console.error('\n✗ Test failed:', error);
    process.exit(1);
  });
}

export { testScraper };
