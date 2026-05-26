/**
 * Pipeline Step 4: generate personalised email from company_context → generated_emails.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PipelineStage } from "@/types/platform";
import {
  applySenderPlaceholders,
  buildPipelineSubjectFallback,
  buildPipelineValidationRetryHint,
  buildPryroPipelineSystemPrompt,
  buildPryroPipelineUserPrompt,
  DEFAULT_YOUR_COMPANY,
  deriveLeadContactFields,
  parsePryroPipelineEmailResponse,
  resolveGenerationModel,
  validatePipelineEmail,
} from "@/utils/email-prompts";
import {
  isWeakLeadContext,
  resolveDisambiguatedNiche,
} from "@/utils/lead-context-builder";
import { scoreEmailQuality } from "@/utils/email-quality";
import { loadAIProviderForUser } from "@/utils/load-ai-provider-server";
import type { AIProviderConfig } from "@/utils/lead-intel-ai";
export type GenerateEmailResult = {
  success: boolean;
  leadId: string;
  pipeline_stage: PipelineStage;
  emailId?: string;
  subject?: string;
  body?: string;
  model?: string;
  error?: string;
  /** Set when options.preview — email not saved */
  preview?: boolean;
  company_context_used?: string;
};

type LeadRow = {
  id: string;
  user_id: string;
  company_name: string;
  email: string | null;
  niche: string | null;
  location: string | null;
  company_context: string | null;
  pipeline_stage: string | null;
  notes: string | null;
  automation_score?: number | null;
  automation_fit_reason?: string | null;
};

async function callPipelineAI(
  provider: AIProviderConfig,
  systemMessage: string,
  userPrompt: string,
  attempt = 0
): Promise<string> {
  const MAX_ATTEMPTS = 4;
  const model = resolveGenerationModel(provider.provider, provider.active_model);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  let url = "";
  let body: object;

  if (provider.provider === "openai" || provider.provider === "groq") {
    url =
      provider.provider === "openai"
        ? "https://api.openai.com/v1/chat/completions"
        : "https://api.groq.com/openai/v1/chat/completions";
    headers.Authorization = `Bearer ${provider.api_key}`;
    body = {
      model,
      messages: [
        { role: "system", content: systemMessage },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.5,
      max_tokens: 600,
    };
  } else if (provider.provider === "anthropic") {
    url = "https://api.anthropic.com/v1/messages";
    headers["x-api-key"] = provider.api_key;
    headers["anthropic-version"] = "2023-06-01";
    body = {
      model: provider.active_model || "claude-3-5-haiku-20241022",
      max_tokens: 600,
      system: systemMessage,
      messages: [{ role: "user", content: userPrompt }],
    };
  } else if (provider.provider === "gemini") {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${provider.api_key}`;
    body = {
      contents: [{ parts: [{ text: `${systemMessage}\n\n${userPrompt}` }] }],
      generationConfig: { temperature: 0.5, maxOutputTokens: 600 },
    };
  } else if (provider.provider === "mistral") {
    url = "https://api.mistral.ai/v1/chat/completions";
    headers.Authorization = `Bearer ${provider.api_key}`;
    body = {
      model,
      messages: [
        { role: "system", content: systemMessage },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.5,
      max_tokens: 600,
    };
  } else {
    throw new Error(`Unsupported AI provider: ${provider.provider}`);
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45_000),
  });

  if (res.status === 429 && attempt < MAX_ATTEMPTS) {
    const waitMs = Math.min(5000 * 2 ** attempt, 45_000);
    await new Promise((r) => setTimeout(r, waitMs));
    return callPipelineAI(provider, systemMessage, userPrompt, attempt + 1);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`AI API error ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  if (provider.provider === "anthropic") {
    return data.content[0].text as string;
  }
  if (provider.provider === "gemini") {
    return data.candidates[0].content.parts[0].text as string;
  }
  return data.choices[0].message.content as string;
}

async function resolveSenderName(
  supabase: SupabaseClient,
  userId: string
): Promise<string> {
  const { data } = await supabase
    .from("smtp_accounts")
    .select("email, sender_name")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("sent_today", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (data?.sender_name?.trim()) return data.sender_name.trim();
  if (data?.email) {
    return data.email
      .split("@")[0]
      .replace(/[._\-]/g, " ")
      .replace(/\b\w/g, (c: string) => c.toUpperCase());
  }
  return "Sales Team";
}

function inferCompanySize(context: string, location: string | null): string {
  const blob = `${context} ${location ?? ""}`.toLowerCase();
  if (/\b(enterprise|multinational|1000\+|500\+ employees)\b/.test(blob)) {
    return "Enterprise";
  }
  if (/\b(\d{2,3})\s*(employees|staff|people)\b/.test(blob)) {
    const m = blob.match(/\b(\d{2,3})\s*(employees|staff|people)\b/);
    return m ? `${m[1]} employees` : "Mid-size";
  }
  if (/\b(small business|sme|startup|family[- ]run|local)\b/.test(blob)) {
    return "Small business";
  }
  return "SMB (not specified on website)";
}

async function markPipelineFailed(
  supabase: SupabaseClient,
  leadId: string,
  userId: string,
  message: string
): Promise<void> {
  await supabase
    .from("leads")
    .update({
      pipeline_stage: "failed",
      pipeline_error: message,
      pipeline_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", leadId)
    .eq("user_id", userId);
}

/**
 * Generate one cold email for a lead using researched company_context.
 */
export async function runGenerateEmailForLead(
  supabase: SupabaseClient,
  userId: string,
  leadId: string,
  options?: { preview?: boolean; tone?: string }
): Promise<GenerateEmailResult> {
  const { data: lead, error: loadError } = await supabase
    .from("leads")
    .select(
      "id, user_id, company_name, email, niche, location, company_context, pipeline_stage, notes, automation_score, automation_fit_reason"
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
  const context = row.company_context?.trim() ?? "";

  const hasResearch =
    context.includes("[RESEARCH]") ||
    context.includes("[INTEL]") ||
    (!isWeakLeadContext(context, row.company_name) && context.length >= 80);

  if (!hasResearch) {
    const msg =
      "Lead needs company research first — run Research before generating email";
    if (!options?.preview) {
      await markPipelineFailed(supabase, leadId, userId, msg);
    }
    return { success: false, leadId, pipeline_stage: "failed", error: msg };
  }

    const aiProvider = await loadAIProviderForUser(supabase, userId);
  if (!aiProvider?.api_key) {
    const msg = "No AI provider configured — set up AI in Settings";
    await markPipelineFailed(supabase, leadId, userId, msg);
    return { success: false, leadId, pipeline_stage: "failed", error: msg };
  }

  try {
    const repName = await resolveSenderName(supabase, userId);
    const { contact_name, contact_role, first_name } = deriveLeadContactFields({
      email: row.email,
      company_name: row.company_name,
    });

    const researchBlock =
      context.match(/\[RESEARCH\][\s\S]*?\[\/RESEARCH\]/)?.[0] ?? context;

    const nicheForEmail = resolveDisambiguatedNiche(
      row.company_name,
      row.niche
    );

    const systemMessage = buildPryroPipelineSystemPrompt(repName);
    const promptBase = {
      company_name: row.company_name.trim(),
      niche: nicheForEmail || row.niche,
      contact_name,
      contact_role,
      location: row.location,
      company_size: inferCompanySize(researchBlock, row.location),
      company_context: researchBlock,
      rep_name: repName,
    };

    const MAX_ATTEMPTS = 3;
    let userPrompt = buildPryroPipelineUserPrompt(promptBase);
    let subject = "";
    let body = "";
    let validation = validatePipelineEmail("", "", row.company_name);

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const raw = await callPipelineAI(aiProvider, systemMessage, userPrompt);
      ({ subject, body } = parsePryroPipelineEmailResponse(
        raw,
        repName,
        first_name
      ));
      body = applySenderPlaceholders(
        body,
        repName,
        "Executive Sales",
        DEFAULT_YOUR_COMPANY
      );
      validation = validatePipelineEmail(subject, body, row.company_name);
      if (validation.ok) break;
      if (attempt < MAX_ATTEMPTS - 1) {
        userPrompt =
          buildPryroPipelineUserPrompt(promptBase) +
          buildPipelineValidationRetryHint(validation.reasons);
      }
    }

    const subjectOnlyFailure = validation.reasons.every((r) =>
      /subject/i.test(r)
    );
    if (!validation.ok && subjectOnlyFailure) {
      subject = buildPipelineSubjectFallback(
        row.company_name,
        nicheForEmail || row.niche
      );
      validation = validatePipelineEmail(subject, body, row.company_name);
    }

    const modelLabel =
      aiProvider.active_model ?? aiProvider.provider;
    const quality = scoreEmailQuality(subject, body, row.company_name);

    if (options?.preview) {
      return {
        success: true,
        leadId,
        pipeline_stage: row.pipeline_stage as PipelineStage,
        subject,
        body,
        model: modelLabel,
        preview: true,
        company_context_used: context,
        ...(validation.ok
          ? {}
          : { error: `Quality warnings: ${validation.reasons.join("; ")}` }),
      };
    }

    const { data: saved, error: insertError } = await supabase
      .from("generated_emails")
      .insert({
        user_id: userId,
        lead_id: leadId,
        subject,
        body,
        tone: "Direct",
        model_used: modelLabel,
        approval_status: "pending",
        quality_score: quality.score,
        ai_score: row.automation_score ?? null,
        ai_score_reason: row.automation_fit_reason ?? null,
      })
      .select("id")
      .single();

    if (insertError) {
      throw new Error(insertError.message);
    }

    const now = new Date().toISOString();
    const { error: updateError } = await supabase
      .from("leads")
      .update({
        pipeline_stage: "approval_pending",
        pipeline_updated_at: now,
        pipeline_error: null,
        updated_at: now,
      })
      .eq("id", leadId)
      .eq("user_id", userId);

    if (updateError) throw new Error(updateError.message);

    return {
      success: true,
      leadId,
      pipeline_stage: "approval_pending",
      emailId: saved?.id,
      subject,
      body,
      model: modelLabel,
      company_context_used: context,
      ...(validation.ok
        ? {}
        : { error: `Saved with warnings: ${validation.reasons.join("; ")}` }),
      ...(quality.score < 50 ? { error: `Low quality score (${quality.score})` } : {}),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Email generation failed";
    await markPipelineFailed(supabase, leadId, userId, msg);
    return { success: false, leadId, pipeline_stage: "failed", error: msg };
  }
}
