import { NextRequest, NextResponse } from "next/server";
import { getProviderFallbackModels } from "@/config/ai-providers";

/** Minimal chat ping — same endpoints as production AI helpers. */
async function pingProvider(
  provider: string,
  apiKey: string,
  model: string
): Promise<{ ok: boolean; status: number; message: string }> {
  const key = apiKey.trim();
  const m = model.trim() || getProviderFallbackModels(provider)[0] || "";

  try {
    if (provider === "openai" || provider === "groq") {
      const baseUrl =
        provider === "openai"
          ? "https://api.openai.com/v1/chat/completions"
          : "https://api.groq.com/openai/v1/chat/completions";
      const res = await fetch(baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: m || (provider === "groq" ? "llama-3.1-8b-instant" : "gpt-4o-mini"),
          messages: [{ role: "user", content: "Reply with OK" }],
          max_tokens: 5,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return { ok: false, status: res.status, message: text.slice(0, 200) || res.statusText };
      }
      return { ok: true, status: res.status, message: "OK" };
    }

    if (provider === "anthropic") {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: m || "claude-3-5-haiku-20241022",
          max_tokens: 5,
          messages: [{ role: "user", content: "Reply with OK" }],
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return { ok: false, status: res.status, message: text.slice(0, 200) || res.statusText };
      }
      return { ok: true, status: res.status, message: "OK" };
    }

    if (provider === "gemini") {
      const modelId = m || "gemini-1.5-flash";
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: "Reply with OK" }] }],
            generationConfig: { maxOutputTokens: 5 },
          }),
          signal: AbortSignal.timeout(15_000),
        }
      );
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return { ok: false, status: res.status, message: text.slice(0, 200) || res.statusText };
      }
      return { ok: true, status: res.status, message: "OK" };
    }

    if (provider === "mistral") {
      const res = await fetch("https://api.mistral.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: m || "mistral-small",
          messages: [{ role: "user", content: "Reply with OK" }],
          max_tokens: 5,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return { ok: false, status: res.status, message: text.slice(0, 200) || res.statusText };
      }
      return { ok: true, status: res.status, message: "OK" };
    }

    return { ok: false, status: 400, message: `Unknown provider: ${provider}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, message: msg };
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const provider = String(body.provider || "");
    const apiKey = String(body.apiKey || "");
    const model = String(body.model || "");

    if (!provider || !apiKey.trim()) {
      return NextResponse.json({ ok: false, message: "provider and apiKey required" }, { status: 400 });
    }

    const result = await pingProvider(provider, apiKey, model);
    return NextResponse.json(result, { status: result.ok ? 200 : 422 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, message: msg }, { status: 500 });
  }
}
