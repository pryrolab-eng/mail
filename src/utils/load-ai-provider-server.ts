import type { SupabaseClient } from "@supabase/supabase-js";
import type { AIProviderConfig } from "./lead-intel-ai";

/** Load active AI provider for a user (server-side). */
export async function loadAIProviderForUser(
  supabase: SupabaseClient,
  userId?: string
): Promise<AIProviderConfig | null> {
  let uid = userId;
  if (!uid) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;
    uid = user.id;
  }

  const select = "provider, api_key, active_model";

  const { data: active } = await supabase
    .from("ai_settings")
    .select(select)
    .eq("user_id", uid)
    .eq("is_active", true)
    .maybeSingle();

  if (active?.api_key?.trim()) {
    return {
      provider: active.provider,
      api_key: active.api_key.trim(),
      active_model: active.active_model,
    };
  }

  const { data: connected } = await supabase
    .from("ai_settings")
    .select(select)
    .eq("user_id", uid)
    .eq("is_connected", true)
    .not("api_key", "is", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!connected?.api_key?.trim()) return null;
  return {
    provider: connected.provider,
    api_key: connected.api_key.trim(),
    active_model: connected.active_model,
  };
}
