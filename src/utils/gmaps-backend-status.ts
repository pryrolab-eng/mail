/**
 * Server-side Maps backend detection (env + live probe).
 * Used by API routes and Scraper UI.
 */

import {
  getGmapsDockerConfig,
  isGmapsDockerAvailable,
} from './gmaps-docker-client';

export type MapsBackendMode = 'puppeteer' | 'docker' | 'docker_unreachable';

export interface MapsBackendStatus {
  mode: MapsBackendMode;
  /** GMAPS_SCRAPER_URL is set */
  configured: boolean;
  reachable: boolean;
  url?: string;
  maxDepth?: number;
  label: string;
  shortLabel: string;
  hint?: string;
}

export async function getMapsBackendStatus(): Promise<MapsBackendStatus> {
  const cfg = getGmapsDockerConfig();

  if (!cfg) {
    return {
      mode: 'puppeteer',
      configured: false,
      reachable: false,
      label: 'Puppeteer Maps + Bing/DDG/Directories',
      shortLabel: 'Puppeteer Maps',
      hint: 'Maps uses Puppeteer. Bing, DuckDuckGo, directories, and website emails use HTTP fetch (not Maps). Optional: GMAPS_SCRAPER_URL for Docker Maps only.',
    };
  }

  const reachable = await isGmapsDockerAvailable();

  if (reachable) {
    return {
      mode: 'docker',
      configured: true,
      reachable: true,
      url: cfg.baseUrl,
      maxDepth: cfg.maxDepth,
      label: 'Docker Maps + Bing/DDG/Directories',
      shortLabel: 'Docker Maps',
      hint: 'Google Maps listings: Docker (gosom). Bing, DuckDuckGo, directories, and website email fetch: unchanged (no Puppeteer on Maps).',
    };
  }

  return {
    mode: 'docker_unreachable',
    configured: true,
    reachable: false,
    url: cfg.baseUrl,
    maxDepth: cfg.maxDepth,
    label: 'Docker offline — Puppeteer Maps fallback',
    shortLabel: 'Docker (offline)',
    hint: `Maps will use Puppeteer until ${cfg.baseUrl} is up. Other sources (Bing, DDG, directories) unchanged.`,
  };
}
