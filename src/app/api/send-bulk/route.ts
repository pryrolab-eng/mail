import { NextRequest, NextResponse } from "next/server";
import { createClient } from "../../../../supabase/server";
import { createServiceClient } from "../../../../supabase/service";
import { SMTPManager } from "@/utils/smtp-server";

export interface BulkEmailItem {
  leadId: string;
  to: string;
  companyName: string;
  subject: string;
  body: string;
}

export interface SendBulkRequest {
  emails: BulkEmailItem[];
  /** Delay in ms between each send. Defaults to 1500. */
  delayMs?: number;
  /** Whether to verify email DNS before sending. Defaults to true. */
  verifyEmails?: boolean;
}

export interface SendBulkResponse {
  success: boolean;
  results?: {
    total: number;
    sent: number;
    failed: number;
    queued: number;
    errors: string[];
  };
  campaignId?: string;
  accountStats?: ReturnType<SMTPManager["getAccountStats"]>;
  error?: string;
}

/** Lightweight DNS-based email validation using Google's public DNS API */
async function verifyEmailDNS(email: string): Promise<boolean> {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) return false;

  const domain = email.split("@")[1];
  try {
    const res = await fetch(
      `https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=MX`,
      { signal: AbortSignal.timeout(4000) }
    );
    const data = await res.json();
    return Array.isArray(data?.Answer) && data.Answer.length > 0;
  } catch {
    // If DNS check fails, assume valid so we don't drop real emails
    return true;
  }
}

export async function POST(request: NextRequest) {
  try {
    // Authenticate
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

    const payload = (await request.json()) as SendBulkRequest;
    const {
      emails,
      delayMs = 1500,
      verifyEmails = true,
    } = payload;

    if (!Array.isArray(emails) || emails.length === 0) {
      return NextResponse.json(
        { success: false, error: "emails array is required and must not be empty" },
        { status: 400 }
      );
    }

    const serviceSupabase = createServiceClient();

    // Load SMTP accounts
    const smtpManager = new SMTPManager();
    await smtpManager.loadAccounts(user.id);

    const capacity = smtpManager.getTotalCapacity();
    if (capacity.remaining === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "All SMTP accounts have reached their daily limit. Try again tomorrow.",
        },
        { status: 429 }
      );
    }

    // Create a campaign record to group this batch
    const { data: campaign } = await serviceSupabase
      .from("email_campaigns")
      .insert({
        user_id: user.id,
        name: `Bulk Campaign — ${new Date().toLocaleString()}`,
        template_subject: emails[0]?.subject ?? "Bulk Email",
        template_body: "Personalized bulk emails",
        status: "active",
        total_recipients: emails.length,
      })
      .select("id")
      .single();

    const campaignId = campaign?.id ?? null;

    const results = {
      total: emails.length,
      sent: 0,
      failed: 0,
      queued: 0,
      errors: [] as string[],
    };

    for (const email of emails) {
      try {
        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email.to)) {
          results.failed++;
          results.errors.push(`${email.to}: invalid email format`);

          await serviceSupabase.from("email_queue").insert({
            user_id: user.id,
            campaign_id: campaignId,
            lead_id: email.leadId,
            recipient_email: email.to,
            recipient_name: email.companyName,
            subject: email.subject,
            body: email.body,
            status: "failed",
            error_message: "Invalid email format",
          });
          continue;
        }

        // Optional DNS verification
        if (verifyEmails) {
          const valid = await verifyEmailDNS(email.to);
          if (!valid) {
            results.failed++;
            results.errors.push(`${email.to}: failed DNS verification`);

            await serviceSupabase.from("email_queue").insert({
              user_id: user.id,
              campaign_id: campaignId,
              lead_id: email.leadId,
              recipient_email: email.to,
              recipient_name: email.companyName,
              subject: email.subject,
              body: email.body,
              status: "failed",
              error_message: "Failed DNS/MX verification",
            });
            continue;
          }
        }

        // Check remaining capacity before each send
        const currentCapacity = smtpManager.getTotalCapacity();
        if (currentCapacity.remaining === 0) {
          // Queue the rest for tomorrow
          await serviceSupabase.from("email_queue").insert({
            user_id: user.id,
            campaign_id: campaignId,
            lead_id: email.leadId,
            recipient_email: email.to,
            recipient_name: email.companyName,
            subject: email.subject,
            body: email.body,
            status: "pending",
            scheduled_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          });
          results.queued++;
          continue;
        }

        // Send
        const sendResult = await smtpManager.sendEmail(
          email.to,
          email.subject,
          email.body
        );

        if (sendResult.success) {
          results.sent++;

          // Resolve smtp_account id from the email address used
          let smtpAccountId: string | null = null;
          if (sendResult.accountUsed) {
            const { data: smtpAccount } = await serviceSupabase
              .from("smtp_accounts")
              .select("id")
              .eq("user_id", user.id)
              .eq("email", sendResult.accountUsed)
              .single();
            smtpAccountId = smtpAccount?.id ?? null;
          }

          // Log to email_queue
          await serviceSupabase.from("email_queue").insert({
            user_id: user.id,
            campaign_id: campaignId,
            lead_id: email.leadId,
            smtp_account_id: smtpAccountId,
            recipient_email: email.to,
            recipient_name: email.companyName,
            subject: email.subject,
            body: email.body,
            status: "sent",
            sent_at: new Date().toISOString(),
          });

          // Log to sent_emails
          await serviceSupabase.from("sent_emails").insert({
            user_id: user.id,
            lead_id: email.leadId,
            campaign_id: campaignId,
            subject: email.subject,
            body: email.body,
            sent_at: new Date().toISOString(),
            status: "sent",
          });

          // Update lead status to "Email Sent" if still "New"
          await serviceSupabase
            .from("leads")
            .update({ status: "Email Sent", updated_at: new Date().toISOString() })
            .eq("id", email.leadId)
            .eq("status", "New"); // Only update if still New
        } else {
          results.failed++;
          results.errors.push(`${email.to}: ${sendResult.error}`);

          await serviceSupabase.from("email_queue").insert({
            user_id: user.id,
            campaign_id: campaignId,
            lead_id: email.leadId,
            recipient_email: email.to,
            recipient_name: email.companyName,
            subject: email.subject,
            body: email.body,
            status: "failed",
            error_message: sendResult.error,
            retry_count: 0,
          });
        }

        // Throttle between sends
        if (delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      } catch (err) {
        results.failed++;
        const msg = err instanceof Error ? err.message : "Unknown error";
        results.errors.push(`${email.to}: ${msg}`);
      }
    }

    // Update campaign with final stats
    if (campaignId) {
      await serviceSupabase
        .from("email_campaigns")
        .update({
          sent_count: results.sent,
          status:
            results.sent === results.total
              ? "completed"
              : results.queued > 0
              ? "active"
              : "completed",
        })
        .eq("id", campaignId);
    }

    return NextResponse.json({
      success: true,
      results,
      campaignId,
      accountStats: smtpManager.getAccountStats(),
    } satisfies SendBulkResponse);
  } catch (error) {
    console.error("[/api/send-bulk] Unexpected error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}
