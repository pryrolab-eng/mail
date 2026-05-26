import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "../../../../../supabase/server";
import { createServiceClient } from "../../../../../supabase/service";
import { runLeadResearch } from "@/utils/lead-research";

export const runtime = "nodejs";

const schema = z.object({
  leadId: z.string().uuid(),
  userId: z.string().uuid().optional(),
});

function isCronAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  let userId = parsed.data.userId;
  const cron = isCronAuthorized(request);

  if (!cron) {
    const supabase = await createClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    if (error || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    userId = user.id;
  }

  if (!userId) {
    return NextResponse.json(
      { error: "userId is required for worker research calls" },
      { status: 400 }
    );
  }

  const service = createServiceClient();
  const result = await runLeadResearch(service, userId, parsed.data.leadId);
  const status = result.success ? 200 : 500;
  return NextResponse.json(result, { status });
}
