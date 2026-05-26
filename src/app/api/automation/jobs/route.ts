import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "../../../../../supabase/server";
import { createServiceClient } from "../../../../../supabase/service";
import { enqueueAutomationJob } from "@/utils/automation-queue";

export const runtime = "nodejs";

const schema = z.object({
  jobType: z.enum([
    "agent_discover",
    "research_lead",
    "score_lead",
    "generate_draft",
    "send_approved_email",
    "process_followups",
    "check_inbox",
  ]),
  leadIds: z.array(z.string().uuid()).max(500).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  scheduledAt: z.string().datetime().optional(),
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
  const { data, error: fetchError } = await service
    .from("automation_jobs")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }

  return NextResponse.json({ jobs: data ?? [] });
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

  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  const service = createServiceClient();
  const scheduled = parsed.data.scheduledAt
    ? new Date(parsed.data.scheduledAt)
    : new Date();
  const ids = parsed.data.leadIds?.length ? parsed.data.leadIds : [null];
  const jobIds: string[] = [];

  for (const leadId of ids) {
    const payload = {
      ...(parsed.data.payload ?? {}),
      ...(leadId ? { leadId } : {}),
    };
    jobIds.push(
      await enqueueAutomationJob(
        service,
        user.id,
        parsed.data.jobType,
        payload,
        scheduled
      )
    );
  }

  return NextResponse.json({ success: true, jobIds });
}
