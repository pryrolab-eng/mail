/**
 * AI provider metadata for Settings UI.
 * Model IDs are loaded live from each provider API when a key is connected;
 * `fallbackModels` is used only if the models API fails.
 */
export interface AIProviderDefinition {
  key: string;
  name: string;
  color: string;
  fallbackModels: string[];
  icon: string;
  tagline: string;
  /** Whether this provider exposes a /models (or equivalent) list API */
  supportsLiveModels: boolean;
}

export const AI_PROVIDER_DEFINITIONS: AIProviderDefinition[] = [
  {
    key: "groq",
    name: "Groq",
    color: "#2563EB",
    fallbackModels: [
      "llama-3.3-70b-versatile",
      "llama-3.1-8b-instant",
      "openai/gpt-oss-120b",
      "openai/gpt-oss-20b",
    ],
    icon: "⚡",
    tagline: "Fastest inference engine",
    supportsLiveModels: true,
  },
  {
    key: "openai",
    name: "OpenAI",
    color: "#2563EB",
    fallbackModels: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
    icon: "◎",
    tagline: "Most capable models",
    supportsLiveModels: true,
  },
  {
    key: "anthropic",
    name: "Anthropic",
    color: "#2563EB",
    fallbackModels: [
      "claude-3-5-sonnet-20241022",
      "claude-3-5-haiku-20241022",
      "claude-3-opus-20240229",
    ],
    icon: "Ⲁ",
    tagline: "Best for nuanced writing",
    supportsLiveModels: true,
  },
  {
    key: "gemini",
    name: "Google Gemini",
    color: "#2563EB",
    fallbackModels: ["gemini-1.5-pro", "gemini-1.5-flash", "gemini-2.0-flash"],
    icon: "◆",
    tagline: "Multimodal intelligence",
    supportsLiveModels: true,
  },
  {
    key: "mistral",
    name: "Mistral AI",
    color: "#2563EB",
    fallbackModels: [
      "mistral-large-latest",
      "mistral-small-latest",
      "open-mixtral-8x7b",
    ],
    icon: "▲",
    tagline: "European open AI",
    supportsLiveModels: true,
  },
];

export function getProviderDefinition(key: string): AIProviderDefinition | undefined {
  return AI_PROVIDER_DEFINITIONS.find((p) => p.key === key);
}

export function getProviderFallbackModels(key: string): string[] {
  return getProviderDefinition(key)?.fallbackModels ?? [];
}

/** @deprecated use getProviderFallbackModels */
export function getProviderDefaultModels(key: string): string[] {
  return getProviderFallbackModels(key);
}
