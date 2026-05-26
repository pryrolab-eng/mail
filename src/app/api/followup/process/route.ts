/**
 * /api/followup/process
 *
 * The follow-up scheduler engine.
 *
 * Called by:
 *  - Vercel Cron (vercel.json) — runs every hour automatically
 *  - /api/followup/trigger    — manual trigger from the UI
 *
 * What it does:
 *  1. Finds every sent_email where next_followup_at <= NOW() and the lead
 *     hasn't replied, isn't dead, and hasn't hit max_followups.
 *  2. Generates a follow-up email body (personalised template or AI).
 *  3. Sends it via the user's SMTP accounts (round-robin rotation).
 *  4. Logs the send, increments followup_count, schedules the next one.
 *  5. Stops the sequence if stop_on_reply is true and a reply was detected.
 *
 * Security:
 *  - Browser requests must be authenticated (Supabase session).
 *  - Cron requests must include the CRON_SECRET header.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "../../../../../supabase/server";
import { createServiceClient } from "../../../../../supabase/service";
import { SMTPManager } from "@/utils/smtp-server";

// nodemailer requires the Node.js runtime (not Edge)
export const runtime = "nodejs";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DueFollowup {
  sent_email_id: string;
  user_id: string;
  lead_id: string;
  campaign_id: string | null;
  original_subject: string | null;
  original_body: string | null;
  sent_at: string;
  followup_count: number;
  next_followup_at: string;
  company_name: string;
  lead_email: string | null;
  niche: string | null;
  location: string | null;
  company_context: string | null;
  lead_status: string;
  max_followups: number;
  default_delay_days: number;
  stop_on_reply: boolean;
  followup_tone: string | null;
  your_company: string | null;
  your_service: string | null;
}

interface ProcessResult {
  userId: string;
  sent: number;
  skipped: number;
  failed: number;
  errors: string[];
}

// ─── Template builder ─────────────────────────────────────────────────────────

/**
 * Builds a follow-up email from a simple template.
 * Variables: {{company_name}}, {{niche}}, {{location}}, {{your_company}},
 *            {{your_service}}, {{followup_number}}, {{original_subject}}
 */
function buildFollowupEmail(
  due: DueFollowup,
  sequenceTemplate: { subject_template: string; body_template: string } | null
): { subject: string; body: string } {
  const followupNumber = due.followup_count + 1;
  const yourCompany = due.your_company ?? "our company";
  const yourService = due.your_service ?? "our service";

  // Use sequence template if available, otherwise fall back to a sensible default
  const subjectTpl =
    sequenceTemplate?.subject_template ??
    `Re: ${due.original_subject ?? "Following up"}`;

  const bodyTpl =
    sequenceTemplate?.body_template ??
    defaultBodyTemplate(followupNumber, due.followup_tone ?? "professional");

  const vars: Record<string, string> = {
    company_name: due.company_name,
    niche: due.niche ?? "your industry",
    location: due.location ?? "your area",
    your_company: yourCompany,
    your_service: yourService,
    followup_number: String(followupNumber),
    original_subject: due.original_subject ?? "",
  };

  const interpolate = (tpl: string) =>
    tpl.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);

  return {
    subject: interpolate(subjectTpl),
    body: interpolate(bodyTpl),
  };
}

function defaultBodyTemplate(followupNumber: number, tone: string): string {
  if (tone === "casual") {
    return followupNumber === 1
      ? `Hey {{company_name}} team,\n\nJust wanted to bump this up in case it got buried. Still think there's a real fit between {{company_name}} and {{your_service}}.\n\nWorth a quick chat?\n\n— {{your_company}}`
      : `Hey again,\n\nI know inboxes get crazy. Sending one last note in case the timing is better now.\n\nHappy to keep it to 10 minutes — just reply and we'll find a time.\n\n— {{your_company}}`;
  }

  return followupNumber === 1
    ? `Hi {{company_name}} team,\n\nI wanted to follow up on my previous email regarding {{your_service}}.\n\nI believe there's a strong opportunity for {{company_name}} to benefit from what we offer, particularly given your work in {{niche}}.\n\nWould you have 15 minutes this week for a brief call?\n\nBest regards,\n{{your_company}}`
    : `Hi {{company_name}} team,\n\nI'm reaching out one final time regarding {{your_service}}.\n\nIf the timing isn't right, no worries at all — just let me know and I won't follow up again. But if there's any interest, I'd love to connect.\n\nBest regards,\n{{your_company}}`;
}

// ─── Core processor ───────────────────────────────────────────────────────────

async function processFollowupsForUser(
  userId: string,
  dueItems: DueFollowup[]
): Promise<ProcessResult> {
  const service = createServiceClient();
  const result: ProcessResult = { userId, sent: 0, skipped: 0, failed: 0, errors: [] };

  // Load SMTP accounts once per user
  const smtpManager = new SMTPManager();
  try {
    await smtpManager.loadAccounts(userId);
  } catch (err) {
    result.errors.push(`Failed to load SMTP accounts: ${err instanceof Error ? err.message : String(err)}`);
    result.failed += dueItems.length;
    return result;
  }

  const capacity = smtpManager.getTotalCapacity();
  if (capacity.remaining === 0) {
    result.errors.push("All SMTP accounts at daily limit");
    result.skipped += dueItems.length;
    return result;
  }

  for (const due of dueItems) {
    try {
      // ── Guard: skip if lead has no email ──────────────────────────────────
      if (!due.lead_email) {
        await markSkipped(service, due, "no_email");
        result.skipped++;
        continue;
      }

      // ── Guard: stop if lead replied / is in a terminal status ─────────────
      if (
        due.stop_on_reply &&
        [
          "Replied",
          "Interested",
          "Closed",
          "Dead",
          "replied",
          "interested",
          "bounced",
          "failed",
          "completed",
        ].includes(due.lead_status)
      ) {
        await stopSequence(service, due.sent_email_id, "lead_replied_or_closed");
        result.skipped++;
        continue;
      }

      // ── Guard: check if a reply exists in email_replies ───────────────────
      if (due.stop_on_reply) {
        const { count } = await service
          .from("email_replies")
          .select("id", { count: "exact", head: true })
          .eq("sent_email_id", due.sent_email_id);

        if ((count ?? 0) > 0) {
          await stopSequence(service, due.sent_email_id, "reply_detected");
          result.skipped++;
          continue;
        }
      }

      // ── Fetch the matching sequence step (if campaign has sequences) ───────
      let sequenceTemplate: { subject_template: string; body_template: string } | null = null;
      let sequenceId: string | null = null;

      if (due.campaign_id) {
        const { data: seq } = await service
          .from("email_sequences")
          .select("id, subject_template, body_template")
          .eq("campaign_id", due.campaign_id)
          .eq("sequence_number", due.followup_count + 1)
          .single();

        if (seq) {
          sequenceTemplate = seq;
          sequenceId = seq.id;
        }
      }

      // ── Build email content ────────────────────────────────────────────────
      const { subject, body } = buildFollowupEmail(due, sequenceTemplate);

      // ── Check SMTP capacity before each send ──────────────────────────────
      const currentCapacity = smtpManager.getTotalCapacity();
      if (currentCapacity.remaining === 0) {
        // Queue this one for tomorrow
        await service.from("followup_queue").insert({
          user_id: userId,
          sent_email_id: due.sent_email_id,
          lead_id: due.lead_id,
          campaign_id: due.campaign_id,
          sequence_id: sequenceId,
          followup_number: due.followup_count + 1,
          scheduled_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          status: "pending",
          subject,
          body,
        });
        result.skipped++;
        continue;
      }

      // ── Send ──────────────────────────────────────────────────────────────
      const sendResult = await smtpManager.sendEmail(due.lead_email, subject, body);

      if (!sendResult.success) {
        throw new Error(sendResult.error ?? "SMTP send failed");
      }

      // ── Resolve smtp_account UUID ─────────────────────────────────────────
      let smtpAccountId: string | null = null;
      if (sendResult.accountUsed) {
        const { data: acct } = await service
          .from("smtp_accounts")
          .select("id")
          .eq("user_id", userId)
          .eq("email", sendResult.accountUsed)
          .single();
        smtpAccountId = acct?.id ?? null;
      }

      const now = new Date().toISOString();
      const newFollowupCount = due.followup_count + 1;
      const isLastFollowup = newFollowupCount >= due.max_followups;

      // ── Log to sent_emails (new row for this follow-up) ───────────────────
      const { data: newSentEmail } = await service
        .from("sent_emails")
        .insert({
          user_id: userId,
          lead_id: due.lead_id,
          campaign_id: due.campaign_id,
          sequence_id: sequenceId,
          subject,
          body,
          sent_at: now,
          status: "sent",
          followup_count: 0,           // this row is itself a fresh send
          followup_stopped: isLastFollowup, // stop chain on this new row if last
          next_followup_at: null,      // will be set if not last
        })
        .select("id")
        .single();

      // ── Log to followup_queue ─────────────────────────────────────────────
      await service.from("followup_queue").insert({
        user_id: userId,
        sent_email_id: due.sent_email_id,
        lead_id: due.lead_id,
        campaign_id: due.campaign_id,
        sequence_id: sequenceId,
        followup_number: newFollowupCount,
        scheduled_at: now,
        sent_at: now,
        status: "sent",
        subject,
        body,
      });

      // ── Log to email_queue for audit trail ────────────────────────────────
      await service.from("email_queue").insert({
        user_id: userId,
        campaign_id: due.campaign_id,
        lead_id: due.lead_id,
        smtp_account_id: smtpAccountId,
        recipient_email: due.lead_email,
        recipient_name: due.company_name,
        subject,
        body,
        status: "sent",
        sent_at: now,
      });

      // ── Update the original sent_email row ────────────────────────────────
      const nextFollowupAt = isLastFollowup
        ? null
        : new Date(Date.now() + due.default_delay_days * 24 * 60 * 60 * 1000).toISOString();

      await service
        .from("sent_emails")
        .update({
          followup_count: newFollowupCount,
          followup_stopped: isLastFollowup,
          next_followup_at: nextFollowupAt,
        })
        .eq("id", due.sent_email_id);

      result.sent++;

      // Small throttle between sends
      await new Promise((r) => setTimeout(r, 1200));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`${due.lead_email ?? due.lead_id}: ${msg}`);
      result.failed++;

      // Log failure to followup_queue
      await service.from("followup_queue").insert({
        user_id: userId,
        sent_email_id: due.sent_email_id,
        lead_id: due.lead_id,
        campaign_id: due.campaign_id,
        followup_number: due.followup_count + 1,
        scheduled_at: new Date().toISOString(),
        status: "failed",
        error_message: msg,
      });
    }
  }

  return result;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function stopSequence(
  service: ReturnType<typeof createServiceClient>,
  sentEmailId: string,
  reason: string
) {
  await service
    .from("sent_emails")
    .update({ followup_stopped: true, next_followup_at: null })
    .eq("id", sentEmailId);

  await service.from("followup_queue").insert({
    user_id: (
      await service.from("sent_emails").select("user_id").eq("id", sentEmailId).single()
    ).data?.user_id,
    sent_email_id: sentEmailId,
    lead_id: (
      await service.from("sent_emails").select("lead_id").eq("id", sentEmailId).single()
    ).data?.lead_id,
    followup_number: 0,
    scheduled_at: new Date().toISOString(),
    status: "skipped",
    skip_reason: reason,
  });
}

async function markSkipped(
  service: ReturnType<typeof createServiceClient>,
  due: DueFollowup,
  reason: string
) {
  await service.from("followup_queue").insert({
    user_id: due.user_id,
    sent_email_id: due.sent_email_id,
    lead_id: due.lead_id,
    campaign_id: due.campaign_id,
    followup_number: due.followup_count + 1,
    scheduled_at: new Date().toISOString(),
    status: "skipped",
    skip_reason: reason,
  });
}

// ─── Route handlers ───────────────────────────────────────────────────────────

/**
 * POST /api/followup/process
 *
 * Accepts two callers:
 *  1. Vercel Cron — must send header: Authorization: Bearer <CRON_SECRET>
 *  2. Authenticated browser — must have a valid Supabase session
 *     (optionally pass { userId } in body to scope to one user)
 */
export async function POST(request: NextRequest) {
  // ── Auth: cron secret OR user session ─────────────────────────────────────
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  const isCronCall =
    cronSecret && authHeader === `Bearer ${cronSecret}`;

  let callerUserId: string | null = null;

  if (!isCronCall) {
    // Must be an authenticated user
    const supabase = await createClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
    callerUserId = user.id;
  }

  // ── Parse optional body ───────────────────────────────────────────────────
  let bodyUserId: string | null = null;
  try {
    const body = await request.json().catch(() => ({}));
    bodyUserId = body?.userId ?? null;
  } catch {
    // no body — fine
  }

  // Cron can process all users; browser session is scoped to their own userId
  const targetUserId = isCronCall ? (bodyUserId ?? null) : callerUserId;

  const service = createServiceClient();

  // ── Fetch due follow-ups ──────────────────────────────────────────────────
  let query = service.from("followup_due").select("*");
  if (targetUserId) {
    query = query.eq("user_id", targetUserId);
  }

  const { data: dueItems, error: fetchError } = await query;

  if (fetchError) {
    console.error("[/api/followup/process] fetch error:", fetchError);
    return NextResponse.json(
      { success: false, error: fetchError.message },
      { status: 500 }
    );
  }

  if (!dueItems || dueItems.length === 0) {
    return NextResponse.json({
      success: true,
      message: "No follow-ups due right now",
      processed: 0,
      results: [],
    });
  }

  // ── Group by user so we load SMTP accounts once per user ─────────────────
  const byUser = new Map<string, DueFollowup[]>();
  for (const item of dueItems as DueFollowup[]) {
    const list = byUser.get(item.user_id) ?? [];
    list.push(item);
    byUser.set(item.user_id, list);
  }

  // ── Process each user's queue ─────────────────────────────────────────────
  const allResults: ProcessResult[] = [];
  for (const [uid, items] of byUser) {
    const result = await processFollowupsForUser(uid, items);
    allResults.push(result);
  }

  const totals = allResults.reduce(
    (acc, r) => ({
      sent: acc.sent + r.sent,
      skipped: acc.skipped + r.skipped,
      failed: acc.failed + r.failed,
    }),
    { sent: 0, skipped: 0, failed: 0 }
  );

  console.log(
    `[followup/process] done — sent:${totals.sent} skipped:${totals.skipped} failed:${totals.failed}`
  );

  return NextResponse.json({
    success: true,
    message: `Processed ${dueItems.length} due follow-ups: ${totals.sent} sent, ${totals.skipped} skipped, ${totals.failed} failed`,
    processed: dueItems.length,
    totals,
    results: allResults,
  });
}

// GET is used by Vercel Cron (it sends GET requests)
export async function GET(request: NextRequest) {
  return POST(request);
}
