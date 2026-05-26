import type { SupabaseClient } from "@supabase/supabase-js";
import type { PipelineStage } from "@/types/platform";
import {
  getOrCreateAutomationSettings,
  nextSendWindowStart,
  randomizedSendDelayMs,
} from "@/utils/automation-settings";

export type AutomationJobType =
  | "agent_discover"
  | "research_lead"
  | "score_lead"
  | "generate_draft"
  | "send_approved_email"
  | "process_followups"
  | "check_inbox";

export async function enqueueAutomationJob(
  supabase: SupabaseClient,
  userId: string,
  jobType: AutomationJobType,
  payload: Record<string, unknown>,
  scheduledAt = new Date()
): Promise<string> {
  const { data, error } = await supabase
    .from("automation_jobs")
    .insert({
      user_id: userId,
      job_type: jobType,
      payload,
      scheduled_at: scheduledAt.toISOString(),
      status: "pending",
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  return data.id as string;
}

export async function markLeadStage(
  supabase: SupabaseClient,
  userId: string,
  leadId: string,
  stage: PipelineStage,
  error: string | null = null
): Promise<void> {
  const now = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("leads")
    .update({
      pipeline_stage: stage,
      pipeline_updated_at: now,
      pipeline_error: error,
      updated_at: now,
    })
    .eq("id", leadId)
    .eq("user_id", userId);

  if (updateError) throw new Error(updateError.message);
}

export async function approveDraftsForQueue(
  supabase: SupabaseClient,
  userId: string,
  leadIds: string[]
): Promise<{ approved: number; queued: number; errors: string[] }> {
  const settings = await getOrCreateAutomationSettings(supabase, userId);
  const result = { approved: 0, queued: 0, errors: [] as string[] };

  for (const leadId of leadIds) {
    try {
      const { data: lead, error: leadError } = await supabase
        .from("leads")
        .select(
          "id, company_name, email, automation_score, email_confidence, pipeline_stage"
        )
        .eq("id", leadId)
        .eq("user_id", userId)
        .single();

      if (leadError || !lead) throw new Error(leadError?.message ?? "Lead not found");
      if (!lead.email?.trim()) throw new Error("Lead has no recipient email");

      const { count: suppressed } = await supabase
        .from("email_suppression_list")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("email", lead.email.toLowerCase());
      if ((suppressed ?? 0) > 0) throw new Error("Recipient is suppressed");

      const { data: draft, error: draftError } = await supabase
        .from("generated_emails")
        .select("id, subject, body")
        .eq("lead_id", leadId)
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (draftError || !draft) {
        throw new Error(draftError?.message ?? "No generated draft found");
      }
      if (!draft.subject?.trim() || !draft.body?.trim()) {
        throw new Error("Draft is missing subject or body");
      }

      const now = new Date();
      const scheduled = nextSendWindowStart(
        new Date(now.getTime() + randomizedSendDelayMs()),
        settings
      );

      const { error: queueError } = await supabase.from("email_queue").insert({
        user_id: userId,
        lead_id: leadId,
        recipient_email: lead.email,
        recipient_name: lead.company_name,
        subject: draft.subject,
        body: draft.body,
        status: "pending",
        scheduled_at: scheduled.toISOString(),
      });
      if (queueError) throw new Error(queueError.message);

      await supabase
        .from("generated_emails")
        .update({
          approval_status: "approved",
          approved_at: new Date().toISOString(),
          approved_by: userId,
          ai_score: lead.automation_score ?? null,
        })
        .eq("id", draft.id)
        .eq("user_id", userId);

      await markLeadStage(supabase, userId, leadId, "queued");
      await enqueueAutomationJob(
        supabase,
        userId,
        "send_approved_email",
        { leadId, emailQueueId: null },
        scheduled
      );
      result.approved++;
      result.queued++;
    } catch (err) {
      result.errors.push(
        `${leadId}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return result;
}

export async function rejectDrafts(
  supabase: SupabaseClient,
  userId: string,
  leadIds: string[],
  reason: string
): Promise<{ rejected: number; errors: string[] }> {
  const result = { rejected: 0, errors: [] as string[] };
  for (const leadId of leadIds) {
    try {
      await supabase
        .from("generated_emails")
        .update({
          approval_status: "rejected",
          rejected_at: new Date().toISOString(),
          rejection_reason: reason,
        })
        .eq("lead_id", leadId)
        .eq("user_id", userId);

      await supabase
        .from("leads")
        .update({
          pipeline_stage: "completed",
          pipeline_updated_at: new Date().toISOString(),
          automation_rejected_reason: reason,
          updated_at: new Date().toISOString(),
        })
        .eq("id", leadId)
        .eq("user_id", userId);
      result.rejected++;
    } catch (err) {
      result.errors.push(
        `${leadId}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  return result;
}
