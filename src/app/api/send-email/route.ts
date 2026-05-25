import { NextRequest, NextResponse } from "next/server";
import { createClient } from "../../../../supabase/server";
import { createServiceClient } from "../../../../supabase/service";
import { SMTPManager } from "@/utils/smtp-server";
import { randomUUID } from "crypto";
import { classifyBounce } from "@/types/platform";

export const runtime = "nodejs";

/**
 * Convert plain-text email body to clean HTML.
 * - Blank lines → paragraph breaks
 * - Single newlines → line breaks
 * - Preserves signature formatting
 */
function plainTextToHtml(text: string): string {
  return text
    .trim()
    .split(/\n\n+/)                          // split on blank lines → paragraphs
    .map(para =>
      `<p style="margin:0 0 14px 0;line-height:1.6;">${
        para
          .split('\n')
          .map(line => line.trim())
          .join('<br>')
      }</p>`
    )
    .join('\n');
}

function injectTracking(body: string, pixelId: string, baseUrl: string): string {
  const base = baseUrl.replace(/\/$/, "");
  const pixel = `<img src="${base}/api/track/open/${pixelId}" width="1" height="1" style="display:none;border:0;" alt="" />`;

  // If body is already HTML, append pixel before </body> or at end
  if (/<html[\s>]/i.test(body)) {
    return body.replace(/<\/body>/i, `${pixel}</body>`);
  }

  // Convert plain text to HTML with proper paragraph breaks
  const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:600px;margin:0 auto;padding:20px;">
${plainTextToHtml(body)}
${pixel}
</body></html>`;
  return html;
}

export interface SendEmailRequest {
  leadId?: string;
  to: string;
  subject: string;
  body: string;
  campaignId?: string;
}

export interface SendEmailResponse {
  success: boolean;
  sentEmailId?: string;
  accountUsed?: string;
  leadId?: string | null;
  error?: string;
  warning?: string;
}

/** Save a record to sent_emails using service role (bypasses RLS) */
async function logEmail(
  service: ReturnType<typeof createServiceClient>,
  data: {
    user_id: string;
    lead_id: string | null;
    to_email: string;
    subject: string;
    body: string;
    status: "sent" | "failed";
    bounce_reason?: string | null;
    tracking_pixel_id?: string;
    smtp_account_id?: string | null;
    campaign_id?: string;
  }
): Promise<string | null> {
  const insert: Record<string, any> = {
    user_id: data.user_id,
    lead_id: data.lead_id,
    to_email: data.to_email,
    subject: data.subject,
    body: data.body,
    sent_at: new Date().toISOString(),
    status: data.status,
  };

  if (data.bounce_reason) insert.bounce_reason = data.bounce_reason;
  if (data.tracking_pixel_id) insert.tracking_pixel_id = data.tracking_pixel_id;
  if (data.smtp_account_id) insert.smtp_account_id = data.smtp_account_id;
  if (data.campaign_id) insert.campaign_id = data.campaign_id;

  const { data: row, error } = await service
    .from("sent_emails")
    .insert(insert)
    .select("id")
    .single();

  if (error) {
    console.error("❌ logEmail failed:", error.message, "| code:", error.code, "| hint:", error.hint);
    return null;
  }

  return row?.id ?? null;
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as SendEmailRequest;
    const { leadId, to, subject, body: emailBody, campaignId } = body;

    if (!to || !subject || !emailBody) {
      return NextResponse.json(
        { success: false, error: "Missing required fields: to, subject, body" },
        { status: 400 }
      );
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return NextResponse.json(
        { success: false, error: "Invalid recipient email address" },
        { status: 400 }
      );
    }

    const service = createServiceClient();

    // Look up lead
    let lead: { id: string; company_name: string; status: string } | null = null;
    if (leadId) {
      const { data } = await service
        .from("leads")
        .select("id, company_name, status")
        .eq("id", leadId)
        .eq("user_id", user.id)
        .single();
      lead = data ?? null;
    }

    // Load SMTP
    const smtpManager = new SMTPManager();
    try {
      await smtpManager.loadAccounts(user.id);
    } catch (err) {
      console.error("loadAccounts failed:", err);
      return NextResponse.json(
        { success: false, error: "Failed to load SMTP accounts: " + String(err) },
        { status: 500 }
      );
    }

    const capacity = smtpManager.getTotalCapacity();
    console.log("SMTP capacity:", capacity);

    if (capacity.total === 0) {
      return NextResponse.json(
        { success: false, error: "No SMTP accounts configured. Add one in SMTP Manager." },
        { status: 400 }
      );
    }

    if (capacity.remaining === 0) {
      return NextResponse.json(
        { success: false, error: "Daily sending limit reached. Try again tomorrow." },
        { status: 429 }
      );
    }

    // Send
    const result = await smtpManager.sendEmail(to, subject, emailBody);

    if (!result.success) {
      console.log(`📧 Email to ${to} FAILED: ${result.error}`);

      // Always log failed emails — this is what shows in Follow-Up
      const sentId = await logEmail(service, {
        user_id: user.id,
        lead_id: lead?.id ?? null,
        to_email: to,
        subject,
        body: emailBody,
        status: "failed",
        bounce_reason: result.error ?? "Send failed",
      });

      console.log(`📝 Failed email logged: ${sentId ?? "FAILED TO LOG"}`);

      // Update lead status
      if (lead?.id) {
        await service.from("leads")
          .update({ status: "failed", updated_at: new Date().toISOString() })
          .eq("id", lead.id);
      }

      return NextResponse.json(
        { success: false, error: result.error || "Failed to send email" },
        { status: 500 }
      );
    }

    // Get smtp_account id
    let smtpAccountId: string | null = null;
    if (result.accountUsed) {
      const { data: smtpAcc } = await service
        .from("smtp_accounts")
        .select("id")
        .eq("email", result.accountUsed)
        .single();
      smtpAccountId = smtpAcc?.id ?? null;
    }

    // Tracking
    const trackingPixelId = randomUUID();
    const baseUrl = (
      process.env.NEXT_PUBLIC_APP_URL ||
      request.headers.get("origin") ||
      "http://localhost:3000"
    ).replace(/\/$/, "");
    const trackedBody = injectTracking(emailBody, trackingPixelId, baseUrl);

    // Log sent email
    const sentId = await logEmail(service, {
      user_id: user.id,
      lead_id: lead?.id ?? null,
      to_email: to,
      subject,
      body: trackedBody,
      status: "sent",
      tracking_pixel_id: trackingPixelId,
      smtp_account_id: smtpAccountId,
      campaign_id: campaignId,
    });

    if (!sentId) {
      console.error("⚠️ Email sent but not recorded in DB");
      return NextResponse.json({
        success: true,
        warning: "Email sent but not recorded. Run FIX_FOLLOWUP_AND_SENT_EMAILS.sql in Supabase.",
        accountUsed: result.accountUsed,
      } satisfies SendEmailResponse);
    }

    console.log(`✅ Email sent and recorded: ${sentId} → ${to}`);

    // Update lead status to contacted
    const leadToUpdate = lead ?? await (async () => {
      const { data } = await service
        .from("leads")
        .select("id, status")
        .eq("user_id", user.id)
        .eq("email", to)
        .maybeSingle();
      return data ?? null;
    })();

    if (leadToUpdate) {
      await service.from("leads").update({
        status: "contacted",
        updated_at: new Date().toISOString(),
        last_contacted_at: new Date().toISOString(),
      }).eq("id", leadToUpdate.id);

      if (leadToUpdate.status !== "contacted") {
        try {
          await service.from("lead_status_history").insert({
            lead_id: leadToUpdate.id,
            old_status: leadToUpdate.status,
            new_status: "contacted",
          });
        } catch {
          /* history row is optional */
        }
      }
    }

    return NextResponse.json({
      success: true,
      sentEmailId: sentId,
      accountUsed: result.accountUsed,
      leadId: leadToUpdate?.id ?? null,
    } satisfies SendEmailResponse);

  } catch (error) {
    console.error("[send-email] Unexpected error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
