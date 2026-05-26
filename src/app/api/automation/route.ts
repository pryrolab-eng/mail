import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "../../../../supabase/server";
import { createServiceClient } from "../../../../supabase/service";
import {
  DEFAULT_AUTOMATION_SETTINGS,
  getOrCreateAutomationSettings,
} from "@/utils/automation-settings";

export const runtime = "nodejs";

const settingsSchema = z.object({
  automation_mode: z
    .enum(["assisted", "high_score_autopilot", "full_autopilot"])
    .default("assisted"),
  provider: z.string().min(1).default("groq"),
  daily_send_limit: z.number().int().min(1).max(500).default(500),
  per_account_daily_limit: z.number().int().min(1).max(50).default(50),
  send_window_start: z.string().regex(/^\d{2}:\d{2}$/).default("09:00"),
  send_window_end: z.string().regex(/^\d{2}:\d{2}$/).default("17:00"),
  timezone: z.string().min(1).default("Africa/Kigali"),
  require_approval_before_send: z.boolean().default(true),
  allow_low_confidence_autosend: z.boolean().default(false),
  min_lead_score: z.number().int().min(0).max(100).default(70),
  worker_enabled: z.boolean().default(true),
});

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = createServiceClient();
  const settings = await getOrCreateAutomationSettings(service, user.id);

  const [{ count: pendingJobs }, { count: pendingApprovals }, { count: queued }] =
    await Promise.all([
      service
        .from("automation_jobs")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("status", "pending"),
      service
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("pipeline_stage", "approval_pending"),
      service
        .from("email_queue")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("status", "pending"),
    ]);

  return NextResponse.json({
    settings,
    health: {
      pendingJobs: pendingJobs ?? 0,
      pendingApprovals: pendingApprovals ?? 0,
      queuedEmails: queued ?? 0,
    },
  });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = settingsSchema.parse({
    ...DEFAULT_AUTOMATION_SETTINGS,
    ...body,
    automation_mode: "assisted",
    require_approval_before_send: true,
    allow_low_confidence_autosend: false,
    daily_send_limit: Math.min(Number(body.daily_send_limit ?? 500), 500),
    per_account_daily_limit: Math.min(
      Number(body.per_account_daily_limit ?? 50),
      50
    ),
  });

  const service = createServiceClient();
  const { data, error: upsertError } = await service
    .from("automation_settings")
    .upsert({ user_id: user.id, ...parsed }, { onConflict: "user_id" })
    .select("*")
    .single();

  if (upsertError) {
    return NextResponse.json({ error: upsertError.message }, { status: 500 });
  }

  return NextResponse.json({ settings: data });
}
