/**
 * Multi-Source Email Finder
 * Finds real email addresses using Google search, company websites, and LinkedIn
 * NO PAID APIs REQUIRED!
 */

export interface EmailFinderResult {
  email: string | null;
  confidence: 'high' | 'medium' | 'low';
  source: string;
  allEmails: string[];
}

/**
 * Extract emails from text
 */
function extractEmails(text: string): string[] {
  const emailRegex = /\b([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})\b/g;
  const emails = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = emailRegex.exec(text)) !== null) {
    const email = match[1].toLowerCase();

    // Filter out garbage
    if (
      !email.includes('example.com') &&
      !email.includes('sentry.io') &&
      !email.includes('wixpress.com') &&
      !email.includes('.png') &&
      !email.includes('.jpg') &&
      !email.includes('@2x') &&
      !email.includes('placeholder')
    ) {
      emails.add(email);
    }
  }

  return Array.from(emails);
}

/**
 * Score email quality
 */
function scoreEmail(email: string): number {
  const local = email.split('@')[0].toLowerCase();
  
  // Best emails
  if (['info', 'contact', 'hello', 'hi'].includes(local)) return 10;
  if (['sales', 'business', 'inquiries'].includes(local)) return 9;
  
  // Good emails
  if (['support', 'help', 'service'].includes(local)) return 7;
  if (local.includes('.')) return 6; // firstname.lastname@
  
  // Avoid
  if (local.includes('noreply') || local.includes('no-reply')) return -10;
  if (local.includes('donotreply')) return -10;
  
  return 5;
}

/**
 * Find best email from list
 */
function findBestEmail(emails: string[]): string | null {
  if (emails.length === 0) return null;
  return emails.sort((a, b) => scoreEmail(b) - scoreEmail(a))[0];
}

/**
 * Method 1: Search Google for company email
 */
async function searchGoogleForEmail(companyName: string, website?: string): Promise<string[]> {
  const emails = new Set<string>();
  
  try {
    // Build search queries
    const queries = [
      `"${companyName}" email contact`,
      `"${companyName}" "contact us" email`,
      `site:${website} email`,
      `"${companyName}" "@" contact`,
    ];
    
    for (const query of queries) {
      // Use Google search (scrape results page)
      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
      
      try {
        const response = await fetch(searchUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
          },
        });
        
        if (response.ok) {
          const html = await response.text();
          const foundEmails = extractEmails(html);
          foundEmails.forEach(e => emails.add(e));
          
          console.log(`[Google Search] Found ${foundEmails.length} emails for query: ${query}`);
        }
        
        // Delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (e) {
        console.error('Google search failed:', e);
      }
    }
  } catch (error) {
    console.error('Google search error:', error);
  }
  
  return Array.from(emails);
}

/**
 * Method 2: Scrape company website for emails
 * Uses fetch with realistic headers. For JS-heavy sites, emails may not be visible —
 * the Puppeteer scraper handles those cases when running in the Maps flow.
 */
async function scrapeWebsiteForEmail(companyName: string, website?: string): Promise<string[]> {
  const emails = new Set<string>();

  if (!website) return [];

  // Normalize URL
  if (!website.startsWith('http')) {
    website = `https://${website}`;
  }

  let baseOrigin = '';
  try { baseOrigin = new URL(website).origin; } catch { return []; }

  const pagesToCheck = [
    website,
    `${baseOrigin}/contact`,
    `${baseOrigin}/contact-us`,
    `${baseOrigin}/about`,
    `${baseOrigin}/about-us`,
    `${baseOrigin}/imprint`,
  ];

  for (const url of pagesToCheck) {
    try {
      console.log(`[Website Scraper] Checking: ${url}`);

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: AbortSignal.timeout(4000), // Reduced from 6000ms for speed
      });

      if (response.ok) {
        let html = await response.text();

        // Decode obfuscated emails
        html = html
          .replace(/\s*\[at\]\s*/gi, '@')
          .replace(/\s*\(at\)\s*/gi, '@')
          .replace(/\s*\[dot\]\s*/gi, '.')
          .replace(/\s*\(dot\)\s*/gi, '.');

        // mailto: links first (most reliable)
        const mailtoRegex = /mailto:([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/gi;
        let mailtoMatch: RegExpExecArray | null;
        while ((mailtoMatch = mailtoRegex.exec(html)) !== null) {
          emails.add(mailtoMatch[1].toLowerCase());
        }

        // Plain text emails
        const foundEmails = extractEmails(html);
        foundEmails.forEach(e => emails.add(e));

        console.log(`[Website Scraper] Found ${emails.size} email(s) on ${url}`);

        // Stop early if we found something on a contact page
        if (url.includes('contact') && emails.size > 0) break;
      }

      await new Promise(resolve => setTimeout(resolve, 300)); // Reduced from 500ms
    } catch (e) {
      console.error(`Failed to fetch ${url}:`, e);
    }
  }

  return Array.from(emails);
}

/**
 * Method 3: Search LinkedIn for company email
 */
async function searchLinkedInForEmail(companyName: string): Promise<string[]> {
  const emails = new Set<string>();
  
  try {
    // Search LinkedIn company page
    const searchUrl = `https://www.google.com/search?q=site:linkedin.com/company "${companyName}" email`;
    
    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html',
      },
    });
    
    if (response.ok) {
      const html = await response.text();
      const foundEmails = extractEmails(html);
      foundEmails.forEach(e => emails.add(e));
      
      console.log(`[LinkedIn Search] Found ${foundEmails.length} emails`);
    }
  } catch (error) {
    console.error('LinkedIn search error:', error);
  }
  
  return Array.from(emails);
}

/**
 * Method 4: Check common email patterns
 */
function generateCommonEmailPatterns(companyName: string, website?: string): string[] {
  if (!website) return [];
  
  try {
    const domain = website.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0];
    
    return [
      `info@${domain}`,
      `contact@${domain}`,
      `hello@${domain}`,
      `sales@${domain}`,
      `support@${domain}`,
    ];
  } catch {
    return [];
  }
}

/**
 * Main function: Find email using all methods
 */
export async function findRealEmail(
  companyName: string,
  website?: string,
  options: {
    useGoogle?: boolean;
    useWebsite?: boolean;
    useLinkedIn?: boolean;
    timeout?: number;
  } = {}
): Promise<EmailFinderResult> {
  const {
    useGoogle = false, // Disabled by default - too slow and unreliable
    useWebsite = true,
    useLinkedIn = false, // Disabled by default - requires auth
    timeout = 10000, // Reduced from 15000ms for speed
  } = options;
  
  console.log(`\n[Email Finder] Starting search for: ${companyName}`);
  console.log(`[Email Finder] Website: ${website || 'Not provided'}`);
  
  const allEmails = new Set<string>();
  const sources: string[] = [];
  
  // Run all methods in parallel with timeout
  const searchPromises: Promise<void>[] = [];
  
  if (useWebsite && website) {
    searchPromises.push(
      (async () => {
        const emails = await scrapeWebsiteForEmail(companyName, website);
        if (emails.length > 0) {
          emails.forEach(e => allEmails.add(e));
          sources.push('website');
        }
      })()
    );
  }
  
  if (useGoogle) {
    searchPromises.push(
      (async () => {
        const emails = await searchGoogleForEmail(companyName, website);
        if (emails.length > 0) {
          emails.forEach(e => allEmails.add(e));
          sources.push('google');
        }
      })()
    );
  }
  
  if (useLinkedIn) {
    searchPromises.push(
      (async () => {
        const emails = await searchLinkedInForEmail(companyName);
        if (emails.length > 0) {
          emails.forEach(e => allEmails.add(e));
          sources.push('linkedin');
        }
      })()
    );
  }
  
  // Wait for all searches with timeout
  await Promise.race([
    Promise.all(searchPromises),
    new Promise(resolve => setTimeout(resolve, timeout)),
  ]);
  
  const emailArray = Array.from(allEmails);
  const bestEmail = findBestEmail(emailArray);
  
  // Determine confidence
  let confidence: 'high' | 'medium' | 'low' = 'low';
  if (sources.includes('website')) {
    confidence = 'high';
  } else if (sources.length >= 2) {
    confidence = 'medium';
  }
  
  console.log(`[Email Finder] Results:`);
  console.log(`  - Total emails found: ${emailArray.length}`);
  console.log(`  - Best email: ${bestEmail || 'None'}`);
  console.log(`  - Sources: ${sources.join(', ') || 'None'}`);
  console.log(`  - Confidence: ${confidence}`);
  
  return {
    email: bestEmail,
    confidence,
    source: sources.join(', '),
    allEmails: emailArray,
  };
}

/**
 * Batch find emails for multiple companies
 */
export async function batchFindEmails(
  companies: Array<{ name: string; website?: string }>,
  delayMs: number = 2000
): Promise<Map<string, EmailFinderResult>> {
  const results = new Map<string, EmailFinderResult>();
  
  for (const company of companies) {
    console.log(`\n========================================`);
    console.log(`Processing: ${company.name}`);
    console.log(`========================================`);
    
    const result = await findRealEmail(company.name, company.website);
    results.set(company.name, result);
    
    // Delay between requests to avoid rate limiting
    if (delayMs > 0) {
      console.log(`Waiting ${delayMs}ms before next search...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  
  return results;
}
