import type { SupabaseClient } from "@supabase/supabase-js";

export type AutomationSettings = {
  id: string;
  user_id: string;
  automation_mode: "assisted" | "high_score_autopilot" | "full_autopilot";
  provider: string;
  daily_send_limit: number;
  per_account_daily_limit: number;
  send_window_start: string;
  send_window_end: string;
  timezone: string;
  require_approval_before_send: boolean;
  allow_low_confidence_autosend: boolean;
  min_lead_score: number;
  worker_enabled: boolean;
};

export const DEFAULT_AUTOMATION_SETTINGS = {
  automation_mode: "assisted",
  provider: "groq",
  daily_send_limit: 500,
  per_account_daily_limit: 50,
  send_window_start: "09:00",
  send_window_end: "17:00",
  timezone: "Africa/Kigali",
  require_approval_before_send: true,
  allow_low_confidence_autosend: false,
  min_lead_score: 70,
  worker_enabled: true,
} as const;

export async function getOrCreateAutomationSettings(
  supabase: SupabaseClient,
  userId: string
): Promise<AutomationSettings> {
  const { data: existing, error } = await supabase
    .from("automation_settings")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (existing) return existing as AutomationSettings;

  const { data, error: insertError } = await supabase
    .from("automation_settings")
    .insert({
      user_id: userId,
      ...DEFAULT_AUTOMATION_SETTINGS,
    })
    .select("*")
    .single();

  if (insertError) throw new Error(insertError.message);
  return data as AutomationSettings;
}

function parseTime(value: string): { hour: number; minute: number } {
  const [hour, minute] = value.split(":").map((n) => Number.parseInt(n, 10));
  return {
    hour: Number.isFinite(hour) ? hour : 9,
    minute: Number.isFinite(minute) ? minute : 0,
  };
}

export function isWithinSendWindow(
  date: Date,
  settings: Pick<
    AutomationSettings,
    "send_window_start" | "send_window_end" | "timezone"
  >
): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: settings.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const nowMinutes = hour * 60 + minute;
  const start = parseTime(settings.send_window_start);
  const end = parseTime(settings.send_window_end);
  const startMinutes = start.hour * 60 + start.minute;
  const endMinutes = end.hour * 60 + end.minute;

  return nowMinutes >= startMinutes && nowMinutes < endMinutes;
}

export function nextSendWindowStart(
  from: Date,
  settings: Pick<
    AutomationSettings,
    "send_window_start" | "send_window_end" | "timezone"
  >
): Date {
  if (isWithinSendWindow(from, settings)) return from;

  const start = parseTime(settings.send_window_start);
  const localParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: settings.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(from);
  const year = localParts.find((p) => p.type === "year")?.value;
  const month = localParts.find((p) => p.type === "month")?.value;
  const day = localParts.find((p) => p.type === "day")?.value;
  const candidate = new Date(
    `${year}-${month}-${day}T${String(start.hour).padStart(2, "0")}:${String(
      start.minute
    ).padStart(2, "0")}:00+02:00`
  );

  if (candidate > from) return candidate;
  return new Date(candidate.getTime() + 24 * 60 * 60 * 1000);
}

export function randomizedSendDelayMs(): number {
  return 90_000 + Math.floor(Math.random() * 150_000);
}
