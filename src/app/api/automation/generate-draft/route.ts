import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "../../../../../supabase/service";
import { runGenerateEmailForLead } from "@/utils/lead-email-generation";

export const runtime = "nodejs";

const schema = z.object({
  userId: z.string().uuid(),
  leadId: z.string().uuid(),
});

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
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
  const result = await runGenerateEmailForLead(
    service,
    parsed.data.userId,
    parsed.data.leadId
  );
  if (!result.success) {
    return NextResponse.json(result, { status: 400 });
  }
  return NextResponse.json(result);
}
