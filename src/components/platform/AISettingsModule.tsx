"use client";

import { useState, useEffect } from "react";
import { AIProvider } from "@/types/platform";
import {
  Eye,
  EyeOff,
  Save,
  Trash2,
  RefreshCw,
  ChevronDown,
  Loader2,
  CheckCircle,
  XCircle,
  Zap,
} from "lucide-react";
import { createClient } from "../../../supabase/client";
import { toast } from "sonner";

interface AISettingsProps {
  userId: string;
}

const PROVIDERS = [
  {
    key: "groq",
    name: "Groq",
    color: "#2563EB",
    models: [
      "llama-3.3-70b-versatile",
      "llama-3.1-8b-instant",
      "openai/gpt-oss-120b",
      "openai/gpt-oss-20b",
      "groq/compound"
    ],
    icon: "⚡",
    tagline: "Fastest inference engine",
  },
  {
    key: "openai",
    name: "OpenAI",
    color: "#2563EB",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
    icon: "◎",
    tagline: "Most capable models",
  },
  {
    key: "anthropic",
    name: "Anthropic",
    color: "#2563EB",
    models: [
      "claude-3-5-sonnet-20241022",
      "claude-3-5-haiku-20241022",
      "claude-3-opus-20240229",
      "claude-3-sonnet-20240229",
      "claude-3-haiku-20240307"
    ],
    icon: "Ⲁ",
    tagline: "Best for nuanced writing",
  },
  {
    key: "gemini",
    name: "Google Gemini",
    color: "#2563EB",
    models: ["gemini-1.5-pro", "gemini-1.5-flash", "gemini-pro"],
    icon: "◆",
    tagline: "Multimodal intelligence",
  },
  {
    key: "mistral",
    name: "Mistral AI",
    color: "#2563EB",
    models: ["mistral-large", "mistral-medium", "mistral-small", "open-mixtral-8x7b"],
    icon: "▲",
    tagline: "European open AI",
  },
];

export default function AISettingsModule({ userId }: AISettingsProps) {
  const [settings, setSettings] = useState<Record<string, AIProvider>>({});
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [testingProviders, setTestingProviders] = useState<Record<string, boolean>>({});
  const [savingProviders, setSavingProviders] = useState<Record<string, boolean>>({});
  const [activeProvider, setActiveProvider] = useState<string>("");
  const [activeModel, setActiveModel] = useState<string>("");
  const [modelDropdownOpen, setModelDropdownOpen] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const supabase = createClient();

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("ai_settings")
      .select("*")
      .eq("user_id", userId);

    if (data) {
      const map: Record<string, AIProvider> = {};
      data.forEach((s: AIProvider) => {
        map[s.provider] = s;
        if (s.is_active) {
          setActiveProvider(s.provider);
          setActiveModel(s.active_model || "");
        }
        if (s.api_key) {
          setKeyInputs((prev) => ({ ...prev, [s.provider]: s.api_key! }));
        }
      });
      setSettings(map);
    }
    setLoading(false);
  };

  const saveKey = async (providerKey: string) => {
    const key = keyInputs[providerKey];
    if (!key?.trim()) {
      toast.error("Enter an API key first");
      return;
    }
    setSavingProviders((prev) => ({ ...prev, [providerKey]: true }));
    try {
      const existing = settings[providerKey];
      if (existing) {
        await supabase
          .from("ai_settings")
          .update({ api_key: key, updated_at: new Date().toISOString() })
          .eq("id", existing.id);
      } else {
        await supabase.from("ai_settings").insert({
          user_id: userId,
          provider: providerKey,
          api_key: key,
          is_active: false,
          is_connected: false,
        });
      }
      toast.success("API key saved");
      await fetchSettings();
      // Auto-test after save
      await testConnection(providerKey, key);
    } catch {
      toast.error("Failed to save key");
    } finally {
      setSavingProviders((prev) => ({ ...prev, [providerKey]: false }));
    }
  };

  const deleteKey = async (providerKey: string) => {
    const existing = settings[providerKey];
    if (!existing) return;
    await supabase.from("ai_settings").delete().eq("id", existing.id);
    setKeyInputs((prev) => ({ ...prev, [providerKey]: "" }));
    toast.success("API key removed");
    await fetchSettings();
  };

  const testConnection = async (providerKey: string, apiKey?: string) => {
    const key = apiKey || keyInputs[providerKey] || settings[providerKey]?.api_key;
    if (!key) {
      toast.error("No API key to test");
      return;
    }
    setTestingProviders((prev) => ({ ...prev, [providerKey]: true }));
    await new Promise((r) => setTimeout(r, 1200));
    // Mock validation - real implementation would call the API
    const isValid = key.length > 20;
    const existing = settings[providerKey];
    if (existing) {
      await supabase
        .from("ai_settings")
        .update({ is_connected: isValid, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
    }
    toast[isValid ? "success" : "error"](
      isValid ? `${PROVIDERS.find((p) => p.key === providerKey)?.name} connected!` : "Invalid API key"
    );
    setTestingProviders((prev) => ({ ...prev, [providerKey]: false }));
    await fetchSettings();
  };

  const setAsActive = async (providerKey: string, model: string) => {
    // Deactivate all others
    await supabase
      .from("ai_settings")
      .update({ is_active: false })
      .eq("user_id", userId);

    // Activate this one
    const existing = settings[providerKey];
    if (existing) {
      await supabase
        .from("ai_settings")
        .update({ is_active: true, active_model: model })
        .eq("id", existing.id);
    }
    setActiveProvider(providerKey);
    setActiveModel(model);
    setModelDropdownOpen(null);
    toast.success(`Active model set to ${providerKey}/${model}`);
    await fetchSettings();
  };

  const maskKey = (key: string) => {
    if (!key || key.length < 8) return "••••••••••••";
    return key.slice(0, 6) + "•".repeat(Math.min(key.length - 10, 20)) + key.slice(-4);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={24} className="animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="p-6 flex flex-col gap-6 bg-white h-full">
      {/* Active Model Banner */}
      {activeProvider && (
        <div className="rounded-xl p-4 flex items-center justify-between bg-blue-50 border border-blue-200">
          <div>
            <p className="text-[10px] uppercase tracking-widest mb-1 text-gray-500 font-semibold">
              Active Generation Model
            </p>
            <div className="flex items-center gap-2">
              <div className="status-dot-green" />
              <span className="text-sm font-semibold text-blue-700 font-mono">
                {activeProvider}/{activeModel}
              </span>
            </div>
          </div>
          <Zap size={20} className="text-blue-600" />
        </div>
      )}

      {/* Provider Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {PROVIDERS.map((provider) => {
          const setting = settings[provider.key];
          const isConnected = setting?.is_connected || false;
          const hasKey = !!(setting?.api_key || keyInputs[provider.key]);
          const isTesting = testingProviders[provider.key];
          const isSaving = savingProviders[provider.key];
          const isActive = activeProvider === provider.key;

          return (
            <div
              key={provider.key}
              className={`rounded-xl p-4 flex flex-col gap-4 border transition-all ${
                isActive
                  ? "bg-blue-50 border-blue-300"
                  : "bg-white border-gray-200 hover:border-gray-300"
              }`}
            >
              {/* Header */}
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg border ${
                    isActive ? "bg-blue-100 border-blue-200" : "bg-gray-100 border-gray-200"
                  }`}>
                    {provider.icon}
                  </div>
                  <div>
                    <p className="text-sm font-bold text-gray-900">{provider.name}</p>
                    <p className="text-[10px] text-gray-500">{provider.tagline}</p>
                  </div>
                </div>

                {/* Connection status */}
                <div className="flex items-center gap-1.5">
                  {hasKey ? (
                    isConnected ? (
                      <div className="flex items-center gap-1">
                        <div className="status-dot-green" style={{ width: 6, height: 6 }} />
                        <span className="text-[9px] text-green-700 font-semibold">LIVE</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1">
                        <div className="status-dot-amber" style={{ width: 6, height: 6 }} />
                        <span className="text-[9px] text-amber-600 font-semibold">UNTESTED</span>
                      </div>
                    )
                  ) : (
                    <div className="flex items-center gap-1">
                      <div className="status-dot-gray" style={{ width: 6, height: 6 }} />
                      <span className="text-[9px] text-gray-400 font-semibold">NO KEY</span>
                    </div>
                  )}
                </div>
              </div>

              {/* API Key Input */}
              <div className="relative">
                <input
                  type={showKeys[provider.key] ? "text" : "password"}
                  placeholder="sk-••••••••••••••••••••"
                  value={keyInputs[provider.key] || ""}
                  onChange={(e) => setKeyInputs((prev) => ({ ...prev, [provider.key]: e.target.value }))}
                  className="w-full pl-3 pr-9 py-2.5 rounded-lg text-xs outline-none border border-gray-300 bg-white text-gray-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 font-mono"
                />
                <button
                  onClick={() => setShowKeys((prev) => ({ ...prev, [provider.key]: !prev[provider.key] }))}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showKeys[provider.key] ? <EyeOff size={12} /> : <Eye size={12} />}
                </button>
              </div>

              {/* Model selector (when connected) */}
              {isConnected && (
                <div className="relative">
                  <button
                    onClick={() => setModelDropdownOpen(modelDropdownOpen === provider.key ? null : provider.key)}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs border border-gray-300 bg-white text-gray-700 hover:border-blue-400 transition-all"
                  >
                    <span className="font-mono">{setting?.active_model || "Select model..."}</span>
                    <ChevronDown size={12} className="text-gray-400" />
                  </button>

                  {modelDropdownOpen === provider.key && (
                    <div className="absolute top-full mt-1 left-0 right-0 rounded-lg z-10 bg-white border border-gray-200 shadow-lg overflow-hidden">
                      {provider.models.map((model) => (
                        <button
                          key={model}
                          onClick={() => setAsActive(provider.key, model)}
                          className="w-full text-left px-3 py-2 text-[11px] hover:bg-blue-50 transition-colors border-b border-gray-100 text-gray-700 font-mono"
                        >
                          {model}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => saveKey(provider.key)}
                  disabled={isSaving}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[11px] font-medium bg-blue-600 text-white hover:bg-blue-700 transition-all disabled:opacity-50"
                >
                  {isSaving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
                  Save
                </button>
                <button
                  onClick={() => testConnection(provider.key)}
                  disabled={isTesting || !hasKey}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[11px] font-medium border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition-all disabled:opacity-40"
                >
                  {isTesting ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                  Test
                </button>
                {hasKey && (
                  <button
                    onClick={() => deleteKey(provider.key)}
                    className="p-2 rounded-lg border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 transition-all"
                  >
                    <Trash2 size={11} />
                  </button>
                )}
              </div>

              {/* Set as active */}
              {isConnected && setting?.active_model && (
                <button
                  onClick={() => setAsActive(provider.key, setting.active_model!)}
                  className={`py-2 rounded-lg text-[11px] font-semibold transition-all border ${
                    isActive
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white text-gray-600 border-gray-300 hover:border-blue-400 hover:text-blue-600"
                  }`}
                >
                  {isActive ? "✓ Active Model" : "Set as Active"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

