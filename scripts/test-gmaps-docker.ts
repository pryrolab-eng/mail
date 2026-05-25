/**
 * Quick check: gosom/google-maps-scraper reachable and one job completes.
 * Requires GMAPS_SCRAPER_URL in .env (default http://localhost:8080).
 *
 *   npx tsx scripts/test-gmaps-docker.ts
 *   npx tsx scripts/test-gmaps-docker.ts "restaurant in Kigali Rwanda"
 */

import 'dotenv/config';
import {
  getGmapsDockerConfig,
  isGmapsDockerAvailable,
  scrapeGmapsDockerQuery,
} from '../src/utils/gmaps-docker-client';

async function main() {
  const cfg = getGmapsDockerConfig();
  if (!cfg) {
    console.error('Set GMAPS_SCRAPER_URL=http://localhost:8080 in .env');
    process.exit(1);
  }
  const ok = await isGmapsDockerAvailable();
  console.log(`URL: ${cfg.baseUrl} — reachable: ${ok}`);
  if (!ok) process.exit(1);

  const keyword = process.argv[2] || 'logistics company in Kigali Rwanda';
  const leads: unknown[] = [];
  const { leads: found, emailVerification, verificationFile } =
    await scrapeGmapsDockerQuery(
      keyword,
      'logistics',
      'Kigali Rwanda',
      5,
      new Set(),
      (l) => {
        leads.push(l);
        console.log(`  ✓ ${l.company_name} — ${l.email}`);
        return true;
      },
      null,
      undefined
    );
  console.log(`\nDone: ${found.length} leads (${leads.length} emitted)`);
  console.log(`Verification rows: ${emailVerification.length}`);
  if (verificationFile) console.log(`Report: ${verificationFile}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
