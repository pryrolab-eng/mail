/**
 * Shared scrape → CRM insert: validation, dedupe, pipeline_stage = scraped.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ScrapedLead } from "@/types/platform";
import { resolveDisambiguatedNiche } from "@/utils/lead-context-builder";
import { inferEmailMetaFromScrapedLead } from "@/utils/scrape-email-meta";
import {
  finalizeScrapedLead,
  finalizePhoneOnlyScrapeLead,
  isJunkScrapeLead,
} from "@/utils/scrape-lead-quality";
import { runLeadResearchBatch } from "@/utils/lead-research";
import { verifyEmail } from "@/utils/email-verifier";

export type ScrapeLeadInsertResult = {
  added: number;
  callListAdded: number;
  duplicates: number;
  skipped: number;
  junkFiltered: number;
  verificationRejected: number;
  insertedLeadIds: string[];
  callListLeadIds: string[];
  researched: number;
  researchFailed: number;
};

function companyLocationKey(companyName: string, loc: string | null | undefined): string {
  return `${companyName.trim().toLowerCase()}|${(loc ?? "").trim().toLowerCase()}`;
}

function phoneOnlyKey(companyName: string, phone: string | null | undefined): string {
  return `phone|${companyName.trim().toLowerCase()}|${(phone ?? "").replace(/\D/g, "")}`;
}

export async function findExistingLeadKeys(
  supabase: SupabaseClient,
  userId: string,
  leads: Array<{
    email?: string;
    company_name: string;
    location?: string | null;
    phone?: string | null;
    phoneOnly?: boolean;
  }>
): Promise<{
  emails: Set<string>;
  companyLocations: Set<string>;
  phoneOnlyKeys: Set<string>;
}> {
  const emails = new Set(
    leads.map((l) => l.email?.trim().toLowerCase()).filter(Boolean) as string[]
  );
  const companyLocations = new Set(
    leads.map((l) => companyLocationKey(l.company_name, l.location))
  );

  const emailList = Array.from(emails);
  const { data: byEmail } = emailList.length
    ? await supabase
        .from("leads")
        .select("email, company_name, location")
        .eq("user_id", userId)
        .in("email", emailList)
    : { data: [] as { email: string | null; company_name: string; location: string | null }[] };

  for (const row of byEmail ?? []) {
    if (row.email) emails.add(row.email.toLowerCase());
    companyLocations.add(companyLocationKey(row.company_name, row.location));
  }

  const names = Array.from(new Set(leads.map((l) => l.company_name.trim())));
  if (names.length > 0) {
    const { data: byName } = await supabase
      .from("leads")
      .select("email, company_name, location")
      .eq("user_id", userId)
      .in("company_name", names);

    for (const row of byName ?? []) {
      if (row.email) emails.add(row.email.toLowerCase());
      companyLocations.add(companyLocationKey(row.company_name, row.location));
    }
  }

  const phoneOnlyKeys = new Set<string>();
  const { data: callRows } = await supabase
    .from("leads")
    .select("company_name, phone")
    .eq("user_id", userId)
    .eq("pipeline_stage", "call_list");
  for (const row of callRows ?? []) {
    phoneOnlyKeys.add(phoneOnlyKey(row.company_name, row.phone));
  }

  return { emails, companyLocations, phoneOnlyKeys };
}

export function isDuplicateScrapeLead(
  lead: {
    email?: string;
    company_name: string;
    location?: string | null;
    phone?: string | null;
    phoneOnly?: boolean;
  },
  existing: {
    emails: Set<string>;
    companyLocations: Set<string>;
    phoneOnlyKeys: Set<string>;
  }
): boolean {
  if (lead.phoneOnly) {
    return existing.phoneOnlyKeys.has(phoneOnlyKey(lead.company_name, lead.phone));
  }
  const email = lead.email?.trim().toLowerCase();
  if (!email) return false;
  if (existing.emails.has(email)) return true;
  return existing.companyLocations.has(
    companyLocationKey(lead.company_name, lead.location)
  );
}

/**
 * Filter, dedupe against DB, insert with pipeline_stage = scraped.
 */
export async function insertScrapedLeadsToCrm(
  supabase: SupabaseClient,
  userId: string,
  rawLeads: ScrapedLead[],
  options: {
    searchLocation: string;
    category?: string;
    niche?: string;
    /** Auto-run company research after insert (default true) */
    autoResearch?: boolean;
  }
): Promise<ScrapeLeadInsertResult> {
  const searchLocation = options.searchLocation.trim();
  let junkFiltered = 0;

  const finalized: ScrapedLead[] = [];
  const phoneOnlyFinal: ScrapedLead[] = [];
  for (const raw of rawLeads) {
    if (raw.phoneOnly) {
      const phoneLead = finalizePhoneOnlyScrapeLead(raw, searchLocation);
      if (!phoneLead) {
        junkFiltered++;
        continue;
      }
      if (
        isJunkScrapeLead(
          {
            company_name: phoneLead.company_name,
            phone: phoneLead.phone,
            website: phoneLead.website,
            business_address: phoneLead.business_address,
            source_snippet: phoneLead.source_snippet,
            location: phoneLead.location,
            phoneOnly: true,
          },
          searchLocation
        )
      ) {
        junkFiltered++;
        continue;
      }
      phoneOnlyFinal.push(phoneLead);
      continue;
    }

    const lead = finalizeScrapedLead(raw, searchLocation);
    if (!lead) {
      junkFiltered++;
      continue;
    }
    if (
      isJunkScrapeLead(
        {
          company_name: lead.company_name,
          email: lead.email,
          website: lead.website,
          business_address: lead.business_address,
          source_snippet: lead.source_snippet,
          location: lead.location,
        },
        searchLocation
      )
    ) {
      junkFiltered++;
      continue;
    }
    finalized.push(lead);
  }

  const withEmail = finalized.filter((l) => l.email?.trim());
  const skipped =
    rawLeads.length - withEmail.length - phoneOnlyFinal.length + junkFiltered;

  const category =
    options.category?.trim() ||
    (options.niche && searchLocation
      ? `${options.niche} - ${searchLocation}`
      : options.niche || searchLocation || "Uncategorized");

  if (category) {
    await supabase
      .from("lead_categories")
      .upsert({ user_id: userId, name: category }, { onConflict: "user_id,name" });
  }

  const existing = await findExistingLeadKeys(supabase, userId, [
    ...withEmail,
    ...phoneOnlyFinal,
  ]);
  const newLeads = withEmail.filter((l) => !isDuplicateScrapeLead(l, existing));
  const newPhoneLeads = phoneOnlyFinal.filter(
    (l) => !isDuplicateScrapeLead(l, existing)
  );
  const duplicates =
    withEmail.length -
    newLeads.length +
    (phoneOnlyFinal.length - newPhoneLeads.length);

  if (newLeads.length === 0 && newPhoneLeads.length === 0) {
    return {
      added: 0,
      callListAdded: 0,
      duplicates,
      skipped,
      junkFiltered,
      verificationRejected: 0,
      insertedLeadIds: [],
      callListLeadIds: [],
      researched: 0,
      researchFailed: 0,
    };
  }

  let verificationRejected = 0;
  const verifiedLeads: Array<{
    lead: (typeof newLeads)[0];
    verification: Awaited<ReturnType<typeof verifyEmail>>;
  }> = [];

  for (const l of newLeads) {
    const check = await verifyEmail(l.email);
    if (!check.valid && check.reason !== "smtp_rejected") {
      verificationRejected++;
      try {
        const { recordVerifyRejection } = await import('@/utils/scrape-run-stats');
        recordVerifyRejection(check.reason);
      } catch {
        /* optional stats */
      }
      console.log(
        `  ⛔ Email verify skip: ${l.email} (${check.reason}) — ${l.company_name}`
      );
      continue;
    }
    verifiedLeads.push({ lead: l, verification: check });
  }

  const now = new Date().toISOString();
  const emailInserts =
    verifiedLeads.length > 0
      ? verifiedLeads.map(({ lead: l, verification }) => {
          const meta = inferEmailMetaFromScrapedLead(l);
          return {
            user_id: userId,
            company_name: l.company_name.trim(),
            email: l.email.trim().toLowerCase(),
            phone: l.phone ?? null,
            website: l.website ?? null,
            niche:
              resolveDisambiguatedNiche(l.company_name, l.niche) || l.niche || null,
            location: l.location || searchLocation || null,
            company_context: l.company_context ?? "",
            status: "new",
            source: "scraper",
            category,
            confidence_score: l.emailIsReal ? 90 : 50,
            email_verified:
              verification.valid || verification.reason === "smtp_rejected",
            email_verification_reason: verification.reason,
            pipeline_stage: "scraped",
            pipeline_updated_at: now,
            pipeline_error: null,
            email_source: meta.email_source,
            email_confidence: meta.email_confidence,
          };
        })
      : [];

  const phoneInserts = newPhoneLeads.map((l) => ({
    user_id: userId,
    company_name: l.company_name.trim(),
    email: null,
    phone: l.phone ?? null,
    website: l.website ?? null,
    niche: resolveDisambiguatedNiche(l.company_name, l.niche) || l.niche || null,
    location: l.location || searchLocation || null,
    company_context: l.company_context ?? "",
    status: "new",
    source: "scraper",
    category,
    confidence_score: 30,
    email_verified: false,
    email_verification_reason: null,
    pipeline_stage: "call_list",
    pipeline_updated_at: now,
    pipeline_error: null,
    email_source: null,
    email_confidence: null,
  }));

  const allInserts = [...emailInserts, ...phoneInserts];
  const { data: insertedRows, error } = await supabase
    .from("leads")
    .insert(allInserts)
    .select("id, pipeline_stage");
  if (error) throw new Error(error.message);

  const insertedLeadIds = (insertedRows ?? [])
    .filter((r) => r.pipeline_stage === "scraped")
    .map((r) => r.id as string);
  const callListLeadIds = (insertedRows ?? [])
    .filter((r) => r.pipeline_stage === "call_list")
    .map((r) => r.id as string);

  let researched = 0;
  let researchFailed = 0;
  if (options.autoResearch !== false && insertedLeadIds.length > 0) {
    const batch = await runLeadResearchBatch(supabase, userId, insertedLeadIds, 2);
    researched = batch.researched;
    researchFailed = batch.failed;
  }

  return {
    added: verifiedLeads.length,
    callListAdded: newPhoneLeads.length,
    duplicates,
    skipped,
    junkFiltered,
    verificationRejected,
    insertedLeadIds,
    callListLeadIds,
    researched,
    researchFailed,
  };
}
