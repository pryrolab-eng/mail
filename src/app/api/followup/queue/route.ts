/**
 * /api/followup/queue
 *
 * GET  — returns the user's follow-up queue with stats
 * DELETE — cancels a pending follow-up (sets status to 'skipped')
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "../../../../../supabase/server";
import { createServiceClient } from "../../../../../supabase/service";

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status"); // pending | sent | skipped | failed
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "50"), 200);

    const service = createServiceClient();

    let query = service
      .from("followup_queue")
      .select(`
        id,
        followup_number,
        scheduled_at,
        sent_at,
        status,
        skip_reason,
        subject,
        error_message,
        created_at,
        leads (
          id,
          company_name,
          email,
          status
        )
      `)
      .eq("user_id", user.id)
      .order("scheduled_at", { ascending: false })
      .limit(limit);

    if (status) {
      query = query.eq("status", status);
    }

    const { data: queue, error } = await query;
    if (error) throw error;

    // ── Stats ──────────────────────────────────────────────────────────────
    const { data: stats } = await service
      .from("followup_queue")
      .select("status")
      .eq("user_id", user.id);

    const counts = (stats ?? []).reduce(
      (acc: Record<string, number>, row: { status: string }) => {
        acc[row.status] = (acc[row.status] ?? 0) + 1;
        return acc;
      },
      {}
    );

    // ── Upcoming (next 7 days) ─────────────────────────────────────────────
    const in7Days = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: upcoming } = await service
      .from("sent_emails")
      .select(`
        id,
        next_followup_at,
        followup_count,
        subject,
        leads ( company_name, email )
      `)
      .eq("user_id", user.id)
      .eq("followup_stopped", false)
      .not("next_followup_at", "is", null)
      .lte("next_followup_at", in7Days)
      .order("next_followup_at", { ascending: true })
      .limit(20);

    return NextResponse.json({
      success: true,
      queue: queue ?? [],
      stats: counts,
      upcoming: upcoming ?? [],
    });
  } catch (err) {
    console.error("[GET /api/followup/queue]", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}

// Cancel a pending follow-up
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const queueId = searchParams.get("id");
    const sentEmailId = searchParams.get("sentEmailId");

    if (!queueId && !sentEmailId) {
      return NextResponse.json(
        { success: false, error: "Provide id or sentEmailId" },
        { status: 400 }
      );
    }

    const service = createServiceClient();

    if (queueId) {
      // Cancel a specific queue entry
      const { error } = await service
        .from("followup_queue")
        .update({ status: "skipped", skip_reason: "cancelled_by_user" })
        .eq("id", queueId)
        .eq("user_id", user.id)
        .eq("status", "pending");

      if (error) throw error;
    }

    if (sentEmailId) {
      // Stop the entire follow-up chain for this sent email
      const { error } = await service
        .from("sent_emails")
        .update({ followup_stopped: true, next_followup_at: null })
        .eq("id", sentEmailId)
        .eq("user_id", user.id);

      if (error) throw error;

      // Also cancel any pending queue entries for this sent email
      await service
        .from("followup_queue")
        .update({ status: "skipped", skip_reason: "cancelled_by_user" })
        .eq("sent_email_id", sentEmailId)
        .eq("user_id", user.id)
        .eq("status", "pending");
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[DELETE /api/followup/queue]", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
