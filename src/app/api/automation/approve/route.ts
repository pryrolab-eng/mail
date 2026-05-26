import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "../../../../../supabase/server";
import { createServiceClient } from "../../../../../supabase/service";
import {
  approveDraftsForQueue,
  rejectDrafts,
} from "@/utils/automation-queue";

export const runtime = "nodejs";

const schema = z.object({
  action: z.enum(["approve", "reject"]),
  leadIds: z.array(z.string().uuid()).min(1).max(500),
  reason: z.string().max(500).optional(),
});

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
  if (parsed.data.action === "approve") {
    const result = await approveDraftsForQueue(
      service,
      user.id,
      parsed.data.leadIds
    );
    return NextResponse.json({ success: true, ...result });
  }

  const result = await rejectDrafts(
    service,
    user.id,
    parsed.data.leadIds,
    parsed.data.reason?.trim() || "Rejected during batch review"
  );
  return NextResponse.json({ success: true, ...result });
}
