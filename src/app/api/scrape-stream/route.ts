import { NextRequest } from "next/server";
import { createClient } from "../../../../supabase/server";
import { createServiceClient } from "../../../../supabase/service";
import { enqueueAutomationJob } from "@/utils/automation-queue";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const { niche, location, maxResults } = (await request.json().catch(() => ({}))) as {
    niche?: string;
    location?: string;
    maxResults?: number;
  };
  if (!niche?.trim()) {
    return new Response(JSON.stringify({ error: "Niche is required" }), { status: 400 });
  }

  const service = createServiceClient();
  const jobId = await enqueueAutomationJob(service, user.id, "agent_discover", {
    niche: niche.trim(),
    location: location?.trim() ?? "",
    maxResults: Math.max(1, Math.min(Number(maxResults ?? 25), 100)),
  });

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const send = (event: string, data: object) => {
        controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      send("start", {
        jobId,
        niche: niche.trim(),
        location: location?.trim() ?? "",
        maxResults: Math.max(1, Math.min(Number(maxResults ?? 25), 100)),
        mode: "agent_queued",
      });
      send("progress", {
        totalFound: 0,
        totalFailed: 0,
        remaining: Math.max(1, Math.min(Number(maxResults ?? 25), 100)),
        currentChunk: 1,
        totalChunks: 1,
        percentComplete: 100,
        phase: "queued_for_worker",
      });
      send("done", {
        jobId,
        total: 0,
        target: Math.max(1, Math.min(Number(maxResults ?? 25), 100)),
        totalFailed: 0,
        crmAdded: 0,
        crmCallListAdded: 0,
        crmDuplicates: 0,
        crmResearched: 0,
        crmResearchFailed: 0,
        phoneOnlyFound: 0,
        exhausted: false,
        realEmails: 0,
        scrapeSummary: {
          withEmail: 0,
          phoneOnly: 0,
          crmAdded: 0,
          callListAdded: 0,
          researched: 0,
          realEmails: 0,
        },
        chunksCompleted: 1,
        message: "Agent discovery job queued. Keep npm run worker running.",
      });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
