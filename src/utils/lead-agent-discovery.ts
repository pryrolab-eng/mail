import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchGoogleHtml,
  parseGoogleHits,
  type SearchHit,
} from "@/utils/search-engine-fetch";
import { enqueueAutomationJob } from "@/utils/automation-queue";

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function hostFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function extractEmail(text: string): string | null {
  return (
    text
      .match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/)?.[0]
      ?.toLowerCase() ?? null
  );
}

function extractPhone(text: string): string | null {
  return (
    text
      .match(/(?:\+?\d{1,3}[\s.\-]?)?(?:\(?\d{2,4}\)?[\s.\-]?){2,5}\d{2,4}/)?.[0]
      ?.replace(/\s+/g, " ")
      .trim() ?? null
  );
}

function titleToCompany(title: string): string {
  return cleanText(
    title
      .replace(/\s[-|–].*$/g, "")
      .replace(/\b(official website|contact|home|homepage|facebook|linkedin)\b/gi, "")
      .replace(/\s+/g, " ")
  ).slice(0, 140);
}

function discoveryQueries(niche: string, location: string, maxResults: number): string[] {
  const loc = cleanText(location);
  const base = cleanText(niche);
  return Array.from(
    new Set([
      `${base}${loc ? ` ${loc}` : ""} official website`,
      `${base}${loc ? ` ${loc}` : ""} contact email phone`,
      `${base}${loc ? ` ${loc}` : ""} businesses`,
      maxResults > 50 ? `${base}${loc ? ` ${loc}` : ""} directory contact` : "",
    ].filter(Boolean))
  );
}

async function searchWeb(query: string): Promise<SearchHit[]> {
  try {
    const google = await fetchGoogleHtml(query, "");
    const hits = parseGoogleHits(google.html, 10);
    console.log(
      `[lead-agent] discover searchWeb google: "${query}" -> ${hits.length} hit(s) via ${google.via}`
    );
    return hits;
  } catch (error) {
    console.warn(
      `[lead-agent] discover searchWeb google failed: "${query}" -> ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return [];
  }
}

export async function runAgentDiscovery(
  supabase: SupabaseClient,
  userId: string,
  input: {
    niche: string;
    location?: string | null;
    maxResults?: number | null;
    generateDrafts?: boolean;
  }
): Promise<{ inserted: number; duplicates: number; researchJobs: number; leadIds: string[] }> {
  const niche = cleanText(input.niche);
  const location = cleanText(input.location ?? "");
  const maxResults = Math.max(1, Math.min(Number(input.maxResults ?? 25), 100));
  const seen = new Set<string>();
  const candidates: Array<{
    company_name: string;
    email: string | null;
    phone: string | null;
    website: string | null;
    company_context: string;
  }> = [];

  console.log(`[lead-agent] discover start: ${niche}${location ? ` in ${location}` : ""}`);
  for (const query of discoveryQueries(niche, location, maxResults)) {
    console.log(`[lead-agent] discover searchWeb: ${query}`);
    const hits = await searchWeb(query);
    for (const hit of hits) {
      if (candidates.length >= maxResults) break;
      const company = titleToCompany(hit.title);
      if (!company || company.length < 3) continue;
      const host = hostFromUrl(hit.url);
      const key = `${company.toLowerCase()}|${host ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({
        company_name: company,
        email: extractEmail(`${hit.title} ${hit.snippet}`),
        phone: extractPhone(`${hit.title} ${hit.snippet}`),
        website: hit.url,
        company_context: `Discovery evidence: ${hit.title}. ${hit.snippet}`.slice(0, 900),
      });
    }
    if (candidates.length >= maxResults) break;
  }

  let inserted = 0;
  let duplicates = 0;
  const leadIds: string[] = [];
  for (const candidate of candidates) {
    const { data: existing } = await supabase
      .from("leads")
      .select("id")
      .eq("user_id", userId)
      .ilike("company_name", candidate.company_name)
      .limit(1)
      .maybeSingle();
    if (existing?.id) {
      duplicates++;
      leadIds.push(existing.id as string);
      continue;
    }

    const { data, error } = await supabase
      .from("leads")
      .insert({
        user_id: userId,
        company_name: candidate.company_name,
        email: candidate.email,
        phone: candidate.phone,
        website: candidate.website,
        niche,
        location: location || null,
        company_context: candidate.company_context,
        status: "new",
        pipeline_stage: "scraped",
        pipeline_updated_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    inserted++;
    leadIds.push(data.id as string);
  }

  for (const leadId of leadIds) {
    await enqueueAutomationJob(supabase, userId, "research_lead", { leadId });
    if (input.generateDrafts) {
      await enqueueAutomationJob(supabase, userId, "generate_draft", { leadId }, new Date(Date.now() + 30_000));
    }
  }

  console.log(
    `[lead-agent] discover done: ${inserted} inserted, ${duplicates} duplicate(s), ${leadIds.length} research job(s)`
  );
  return { inserted, duplicates, researchJobs: leadIds.length, leadIds };
}
