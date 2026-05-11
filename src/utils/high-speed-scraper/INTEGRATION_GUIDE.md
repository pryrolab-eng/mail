# Integration Guide

## Installation

### 1. Install Dependencies

```bash
npm install axios cheerio puppeteer
npm install --save-dev @types/node
```

### 2. Add to package.json

```json
{
  "dependencies": {
    "axios": "^1.6.0",
    "cheerio": "^1.0.0-rc.12",
    "puppeteer": "^21.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0"
  }
}
```

## Project Structure

```
src/utils/high-speed-scraper/
├── index.ts                    # Main entry point
├── types.ts                    # TypeScript types
├── email-extractor.ts          # Email extraction logic
├── dns-validator.ts            # DNS MX validation
├── rate-limiter.ts             # Rate limiting
├── scraper-worker.ts           # Axios scraper
├── puppeteer-worker.ts         # Puppeteer scraper
├── worker-queue.ts             # Worker queue system
├── exporter.ts                 # JSON/CSV export
├── logger.ts                   # Logging system
├── README.md                   # Documentation
├── INTEGRATION_GUIDE.md        # This file
└── examples/
    ├── basic-usage.ts          # Usage examples
    └── test-scraper.ts         # Test script
```

## Quick Integration

### Option 1: Use as Module

```typescript
// In your existing code
import { quickScrape } from '@/utils/high-speed-scraper';

async function scrapeEmails(urls: string[]) {
  const results = await quickScrape(urls, {
    concurrency: 20,
    timeout: 5000,
  });
  
  return results.filter(r => r.bestEmail);
}
```

### Option 2: Integrate with Existing Scraper

Replace your existing scraper in `src/app/actions.ts`:

```typescript
import { quickScrape } from '@/utils/high-speed-scraper';

export const scrapeLeadsAction = async (
  niche: string,
  location: string,
  maxResults: number = 100
) => {
  try {
    // Get URLs from Google Maps (existing logic)
    const urls = await getBusinessUrlsFromMaps(niche, location, maxResults);
    
    // Scrape emails using high-speed scraper
    const results = await quickScrape(urls, {
      concurrency: 50,
      timeout: 8000,
      usePuppeteer: false,
      validateDNS: false,
    });
    
    // Convert to your lead format
    const leads = results
      .filter(r => r.bestEmail)
      .map(r => ({
        company_name: extractCompanyName(r.url),
        email: r.bestEmail!,
        emailIsReal: r.confidence === 'high',
        niche,
        location,
        company_context: '',
        source_url: r.url,
        website: r.url,
      }));
    
    return {
      success: true,
      leads,
      count: leads.length,
      method: 'high-speed-scraper',
    };
  } catch (error) {
    return {
      success: false,
      leads: [],
      count: 0,
      error: error instanceof Error ? error.message : 'Failed to scrape',
    };
  }
};
```

### Option 3: Create New API Endpoint

```typescript
// src/app/api/scrape-emails/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { quickScrape } from '@/utils/high-speed-scraper';

export async function POST(request: NextRequest) {
  try {
    const { urls } = await request.json();
    
    if (!Array.isArray(urls) || urls.length === 0) {
      return NextResponse.json(
        { error: 'URLs array is required' },
        { status: 400 }
      );
    }
    
    const results = await quickScrape(urls, {
      concurrency: 30,
      timeout: 8000,
    });
    
    return NextResponse.json({
      success: true,
      results,
      stats: {
        total: results.length,
        withEmails: results.filter(r => r.bestEmail).length,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Scraping failed' },
      { status: 500 }
    );
  }
}
```

## Integration with ScraperModule

Update `src/components/platform/ScraperModule.tsx`:

```typescript
import { quickScrape } from '@/utils/high-speed-scraper';

const handleScrape = async () => {
  if (!niche.trim() || !location.trim()) {
    toast.error("Enter niche and location");
    return;
  }

  setIsScraping(true);
  setResults([]);

  try {
    // Get business URLs from Google Maps
    const urls = await getBusinessUrls(niche, location, maxResults);
    
    // Scrape emails using high-speed scraper
    const scraped = await quickScrape(urls, {
      concurrency: 50,
      timeout: 8000,
      usePuppeteer: false,
      validateDNS: false,
    });
    
    // Convert to lead format
    const leads = scraped
      .filter(r => r.bestEmail)
      .map(r => ({
        company_name: extractName(r.url),
        email: r.bestEmail!,
        emailIsReal: r.confidence === 'high',
        niche,
        location,
        company_context: '',
        source_url: r.url,
        website: r.url,
      }));
    
    setResults(leads);
    toast.success(`Found ${leads.length} leads with emails`);
  } catch (error) {
    toast.error("Scraping failed");
  } finally {
    setIsScraping(false);
  }
};
```

## Performance Tuning

### For Speed (Recommended)
```typescript
{
  concurrency: 100,
  timeout: 5000,
  retries: 1,
  usePuppeteer: false,
  validateDNS: false,
}
```

### For Accuracy
```typescript
{
  concurrency: 20,
  timeout: 15000,
  retries: 3,
  usePuppeteer: true,
  validateDNS: true,
}
```

### For Production
```typescript
{
  concurrency: 50,
  timeout: 10000,
  retries: 2,
  rateLimit: {
    maxRequestsPerSecond: 20,
    maxRequestsPerMinute: 500,
  },
  usePuppeteer: false,
  validateDNS: false,
}
```

## Testing

### Run Test Script

```bash
# Test with real websites
npx ts-node src/utils/high-speed-scraper/examples/test-scraper.ts

# Run examples
npx ts-node src/utils/high-speed-scraper/examples/basic-usage.ts
```

### Unit Tests

```typescript
import { extractEmails, scoreEmail, isValidEmail } from './email-extractor';

describe('Email Extractor', () => {
  test('extracts mailto links', () => {
    const html = '<a href="mailto:test@example.com">Email</a>';
    const results = extractEmails(html);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].email).toBe('test@example.com');
  });
  
  test('scores emails correctly', () => {
    expect(scoreEmail('info@company.com')).toBeGreaterThan(90);
    expect(scoreEmail('noreply@company.com')).toBeLessThan(50);
  });
  
  test('filters invalid emails', () => {
    expect(isValidEmail('test@example.com')).toBe(false); // blocked domain
    expect(isValidEmail('noreply@company.com')).toBe(false); // blocked prefix
    expect(isValidEmail('info@company.com')).toBe(true);
  });
});
```

## Monitoring

### Add Progress Tracking

```typescript
const scraper = new HighSpeedScraper({ concurrency: 50 });

scraper['queue'].on('job-complete', ({ result, stats }) => {
  console.log(`Progress: ${stats.completed}/${stats.total}`);
  console.log(`Emails found: ${stats.emailsFound}`);
});

await scraper.scrape(urls);
```

### Track Performance

```typescript
const startTime = Date.now();
const results = await scraper.scrape(urls);
const duration = Date.now() - startTime;

console.log(`Scraped ${results.length} URLs in ${duration}ms`);
console.log(`Speed: ${(results.length / (duration / 1000)).toFixed(1)} URLs/sec`);
```

## Error Handling

```typescript
try {
  const results = await quickScrape(urls, { concurrency: 50 });
  
  // Check for failures
  const failed = results.filter(r => !r.success);
  if (failed.length > 0) {
    console.warn(`${failed.length} URLs failed to scrape`);
    failed.forEach(r => console.error(`${r.url}: ${r.error}`));
  }
  
  // Process successful results
  const successful = results.filter(r => r.success);
  return successful;
} catch (error) {
  console.error('Scraping failed:', error);
  throw error;
}
```

## Memory Management

For large-scale scraping (10,000+ URLs):

```typescript
// Process in batches
const batchSize = 1000;
const allResults = [];

for (let i = 0; i < urls.length; i += batchSize) {
  const batch = urls.slice(i, i + batchSize);
  const results = await quickScrape(batch, { concurrency: 50 });
  allResults.push(...results);
  
  // Optional: save intermediate results
  await saveResults(results, `batch-${i / batchSize}.json`);
}
```

## Deployment

### Environment Variables

```env
# .env.local
SCRAPER_CONCURRENCY=50
SCRAPER_TIMEOUT=10000
SCRAPER_USE_PUPPETEER=false
SCRAPER_VALIDATE_DNS=false
```

### Use in Code

```typescript
const scraper = new HighSpeedScraper({
  concurrency: parseInt(process.env.SCRAPER_CONCURRENCY || '50'),
  timeout: parseInt(process.env.SCRAPER_TIMEOUT || '10000'),
  usePuppeteer: process.env.SCRAPER_USE_PUPPETEER === 'true',
  validateDNS: process.env.SCRAPER_VALIDATE_DNS === 'true',
});
```

## Troubleshooting

### Issue: Slow performance
**Solution**: Increase concurrency, disable Puppeteer and DNS validation

### Issue: Too many failures
**Solution**: Increase timeout, increase retries, decrease concurrency

### Issue: Memory issues
**Solution**: Decrease concurrency, process in batches

### Issue: Rate limiting
**Solution**: Decrease maxRequestsPerSecond/Minute

## Support

For issues or questions:
1. Check the README.md
2. Review examples in `examples/`
3. Run test script: `test-scraper.ts`
4. Open a GitHub issue

## Next Steps

1. ✅ Install dependencies
2. ✅ Run test script
3. ✅ Integrate with your code
4. ✅ Tune performance settings
5. ✅ Deploy to production

Happy scraping! 🚀
