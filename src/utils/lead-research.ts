/**
 * Pipeline Step 3: research a scraped lead through the hybrid agent runtime.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PipelineStage } from "@/types/platform";
import {
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
import {
  extractOperationalSignalsFromLocation,
  inferIndustryKey,
} from "@/utils/company-public-research";
import {
  runLeadResearchAgent,
  serializeLeadResearchAgent,
} from "@/utils/lead-research-agent";

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

function hostFromMaybeUrl(url: string): string | null {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname
      .replace(/^www\./, "")
      .toLowerCase();
  } catch {
    return null;
  }
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
    const lower = text.toLowerCase();
    const services: string[] = [];
    if (/member|membership|dues|advocacy|professional/.test(lower)) {
      services.push("Membership and professional services");
    }
    if (/event|conference|seminar|training|cpd/.test(lower)) {
      services.push("Events and continuing education");
    }
    return services.length ? services : ["Membership organization services"];
  }
  return [];
}

function collectAgentBusinessFacts(agent: {
  evidence: Array<{
    extractedFacts: {
      businessFacts?: Array<{
        fact: string;
        category: string;
        source: string;
        confidence: string;
        salesRelevance: string;
      }>;
    };
  }>;
}) {
  const relevanceRank = { high: 0, medium: 1, low: 2 } as Record<string, number>;
  const categoryRank = {
    payment_model: 0,
    services_offered: 1,
    team_size: 2,
    specializations: 3,
    founder_background: 4,
    years_in_operation: 5,
    contact: 6,
    location: 7,
  } as Record<string, number>;
  return Array.from(
    new Map(
      agent.evidence
        .flatMap((item) => item.extractedFacts.businessFacts ?? [])
        .filter((fact) => fact.fact && fact.category && fact.source)
        .map((fact) => [`${fact.category}:${fact.fact.toLowerCase()}`, fact])
    ).values()
  ).sort(
    (a, b) =>
      (relevanceRank[a.salesRelevance] ?? 9) -
        (relevanceRank[b.salesRelevance] ?? 9) ||
      (categoryRank[a.category] ?? 99) - (categoryRank[b.category] ?? 99)
  );
}

function buildAgentResearchBlock(params: {
  companyName: string;
  businessType: string;
  operatingSignals: string[];
  businessFacts: ReturnType<typeof collectAgentBusinessFacts>;
  sources: string[];
}): string {
  return [
    "[RESEARCH]",
    `Company: ${params.companyName}`,
    `Business type: ${params.businessType}`,
    params.operatingSignals.length
      ? `Operations: ${params.operatingSignals.join("; ")}`
      : "",
    "Business facts:",
    JSON.stringify(params.businessFacts.slice(0, 8), null, 2),
    params.sources.length
      ? `Sources: ${params.sources.slice(0, 5).join(", ")}`
      : "",
    "[/RESEARCH]",
  ]
    .filter(Boolean)
    .join("\n");
}

function cleanLocationForContext(value: string | null): string | null {
  const clean = value?.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  if (clean.length > 140 || /[·]|open|closes|rating|reviews|\d\.\d\(\d+\)/i.test(clean)) {
    return null;
  }
  return clean;
}

export function resolveLeadWebsiteUrl(lead: {
  company_name?: string | null;
  website?: string | null;
  email?: string | null;
}): string | null {
  const site = lead.website?.trim();
  if (site && !/maps\.google|facebook\.com|linkedin\.com/i.test(site)) {
    const normalized = site.startsWith("http") ? site : `https://${site}`;
    const host = hostFromMaybeUrl(normalized);
    const companyTokens =
      lead.company_name
        ?.normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length >= 4)
        .filter(
          (token) =>
            ![
              "clinic",
              "medical",
              "company",
              "business",
              "official",
              "website",
            ].includes(token)
        ) ?? [];
    if (
      !host ||
      companyTokens.length === 0 ||
      companyTokens.some((token) => host.includes(token))
    ) {
      return normalized;
    }
  }

  const domain = lead.email?.split("@")[1]?.toLowerCase();
  if (domain && !FREE_EMAIL_DOMAINS.has(domain)) {
    return `https://${domain}`;
  }
  return null;
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

  const cleanLocation = cleanLocationForContext(row.location);
  const locationSignals = extractOperationalSignalsFromLocation(
    cleanLocation,
    row.company_name
  );

  try {
    let resolvedWebsite = resolveLeadWebsiteUrl(row);
    const aiProvider = await loadAIProviderForUser(supabase, userId);
    const agent = await runLeadResearchAgent({
      userId,
      leadId,
      companyName: row.company_name,
      location: cleanLocation,
      niche: storedNiche,
      website: resolvedWebsite,
      email: row.email,
      phone: row.phone,
      aiProvider,
      supabase,
    });

    if (!resolvedWebsite && agent.officialWebsite) {
      resolvedWebsite = agent.officialWebsite;
    }

    const agentBlock = serializeLeadResearchAgent(agent);
    const businessFacts = collectAgentBusinessFacts(agent);
    const listingFacts = [
      cleanLocation,
      row.phone ? `Phone: ${row.phone}` : null,
    ]
      .filter(Boolean)
      .join(". ");

    const businessType =
      industryKey === "arcade"
        ? "24-hour entertainment arcade (gaming venue)"
        : industryKey === "professional_association"
          ? "Professional association / membership organization"
          : `${storedNiche} business`;

    const operatingSignals = [...locationSignals];
    if (isProfessionalAssociationName(row.company_name)) {
      operatingSignals.push(
        "Membership organization, not a bar, restaurant, or retail venue"
      );
    }

    const researchBlock = buildAgentResearchBlock({
      companyName: row.company_name,
      businessType,
      operatingSignals,
      businessFacts,
      sources: Array.from(new Set(agent.evidence.map((item) => item.url).filter(Boolean))),
    });

    const mergedContext = [researchBlock, agentBlock, row.company_context?.trim()]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 3500);

    if (isWeakLeadContext(mergedContext, row.company_name) && locationSignals.length === 0) {
      const msg = "Agent produced insufficient evidence";
      await markLeadPipeline(supabase, leadId, userId, "failed", {
        pipeline_error: msg,
      });
      return { success: false, leadId, pipeline_stage: "failed", error: msg };
    }

    const intelInput: LeadIntelInput = {
      company_name: row.company_name,
      niche: storedNiche,
      location: cleanLocation,
      company_context: mergedContext,
      website: resolvedWebsite ?? row.website,
      phone: row.phone,
    };
    const intel = await resolveLeadIntel(intelInput, {
      aiProvider,
      useAi: false,
    });

    const stored = `${researchBlock}\n\n${agentBlock}\n\n${serializeLeadIntelForStorage(intel)}`;
    const nextStage =
      agent.recommendedAction === "phone_only"
        ? "call_list"
        : agent.recommendedAction === "rejected"
          ? "failed"
          : "researched";

    await markLeadPipeline(supabase, leadId, userId, nextStage, {
      company_context: stored,
      website: resolvedWebsite ?? row.website ?? undefined,
      niche: storedNiche,
      pipeline_error:
        nextStage === "failed"
          ? agent.reason || "Agent rejected this lead"
          : null,
    });

    return {
      success: nextStage !== "failed",
      leadId,
      pipeline_stage: nextStage,
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
