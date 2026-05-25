import {
  applySenderPlaceholders,
  buildSystemMessage,
  buildUserPrompt,
  DEFAULT_YOUR_COMPANY,
  EmailLeadInput,
  EmailTone,
  parseEmailResponse,
  resolveGenerationModel,
} from "./email-prompts";
import { scoreEmailQuality, type EmailQualityResult } from "./email-quality";
import type { LeadIntel } from "./lead-intel";

export type { EmailLeadInput, EmailTone };

interface EmailGenerationParams {
  lead: EmailLeadInput;
  yourCompany?: string;
  yourService?: string;
  tone: EmailTone;
  customPainPoint?: string;
  userId: string;
  senderName?: string;
  senderEmail?: string;
  senderTitle?: string;
  /** Rotates subject formulas in bulk */
  subjectFormulaIndex?: number;
}

export async function generateAIEmail(
  params: EmailGenerationParams
): Promise<{ subject: string; body: string; quality: EmailQualityResult }> {
  const {
    lead,
    yourCompany: paramCompany,
    yourService: paramService,
    tone,
    customPainPoint,
    userId,
    senderName: paramSenderName,
    senderTitle: paramSenderTitle = "Executive Sales",
    subjectFormulaIndex = 0,
  } = params;

  let yourCompany = paramCompany || DEFAULT_YOUR_COMPANY;
  let yourService = paramService?.trim() || "";

  if (!yourService) {
    const profileRes = await fetch("/api/pryro-profile");
    if (profileRes.ok) {
      const profile = await profileRes.json();
      yourService = profile.offerFormatted || profile.serviceOffer || "";
      yourCompany = profile.company || yourCompany;
    }
  }

  if (!yourService) {
    throw new Error(
      "Could not load Pryro offer from your website. Check PRYRO_WEBSITE_URL in .env and that the site is reachable."
    );
  }

  let leadIntel: LeadIntel | undefined;
  try {
    const intelRes = await fetch("/api/lead-intel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...lead, useAi: true }),
    });
    if (intelRes.ok) {
      const data = await intelRes.json();
      leadIntel = data.intel;
    }
  } catch {
    /* proceed without intel */
  }

  const providerRes = await fetch(`/api/ai-provider?userId=${userId}`);
  if (!providerRes.ok) {
    let msg = "No active AI provider configured. Please set up AI in Settings.";
    try {
      const err = await providerRes.json();
      msg = err.error || err.details || msg;
    } catch {}
    throw new Error(msg);
  }
  const aiProvider = await providerRes.json();

  let senderName = paramSenderName || "";

  if (!senderName) {
    try {
      const supabase = (await import("../../supabase/client")).createClient();
      const { data: smtpAccounts } = await supabase
        .from("smtp_accounts")
        .select("email, sender_name")
        .eq("user_id", userId)
        .eq("status", "active")
        .order("sent_today", { ascending: true })
        .limit(1);

      if (smtpAccounts?.length) {
        const account = smtpAccounts[0];
        senderName =
          account.sender_name ||
          account.email
            .split("@")[0]
            .replace(/[._\-]/g, " ")
            .replace(/\b\w/g, (c: string) => c.toUpperCase());
      }
    } catch {
      /* use default */
    }
  }

  if (!senderName) senderName = "Sales Team";

  const systemMessage = buildSystemMessage(senderName, paramSenderTitle);
  const userPrompt = buildUserPrompt({
    lead,
    yourCompany,
    yourService,
    tone,
    customPainPoint,
    leadIntel,
    subjectFormulaIndex,
  });

  const model = resolveGenerationModel(aiProvider.provider, aiProvider.active_model);
  let aiResponse = "";

  if (aiProvider.provider === "openai" || aiProvider.provider === "groq") {
    const baseUrl =
      aiProvider.provider === "openai"
        ? "https://api.openai.com/v1/chat/completions"
        : "https://api.groq.com/openai/v1/chat/completions";

    const res = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${aiProvider.api_key}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemMessage },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.55,
        max_tokens: 550,
      }),
    });

    if (!res.ok) {
      let errText = "";
      try {
        errText = await res.text();
      } catch {}
      let errJson: { error?: { message?: string } } | null = null;
      try {
        errJson = JSON.parse(errText);
      } catch {}
      const msg = errJson?.error?.message || errText.slice(0, 200) || res.statusText;
      if (aiProvider.provider === "groq") {
        if (res.status === 401) throw new Error("Groq API key is invalid. Check Settings.");
        if (res.status === 429) throw new Error("Groq rate limit hit. Wait a moment and try again.");
        if (res.status === 404) throw new Error(`Groq model "${model}" not found. Check Settings.`);
      }
      throw new Error(`${aiProvider.provider} API error (${res.status}): ${msg}`);
    }
    const data = await res.json();
    aiResponse = data.choices[0].message.content;
  } else if (aiProvider.provider === "anthropic") {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": aiProvider.api_key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 550,
        system: systemMessage,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic API error: ${res.statusText}`);
    const data = await res.json();
    aiResponse = data.content[0].text;
  } else if (aiProvider.provider === "gemini") {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${aiProvider.api_key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${systemMessage}\n\n${userPrompt}` }] }],
          generationConfig: { temperature: 0.55, maxOutputTokens: 550 },
        }),
      }
    );
    if (!res.ok) throw new Error(`Gemini API error: ${res.statusText}`);
    const data = await res.json();
    aiResponse = data.candidates[0].content.parts[0].text;
  } else if (aiProvider.provider === "mistral") {
    const res = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${aiProvider.api_key}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemMessage },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.55,
        max_tokens: 550,
      }),
    });
    if (!res.ok) throw new Error(`Mistral API error: ${res.statusText}`);
    const data = await res.json();
    aiResponse = data.choices[0].message.content;
  } else {
    throw new Error(`Unsupported AI provider: ${aiProvider.provider}`);
  }

  const { subject, body: rawBody } = parseEmailResponse(aiResponse);
  const body = applySenderPlaceholders(rawBody, senderName, paramSenderTitle, yourCompany);

  if (!subject || !body) {
    throw new Error("AI generated an empty subject or body. Try again.");
  }

  const quality = scoreEmailQuality(subject, body, lead.company_name);
  return { subject, body, quality };
}
