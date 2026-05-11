# High-Speed Email Scraper

Production-grade email scraper for thousands of websites built with TypeScript and Node.js.

## Features

✅ **High Performance**
- Scrape 10,000+ websites efficiently
- 50-100 concurrent workers
- Async parallel processing with worker queues
- Optimized for speed and low memory usage

✅ **Smart Scraping**
- Axios + Cheerio for fast scraping (default)
- Puppeteer fallback for JavaScript-heavy sites
- Automatic retry with exponential backoff
- Rate limiting (requests per second/minute)
- Timeout protection

✅ **Advanced Email Extraction**
- Extract from `mailto:` links
- Extract from visible text
- Decode obfuscated emails (`[at]`, `[dot]`)
- Decode Cloudflare email protection
- Extract from `data-cfemail` attributes

✅ **Email Validation**
- Filter fake emails (noreply, example.com, etc.)
- Filter tracking emails and image filenames
- Score emails by quality (info@, contact@, sales@, etc.)
- DNS MX record validation (optional)

✅ **Export & Reporting**
- Export to JSON and CSV
- Detailed statistics
- Progress tracking
- Comprehensive logging

## Installation

```bash
npm install axios cheerio puppeteer
```

## Quick Start

```typescript
import { quickScrape } from './high-speed-scraper';

const urls = [
  'https://company1.com',
  'https://company2.com',
  'https://company3.com',
];

const results = await quickScrape(urls, {
  concurrency: 20,
  timeout: 5000,
});

results.forEach(result => {
  console.log(`${result.url} → ${result.bestEmail || 'No email'}`);
});
```

## Advanced Usage

### Full Configuration

```typescript
import { HighSpeedScraper } from './high-speed-scraper';

const scraper = new HighSpeedScraper({
  concurrency: 50,           // Number of parallel workers
  timeout: 10000,            // Request timeout (ms)
  retries: 2,                // Number of retries for failed requests
  retryDelay: 1000,          // Delay between retries (ms)
  rateLimit: {
    maxRequestsPerSecond: 20,
    maxRequestsPerMinute: 500,
  },
  usePuppeteer: true,        // Fallback to Puppeteer for JS sites
  validateDNS: true,         // Validate email domains with DNS
  userAgent: 'Custom User Agent',
});

const results = await scraper.scrape(urls);
await scraper.stop();
```

### Scrape and Export

```typescript
import { scrapeAndExport } from './high-speed-scraper';

const { results, stats, files } = await scrapeAndExport(
  urls,
  './output',
  {
    concurrency: 50,
    timeout: 8000,
  }
);

console.log('Exported to:');
console.log(`  JSON: ${files.json}`);
console.log(`  CSV: ${files.csv}`);
console.log(`  Stats: ${files.stats}`);
```

### Progress Tracking

```typescript
const scraper = new HighSpeedScraper({ concurrency: 20 });

scraper['queue'].on('job-complete', ({ result, stats }) => {
  console.log(`Progress: ${stats.completed}/${stats.total}`);
  if (result.bestEmail) {
    console.log(`Found: ${result.bestEmail} (${result.confidence})`);
  }
});

await scraper.scrape(urls);
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `concurrency` | number | 50 | Number of parallel workers |
| `timeout` | number | 10000 | Request timeout in milliseconds |
| `retries` | number | 2 | Number of retries for failed requests |
| `retryDelay` | number | 1000 | Delay between retries in milliseconds |
| `rateLimit.maxRequestsPerSecond` | number | 20 | Max requests per second |
| `rateLimit.maxRequestsPerMinute` | number | 500 | Max requests per minute |
| `usePuppeteer` | boolean | false | Use Puppeteer for JS-heavy sites |
| `validateDNS` | boolean | false | Validate email domains with DNS MX |
| `userAgent` | string | Chrome UA | Custom user agent string |

## Result Format

```typescript
interface ScrapedWebsite {
  url: string;                    // Website URL
  bestEmail: string | null;       // Best email found
  confidence: 'high' | 'medium' | 'low' | 'none';
  allEmails: EmailResult[];       // All emails found
  sourceUrl: string;              // Source URL
  scrapedAt: string;              // ISO timestamp
  method: 'axios' | 'puppeteer';  // Scraping method used
  duration: number;               // Scraping duration (ms)
  success: boolean;               // Success status
  error?: string;                 // Error message (if failed)
}

interface EmailResult {
  email: string;                  // Email address
  score: number;                  // Quality score (0-100)
  source: 'mailto' | 'text' | 'obfuscated' | 'cloudflare';
}
```

## Email Quality Scoring

Emails are scored from 0-100 based on quality:

| Email Type | Score | Example |
|------------|-------|---------|
| `info@`, `contact@`, `hello@` | 100 | info@company.com |
| `sales@`, `business@` | 90 | sales@company.com |
| `support@`, `help@` | 80 | support@company.com |
| `firstname.lastname@` | 85 | john.doe@company.com |
| Generic | 50 | general@company.com |

## Performance Benchmarks

### Small Scale (100 URLs)
- **Concurrency**: 20 workers
- **Duration**: ~10-15 seconds
- **Speed**: ~7-10 URLs/sec

### Medium Scale (1,000 URLs)
- **Concurrency**: 50 workers
- **Duration**: ~1-2 minutes
- **Speed**: ~10-15 URLs/sec

### Large Scale (10,000 URLs)
- **Concurrency**: 100 workers
- **Duration**: ~10-15 minutes
- **Speed**: ~15-20 URLs/sec

*Benchmarks vary based on network speed, website response times, and hardware.*

## Optimization Tips

### For Maximum Speed
```typescript
{
  concurrency: 100,
  timeout: 5000,
  retries: 1,
  usePuppeteer: false,
  validateDNS: false,
}
```

### For Maximum Accuracy
```typescript
{
  concurrency: 20,
  timeout: 15000,
  retries: 3,
  usePuppeteer: true,
  validateDNS: true,
}
```

### For Balanced Performance
```typescript
{
  concurrency: 50,
  timeout: 10000,
  retries: 2,
  usePuppeteer: false,
  validateDNS: false,
}
```

## Export Formats

### JSON Output
```json
{
  "metadata": {
    "totalWebsites": 100,
    "successful": 95,
    "failed": 5,
    "emailsFound": 78,
    "avgDuration": 1234,
    "totalDuration": 120000
  },
  "results": [
    {
      "url": "https://company.com",
      "bestEmail": "info@company.com",
      "confidence": "high",
      "allEmails": [
        {
          "email": "info@company.com",
          "score": 100,
          "source": "mailto"
        }
      ],
      "method": "axios",
      "duration": 1234,
      "success": true
    }
  ]
}
```

### CSV Output
```csv
URL,Best Email,Confidence,All Emails,Email Count,Method,Duration (ms),Success,Error,Scraped At
https://company.com,info@company.com,high,info@company.com; sales@company.com,2,axios,1234,Yes,,2024-01-01T00:00:00.000Z
```

## Error Handling

The scraper handles various error types:

- **Network errors**: ECONNRESET, ETIMEDOUT, ECONNREFUSED
- **HTTP errors**: 429, 500, 502, 503, 504
- **Timeout errors**: Request timeout exceeded
- **DNS errors**: Domain not found

Failed requests are automatically retried with exponential backoff.

## Rate Limiting

Built-in rate limiter prevents overwhelming servers:

```typescript
rateLimit: {
  maxRequestsPerSecond: 20,   // Max 20 requests per second
  maxRequestsPerMinute: 500,  // Max 500 requests per minute
}
```

The scraper automatically waits when limits are reached.

## DNS Validation

Optional DNS MX record validation:

```typescript
validateDNS: true  // Validate email domains have MX records
```

Results are cached for 24 hours to improve performance.

## Logging

Control log verbosity:

```typescript
import { logger, LogLevel } from './high-speed-scraper';

logger.setLevel(LogLevel.DEBUG);  // DEBUG, INFO, WARN, ERROR, NONE
```

## Memory Management

The scraper is optimized for low memory usage:

- Streaming processing (no large arrays in memory)
- DNS cache with TTL
- Browser instance reuse (Puppeteer)
- Automatic cleanup on completion

## Best Practices

1. **Start small**: Test with 10-100 URLs first
2. **Adjust concurrency**: Based on your network and CPU
3. **Use rate limiting**: Respect server resources
4. **Enable retries**: For unreliable networks
5. **Disable Puppeteer**: Unless needed (much faster)
6. **Disable DNS validation**: Unless accuracy is critical (faster)
7. **Monitor progress**: Use event listeners
8. **Export results**: Save to JSON/CSV for analysis

## Troubleshooting

### Slow Performance
- Increase `concurrency`
- Decrease `timeout`
- Disable `usePuppeteer`
- Disable `validateDNS`

### Too Many Failures
- Increase `timeout`
- Increase `retries`
- Decrease `concurrency`
- Check network connection

### Memory Issues
- Decrease `concurrency`
- Process URLs in batches
- Clear DNS cache periodically

### Rate Limiting
- Decrease `maxRequestsPerSecond`
- Decrease `maxRequestsPerMinute`
- Add delays between batches

## Examples

See `examples/basic-usage.ts` for complete examples:

1. Quick scrape
2. Advanced configuration
3. Scrape and export
4. Large scale scraping (10,000 URLs)
5. Progress tracking
6. Filter results

## API Reference

### HighSpeedScraper

```typescript
class HighSpeedScraper {
  constructor(config?: Partial<ScraperConfig>)
  async scrape(urls: string[]): Promise<ScrapedWebsite[]>
  async scrapeAndExport(urls: string[], outputDir: string): Promise<{...}>
  getStats(): ScrapeStats
  getDNSStats(): {...}
  clearDNSCache(): void
  async stop(): Promise<void>
}
```

### Convenience Functions

```typescript
async function quickScrape(
  urls: string[],
  options?: {...}
): Promise<ScrapedWebsite[]>

async function scrapeAndExport(
  urls: string[],
  outputDir: string,
  options?: {...}
): Promise<{...}>
```

## License

MIT

## Contributing

Contributions welcome! Please open an issue or PR.

## Support

For issues or questions, please open a GitHub issue.
