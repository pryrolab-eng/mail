/**
 * Pipeline Step 3: research a scraped lead → company_context + pipeline_stage.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PipelineStage } from "@/types/platform";
import {
  fetchLeadWebsiteSnippet,
  resolveLeadIntel,
  serializeLeadIntelForStorage,
  type LeadIntelInput,
} from "@/utils/lead-intel";
import {
  isProfessionalAssociationName,
  isWeakLeadContext,
  PROFESSIONAL_ASSOCIATION_NICHE,
  resolveDisambiguatedNiche,
} from "@/utils/lead-context-builder";
import { loadAIProviderForUser } from "@/utils/load-ai-provider-server";
import { fetchWebpage } from "@/utils/website-email-scraper";
import {
  buildStructuredResearchBlock,
  extractOperationalSignalsFromLocation,
  inferIndustryKey,
  searchPublicCompanyInfo,
} from "@/utils/company-public-research";

const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "icloud.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
]);

export type LeadResearchResult = {
  success: boolean;
  leadId: string;
  pipeline_stage: PipelineStage;
  company_context?: string | null;
  error?: string;
  intelSource?: string;
  researchPreview?: string;
};

type LeadRow = {
  id: string;
  user_id: string;
  company_name: string;
  email: string | null;
  website: string | null;
  niche: string | null;
  location: string | null;
  company_context: string | null;
  phone: string | null;
  pipeline_stage: string | null;
};

function htmlToPlainText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractPhrasesFromText(text: string, companyName: string): string[] {
  const firstWord = companyName.split(/\s+/)[0]?.toLowerCase() ?? "";
  return text
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 35 && s.length <= 280)
    .filter((s) => !/cookie|javascript|privacy policy|terms of use/i.test(s))
    .sort((a, b) => {
      const aHit = firstWord && a.toLowerCase().includes(firstWord) ? 1 : 0;
      const bHit = firstWord && b.toLowerCase().includes(firstWord) ? 1 : 0;
      return bHit - aHit;
    })
    .slice(0, 5);
}

function extractServicesFromText(text: string, companyName?: string): string[] {
  if (companyName && isProfessionalAssociationName(companyName)) {
    const services: string[] = [];
    const lower = text.toLowerCase();
    if (/member|membership|dues|advocacy|professional/.test(lower)) {
      services.push("Membership and professional services");
    }
    if (/event|conference|seminar|training|cpd/.test(lower)) {
      services.push("Events and continuing education");
    }
    return services.length
      ? services
      : ["Membership organization services"];
  }

  const services: string[] = [];
  const lower = text.toLowerCase();
  if (/arcade|video game|gaming|pool table|snooker|billiard/.test(lower)) {
    services.push("Arcade / gaming entertainment");
  }
  if (/birthday party|party package|event/.test(lower)) {
    services.push("Events and party packages");
  }
  if (
    /food|snack|drink/.test(lower) ||
    (/\bbar\b/.test(lower) && !/\bbar association\b/i.test(lower + (companyName ?? "")))
  ) {
    services.push("Food and beverages on site");
  }
  if (/24 hour|24\/7|open all night/.test(lower)) {
    services.push("24-hour operation");
  }
  return services;
}

/** Resolve a usable business website URL from lead fields */
export function resolveLeadWebsiteUrl(lead: {
  website?: string | null;
  email?: string | null;
}): string | null {
  const site = lead.website?.trim();
  if (site && !/maps\.google|facebook\.com|linkedin\.com/i.test(site)) {
    return site.startsWith("http") ? site : `https://${site}`;
  }
  const domain = lead.email?.split("@")[1]?.toLowerCase();
  if (domain && !FREE_EMAIL_DOMAINS.has(domain)) {
    return `https://${domain}`;
  }
  return null;
}

/** Scrape homepage/about using website-email-scraper fetch + lead-intel snippet */
export async function scrapeCompanyWebsiteContext(
  websiteUrl: string,
  companyName: string
): Promise<{
  rawContext: string;
  phrases: string[];
  resolvedUrl: string | null;
  services: string[];
  error?: string;
}> {
  let origin = websiteUrl;
  try {
    origin = new URL(
      websiteUrl.startsWith("http") ? websiteUrl : `https://${websiteUrl}`
    ).origin;
  } catch {
    return {
      rawContext: "",
      phrases: [],
      resolvedUrl: null,
      services: [],
      error: "Invalid website URL",
    };
  }

  const urls = [
    origin,
    `${origin}/about`,
    `${origin}/about-us`,
    `${origin}/services`,
    `${origin}/contact`,
  ];

  let combinedText = "";
  let resolvedUrl: string | null = null;
  const allPhrases: string[] = [];

  for (const url of urls) {
    const html = await fetchWebpage(url, 12_000);
    if (!html) continue;
    if (!resolvedUrl) resolvedUrl = url;
    const text = htmlToPlainText(html);
    combinedText += ` ${text}`;
    allPhrases.push(...extractPhrasesFromText(text, companyName));
  }

  const snippet = await fetchLeadWebsiteSnippet(origin);
  if (snippet) {
    if (snippet.meta) combinedText = `${snippet.meta} ${combinedText}`;
    if (snippet.sentences.length) {
      allPhrases.unshift(...snippet.sentences);
    }
  }

  const uniquePhrases = Array.from(new Set(allPhrases)).slice(0, 5);
  const services = extractServicesFromText(combinedText, companyName);

  if (!combinedText.trim() && uniquePhrases.length === 0) {
    return {
      rawContext: "",
      phrases: [],
      resolvedUrl,
      services: [],
      error: resolvedUrl
        ? "Website loaded but no usable text (blocked or empty page)"
        : "Could not reach website (timeout, DNS, or blocked)",
    };
  }

  const parts: string[] = [];
  if (uniquePhrases.length > 0) {
    parts.push(`How they describe themselves: "${uniquePhrases.join('" | "')}"`);
  }
  if (services.length) {
    parts.push(`Services detected: ${services.join("; ")}`);
  }
  parts.push(combinedText.slice(0, 1200));

  return {
    rawContext: parts.join("\n").trim(),
    phrases: uniquePhrases,
    resolvedUrl,
    services,
  };
}

async function markLeadPipeline(
  supabase: SupabaseClient,
  leadId: string,
  userId: string,
  stage: PipelineStage,
  updates: {
    company_context?: string;
    website?: string;
    niche?: string;
    pipeline_error?: string | null;
  }
): Promise<void> {
  const { error } = await supabase
    .from("leads")
    .update({
      pipeline_stage: stage,
      pipeline_updated_at: new Date().toISOString(),
      pipeline_error: updates.pipeline_error ?? null,
      ...(updates.company_context !== undefined
        ? { company_context: updates.company_context }
        : {}),
      ...(updates.website ? { website: updates.website } : {}),
      ...(updates.niche ? { niche: updates.niche } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", leadId)
    .eq("user_id", userId);

  if (error) throw new Error(error.message);
}

/**
 * Research one lead: website + Bing fallback → structured context → intel.
 */
export async function runLeadResearch(
  supabase: SupabaseClient,
  userId: string,
  leadId: string
): Promise<LeadResearchResult> {
  const { data: lead, error: loadError } = await supabase
    .from("leads")
    .select(
      "id, user_id, company_name, email, website, niche, location, company_context, phone, pipeline_stage"
    )
    .eq("id", leadId)
    .eq("user_id", userId)
    .single();

  if (loadError || !lead) {
    return {
      success: false,
      leadId,
      pipeline_stage: "failed",
      error: loadError?.message ?? "Lead not found",
    };
  }

  const row = lead as LeadRow;
  const correctedNiche = resolveDisambiguatedNiche(row.company_name, row.niche);
  const industryKey = inferIndustryKey(row.company_name, correctedNiche);
  const storedNiche =
    industryKey === "arcade"
      ? "Entertainment / Arcade"
      : industryKey === "professional_association"
        ? PROFESSIONAL_ASSOCIATION_NICHE
        : correctedNiche || industryKey;

  const locationSignals = extractOperationalSignalsFromLocation(
    row.location,
    row.company_name
  );

  try {
    let websiteText = "";
    let theirPhrases: string[] = [];
    let services: string[] = [];
    let sources: string[] = [];
    let resolvedWebsite = resolveLeadWebsiteUrl(row);

    const websiteUrl = resolvedWebsite;
    if (websiteUrl) {
      console.log(`[lead-research] Scraping website: ${websiteUrl}`);
      const scraped = await scrapeCompanyWebsiteContext(
        websiteUrl,
        row.company_name
      );
      if (scraped.rawContext) {
        websiteText = scraped.rawContext;
        theirPhrases = scraped.phrases;
        services = scraped.services;
        resolvedWebsite = scraped.resolvedUrl ?? websiteUrl;
        sources.push(resolvedWebsite);
      } else {
        console.warn(`[lead-research] Website scrape failed: ${scraped.error}`);
      }
    }

    if (websiteText.length < 120) {
      console.log(`[lead-research] Bing fallback for ${row.company_name}`);
      const pub = await searchPublicCompanyInfo(
        row.company_name,
        row.location ?? "Kigali, Rwanda"
      );
      const goodHits = pub.hits.filter((h) => {
        const b = `${h.title} ${h.snippet}`.toLowerCase();
        return !/mena|mauritius|mbc\.net|broadcasting|paramount|mbc group, the largest/i.test(
          b
        );
      });

      if (goodHits.length > 0) {
        const cleanText = goodHits.map((h) => `${h.title}. ${h.snippet}`).join(" ");
        websiteText = [websiteText, cleanText].filter(Boolean).join("\n");
        theirPhrases.push(
          ...extractPhrasesFromText(cleanText, row.company_name)
        );
        sources.push(...goodHits.map((h) => h.url).filter(Boolean));
      } else {
        console.log(
          `[lead-research] No relevant Bing snippets — using Maps/listing signals only`
        );
      }
    }

    if (services.length === 0) {
      services = extractServicesFromText(
        `${websiteText} ${row.location ?? ""} ${row.company_name}`,
        row.company_name
      );
    }

    const businessType =
      industryKey === "arcade"
        ? "24-hour entertainment arcade (gaming venue)"
        : industryKey === "professional_association"
          ? "Professional association / membership organization"
          : `${storedNiche} business`;

    const operatingSignalsBase = [...locationSignals];
    if (isProfessionalAssociationName(row.company_name)) {
      operatingSignalsBase.push(
        "Membership organization — not a bar, restaurant, or retail venue (scraper niche may be wrong)"
      );
    }

    const listingFacts = [
      row.location?.trim(),
      row.phone ? `Phone: ${row.phone}` : null,
    ]
      .filter(Boolean)
      .join(". ");

    const researchBlock = buildStructuredResearchBlock({
      companyName: row.company_name,
      businessType,
      operatingSignals: operatingSignalsBase,
      services,
      theirPhrases: Array.from(new Set(theirPhrases)).slice(0, 5),
      websiteText:
        websiteText ||
        (listingFacts
          ? `Google Maps listing: ${listingFacts}`
          : undefined),
      publicSnippets: undefined,
      sources: Array.from(new Set(sources)),
    });

    const priorContext = row.company_context?.trim() ?? "";
    const mergedContext = [researchBlock, priorContext]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 3500);

    if (isWeakLeadContext(mergedContext, row.company_name) && locationSignals.length === 0) {
      const msg = "Research produced insufficient company context (website blocked and no public snippets)";
      await markLeadPipeline(supabase, leadId, userId, "failed", {
        pipeline_error: msg,
      });
      return { success: false, leadId, pipeline_stage: "failed", error: msg };
    }

    const intelInput: LeadIntelInput = {
      company_name: row.company_name,
      niche: storedNiche,
      location: row.location,
      company_context: mergedContext,
      website: resolvedWebsite ?? row.website,
      phone: row.phone,
    };

    const aiProvider = await loadAIProviderForUser(supabase, userId);
    const intel = await resolveLeadIntel(intelInput, {
      aiProvider,
      useAi: !!aiProvider,
    });

    const stored = `${researchBlock}\n\n${serializeLeadIntelForStorage(intel)}`;
    await markLeadPipeline(supabase, leadId, userId, "researched", {
      company_context: stored,
      website: resolvedWebsite ?? row.website ?? undefined,
      niche: storedNiche,
      pipeline_error: null,
    });

    return {
      success: true,
      leadId,
      pipeline_stage: "researched",
      company_context: stored,
      intelSource: intel.source,
      researchPreview: researchBlock,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Research failed";
    await markLeadPipeline(supabase, leadId, userId, "failed", {
      pipeline_error: msg,
    });
    return { success: false, leadId, pipeline_stage: "failed", error: msg };
  }
}

/** Run research for many leads with limited concurrency (post-scrape). */
export async function runLeadResearchBatch(
  supabase: SupabaseClient,
  userId: string,
  leadIds: string[],
  concurrency = 2
): Promise<{ researched: number; failed: number }> {
  let researched = 0;
  let failed = 0;

  for (let i = 0; i < leadIds.length; i += concurrency) {
    const batch = leadIds.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map((id) =>
        runLeadResearch(supabase, userId, id).catch((e) => ({
          success: false,
          leadId: id,
          pipeline_stage: "failed" as PipelineStage,
          error: e instanceof Error ? e.message : "Research failed",
        }))
      )
    );
    for (const r of results) {
      if (r.success) researched++;
      else failed++;
    }
  }

  return { researched, failed };
}
