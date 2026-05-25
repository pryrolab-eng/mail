/**
 * Optional LLM pass to turn scraped lead research into sharper intel.
 * Falls back silently to rule-based intel on error or rate limits.
 */

import type { LeadIntel, LeadIntelInput } from "./lead-intel";
import { resolveGenerationModel } from "./email-prompts";

export interface AIProviderConfig {
  provider: string;
  api_key: string;
  active_model: string | null;
}

export type IntelSource = "rules" | "ai";

interface AIIntelJson {
  whatTheyDo?: string;
  likelyPain?: string;
  hookLine?: string;
  facts?: string[];
}

async function callIntelLLM(
  provider: AIProviderConfig,
  system: string,
  user: string
): Promise<string> {
  const { provider: name, api_key, active_model } = provider;
  const model = resolveGenerationModel(name, active_model);

  if (name === "openai" || name === "groq") {
    const url =
      name === "openai"
        ? "https://api.openai.com/v1/chat/completions"
        : "https://api.groq.com/openai/v1/chat/completions";
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${api_key}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.25,
        max_tokens: 400,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 429) throw new Error("rate_limit");
    if (!res.ok) throw new Error(`${name} API error: ${res.status}`);
    const data = await res.json();
    return data.choices[0].message.content.trim();
  }

  if (name === "anthropic") {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: active_model || "claude-3-5-haiku-20241022",
        max_tokens: 400,
        system,
        messages: [{ role: "user", content: user }],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 429) throw new Error("rate_limit");
    if (!res.ok) throw new Error(`Anthropic API error: ${res.status}`);
    const data = await res.json();
    return data.content[0].text.trim();
  }

  if (name === "gemini") {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${api_key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${system}\n\n${user}` }] }],
          generationConfig: { temperature: 0.25, maxOutputTokens: 400 },
        }),
        signal: AbortSignal.timeout(20_000),
      }
    );
    if (!res.ok) throw new Error(`Gemini API error: ${res.status}`);
    const data = await res.json();
    return data.candidates[0].content.parts[0].text.trim();
  }

  if (name === "mistral") {
    const res = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${api_key}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.25,
        max_tokens: 400,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`Mistral API error: ${res.status}`);
    const data = await res.json();
    return data.choices[0].message.content.trim();
  }

  throw new Error(`Unsupported provider: ${name}`);
}

function parseIntelJson(raw: string): AIIntelJson | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const text = (fenced || raw).trim();
  try {
    return JSON.parse(text) as AIIntelJson;
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]) as AIIntelJson;
    } catch {
      return null;
    }
  }
}

function buildResearchBundle(
  input: LeadIntelInput,
  ruleIntel: LeadIntel,
  websiteText: string
): string {
  const lines = [
    `Company: ${input.company_name}`,
    `Niche: ${input.niche || "unknown"}`,
    `Location: ${input.location || "unknown"}`,
    input.website ? `Website: ${input.website}` : "",
    input.phone ? `Phone: ${input.phone}` : "",
    input.rating ? `Rating: ${input.rating}` : "",
    input.company_context ? `Existing notes: ${input.company_context.slice(0, 800)}` : "",
    ruleIntel.facts.length ? `Rule-based facts: ${ruleIntel.facts.join("; ")}` : "",
    websiteText ? `Website text excerpt:\n${websiteText.slice(0, 2500)}` : "",
  ].filter(Boolean);
  return lines.join("\n");
}

const SYSTEM = `You analyze businesses for B2B cold email research.
Return ONLY valid JSON (no markdown outside JSON) with this shape:
{
  "whatTheyDo": "1-2 sentences: what this specific company does",
  "likelyPain": "1 sentence: operational pain plausible for them (no fake metrics)",
  "hookLine": "1 sentence: opening line idea for email — must mention company name",
  "facts": ["3-5 short factual bullets from research only"]
}
Rules:
- Use ONLY information in the user message. Do not invent revenue, awards, headcount, or "I saw your post".
- Be specific to THIS company, not "businesses in this industry often".
- hookLine must include the company name.`;

/**
 * Enhance rule-based intel with one fast LLM call.
 * Returns null on failure (caller keeps rule-based intel).
 */
export async function enhanceLeadIntelWithAI(
  provider: AIProviderConfig,
  input: LeadIntelInput,
  ruleIntel: LeadIntel,
  websiteText: string
): Promise<{ intel: LeadIntel; source: IntelSource } | null> {
  const user = buildResearchBundle(input, ruleIntel, websiteText);

  try {
    const raw = await callIntelLLM(provider, SYSTEM, user);
    const parsed = parseIntelJson(raw);
    if (!parsed?.hookLine && !parsed?.whatTheyDo) return null;

    const facts = Array.isArray(parsed.facts)
      ? parsed.facts.filter((f) => typeof f === "string" && f.length > 5).slice(0, 6)
      : ruleIntel.facts;

    if (!facts.some((f) => f.toLowerCase().includes(input.company_name.toLowerCase().split(" ")[0]))) {
      facts.unshift(`Company name: ${input.company_name}`);
    }

    const intel: LeadIntel = {
      companyName: ruleIntel.companyName,
      niche: ruleIntel.niche,
      location: ruleIntel.location,
      whatTheyDo: (parsed.whatTheyDo || ruleIntel.whatTheyDo).slice(0, 320),
      likelyPain: (parsed.likelyPain || ruleIntel.likelyPain).slice(0, 200),
      hookLine: (parsed.hookLine || ruleIntel.hookLine).slice(0, 200),
      facts,
      weak: false,
      source: "ai",
    };

    return { intel, source: "ai" };
  } catch (err) {
    console.warn("[lead-intel-ai]", err instanceof Error ? err.message : err);
    return null;
  }
}
