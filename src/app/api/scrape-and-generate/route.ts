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

  const cappedMax = Math.max(1, Math.min(Number(maxResults ?? 25), 100));
  const service = createServiceClient();
  const jobId = await enqueueAutomationJob(service, user.id, "agent_discover", {
    niche: niche.trim(),
    location: location?.trim() ?? "",
    maxResults: cappedMax,
    generateDrafts: true,
  });

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const send = (event: string, data: object) => {
        controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      send("start", {
        jobId,
        phase: "queued_for_worker",
        mode: "agent_queued",
        total: cappedMax,
      });
      send("progress", {
        phase: "queued_for_worker",
        scraped: 0,
        emails: 0,
        fallbacks: 0,
        total: cappedMax,
        message: "Agent discovery and draft jobs queued. Keep npm run worker running.",
      });
      send("done", {
        jobId,
        scraped: 0,
        emails: [],
        generated: 0,
        message: "Agent discovery and draft jobs queued.",
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
