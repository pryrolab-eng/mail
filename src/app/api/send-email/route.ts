import { NextRequest, NextResponse } from "next/server";
import { createClient } from "../../../../supabase/server";
import { createServiceClient } from "../../../../supabase/service";
import { SMTPManager } from "@/utils/smtp-server";
import { randomUUID } from "crypto";
import { classifyBounce } from "@/types/platform";

// nodemailer requires the Node.js runtime (not Edge)
export const runtime = "nodejs";

/** Inject tracking pixel and wrap links for click tracking */
function injectTracking(body: string, pixelId: string, baseUrl: string): string {
  // Ensure baseUrl has no trailing slash
  const base = baseUrl.replace(/\/$/, "");

  // 1×1 pixel — path param format matching /api/track/open/[pixelId]
  const pixelUrl = `${base}/api/track/open/${pixelId}`;
  const pixel = `<img src="${pixelUrl}" width="1" height="1" style="display:none;border:0;outline:none;" alt="" />`;

  // Append pixel at the end of the body (works for plain text and HTML)
  const tracked = body.trimEnd() + "\n\n" + pixel;

  // Wrap http/https links for click tracking — path param format
  return tracked.replace(
    /href="(https?:\/\/[^"]+)"/gi,
    (_, url) => `href="${base}/api/track/click/${pixelId}?url=${encodeURIComponent(url)}"`
  );
}

export interface SendEmailRequest {
  leadId?: string;  // Optional — not required for manual sends
  to: string;
  subject: string;
  body: string;
  /** Optional — if provided, the sent email is linked to this campaign */
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

export async function POST(request: NextRequest) {
  try {
    // Authenticate the request
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = (await request.json()) as SendEmailRequest;
    const { leadId, to, subject, body: emailBody, campaignId } = body;

    // Validate required fields
    if (!to || !subject || !emailBody) {
      return NextResponse.json(
        { success: false, error: "Missing required fields: to, subject, body" },
        { status: 400 }
      );
    }

    // Basic email format check
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(to)) {
      return NextResponse.json(
        { success: false, error: "Invalid recipient email address format" },
        { status: 400 }
      );
    }
    
    // Warn about common fake email patterns
    const domain = to.split('@')[1];
    const isSuspiciousEmail = 
      to.startsWith('info@') || 
      to.startsWith('contact@') || 
      to.startsWith('hello@') ||
      to.startsWith('support@');
    
    if (isSuspiciousEmail) {
      console.warn(`⚠️  Sending to potentially generated email: ${to}`);
      console.warn(`   Domain: ${domain} - This might bounce if the domain doesn't exist`);
    }

    // If leadId provided, verify the lead belongs to this user
    const serviceSupabase = createServiceClient();
    let lead: { id: string; company_name: string; status: string } | null = null;

    if (leadId) {
      const { data: leadData, error: leadError } = await serviceSupabase
        .from("leads")
        .select("id, company_name, status")
        .eq("id", leadId)
        .eq("user_id", user.id)
        .single();

      if (leadError || !leadData) {
        // Lead not found — log it but don't block the send.
        // This happens when the lead hasn't been saved to the DB yet
        // (e.g. sending directly from scraper results before "Add to CRM").
        console.warn(`[send-email] leadId ${leadId} not found for user ${user.id} — sending without lead link`);
      } else {
        lead = leadData;
      }
    }

    // Load SMTP accounts and send
    const smtpManager = new SMTPManager();
    
    try {
      await smtpManager.loadAccounts(user.id);
    } catch (loadError) {
      console.error('Failed to load SMTP accounts:', loadError);
      return NextResponse.json(
        {
          success: false,
          error: "Failed to load SMTP accounts: " + (loadError instanceof Error ? loadError.message : String(loadError)),
        },
        { status: 500 }
      );
    }

    const capacity = smtpManager.getTotalCapacity();
    
    console.log('SMTP capacity:', capacity);
    
    if (capacity.total === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "No SMTP accounts configured. Add one in SMTP Manager.",
        },
        { status: 400 }
      );
    }
    
    if (capacity.remaining === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "All SMTP accounts have reached their daily sending limit. Try again tomorrow.",
        },
        { status: 429 }
      );
    }

    const result = await smtpManager.sendEmail(to, subject, emailBody);

    if (!result.success) {
      // Classify the bounce/failure type
      const bounceType = classifyBounce(result.error || '');

      // Log failed email — try full insert first, fallback to minimal
      const serviceSupabase2 = createServiceClient();
      const failedInsert = await serviceSupabase2.from('sent_emails').insert({
        user_id: user.id,
        lead_id: lead?.id ?? null,
        to_email: to,
        subject,
        body: emailBody,
        sent_at: new Date().toISOString(),
        status: 'failed',
        bounce_reason: result.error,
      });
      if (failedInsert.error) {
        console.error("Failed to log failed email:", failedInsert.error.message);
      }

      // Update lead status to 'failed'
      if (lead?.id) {
        await serviceSupabase2.from('leads')
          .update({ status: 'failed', updated_at: new Date().toISOString() })
          .eq('id', lead.id).catch(() => {});
      }

      // Create notification
      await serviceSupabase2.from('notifications').insert({
        user_id: user.id,
        type: 'failed_email',
        title: 'Email Failed to Send',
        message: `Failed to send to ${to}: ${result.error}`,
        data: { to, error: result.error, bounceType },
      }).catch(() => {});

      return NextResponse.json(
        { success: false, error: result.error || "Failed to send email" },
        { status: 500 }
      );
    }

    // Look up the smtp_account id from the email address that was used
    let smtpAccountId: string | null = null;
    if (result.accountUsed) {
      const { data: smtpAccount } = await serviceSupabase
        .from("smtp_accounts")
        .select("id")
        .eq("user_id", user.id)
        .eq("email", result.accountUsed)
        .single();
      smtpAccountId = smtpAccount?.id ?? null;
    }

    // Record the sent email with tracking
    const trackingPixelId = randomUUID();
    // Use NEXT_PUBLIC_APP_URL env var — must be set to your deployed domain
    // e.g. https://yourapp.vercel.app or http://localhost:3000 for dev
    const baseUrl = (
      process.env.NEXT_PUBLIC_APP_URL ||
      request.headers.get("origin") ||
      request.headers.get("x-forwarded-host") && `https://${request.headers.get("x-forwarded-host")}` ||
      "http://localhost:3000"
    ).replace(/\/$/, "");

    const trackedBody = injectTracking(emailBody, trackingPixelId, baseUrl);

    // Build insert — use service client so RLS doesn't block it
    const insertData: Record<string, any> = {
      user_id: user.id,
      lead_id: lead?.id ?? null,
      to_email: to,
      subject,
      body: trackedBody,
      sent_at: new Date().toISOString(),
      status: "sent",
      tracking_pixel_id: trackingPixelId,
    };
    if (smtpAccountId) insertData.smtp_account_id = smtpAccountId;
    if (campaignId) insertData.campaign_id = campaignId;

    const { data: sentEmail, error: insertError } = await serviceSupabase
      .from("sent_emails")
      .insert(insertData)
      .select("id")
      .single();

    if (insertError) {
      console.error("❌ Failed to log sent email:", insertError.message, insertError.hint);
      // Email was sent — return success but warn
      return NextResponse.json({
        success: true,
        warning: `Email sent to ${to} but not recorded. Run FIX_FOLLOWUP_AND_SENT_EMAILS.sql in Supabase.`,
        accountUsed: result.accountUsed,
      } satisfies SendEmailResponse);
    }

    console.log("✓ Email sent and recorded:", { sentEmailId: sentEmail?.id, to });

    // Update lead status to "contacted" — always, regardless of current status
    const leadToUpdate = lead ?? await (async () => {
      const { data } = await serviceSupabase
        .from("leads")
        .select("id, status")
        .eq("user_id", user.id)
        .eq("email", to)
        .maybeSingle();
      return data;
    })();

    if (leadToUpdate) {
      const prevStatus = leadToUpdate.status;
      await serviceSupabase
        .from("leads")
        .update({ status: "contacted", updated_at: new Date().toISOString(), last_contacted_at: new Date().toISOString() })
        .eq("id", leadToUpdate.id);

      // Log status history only if status actually changed
      if (prevStatus !== "contacted") {
        await serviceSupabase.from("lead_status_history").insert({
          lead_id: leadToUpdate.id,
          old_status: prevStatus,
          new_status: "contacted",
        }).catch(() => {}); // non-critical
      }
    }

    return NextResponse.json({
      success: true,
      sentEmailId: sentEmail?.id,
      accountUsed: result.accountUsed,
      leadId: leadToUpdate?.id ?? null,
    } satisfies SendEmailResponse);
  } catch (error) {
    console.error("[/api/send-email] Unexpected error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}
