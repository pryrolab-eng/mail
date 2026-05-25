/**
 * Part C: Re-research MBC ARCADE HOUSE and preview generated email (no save).
 * Run: npx tsx scripts/pipeline-mbc-test.ts
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";
import { runLeadResearch } from "../src/utils/lead-research";
import { runGenerateEmailForLead } from "../src/utils/lead-email-generation";

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

const LEAD_ID = "b829d28e-28f0-4b73-a508-739ed2855b56";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_KEY in .env");
  process.exit(1);
}

const supabase = createClient(url, key);

async function main() {
  const { data: lead } = await supabase
    .from("leads")
    .select("id, user_id, company_name, company_context, pipeline_stage, niche")
    .eq("id", LEAD_ID)
    .single();

  if (!lead) {
    console.error("Lead not found");
    process.exit(1);
  }

  console.log("\n=== BEFORE ===");
  console.log("pipeline_stage:", lead.pipeline_stage);
  console.log("niche:", lead.niche);
  console.log("company_context:\n", lead.company_context?.slice(0, 500));

  await supabase.from("generated_emails").delete().eq("lead_id", LEAD_ID);

  console.log("\n=== RESEARCH ===");
  const research = await runLeadResearch(supabase, lead.user_id, LEAD_ID);
  console.log(JSON.stringify(research, null, 2));

  const { data: afterResearch } = await supabase
    .from("leads")
    .select("company_context, pipeline_stage, niche")
    .eq("id", LEAD_ID)
    .single();

  console.log("\n=== company_context AFTER RESEARCH ===");
  console.log(afterResearch?.company_context);

  console.log("\n=== GENERATE (preview, not saved) ===");
  const gen = await runGenerateEmailForLead(supabase, lead.user_id, LEAD_ID, {
    preview: true,
  });
  console.log("\nSubject:", gen.subject);
  console.log("\nBody:\n", gen.body);
  console.log("\nMeta:", gen.error ?? "ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
