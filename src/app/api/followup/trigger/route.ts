/**
 * /api/followup/trigger
 *
 * Manual trigger — called from the FollowUpModule UI.
 * Schedules follow-ups for a specific set of sent emails, then
 * immediately kicks the processor so anything due right now goes out.
 *
 * POST body:
 * {
 *   sentEmailIds?: string[];   // scope to specific emails (optional)
 *   runNow?: boolean;          // also call /process immediately (default true)
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "../../../../../supabase/server";
import { createServiceClient } from "../../../../../supabase/service";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { sentEmailIds, runNow = true } = body as {
      sentEmailIds?: string[];
      runNow?: boolean;
    };

    const service = createServiceClient();

    // ── Fetch user's follow-up settings ───────────────────────────────────
    const { data: settings } = await service
      .from("followup_settings")
      .select("*")
      .eq("user_id", user.id)
      .single();

    if (!settings?.auto_followup_enabled) {
      return NextResponse.json({
        success: false,
        error: "Auto follow-up is disabled. Enable it in Follow-Up Settings first.",
      }, { status: 400 });
    }

    // ── Find sent emails that don't have a follow-up scheduled yet ────────
    let emailQuery = service
      .from("sent_emails")
      .select("id, sent_at, followup_count, next_followup_at, followup_stopped, status, lead_id")
      .eq("user_id", user.id)
      .eq("followup_stopped", false)
      .is("next_followup_at", null)           // not yet scheduled
      .not("status", "in", '("replied","bounced")');

    if (sentEmailIds && sentEmailIds.length > 0) {
      emailQuery = emailQuery.in("id", sentEmailIds);
    }

    const { data: emails, error: emailError } = await emailQuery;

    if (emailError) throw emailError;

    if (!emails || emails.length === 0) {
      // Nothing to schedule — just run the processor if requested
      if (runNow) {
        return await callProcessor(user.id, request);
      }
      return NextResponse.json({
        success: true,
        message: "No emails to schedule for follow-up",
        scheduled: 0,
      });
    }

    // ── Schedule next_followup_at for each email ──────────────────────────
    const delayMs = settings.default_delay_days * 24 * 60 * 60 * 1000;
    let scheduled = 0;

    for (const email of emails) {
      // Skip if lead has already replied
      const { count: replyCount } = await service
        .from("email_replies")
        .select("id", { count: "exact", head: true })
        .eq("sent_email_id", email.id);

      if ((replyCount ?? 0) > 0) {
        await service
          .from("sent_emails")
          .update({ followup_stopped: true })
          .eq("id", email.id);
        continue;
      }

      // Schedule: base time is sent_at + delay * (followup_count + 1)
      // so the 1st follow-up is delay days after the original send,
      // the 2nd is delay days after the 1st, etc.
      const baseTime = new Date(email.sent_at).getTime();
      const nextAt = new Date(
        baseTime + delayMs * (email.followup_count + 1)
      ).toISOString();

      await service
        .from("sent_emails")
        .update({ next_followup_at: nextAt })
        .eq("id", email.id);

      scheduled++;
    }

    // ── Optionally run the processor immediately ───────────────────────────
    if (runNow) {
      return await callProcessor(user.id, request, scheduled);
    }

    return NextResponse.json({
      success: true,
      message: `Scheduled follow-ups for ${scheduled} emails`,
      scheduled,
    });
  } catch (err) {
    console.error("[POST /api/followup/trigger]", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}

/** Calls the processor route internally and merges the result */
async function callProcessor(
  userId: string,
  originalRequest: NextRequest,
  scheduled = 0
) {
  try {
    const origin =
      originalRequest.headers.get("origin") ??
      process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(".supabase.co", ".vercel.app") ??
      "http://localhost:3000";

    const processorUrl = `${origin}/api/followup/process`;

    const res = await fetch(processorUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Forward the session cookie so the processor can auth
        cookie: originalRequest.headers.get("cookie") ?? "",
      },
      body: JSON.stringify({ userId }),
    });

    const processorData = await res.json();

    return NextResponse.json({
      success: true,
      message: `Scheduled ${scheduled} emails. ${processorData.message ?? ""}`.trim(),
      scheduled,
      processor: processorData,
    });
  } catch (err) {
    // Processor call failed — still return success for the scheduling part
    return NextResponse.json({
      success: true,
      message: `Scheduled ${scheduled} emails. Processor call failed: ${err instanceof Error ? err.message : String(err)}`,
      scheduled,
    });
  }
}
