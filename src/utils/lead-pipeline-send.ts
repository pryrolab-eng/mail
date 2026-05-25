/**
 * Pipeline Step 5: send drafted email via SMTP → sent_emails + pipeline_stage = sent.
 */

import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PipelineStage } from "@/types/platform";
import { SMTPManager } from "@/utils/smtp-server";
import { createServiceClient } from "../../supabase/service";

export type SendLeadEmailResult = {
  success: boolean;
  leadId: string;
  emailId: string;
  pipeline_stage: PipelineStage;
  sentEmailId?: string;
  accountUsed?: string;
  error?: string;
};

function plainTextToHtml(text: string): string {
  return text
    .trim()
    .split(/\n\n+/)
    .map(
      (para) =>
        `<p style="margin:0 0 14px 0;line-height:1.6;">${para
          .split("\n")
          .map((line) => line.trim())
          .join("<br>")}</p>`
    )
    .join("\n");
}

function injectTracking(body: string, pixelId: string, baseUrl: string): string {
  const base = baseUrl.replace(/\/$/, "");
  const pixel = `<img src="${base}/api/track/open/${pixelId}" width="1" height="1" style="display:none;border:0;" alt="" />`;
  if (/<html[\s>]/i.test(body)) {
    return body.replace(/<\/body>/i, `${pixel}</body>`);
  }
  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:600px;margin:0 auto;padding:20px;">
${plainTextToHtml(body)}
${pixel}
</body></html>`;
}

async function logSentEmail(
  service: ReturnType<typeof createServiceClient>,
  data: {
    user_id: string;
    lead_id: string;
    to_email: string;
    subject: string;
    body: string;
    status: "sent" | "failed";
    bounce_reason?: string | null;
    tracking_pixel_id?: string;
    smtp_account_id?: string | null;
  }
): Promise<string | null> {
  const insert: Record<string, string | null> = {
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

  const { data: row, error } = await service
    .from("sent_emails")
    .insert(insert)
    .select("id")
    .single();

  if (error) {
    console.error("[lead-pipeline-send] logSentEmail:", error.message);
    return null;
  }
  return row?.id ?? null;
}

async function markPipeline(
  service: ReturnType<typeof createServiceClient>,
  leadId: string,
  userId: string,
  stage: PipelineStage,
  pipelineError: string | null,
  extra?: { status?: string; last_contacted_at?: string }
): Promise<void> {
  const now = new Date().toISOString();
  await service
    .from("leads")
    .update({
      pipeline_stage: stage,
      pipeline_updated_at: now,
      pipeline_error: pipelineError,
      updated_at: now,
      ...(extra?.status ? { status: extra.status } : {}),
      ...(extra?.last_contacted_at
        ? { last_contacted_at: extra.last_contacted_at }
        : {}),
    })
    .eq("id", leadId)
    .eq("user_id", userId);
}

/**
 * Send a generated email for a lead (pipeline Step 5).
 */
export async function runSendEmailForLead(
  supabase: SupabaseClient,
  userId: string,
  leadId: string,
  emailId: string,
  options?: { appBaseUrl?: string }
): Promise<SendLeadEmailResult> {
  const service = createServiceClient();

  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("id, user_id, company_name, email, status, pipeline_stage")
    .eq("id", leadId)
    .eq("user_id", userId)
    .single();

  if (leadError || !lead) {
    return {
      success: false,
      leadId,
      emailId,
      pipeline_stage: "failed",
      error: leadError?.message ?? "Lead not found",
    };
  }

  const { data: draft, error: draftError } = await supabase
    .from("generated_emails")
    .select("id, subject, body, lead_id, user_id")
    .eq("id", emailId)
    .eq("lead_id", leadId)
    .eq("user_id", userId)
    .single();

  if (draftError || !draft) {
    return {
      success: false,
      leadId,
      emailId,
      pipeline_stage: "failed",
      error: draftError?.message ?? "Draft email not found for this lead",
    };
  }

  const to = lead.email?.trim();
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    const msg = "Lead has no valid recipient email address";
    await markPipeline(service, leadId, userId, "failed", msg);
    await logSentEmail(service, {
      user_id: userId,
      lead_id: leadId,
      to_email: to || "unknown",
      subject: draft.subject ?? "",
      body: draft.body ?? "",
      status: "failed",
      bounce_reason: msg,
    });
    return {
      success: false,
      leadId,
      emailId,
      pipeline_stage: "failed",
      error: msg,
    };
  }

  const subject = draft.subject?.trim();
  const emailBody = draft.body?.trim();
  if (!subject || !emailBody) {
    const msg = "Draft email is missing subject or body";
    await markPipeline(service, leadId, userId, "failed", msg);
    return {
      success: false,
      leadId,
      emailId,
      pipeline_stage: "failed",
      error: msg,
    };
  }

  const smtpManager = new SMTPManager();
  try {
    await smtpManager.loadAccounts(userId);
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : "Failed to load SMTP accounts";
    await markPipeline(service, leadId, userId, "failed", msg);
    return {
      success: false,
      leadId,
      emailId,
      pipeline_stage: "failed",
      error: msg,
    };
  }

  const capacity = smtpManager.getTotalCapacity();
  if (capacity.total === 0) {
    const msg = "No SMTP accounts configured. Add one in SMTP Manager.";
    await markPipeline(service, leadId, userId, "failed", msg);
    return {
      success: false,
      leadId,
      emailId,
      pipeline_stage: "failed",
      error: msg,
    };
  }

  if (capacity.remaining === 0) {
    const msg = "Daily sending limit reached on all SMTP accounts. Try again tomorrow.";
    await markPipeline(service, leadId, userId, "failed", msg);
    return {
      success: false,
      leadId,
      emailId,
      pipeline_stage: "failed",
      error: msg,
    };
  }

  const result = await smtpManager.sendEmail(to, subject, emailBody);

  if (!result.success) {
    const errMsg = result.error ?? "SMTP send failed";
    await logSentEmail(service, {
      user_id: userId,
      lead_id: leadId,
      to_email: to,
      subject,
      body: emailBody,
      status: "failed",
      bounce_reason: errMsg,
    });
    await markPipeline(service, leadId, userId, "failed", errMsg, {
      status: "failed",
    });
    return {
      success: false,
      leadId,
      emailId,
      pipeline_stage: "failed",
      error: errMsg,
    };
  }

  let smtpAccountId: string | null = null;
  if (result.accountUsed) {
    const { data: smtpAcc } = await service
      .from("smtp_accounts")
      .select("id")
      .eq("email", result.accountUsed)
      .maybeSingle();
    smtpAccountId = smtpAcc?.id ?? null;
  }

  const trackingPixelId = randomUUID();
  const baseUrl = (
    options?.appBaseUrl ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000"
  ).replace(/\/$/, "");
  const trackedBody = injectTracking(emailBody, trackingPixelId, baseUrl);

  const sentId = await logSentEmail(service, {
    user_id: userId,
    lead_id: leadId,
    to_email: to,
    subject,
    body: trackedBody,
    status: "sent",
    tracking_pixel_id: trackingPixelId,
    smtp_account_id: smtpAccountId,
  });

  const now = new Date().toISOString();
  await markPipeline(service, leadId, userId, "sent", null, {
    status: "Email Sent",
    last_contacted_at: now,
  });

  if (lead.status && lead.status !== "Email Sent" && lead.status !== "contacted") {
    try {
      await service.from("lead_status_history").insert({
        lead_id: leadId,
        old_status: lead.status,
        new_status: "Email Sent",
      });
    } catch {
      /* history row is optional */
    }
  }

  return {
    success: true,
    leadId,
    emailId,
    pipeline_stage: "sent",
    sentEmailId: sentId ?? undefined,
    accountUsed: result.accountUsed,
    ...(sentId ? {} : { error: "Email sent but not recorded in sent_emails" }),
  };
}
