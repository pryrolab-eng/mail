/**
 * High-Speed Email Scraper - Email Extraction & Validation
 */

import { EmailResult } from './types';

// ─── Constants ───────────────────────────────────────────────────────────────

const BLOCKED_DOMAINS = [
  'example.com', 'example.org', 'test.com', 'localhost',
  'sentry.io', 'wixpress.com', 'squarespace.com', 'wordpress.com',
  'googletagmanager.com', 'google-analytics.com', 'facebook.com',
  'twitter.com', 'linkedin.com', 'instagram.com', 'youtube.com',
];

const BLOCKED_PREFIXES = [
  'noreply', 'no-reply', 'donotreply', 'do-not-reply',
  'mailer-daemon', 'postmaster', 'abuse', 'spam',
  'privacy', 'legal', 'dmca', 'copyright',
  'unsubscribe', 'bounce', 'return',
];

const BLOCKED_SUBSTRINGS = [
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp',
  '@2x', '@3x', 'placeholder', 'tracking', 'pixel',
  'analytics', 'tag', 'beacon',
];

const EMAIL_REGEX = /\b([a-zA-Z0-9][a-zA-Z0-9._%+\-]*@[a-zA-Z0-9][a-zA-Z0-9.\-]*\.[a-zA-Z]{2,})\b/g;

// ─── Email Extraction ────────────────────────────────────────────────────────

/**
 * Extract all emails from HTML content
 */
export function extractEmails(html: string): EmailResult[] {
  const results: EmailResult[] = [];
  const seen = new Set<string>();

  // 1. Extract mailto: links (highest priority)
  const mailtoEmails = extractMailtoEmails(html);
  mailtoEmails.forEach(email => {
    if (!seen.has(email)) {
      seen.add(email);
      results.push({ email, score: scoreEmail(email), source: 'mailto' });
    }
  });

  // 2. Decode Cloudflare protected emails
  const cloudflareEmails = decodeCloudflareEmails(html);
  cloudflareEmails.forEach(email => {
    if (!seen.has(email)) {
      seen.add(email);
      results.push({ email, score: scoreEmail(email), source: 'cloudflare' });
    }
  });

  // 3. Decode obfuscated emails ([at], [dot], etc.)
  const deobfuscated = deobfuscateEmails(html);
  const obfuscatedEmails = extractFromText(deobfuscated);
  obfuscatedEmails.forEach(email => {
    if (!seen.has(email)) {
      seen.add(email);
      results.push({ email, score: scoreEmail(email), source: 'obfuscated' });
    }
  });

  // 4. Extract from plain text
  const plainEmails = extractFromText(html);
  plainEmails.forEach(email => {
    if (!seen.has(email)) {
      seen.add(email);
      results.push({ email, score: scoreEmail(email), source: 'text' });
    }
  });

  // Filter out invalid emails
  return results.filter(r => isValidEmail(r.email));
}

/**
 * Extract emails from mailto: links
 */
function extractMailtoEmails(html: string): string[] {
  const emails: string[] = [];
  const mailtoRegex = /mailto:([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/gi;
  let match: RegExpExecArray | null;

  while ((match = mailtoRegex.exec(html)) !== null) {
    emails.push(match[1].toLowerCase());
  }

  return emails;
}

/**
 * Decode Cloudflare email protection
 * Format: /cdn-cgi/l/email-protection#HEXSTRING or data-cfemail="HEXSTRING"
 */
function decodeCloudflareEmails(html: string): string[] {
  const emails: string[] = [];

  // Method 1: href="/cdn-cgi/l/email-protection#..."
  const hrefRegex = /\/cdn-cgi\/l\/email-protection#([0-9a-f]+)/gi;
  let match: RegExpExecArray | null;

  while ((match = hrefRegex.exec(html)) !== null) {
    const decoded = decodeCloudflareHex(match[1]);
    if (decoded) emails.push(decoded);
  }

  // Method 2: data-cfemail="..."
  const dataRegex = /data-cfemail="([0-9a-f]+)"/gi;
  while ((match = dataRegex.exec(html)) !== null) {
    const decoded = decodeCloudflareHex(match[1]);
    if (decoded) emails.push(decoded);
  }

  return emails;
}

/**
 * Decode Cloudflare hex-encoded email (XOR cipher)
 */
function decodeCloudflareHex(hex: string): string | null {
  try {
    const bytes = hex.match(/.{2}/g);
    if (!bytes || bytes.length < 2) return null;

    const key = parseInt(bytes[0], 16);
    const decoded = bytes
      .slice(1)
      .map(b => String.fromCharCode(parseInt(b, 16) ^ key))
      .join('');

    return decoded.includes('@') ? decoded.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * Deobfuscate emails with [at], [dot], (at), (dot), etc.
 */
function deobfuscateEmails(text: string): string {
  return text
    .replace(/\s*\[at\]\s*/gi, '@')
    .replace(/\s*\(at\)\s*/gi, '@')
    .replace(/\s*\{at\}\s*/gi, '@')
    .replace(/\s*\[dot\]\s*/gi, '.')
    .replace(/\s*\(dot\)\s*/gi, '.')
    .replace(/\s*\{dot\}\s*/gi, '.')
    .replace(/\s*\[AT\]\s*/g, '@')
    .replace(/\s*\(AT\)\s*/g, '@')
    .replace(/\s*\[DOT\]\s*/g, '.')
    .replace(/\s*\(DOT\)\s*/g, '.');
}

/**
 * Extract emails from plain text using regex
 */
function extractFromText(text: string): string[] {
  const emails: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = EMAIL_REGEX.exec(text)) !== null) {
    emails.push(match[1].toLowerCase());
  }

  return Array.from(new Set(emails));
}

// ─── Email Validation ────────────────────────────────────────────────────────

/**
 * Validate email format and filter fake/tracking emails
 */
export function isValidEmail(email: string): boolean {
  const [local, domain] = email.split('@');
  if (!local || !domain) return false;

  // Check domain
  if (BLOCKED_DOMAINS.some(d => domain.includes(d))) return false;
  if (!/\.[a-z]{2,}$/i.test(domain)) return false;

  // Check local part
  const localLower = local.toLowerCase();
  if (BLOCKED_PREFIXES.some(p => localLower.startsWith(p))) return false;
  if (BLOCKED_SUBSTRINGS.some(s => email.includes(s))) return false;

  // Check for image filenames disguised as emails
  if (/\.(png|jpg|jpeg|gif|svg|webp)@/i.test(email)) return false;

  // Must have valid characters
  if (!/^[a-zA-Z0-9._%+\-]+$/.test(local)) return false;

  return true;
}

/**
 * Score email quality (higher = better)
 */
export function scoreEmail(email: string): number {
  const local = email.split('@')[0].toLowerCase();
  let score = 50; // Base score

  // High-value prefixes
  if (['info', 'contact', 'hello', 'hi'].includes(local)) score += 50;
  else if (['sales', 'business', 'inquiries', 'inquiry'].includes(local)) score += 40;
  else if (['support', 'help', 'service', 'office'].includes(local)) score += 30;
  else if (['admin', 'team', 'general'].includes(local)) score += 20;

  // Personal emails (firstname.lastname@)
  if (local.includes('.') && !local.startsWith('.') && !local.endsWith('.')) {
    score += 35;
  }

  // Penalize generic/suspicious patterns
  if (local.includes('webmaster')) score -= 20;
  if (local.includes('test')) score -= 30;
  if (local.length < 3) score -= 20;
  if (local.length > 30) score -= 10;

  // Bonus for common TLDs
  const domain = email.split('@')[1];
  if (/\.(com|org|net|edu|gov)$/i.test(domain)) score += 10;

  return Math.max(0, Math.min(100, score));
}

/**
 * Find best email from a list
 */
export function findBestEmail(results: EmailResult[]): EmailResult | null {
  if (results.length === 0) return null;

  // Sort by score (descending) and source priority
  const sorted = [...results].sort((a, b) => {
    // Prioritize mailto links
    if (a.source === 'mailto' && b.source !== 'mailto') return -1;
    if (b.source === 'mailto' && a.source !== 'mailto') return 1;

    // Then by score
    return b.score - a.score;
  });

  return sorted[0];
}

/**
 * Determine confidence level based on best email score and source
 */
export function getConfidence(best: EmailResult | null): 'high' | 'medium' | 'low' | 'none' {
  if (!best) return 'none';

  if (best.source === 'mailto' && best.score >= 70) return 'high';
  if (best.score >= 80) return 'high';
  if (best.score >= 60) return 'medium';
  return 'low';
}
