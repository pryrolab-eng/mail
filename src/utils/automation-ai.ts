import type { SupabaseClient } from "@supabase/supabase-js";
import { loadAIProviderForUser } from "@/utils/load-ai-provider-server";
import { resolveGenerationModel } from "@/utils/email-prompts";

export type AutomationLeadScore = {
  qualified: boolean;
  score: number;
  reason: string;
  best_email: string | null;
  confidence: "high" | "medium" | "low";
  risk: "low" | "medium" | "high";
  recommended_action: "auto_queue" | "draft" | "review" | "phone_only" | "reject";
};

const FALLBACK_SCORE: AutomationLeadScore = {
  qualified: false,
  score: 0,
  reason: "AI scoring did not return valid structured output.",
  best_email: null,
  confidence: "low",
  risk: "high",
  recommended_action: "review",
};

function extractJsonObject(text: string): unknown {
  const cleaned = text.replace(/```json|```/gi, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error("No JSON object found");
  }
}

export function parseAutomationLeadScore(raw: string): AutomationLeadScore {
  try {
    const parsed = extractJsonObject(raw) as Partial<AutomationLeadScore>;
    const score = Math.max(
      0,
      Math.min(100, Number.parseInt(String(parsed.score ?? 0), 10) || 0)
    );
    const confidence = ["high", "medium", "low"].includes(
      String(parsed.confidence)
    )
      ? (parsed.confidence as AutomationLeadScore["confidence"])
      : score >= 80
        ? "high"
        : score >= 60
          ? "medium"
          : "low";
    const risk = ["low", "medium", "high"].includes(String(parsed.risk))
      ? (parsed.risk as AutomationLeadScore["risk"])
      : confidence === "high"
        ? "low"
        : "medium";
    const recommended = ["auto_queue", "draft", "review", "phone_only", "reject"].includes(
      String(parsed.recommended_action)
    )
      ? (parsed.recommended_action as AutomationLeadScore["recommended_action"])
      : score >= 70
        ? "draft"
        : "review";

    return {
      qualified: Boolean(parsed.qualified ?? score >= 70),
      score,
      reason: String(parsed.reason ?? "No reason returned.").slice(0, 500),
      best_email:
        typeof parsed.best_email === "string" && parsed.best_email.includes("@")
          ? parsed.best_email.toLowerCase()
          : null,
      confidence,
      risk,
      recommended_action: recommended,
    };
  } catch {
    return FALLBACK_SCORE;
  }
}

async function callProvider(
  provider: { provider: string; api_key: string; active_model: string | null },
  system: string,
  prompt: string
): Promise<string> {
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
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      temperature: 0.1,
      max_tokens: 450,
    };
  } else {
    throw new Error("Free v1 scoring currently supports OpenAI-compatible providers.");
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`AI scoring failed ${res.status}: ${text.slice(0, 180)}`);
  }

  const data = await res.json();
  return data.choices[0].message.content as string;
}

export async function scoreLeadForAutomation(
  supabase: SupabaseClient,
  userId: string,
  leadId: string
): Promise<AutomationLeadScore> {
  const { data: lead, error } = await supabase
    .from("leads")
    .select(
      "id, company_name, email, phone, website, niche, location, company_context, email_source, email_confidence, agent_confidence, agent_risk, agent_recommended_action, agent_email_angle, agent_draft_allowed, agent_auto_send_allowed"
    )
    .eq("id", leadId)
    .eq("user_id", userId)
    .single();

  if (error || !lead) throw new Error(error?.message ?? "Lead not found");

  const provider = await loadAIProviderForUser(supabase, userId);
  if (!provider?.api_key) {
    throw new Error("No active AI provider configured.");
  }

  const system = `You score cold outreach leads for a free v1 assisted automation system.
Return ONLY JSON with:
qualified boolean, score integer 0-100, reason string, best_email string|null,
confidence high|medium|low, risk low|medium|high, recommended_action auto_queue|draft|review|phone_only|reject.
Rules:
- Prefer real business emails and clear company context.
- Guessed/fallback/low-confidence emails must be review or reject, never high confidence.
- If no valid email exists, recommend reject unless phone-only review is useful.
- If agent_auto_send_allowed is false, do not recommend auto_queue.
- If agent_draft_allowed is false, do not recommend draft.
- Be conservative for deliverability.`;

  const prompt = JSON.stringify(lead, null, 2);
  const raw = await callProvider(provider, system, prompt);
  const score = parseAutomationLeadScore(raw);
  if (!lead.agent_auto_send_allowed && score.recommended_action === "auto_queue") {
    score.recommended_action = "draft";
    score.reason = `${score.reason} Agent safety downgraded auto-queue to draft/review.`;
  }
  if (!lead.agent_draft_allowed && ["auto_queue", "draft"].includes(score.recommended_action)) {
    score.recommended_action = lead.phone ? "phone_only" : "review";
    score.qualified = false;
    score.score = Math.min(score.score, 55);
    score.reason = `${score.reason} Agent evidence does not allow drafting yet.`;
  }

  const reviewRequired =
    score.recommended_action !== "auto_queue" ||
    score.score < 70 ||
    score.confidence !== "high" ||
    !lead.agent_auto_send_allowed;

  await supabase
    .from("leads")
    .update({
      automation_score: score.score,
      automation_fit_reason: score.reason,
      automation_risk: score.risk,
      automation_recommended_action: score.recommended_action,
      automation_review_required: reviewRequired,
      automation_last_scored_at: new Date().toISOString(),
      pipeline_stage: score.qualified ? "verified" : "approval_pending",
      pipeline_updated_at: new Date().toISOString(),
      pipeline_error: null,
    })
    .eq("id", leadId)
    .eq("user_id", userId);

  return score;
}
