/**
 * Test AI city district expansion + optional short Maps scrape.
 * Run: npx tsx scripts/test-district-expansion.ts
 * One city: npx tsx scripts/test-district-expansion.ts --kigali
 * Full scrape: npx tsx scripts/test-district-expansion.ts --scrape
 *
 * Uses the same provider resolution as scrape-stream (per user_id + is_active).
 * Set TEST_USER_ID in .env to your Supabase auth user id (dashboard user).
 * If omitted, picks the first ai_settings row with is_active + is_connected + api_key.
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";
import {
  clearCityAreaCache,
  expandCityIntoAreas,
  formatExpandAreasStatus,
  getActiveAIProvider,
  type AIProviderConfig,
} from "../src/utils/ai-scraper-helper";
import { resetExpansionAiSession } from "../src/utils/ai-scrape-rate-limit";
import {
  expandLocationQueries,
  extractCityFromLocation,
  scrapeWithoutAPI,
} from "../src/utils/puppeteer-scraper";

const root = resolve(__dirname, "..");

function loadEnv() {
  const raw = readFileSync(resolve(root, ".env"), "utf8").replace(/^\uFEFF/, "");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

loadEnv();

async function resolveTestUserId(): Promise<string | null> {
  const fromEnv = process.env.TEST_USER_ID?.trim();
  if (fromEnv) return fromEnv;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;

  const supabase = createClient(url, key);
  const { data } = await supabase
    .from("ai_settings")
    .select("user_id")
    .eq("is_active", true)
    .eq("is_connected", true)
    .not("api_key", "is", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data?.user_id ?? null;
}

async function loadAiProvider(): Promise<AIProviderConfig | null> {
  const userId = await resolveTestUserId();
  if (!userId) {
    console.warn(
      "No TEST_USER_ID and no active+connected ai_settings row — set TEST_USER_ID in .env"
    );
    return null;
  }
  return getActiveAIProvider(userId);
}

const CASES = [
  { niche: "restaurant", location: "Kigali Rwanda" },
  { niche: "school", location: "Nairobi Kenya" },
  { niche: "clinic", location: "Paris France" },
] as const;

async function runCase(
  niche: string,
  location: string,
  provider: AIProviderConfig | null,
  doScrape: boolean
) {
  clearCityAreaCache();
  resetExpansionAiSession();

  const city = extractCityFromLocation(location);
  const expansion = await expandCityIntoAreas(niche, city, provider);
  const queries = await expandLocationQueries(niche, location, provider);
  const areaCount = queries.length - 1;

  console.log(`\n--- ${niche} + ${location} ---`);
  console.log(`  City extracted: ${city}`);
  if (areaCount > 0) {
    console.log(`  Areas generated: ${areaCount}`);
  } else {
    console.log(`  Areas generated: ${formatExpandAreasStatus(expansion)}`);
  }
  console.log(`  Maps queries: ${queries.length}`);
  queries.forEach((q, i) => console.log(`    ${i + 1}. ${q}`));

  if (doScrape) {
    const leads = await scrapeWithoutAPI(niche, location, 40, undefined, provider, {
      round: 1,
    });
    console.log(`  Leads (max 40 target): ${leads.length}`);
  }
}

async function main() {
  const doScrape = process.argv.includes("--scrape");
  const kigaliOnly = process.argv.includes("--kigali");
  const testUserId = await resolveTestUserId();
  const provider = await loadAiProvider();

  console.log("Test user_id:", testUserId ?? "(none)");
  console.log(
    "AI provider:",
    provider
      ? `${provider.provider}/${provider.active_model} (key len ${provider.api_key?.length ?? 0})`
      : "(none)"
  );

  const cases = kigaliOnly ? [CASES[0]] : [...CASES];

  for (const { niche, location } of cases) {
    await runCase(niche, location, provider, doScrape);
  }

  if (!kigaliOnly) {
    console.log("\n--- Fallback (no AI key) ---");
    clearCityAreaCache();
    const expansion = await expandCityIntoAreas(
      "restaurant",
      "Kigali",
      null
    );
    const fallback = await expandLocationQueries(
      "restaurant",
      "Kigali Rwanda",
      null
    );
    console.log(`  ${formatExpandAreasStatus(expansion)}`);
    console.log(`  Queries: ${fallback.length} → ${fallback.join(" | ")}`);
    if (fallback.length !== 1) {
      console.error("  FAIL: expected single query fallback");
      process.exit(1);
    }
    console.log("  OK: single query fallback without crash");
  }

  if (!doScrape) {
    console.log("\nTip: run with --scrape for short Puppeteer lead counts (slow).");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
