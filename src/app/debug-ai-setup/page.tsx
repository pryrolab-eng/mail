"use client";

import { useEffect, useState } from "react";
import { createClient } from "../../../supabase/client";

export default function DebugAISetup() {
  const [userId, setUserId] = useState<string | null>(null);
  const [aiSettings, setAiSettings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [provider, setProvider] = useState("groq");
  const [adding, setAdding] = useState(false);

  const supabase = createClient();

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    setError(null);

    try {
      // Get current user
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      
      if (userError || !user) {
        setError("Not authenticated: " + (userError?.message || "No user"));
        setLoading(false);
        return;
      }

      setUserId(user.id);

      // Get AI settings
      const { data: settings, error: settingsError } = await supabase
        .from("ai_settings")
        .select("*")
        .eq("user_id", user.id);

      if (settingsError) {
        setError("Error fetching AI settings: " + settingsError.message);
      } else {
        setAiSettings(settings || []);
      }
    } catch (err: any) {
      setError("Unexpected error: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const addProvider = async () => {
    if (!userId || !apiKey) {
      alert("Please enter an API key");
      return;
    }

    setAdding(true);
    try {
      // First, deactivate all other providers
      await supabase
        .from("ai_settings")
        .update({ is_active: false })
        .eq("user_id", userId);

      // Insert or update the provider
      const { error: insertError } = await supabase
        .from("ai_settings")
        .upsert({
          user_id: userId,
          provider: provider,
          api_key: apiKey,
          active_model: provider === "groq" ? "llama-3.3-70b-versatile" : 
                       provider === "anthropic" ? "claude-3-5-sonnet-20241022" :
                       "gpt-4o-mini",
          is_active: true,
          is_connected: true,
        }, {
          onConflict: "user_id,provider"
        });

      if (insertError) {
        alert("Error adding provider: " + insertError.message);
      } else {
        alert("Provider added successfully!");
        setApiKey("");
        loadData();
      }
    } catch (err: any) {
      alert("Error: " + err.message);
    } finally {
      setAdding(false);
    }
  };

  const deleteProvider = async (id: string) => {
    if (!confirm("Delete this provider?")) return;

    const { error } = await supabase
      .from("ai_settings")
      .delete()
      .eq("id", id);

    if (error) {
      alert("Error deleting: " + error.message);
    } else {
      loadData();
    }
  };

  const activateProvider = async (id: string) => {
    // Deactivate all
    await supabase
      .from("ai_settings")
      .update({ is_active: false })
      .eq("user_id", userId);

    // Activate this one
    const { error } = await supabase
      .from("ai_settings")
      .update({ is_active: true })
      .eq("id", id);

    if (error) {
      alert("Error activating: " + error.message);
    } else {
      loadData();
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">AI Provider Debug</h1>
        <p className="text-gray-600 mb-8">Check and manage your AI provider configuration</p>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <p className="text-red-800 font-medium">Error:</p>
            <p className="text-red-600 text-sm mt-1">{error}</p>
          </div>
        )}

        {/* User Info */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">User Information</h2>
          <div className="bg-gray-50 rounded p-3">
            <p className="text-sm text-gray-600">User ID:</p>
            <p className="text-sm font-mono text-gray-900 break-all">{userId || "Not found"}</p>
          </div>
        </div>

        {/* Current AI Settings */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">
            Current AI Providers ({aiSettings.length})
          </h2>
          
          {aiSettings.length === 0 ? (
            <div className="text-center py-8 bg-gray-50 rounded-lg">
              <p className="text-gray-500">No AI providers configured</p>
              <p className="text-sm text-gray-400 mt-1">Add one below to start generating emails</p>
            </div>
          ) : (
            <div className="space-y-3">
              {aiSettings.map((setting) => (
                <div
                  key={setting.id}
                  className={`border rounded-lg p-4 ${
                    setting.is_active ? "border-green-500 bg-green-50" : "border-gray-200"
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <h3 className="font-semibold text-gray-900 capitalize">{setting.provider}</h3>
                        {setting.is_active && (
                          <span className="px-2 py-0.5 bg-green-600 text-white text-xs rounded-full">
                            Active
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-600 mb-1">
                        <span className="font-medium">Model:</span> {setting.active_model || "Not set"}
                      </p>
                      <p className="text-sm text-gray-600 mb-1">
                        <span className="font-medium">API Key:</span>{" "}
                        <span className="font-mono text-xs">
                          {setting.api_key?.substring(0, 20)}...
                        </span>
                      </p>
                      <p className="text-xs text-gray-500">
                        Created: {new Date(setting.created_at).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      {!setting.is_active && (
                        <button
                          onClick={() => activateProvider(setting.id)}
                          className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
                        >
                          Activate
                        </button>
                      )}
                      <button
                        onClick={() => deleteProvider(setting.id)}
                        className="px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-700"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Add New Provider */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Add AI Provider</h2>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Provider</label>
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
              >
                <option value="groq">Groq (Free)</option>
                <option value="anthropic">Anthropic (Claude)</option>
                <option value="openai">OpenAI (GPT)</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">API Key</label>
              <input
                type="text"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={
                  provider === "groq" ? "gsk_..." :
                  provider === "anthropic" ? "sk-ant-..." :
                  "sk-..."
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 font-mono text-sm"
              />
              <p className="text-xs text-gray-500 mt-1">
                {provider === "groq" && "Get free key: https://console.groq.com/keys"}
                {provider === "anthropic" && "Get key: https://console.anthropic.com/settings/keys"}
                {provider === "openai" && "Get key: https://platform.openai.com/api-keys"}
              </p>
            </div>

            <button
              onClick={addProvider}
              disabled={adding || !apiKey}
              className="w-full py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {adding ? "Adding..." : "Add Provider"}
            </button>
          </div>
        </div>

        <div className="mt-6 text-center">
          <a
            href="/platform"
            className="text-blue-600 hover:text-blue-700 text-sm font-medium"
          >
            ← Back to Platform
          </a>
        </div>
      </div>
    </div>
  );
}
