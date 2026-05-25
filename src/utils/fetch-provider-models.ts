import { getProviderFallbackModels } from "@/config/ai-providers";

export type ModelsListSource = "live" | "fallback";

export interface FetchProviderModelsResult {
  models: string[];
  source: ModelsListSource;
  error?: string;
}

const EXCLUDE_ID =
  /embed|whisper|tts|dall-?e|moderation|audio|transcrib|realtime|legacy|instruct|davinci|babbage|curie|ada-00/i;

function dedupeSorted(ids: string[]): string[] {
  return [...new Set(ids.map((s) => s.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b)
  );
}

function preferChatModels(ids: string[]): string[] {
  const chat = ids.filter((id) => !EXCLUDE_ID.test(id));
  const scored = chat.sort((a, b) => {
    const score = (id: string) => {
      let s = 0;
      if (/gpt-4o|claude-3-5|llama-3\.3|gemini-2|gemini-1\.5/i.test(id)) s += 10;
      if (/mini|flash|instant|haiku/i.test(id)) s += 5;
      if (/preview|exp\b|experimental/i.test(id)) s -= 2;
      return s;
    };
    return score(b) - score(a) || a.localeCompare(b);
  });
  return dedupeSorted(scored);
}

async function fetchOpenAiCompatibleModels(
  baseUrl: string,
  apiKey: string
): Promise<string[]> {
  const res = await fetch(`${baseUrl}/models`, {
    headers: { Authorization: `Bearer ${apiKey.trim()}` },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${text.slice(0, 120)}`);
  }
  const data = (await res.json()) as { data?: { id: string }[] };
  const ids = (data.data ?? []).map((m) => m.id).filter(Boolean);
  return preferChatModels(ids);
}

async function fetchGeminiModels(apiKey: string): Promise<string[]> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey.trim())}`,
    { signal: AbortSignal.timeout(12_000) }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${text.slice(0, 120)}`);
  }
  const data = (await res.json()) as {
    models?: {
      name: string;
      supportedGenerationMethods?: string[];
    }[];
  };
  const ids = (data.models ?? [])
    .filter((m) =>
      (m.supportedGenerationMethods ?? []).includes("generateContent")
    )
    .map((m) => m.name.replace(/^models\//, ""))
    .filter((id) => id && !EXCLUDE_ID.test(id));
  return preferChatModels(ids);
}

async function fetchAnthropicModels(apiKey: string): Promise<string[]> {
  const res = await fetch("https://api.anthropic.com/v1/models", {
    headers: {
      "x-api-key": apiKey.trim(),
      "anthropic-version": "2023-06-01",
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${text.slice(0, 120)}`);
  }
  const data = (await res.json()) as {
    data?: { id: string; type?: string }[];
  };
  const ids = (data.data ?? []).map((m) => m.id).filter(Boolean);
  if (ids.length) return preferChatModels(ids);
  throw new Error("empty model list");
}

/**
 * Fetch chat-capable model IDs from the provider API.
 * Falls back to curated list when the API is unavailable (e.g. Anthropic).
 */
export async function fetchLiveProviderModels(
  provider: string,
  apiKey: string
): Promise<FetchProviderModelsResult> {
  const fallback = getProviderFallbackModels(provider);

  if (!apiKey?.trim()) {
    return { models: fallback, source: "fallback", error: "missing api key" };
  }

  try {
    let models: string[] = [];

    switch (provider) {
      case "groq":
        models = await fetchOpenAiCompatibleModels(
          "https://api.groq.com/openai/v1",
          apiKey
        );
        break;
      case "openai":
        models = await fetchOpenAiCompatibleModels(
          "https://api.openai.com/v1",
          apiKey
        );
        break;
      case "gemini":
        models = await fetchGeminiModels(apiKey);
        break;
      case "mistral":
        models = await fetchOpenAiCompatibleModels(
          "https://api.mistral.ai/v1",
          apiKey
        );
        break;
      case "anthropic":
        try {
          models = await fetchAnthropicModels(apiKey);
        } catch {
          return {
            models: fallback,
            source: "fallback",
            error: "Anthropic models API unavailable — using curated list",
          };
        }
        break;
      default:
        return { models: fallback, source: "fallback", error: "unknown provider" };
    }

    if (!models.length) {
      return {
        models: fallback,
        source: "fallback",
        error: "provider returned no chat models",
      };
    }

    return { models, source: "live" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { models: fallback, source: "fallback", error: msg };
  }
}

/** Merge saved model into list if provider dropped it (still show for user to change). */
export function mergeSavedModel(
  models: string[],
  saved?: string | null
): string[] {
  if (!saved?.trim()) return models;
  const s = saved.trim();
  if (models.includes(s)) return models;
  return [s, ...models];
}
