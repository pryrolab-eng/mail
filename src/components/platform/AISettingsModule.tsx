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
import { AI_PROVIDER_DEFINITIONS } from "@/config/ai-providers";
import type { ModelsListSource } from "@/utils/fetch-provider-models";

interface AISettingsProps {
  userId: string;
}

const PROVIDERS = AI_PROVIDER_DEFINITIONS;

export default function AISettingsModule({ userId }: AISettingsProps) {
  const [settings, setSettings] = useState<Record<string, AIProvider>>({});
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [testingProviders, setTestingProviders] = useState<Record<string, boolean>>({});
  const [savingProviders, setSavingProviders] = useState<Record<string, boolean>>({});
  const [activeProvider, setActiveProvider] = useState<string>("");
  const [activeModel, setActiveModel] = useState<string>("");
  const [modelDropdownOpen, setModelDropdownOpen] = useState<string | null>(null);
  const [liveModels, setLiveModels] = useState<Record<string, string[]>>({});
  const [modelsSource, setModelsSource] = useState<Record<string, ModelsListSource>>({});
  const [savedModelDeprecated, setSavedModelDeprecated] = useState<Record<string, boolean>>({});
  const [loadingModels, setLoadingModels] = useState<Record<string, boolean>>({});
  const [initialLoading, setInitialLoading] = useState(true);

  const supabase = createClient();

  useEffect(() => {
    void loadSettings(true);
  }, []);

  const fetchProviderModels = async (providerKey: string, apiKey?: string) => {
    const key =
      apiKey?.trim() ||
      keyInputs[providerKey]?.trim() ||
      settings[providerKey]?.api_key?.trim();
    if (!key) return;

    setLoadingModels((prev) => ({ ...prev, [providerKey]: true }));
    try {
      const res = await fetch("/api/ai-settings/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: providerKey,
          apiKey: key,
          savedModel: settings[providerKey]?.active_model,
        }),
      });
      const data = (await res.json()) as {
        models?: string[];
        source?: ModelsListSource;
        error?: string;
        savedDeprecated?: boolean;
      };
      const models = Array.isArray(data.models) ? data.models : [];
      setLiveModels((prev) => ({ ...prev, [providerKey]: models }));
      setModelsSource((prev) => ({
        ...prev,
        [providerKey]: data.source === "live" ? "live" : "fallback",
      }));
      setSavedModelDeprecated((prev) => ({
        ...prev,
        [providerKey]: !!data.savedDeprecated,
      }));
      if (data.source === "fallback" && data.error) {
        toast.message(`Using fallback model list for ${providerKey}`, {
          description: data.error.slice(0, 100),
        });
      }
    } catch (err) {
      toast.error("Could not load models", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoadingModels((prev) => ({ ...prev, [providerKey]: false }));
    }
  };

  const openModelDropdown = async (providerKey: string) => {
    const next = modelDropdownOpen === providerKey ? null : providerKey;
    setModelDropdownOpen(next);
    if (next === providerKey && !liveModels[providerKey]?.length) {
      await fetchProviderModels(providerKey);
    }
  };

  const getModelsForProvider = (providerKey: string): string[] => {
    const live = liveModels[providerKey];
    if (live?.length) return live;
    return (
      PROVIDERS.find((p) => p.key === providerKey)?.fallbackModels ?? []
    );
  };

  const applySettingsRows = (rows: AIProvider[], options?: { syncKeyInputs?: boolean }) => {
    const map: Record<string, AIProvider> = {};
    let nextActive = "";
    let nextModel = "";

    rows.forEach((s) => {
      map[s.provider] = s;
      if (s.is_active) {
        nextActive = s.provider;
        nextModel = s.active_model || "";
      }
    });

    setSettings(map);
    if (nextActive) {
      setActiveProvider(nextActive);
      setActiveModel(nextModel);
    } else {
      setActiveProvider("");
      setActiveModel("");
    }

    if (options?.syncKeyInputs) {
      setKeyInputs((prev) => {
        const next = { ...prev };
        rows.forEach((s) => {
          if (s.api_key) next[s.provider] = s.api_key;
        });
        return next;
      });
    }
  };

  /** Load from DB without blanking the UI (except first visit). */
  const loadSettings = async (isFirstLoad = false) => {
    if (isFirstLoad) setInitialLoading(true);

    const { data } = await supabase
      .from("ai_settings")
      .select("*")
      .eq("user_id", userId);

    if (data?.length) {
      applySettingsRows(data, { syncKeyInputs: isFirstLoad });
      if (isFirstLoad) {
        for (const s of data) {
          if (s.is_connected && s.api_key) {
            void fetchProviderModels(s.provider, s.api_key);
          }
        }
      }
    }

    if (isFirstLoad) setInitialLoading(false);
  };

  const patchProviderSetting = (
    providerKey: string,
    patch: Partial<AIProvider> & { provider: string }
  ) => {
    setSettings((prev) => {
      const existing = prev[providerKey];
      const merged = {
        ...(existing ?? {
          id: patch.id ?? "",
          user_id: userId,
          provider: providerKey,
          api_key: null,
          active_model: null,
          is_active: false,
          is_connected: false,
        }),
        ...patch,
      } as AIProvider;
      return { ...prev, [providerKey]: merged };
    });
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
      if (existing) {
        patchProviderSetting(providerKey, {
          ...existing,
          api_key: key,
          is_connected: false,
        });
      } else {
        const { data: inserted } = await supabase
          .from("ai_settings")
          .select("*")
          .eq("user_id", userId)
          .eq("provider", providerKey)
          .maybeSingle();
        if (inserted) patchProviderSetting(providerKey, inserted);
      }
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
    setSettings((prev) => {
      const next = { ...prev };
      delete next[providerKey];
      return next;
    });
    setLiveModels((prev) => {
      const next = { ...prev };
      delete next[providerKey];
      return next;
    });
    if (activeProvider === providerKey) {
      setActiveProvider("");
      setActiveModel("");
    }
    toast.success("API key removed");
  };

  const testConnection = async (providerKey: string, apiKey?: string) => {
    const key = apiKey || keyInputs[providerKey] || settings[providerKey]?.api_key;
    if (!key?.trim()) {
      toast.error("No API key to test");
      return;
    }
    const model =
      settings[providerKey]?.active_model ||
      getModelsForProvider(providerKey)[0] ||
      PROVIDERS.find((p) => p.key === providerKey)?.fallbackModels[0] ||
      "";

    setTestingProviders((prev) => ({ ...prev, [providerKey]: true }));
    try {
      const res = await fetch("/api/ai-settings/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: providerKey, apiKey: key.trim(), model }),
      });
      const data = (await res.json()) as { ok?: boolean; message?: string; status?: number };
      const isValid = !!data.ok;

      const existing = settings[providerKey];
      if (existing) {
        await supabase
          .from("ai_settings")
          .update({ is_connected: isValid, updated_at: new Date().toISOString() })
          .eq("id", existing.id);
        patchProviderSetting(providerKey, { ...existing, is_connected: isValid });
      }

      if (isValid) {
        toast.success(`${PROVIDERS.find((p) => p.key === providerKey)?.name} connected`);
        void fetchProviderModels(providerKey, key.trim());
      } else {
        const hint = data.status === 401 ? " — check or replace your API key" : "";
        toast.error(`Connection failed${hint}`, {
          description: data.message?.slice(0, 120),
        });
      }
    } catch (err) {
      toast.error("Test request failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setTestingProviders((prev) => ({ ...prev, [providerKey]: false }));
    }
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

    setSettings((prev) => {
      const next: Record<string, AIProvider> = {};
      for (const [k, v] of Object.entries(prev)) {
        next[k] = { ...v, is_active: k === providerKey };
      }
      if (prev[providerKey]) {
        next[providerKey] = { ...prev[providerKey], is_active: true, active_model: model };
      }
      return next;
    });

    toast.success(`Active model set to ${providerKey}/${model}`);
  };

  const maskKey = (key: string) => {
    if (!key || key.length < 8) return "••••••••••••";
    return key.slice(0, 6) + "•".repeat(Math.min(key.length - 10, 20)) + key.slice(-4);
  };

  return (
    <div className="p-6 flex flex-col gap-6 bg-white h-full relative">
      {initialLoading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/80 backdrop-blur-[1px]">
          <Loader2 size={24} className="animate-spin text-blue-600" />
        </div>
      )}
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
          const modelList = getModelsForProvider(provider.key);
          const isLoadingModels = loadingModels[provider.key];
          const listSource = modelsSource[provider.key];
          const savedModel = setting?.active_model;
          const savedNotInLive = savedModelDeprecated[provider.key];

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
                  type="button"
                  onClick={() => setShowKeys((prev) => ({ ...prev, [provider.key]: !prev[provider.key] }))}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showKeys[provider.key] ? <EyeOff size={12} /> : <Eye size={12} />}
                </button>
              </div>

              {/* Model selector (when connected) */}
              {isConnected && (
                <div className="relative flex flex-col gap-1">
                  {savedNotInLive && (
                    <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                      Active model <span className="font-mono">{savedModel}</span> is not in the
                      live list — choose a current model.
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => openModelDropdown(provider.key)}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs border border-gray-300 bg-white text-gray-700 hover:border-blue-400 transition-all"
                  >
                    <span className="font-mono truncate">
                      {setting?.active_model || "Select model..."}
                    </span>
                    {isLoadingModels ? (
                      <Loader2 size={12} className="animate-spin text-blue-600 shrink-0" />
                    ) : (
                      <ChevronDown size={12} className="text-gray-400 shrink-0" />
                    )}
                  </button>

                  {listSource && (
                    <span className="text-[9px] text-gray-400 px-1">
                      {listSource === "live"
                        ? `${modelList.length} models from API`
                        : "Fallback list (API unavailable)"}
                    </span>
                  )}

                  {modelDropdownOpen === provider.key && (
                    <div className="absolute top-full mt-1 left-0 right-0 rounded-lg z-20 bg-white border border-gray-200 shadow-lg overflow-hidden max-h-52 flex flex-col">
                      <button
                        type="button"
                        onClick={() => fetchProviderModels(provider.key)}
                        disabled={isLoadingModels}
                        className="flex items-center justify-center gap-1 px-3 py-2 text-[10px] font-medium text-blue-600 bg-blue-50 border-b border-gray-100 hover:bg-blue-100 disabled:opacity-50"
                      >
                        {isLoadingModels ? (
                          <Loader2 size={10} className="animate-spin" />
                        ) : (
                          <RefreshCw size={10} />
                        )}
                        Refresh from provider
                      </button>
                      <div className="overflow-y-auto">
                        {modelList.length === 0 && !isLoadingModels && (
                          <p className="px-3 py-2 text-[10px] text-gray-500">
                            No models — save key and test connection
                          </p>
                        )}
                        {modelList.map((model) => {
                          const isSavedOnly =
                            model === savedModel && savedModelDeprecated[provider.key];
                          return (
                            <button
                              key={model}
                              type="button"
                              onClick={() => setAsActive(provider.key, model)}
                              className={`w-full text-left px-3 py-2 text-[11px] hover:bg-blue-50 transition-colors border-b border-gray-100 font-mono ${
                                setting?.active_model === model
                                  ? "bg-blue-50 text-blue-700 font-semibold"
                                  : "text-gray-700"
                              }`}
                            >
                              {model}
                              {isSavedOnly && (
                                <span className="ml-1 text-[9px] text-amber-600">(saved)</span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => saveKey(provider.key)}
                  disabled={isSaving}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[11px] font-medium bg-blue-600 text-white hover:bg-blue-700 transition-all disabled:opacity-50"
                >
                  {isSaving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => testConnection(provider.key)}
                  disabled={isTesting || !hasKey}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[11px] font-medium border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition-all disabled:opacity-40"
                >
                  {isTesting ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                  Test
                </button>
                {hasKey && (
                  <button
                    type="button"
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
                  type="button"
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

