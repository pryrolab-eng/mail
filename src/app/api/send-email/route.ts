import { NextRequest, NextResponse } from "next/server";
import { createClient } from "../../../../supabase/server";
import { createServiceClient } from "../../../../supabase/service";
import { SMTPManager } from "@/utils/smtp-server";
import { randomUUID } from "crypto";
import { classifyBounce } from "@/types/platform";

export const runtime = "nodejs";

function injectTracking(body: string, pixelId: string, baseUrl: string): string {
  const base = baseUrl.replace(/\/$/, "");
  const pixel = `<img src="${base}/api/track/open/${pixelId}" width="1" height="1" style="display:none;border:0;" alt="" />`;
  const tracked = body.trimEnd() + "\n\n" + pixel;
  return tracked.replace(
    /href="(https?:\/\/[^"]+)"/gi,
    (_, url) => `href="${base}/api/track/click/${pixelId}?url=${encodeURIComponent(url)}"`
  );
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

    // Look up lead if leadId provided
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

    // Load SMTP and check capacity
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

    // Send the email
    const result = await smtpManager.sendEmail(to, subject, emailBody);

    if (!result.success) {
      // Log failed send — fire and forget, don't crash on DB errors
      try {
        await service.from("sent_emails").insert({
          user_id: user.id,
          lead_id: lead?.id ?? null,
          to_email: to,
          subject,
          body: emailBody,
          sent_at: new Date().toISOString(),
          status: "failed",
          bounce_reason: result.error ?? null,
        });
      } catch { /* non-critical */ }

      if (lead?.id) {
        try {
          await service.from("leads")
            .update({ status: "failed", updated_at: new Date().toISOString() })
            .eq("id", lead.id);
        } catch { /* non-critical */ }
      }

      return NextResponse.json(
        { success: false, error: result.error || "Failed to send email" },
        { status: 500 }
      );
    }

    // Get smtp_account id
    let smtpAccountId: string | null = null;
    if (result.accountUsed) {
      try {
        const { data } = await service
          .from("smtp_accounts")
          .select("id")
          .eq("user_id", user.id)
          .eq("email", result.accountUsed)
          .single();
        smtpAccountId = data?.id ?? null;
      } catch { /* non-critical */ }
    }

    // Build tracking
    const trackingPixelId = randomUUID();
    const baseUrl = (
      process.env.NEXT_PUBLIC_APP_URL ||
      request.headers.get("origin") ||
      "http://localhost:3000"
    ).replace(/\/$/, "");
    const trackedBody = injectTracking(emailBody, trackingPixelId, baseUrl);

    // Record sent email
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

    const { data: sentEmail, error: insertError } = await service
      .from("sent_emails")
      .insert(insertData)
      .select("id")
      .single();

    if (insertError) {
      console.error("Failed to log sent email:", insertError.message);
      return NextResponse.json({
        success: true,
        warning: "Email sent but not recorded. Run FIX_FOLLOWUP_AND_SENT_EMAILS.sql",
        accountUsed: result.accountUsed,
      } satisfies SendEmailResponse);
    }

    console.log("✓ Email sent:", { id: sentEmail?.id, to });

    // Update lead status to contacted
    const leadToUpdate = lead ?? await (async () => {
      try {
        const { data } = await service
          .from("leads")
          .select("id, status")
          .eq("user_id", user.id)
          .eq("email", to)
          .maybeSingle();
        return data;
      } catch { return null; }
    })();

    if (leadToUpdate) {
      try {
        await service.from("leads").update({
          status: "contacted",
          updated_at: new Date().toISOString(),
          last_contacted_at: new Date().toISOString(),
        }).eq("id", leadToUpdate.id);

        if (leadToUpdate.status !== "contacted") {
          await service.from("lead_status_history").insert({
            lead_id: leadToUpdate.id,
            old_status: leadToUpdate.status,
            new_status: "contacted",
          });
        }
      } catch { /* non-critical */ }
    }

    return NextResponse.json({
      success: true,
      sentEmailId: sentEmail?.id,
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
