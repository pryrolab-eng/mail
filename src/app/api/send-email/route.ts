import { NextRequest, NextResponse } from "next/server";
import { createClient } from "../../../../supabase/server";
import { createServiceClient } from "../../../../supabase/service";
import { SMTPManager } from "@/utils/smtp-server";

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
  error?: string;
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
        { success: false, error: "Invalid recipient email address" },
        { status: 400 }
      );
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
        return NextResponse.json(
          { success: false, error: "Lead not found or access denied" },
          { status: 404 }
        );
      }
      lead = leadData;
    }

    // Load SMTP accounts and send
    const smtpManager = new SMTPManager();
    await smtpManager.loadAccounts(user.id);

    const capacity = smtpManager.getTotalCapacity();
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

    // Record the sent email
    const { data: sentEmail, error: insertError } = await serviceSupabase
      .from("sent_emails")
      .insert({
        user_id: user.id,
        lead_id: leadId ?? null,
        campaign_id: campaignId ?? null,
        subject,
        body: emailBody,
        sent_at: new Date().toISOString(),
        status: "sent",
      })
      .select("id")
      .single();

    if (insertError) {
      // Email was sent but we failed to log it — not a fatal error
      console.error("Failed to log sent email:", insertError);
    }

    // Update lead status to "Email Sent" if it's still "New" (only when a lead is linked)
    if (lead && lead.status === "New") {
      await serviceSupabase
        .from("leads")
        .update({ status: "Email Sent", updated_at: new Date().toISOString() })
        .eq("id", lead.id);

      // Log status history
      await serviceSupabase.from("lead_status_history").insert({
        lead_id: lead.id,
        old_status: lead.status,
        new_status: "Email Sent",
      });
    }

    return NextResponse.json({
      success: true,
      sentEmailId: sentEmail?.id,
      accountUsed: result.accountUsed,
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
