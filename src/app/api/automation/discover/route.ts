import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "../../../../../supabase/service";
import { runAgentDiscovery } from "@/utils/lead-agent-discovery";

export const runtime = "nodejs";
export const maxDuration = 300;

const schema = z.object({
  userId: z.string().uuid(),
  niche: z.string().min(1),
  location: z.string().optional().nullable(),
  maxResults: z.coerce.number().int().min(1).max(100).default(25),
  generateDrafts: z.boolean().optional().default(false),
});

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
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
  const result = await runAgentDiscovery(service, parsed.data.userId, parsed.data);
  return NextResponse.json({ success: true, ...result });
}
