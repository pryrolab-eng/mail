import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "../../../../../supabase/server";
import { createServiceClient } from "../../../../../supabase/service";
import { scoreLeadForAutomation } from "@/utils/automation-ai";
import { enqueueAutomationJob } from "@/utils/automation-queue";

export const runtime = "nodejs";

const schema = z.object({
  leadIds: z.array(z.string().uuid()).min(1).max(100),
  enqueueDrafts: z.boolean().default(false),
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
  const results: Array<{ leadId: string; score?: number; action?: string; error?: string }> = [];

  for (const leadId of parsed.data.leadIds) {
    try {
      const score = await scoreLeadForAutomation(service, user.id, leadId);
      results.push({
        leadId,
        score: score.score,
        action: score.recommended_action,
      });
      if (parsed.data.enqueueDrafts && score.qualified && score.score >= 70) {
        await enqueueAutomationJob(service, user.id, "generate_draft", { leadId });
      }
    } catch (err) {
      results.push({
        leadId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({
    success: true,
    scored: results.filter((r) => r.score != null).length,
    failed: results.filter((r) => r.error).length,
    results,
  });
}
