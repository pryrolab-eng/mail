/**
 * Verify gosom CSV → emails column parsing.
 * npx tsx scripts/test-gosom-csv-parse.ts [path-to.csv]
 */

import fs from 'fs';
import path from 'path';
import { parseCsvPlaces } from '../src/utils/gmaps-docker-client';

const csvPath =
  process.argv[2] ||
  path.join(process.cwd(), 'gmapsdata', 'd5c35d30-4fe5-458c-a239-a2e371b455d8.csv');

const csv = fs.readFileSync(csvPath, 'utf8');
const places = parseCsvPlaces(csv);
const withEmail = places.filter(
  (p) =>
    (typeof p.emails === 'string' && p.emails.includes('@')) ||
    (typeof p.email === 'string' && p.email.includes('@'))
);

console.log(`\nFile: ${csvPath}`);
console.log(`Places: ${places.length}`);
console.log(`With emails column: ${withEmail.length}`);
for (const p of withEmail.slice(0, 8)) {
  console.log(`  - ${p.title}: ${p.emails || p.email}`);
}
