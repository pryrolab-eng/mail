/**
 * Integration test: warehouse + Kigali Rwanda, target 100.
 * Run: npx tsx scripts/test-free-lead-stack.ts
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";
import { getActiveAIProvider } from "../src/utils/ai-scraper-helper";
import { expandKigaliQueries } from "../src/utils/puppeteer-scraper";
import { scrapeWithoutAPI } from "../src/utils/puppeteer-scraper";
import { insertScrapedLeadsToCrm } from "../src/utils/scrape-lead-crm";
import { resetScrapeRunStats, scrapeRunStats } from "../src/utils/scrape-run-stats";

const root = resolve(__dirname, "..");

function loadEnv() {
  for (const line of readFileSync(resolve(root, ".env"), "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t[0] === "#") continue;
    const eq = t.indexOf("=");
    if (eq < 1) continue;
    process.env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
}

async function resolveTestUserId(supabase: ReturnType<typeof createClient>): Promise<string> {
  if (process.env.TEST_USER_ID?.trim()) return process.env.TEST_USER_ID.trim();
  const { data } = await supabase
    .from("ai_settings")
    .select("user_id")
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data?.user_id) throw new Error("Set TEST_USER_ID in .env");
  return data.user_id;
}

async function main() {
  loadEnv();
  resetScrapeRunStats();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_KEY!;
  const supabase = createClient(url, key);

  const userId = await resolveTestUserId(supabase);
  const provider = await getActiveAIProvider(userId);
  const niche = "warehouse";
  const location = "Kigali Rwanda";

  const mapsQueries = expandKigaliQueries(niche, location);
  console.log("\n=== BEFORE (old behavior) ===");
  console.log("Maps queries: 1 (single query only)");
  console.log("\n=== STEP 1 — Kigali expansion ===");
  console.log(`Maps queries planned: ${mapsQueries.length}`);
  mapsQueries.forEach((q, i) => console.log(`  ${i + 1}. ${q}`));

  console.log("\n=== Running scrape (target 100) ===\n");
  const leads = await scrapeWithoutAPI(niche, location, 100, undefined, provider, {
    round: 1,
  });

  const kgCount = leads.filter((l) =>
    l.company_context?.includes("[KNOWLEDGE GRAPH]")
  ).length;

  console.log("\n=== Scrape complete — inserting to CRM ===\n");
  const crm = await insertScrapedLeadsToCrm(supabase, userId, leads, {
    searchLocation: location,
    niche,
    autoResearch: false,
  });

  console.log("\n=== INTEGRATION TEST REPORT ===");
  console.log(`1. Maps queries run: ${scrapeRunStats.mapsQueries || mapsQueries.length} (expect ~11)`);
  console.log(`2. CommonCrawl emails in run: ${scrapeRunStats.commonCrawlHits}`);
  console.log(`3. Verifier rejected: ${crm.verificationRejected}`);
  if (Object.keys(scrapeRunStats.verifyReasons).length) {
    console.log(`   Reasons: ${JSON.stringify(scrapeRunStats.verifyReasons)}`);
  }
  console.log(`4. Knowledge Graph in scraped leads: ${kgCount} (stats counter: ${scrapeRunStats.knowledgeGraphEnriched})`);
  console.log(`5. CRM inserted: ${crm.added} | duplicates: ${crm.duplicates} | junk filtered during insert: ${crm.junkFiltered}`);
  console.log(`   Raw leads from scrape: ${leads.length}`);
  console.log("\nGOOGLE_KNOWLEDGE_GRAPH_API_KEY set:", !!process.env.GOOGLE_KNOWLEDGE_GRAPH_API_KEY?.trim());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
