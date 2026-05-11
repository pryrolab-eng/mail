/**
 * High-Speed Email Scraper - Export to JSON and CSV
 */

import { ScrapedWebsite, ScrapeStats } from './types';
import { writeFile } from 'fs/promises';
import { join } from 'path';

/**
 * Export results to JSON
 */
export async function exportToJSON(
  results: ScrapedWebsite[],
  stats: ScrapeStats,
  outputPath: string
): Promise<void> {
  const data = {
    metadata: {
      totalWebsites: stats.total,
      successful: stats.completed,
      failed: stats.failed,
      emailsFound: stats.emailsFound,
      avgDuration: Math.round(stats.avgDuration),
      totalDuration: stats.endTime ? stats.endTime - stats.startTime : 0,
      exportedAt: new Date().toISOString(),
    },
    results: results.map(r => ({
      url: r.url,
      bestEmail: r.bestEmail,
      confidence: r.confidence,
      allEmails: r.allEmails.map(e => ({
        email: e.email,
        score: e.score,
        source: e.source,
      })),
      method: r.method,
      duration: r.duration,
      success: r.success,
      error: r.error,
      scrapedAt: r.scrapedAt,
    })),
  };

  await writeFile(outputPath, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Export results to CSV
 */
export async function exportToCSV(
  results: ScrapedWebsite[],
  outputPath: string
): Promise<void> {
  const headers = [
    'URL',
    'Best Email',
    'Confidence',
    'All Emails',
    'Email Count',
    'Method',
    'Duration (ms)',
    'Success',
    'Error',
    'Scraped At',
  ];

  const rows = results.map(r => [
    escapeCSV(r.url),
    escapeCSV(r.bestEmail || ''),
    escapeCSV(r.confidence),
    escapeCSV(r.allEmails.map(e => e.email).join('; ')),
    r.allEmails.length.toString(),
    escapeCSV(r.method),
    r.duration.toString(),
    r.success ? 'Yes' : 'No',
    escapeCSV(r.error || ''),
    escapeCSV(r.scrapedAt),
  ]);

  const csv = [
    headers.join(','),
    ...rows.map(row => row.join(',')),
  ].join('\n');

  await writeFile(outputPath, csv, 'utf-8');
}

/**
 * Export summary statistics to JSON
 */
export async function exportStats(
  stats: ScrapeStats,
  outputPath: string
): Promise<void> {
  const summary = {
    total: stats.total,
    completed: stats.completed,
    failed: stats.failed,
    emailsFound: stats.emailsFound,
    successRate: ((stats.completed / stats.total) * 100).toFixed(2) + '%',
    emailFoundRate: ((stats.emailsFound / stats.completed) * 100).toFixed(2) + '%',
    avgDuration: Math.round(stats.avgDuration) + 'ms',
    totalDuration: stats.endTime ? formatDuration(stats.endTime - stats.startTime) : 'N/A',
    startTime: new Date(stats.startTime).toISOString(),
    endTime: stats.endTime ? new Date(stats.endTime).toISOString() : 'N/A',
  };

  await writeFile(outputPath, JSON.stringify(summary, null, 2), 'utf-8');
}

/**
 * Export results with emails only (filtered)
 */
export async function exportEmailsOnly(
  results: ScrapedWebsite[],
  outputPath: string,
  format: 'json' | 'csv' = 'json'
): Promise<void> {
  const withEmails = results.filter(r => r.bestEmail);

  if (format === 'json') {
    const data = withEmails.map(r => ({
      url: r.url,
      email: r.bestEmail,
      confidence: r.confidence,
      allEmails: r.allEmails.map(e => e.email),
    }));
    await writeFile(outputPath, JSON.stringify(data, null, 2), 'utf-8');
  } else {
    const headers = ['URL', 'Email', 'Confidence', 'All Emails'];
    const rows = withEmails.map(r => [
      escapeCSV(r.url),
      escapeCSV(r.bestEmail!),
      escapeCSV(r.confidence),
      escapeCSV(r.allEmails.map(e => e.email).join('; ')),
    ]);
    const csv = [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
    await writeFile(outputPath, csv, 'utf-8');
  }
}

// ─── Helper Functions ────────────────────────────────────────────────────────

/**
 * Escape CSV field
 */
function escapeCSV(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Format duration in human-readable format
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}
