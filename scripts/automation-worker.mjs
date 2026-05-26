import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

const root = process.cwd();
loadEnv(path.join(root, ".env"));

const once = process.argv.includes("--once");
const workerId = `${os.hostname()}-${process.pid}`;
const pollMs = Number(process.env.AUTOMATION_WORKER_POLL_MS ?? 15_000);

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_KEY;
if (!supabaseUrl || !serviceKey) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_KEY are required.");
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const idx = trimmed.indexOf("=");
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function log(...args) {
  console.log(new Date().toISOString(), "[worker]", ...args);
}

function plainTextToHtml(text) {
  if (/<html[\s>]/i.test(text)) return text;
  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:600px;margin:0 auto;padding:20px;">
${String(text)
  .trim()
  .split(/\n\n+/)
  .map(
    (para) =>
      `<p style="margin:0 0 14px 0;line-height:1.6;">${para
        .split("\n")
        .map((line) => line.trim())
        .join("<br>")}</p>`
  )
  .join("\n")}
</body></html>`;
}

function withTracking(body, pixelId) {
  const appUrl = (
    process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
  ).replace(/\/$/, "");
  const pixel = `<img src="${appUrl}/api/track/open/${pixelId}" width="1" height="1" style="display:none;border:0;" alt="" />`;
  const html = plainTextToHtml(body);
  return html.replace(/<\/body>/i, `${pixel}</body>`);
}

function localTimeMinutes(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  return (
    Number(parts.find((p) => p.type === "hour")?.value ?? 0) * 60 +
    Number(parts.find((p) => p.type === "minute")?.value ?? 0)
  );
}

function timeMinutes(value) {
  const [h, m] = String(value).split(":").map((n) => Number.parseInt(n, 10));
  return (Number.isFinite(h) ? h : 9) * 60 + (Number.isFinite(m) ? m : 0);
}

function withinSendWindow(settings) {
  const now = localTimeMinutes(new Date(), settings.timezone);
  return (
    now >= timeMinutes(settings.send_window_start) &&
    now < timeMinutes(settings.send_window_end)
  );
}

async function getSettings(userId) {
  const { data } = await supabase
    .from("automation_settings")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (data) return data;
  const { data: inserted, error } = await supabase
    .from("automation_settings")
    .insert({ user_id: userId })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return inserted;
}

async function claimJob() {
  const { data: jobs, error } = await supabase
    .from("automation_jobs")
    .select("*")
    .eq("status", "pending")
    .lte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(1);
  if (error) throw new Error(error.message);
  const job = jobs?.[0];
  if (!job) return null;

  const { data: claimed, error: claimError } = await supabase
    .from("automation_jobs")
    .update({
      status: "running",
      started_at: new Date().toISOString(),
      locked_at: new Date().toISOString(),
      locked_by: workerId,
      attempts: (job.attempts ?? 0) + 1,
    })
    .eq("id", job.id)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();
  if (claimError) throw new Error(claimError.message);
  return claimed;
}

async function completeJob(job) {
  await supabase
    .from("automation_jobs")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("id", job.id);
}

async function failJob(job, error) {
  const message = error instanceof Error ? error.message : String(error);
  const retry = (job.attempts ?? 1) < (job.max_attempts ?? 5);
  await supabase
    .from("automation_jobs")
    .update({
      status: retry ? "pending" : "failed",
      scheduled_at: new Date(Date.now() + Math.min(60_000 * 2 ** (job.attempts ?? 1), 900_000)).toISOString(),
      last_error: message.slice(0, 1000),
      locked_at: null,
      locked_by: null,
    })
    .eq("id", job.id);
}

async function loadSmtpAccount(userId, perAccountLimit) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  await supabase
    .from("smtp_accounts")
    .update({ sent_today: 0, last_reset: new Date().toISOString(), status: "active" })
    .eq("user_id", userId)
    .lt("last_reset", today.toISOString());

  const { data, error } = await supabase
    .from("smtp_accounts")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "active")
    .lt("sent_today", perAccountLimit)
    .order("sent_today", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function sendQueuedEmail(userId, leadId = null) {
  const settings = await getSettings(userId);
  if (!settings.worker_enabled) return;
  if (!withinSendWindow(settings)) {
    log("outside send window, leaving queue pending");
    return;
  }

  let query = supabase
    .from("email_queue")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "pending")
    .lte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(1);
  if (leadId) query = query.eq("lead_id", leadId);
  const { data: queueRows, error } = await query;
  if (error) throw new Error(error.message);
  const queued = queueRows?.[0];
  if (!queued) return;

  const { count: sentToday } = await supabase
    .from("sent_emails")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("sent_at", new Date(new Date().setHours(0, 0, 0, 0)).toISOString())
    .eq("status", "sent");
  if ((sentToday ?? 0) >= settings.daily_send_limit) {
    await supabase
      .from("email_queue")
      .update({
        scheduled_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      })
      .eq("id", queued.id);
    return;
  }

  const suppressed = await supabase
    .from("email_suppression_list")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("email", String(queued.recipient_email).toLowerCase());
  if ((suppressed.count ?? 0) > 0) {
    await supabase
      .from("email_queue")
      .update({ status: "failed", error_message: "Recipient suppressed" })
      .eq("id", queued.id);
    return;
  }

  const account = await loadSmtpAccount(userId, settings.per_account_daily_limit);
  if (!account) {
    log("no Gmail capacity available");
    return;
  }

  const transporter = nodemailer.createTransport({
    host: account.host,
    port: account.port,
    secure: account.port === 465,
    auth: { user: account.user_name || account.email, pass: account.password },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });

  const pixelId = randomUUID();
  const html = withTracking(queued.body, pixelId);
  try {
    const info = await transporter.sendMail({
      from: `"${account.sender_name || account.email.split("@")[0]}" <${account.email}>`,
      to: queued.recipient_email,
      subject: queued.subject,
      html,
      text: String(queued.body).replace(/<[^>]*>/g, ""),
    });

    await supabase.from("sent_emails").insert({
      user_id: userId,
      lead_id: queued.lead_id,
      campaign_id: queued.campaign_id,
      smtp_account_id: account.id,
      to_email: queued.recipient_email,
      subject: queued.subject,
      body: html,
      status: "sent",
      sent_at: new Date().toISOString(),
      tracking_pixel_id: pixelId,
      smtp_message_id: info.messageId ?? null,
    });

    await supabase
      .from("email_queue")
      .update({
        status: "sent",
        sent_at: new Date().toISOString(),
        smtp_account_id: account.id,
      })
      .eq("id", queued.id);

    await supabase
      .from("smtp_accounts")
      .update({ sent_today: (account.sent_today ?? 0) + 1 })
      .eq("id", account.id);

    if (queued.lead_id) {
      await supabase
        .from("leads")
        .update({
          pipeline_stage: "sent",
          status: "contacted",
          last_contacted_at: new Date().toISOString(),
          pipeline_updated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", queued.lead_id)
        .eq("user_id", userId);
      await supabase
        .from("generated_emails")
        .update({ approval_status: "sent" })
        .eq("lead_id", queued.lead_id)
        .eq("user_id", userId);
    }
    log("sent", queued.recipient_email, "via", account.email);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await supabase
      .from("email_queue")
      .update({ status: "failed", error_message: msg })
      .eq("id", queued.id);
    if (queued.lead_id) {
      await supabase
        .from("leads")
        .update({
          pipeline_stage: "failed",
          pipeline_error: msg,
          updated_at: new Date().toISOString(),
        })
        .eq("id", queued.lead_id)
        .eq("user_id", userId);
    }
    throw err;
  }
}

async function scoreLead(job) {
  const leadId = job.payload?.leadId;
  if (!leadId) throw new Error("score_lead requires payload.leadId");
  const { data: lead, error } = await supabase
    .from("leads")
    .select("*")
    .eq("id", leadId)
    .eq("user_id", job.user_id)
    .single();
  if (error || !lead) throw new Error(error?.message ?? "Lead not found");

  const score =
    lead.email_confidence === "high"
      ? 82
      : lead.email_confidence === "medium"
        ? 70
        : lead.email
          ? 55
          : 25;
  await supabase
    .from("leads")
    .update({
      automation_score: score,
      automation_fit_reason:
        "Worker heuristic score. Use Generate/AI scoring in the app for richer Groq scoring.",
      automation_risk: score >= 70 ? "low" : "medium",
      automation_recommended_action: score >= 70 ? "draft" : "review",
      automation_review_required: true,
      automation_last_scored_at: new Date().toISOString(),
      pipeline_stage: score >= 70 ? "verified" : "approval_pending",
      pipeline_updated_at: new Date().toISOString(),
    })
    .eq("id", leadId)
    .eq("user_id", job.user_id);
}

async function callGroq(userId, system, prompt, maxTokens = 700) {
  const { data: provider, error } = await supabase
    .from("ai_settings")
    .select("provider, api_key, active_model")
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!provider?.api_key) throw new Error("No active AI provider configured");
  if (!["groq", "openai"].includes(provider.provider)) {
    throw new Error("Worker draft generation supports Groq/OpenAI-compatible providers in free v1");
  }
  const url =
    provider.provider === "openai"
      ? "https://api.openai.com/v1/chat/completions"
      : "https://api.groq.com/openai/v1/chat/completions";
  const model =
    provider.active_model ||
    (provider.provider === "groq" ? "llama-3.1-8b-instant" : "gpt-4o-mini");
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${provider.api_key}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      temperature: 0.55,
      max_tokens: maxTokens,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`AI draft failed ${res.status}: ${text.slice(0, 180)}`);
  }
  const data = await res.json();
  return {
    text: data.choices[0].message.content,
    model,
  };
}

function parseDraft(raw, companyName) {
  const cleaned = String(raw).replace(/```json|```/gi, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    return {
      subject: String(parsed.subject || `Quick idea for ${companyName}`).trim(),
      body: String(parsed.body || "").trim(),
    };
  } catch {
    const subjectMatch = cleaned.match(/^subject:\s*(.+)$/im);
    const body = cleaned.replace(/^subject:\s*.+$/im, "").trim();
    return {
      subject: subjectMatch?.[1]?.trim() || `Quick idea for ${companyName}`,
      body,
    };
  }
}

async function generateDraft(job) {
  const leadId = job.payload?.leadId;
  if (!leadId) throw new Error("generate_draft requires payload.leadId");
  const { data: lead, error } = await supabase
    .from("leads")
    .select("*")
    .eq("id", leadId)
    .eq("user_id", job.user_id)
    .single();
  if (error || !lead) throw new Error(error?.message ?? "Lead not found");
  if (!lead.email) throw new Error("Lead has no email");
  if ((lead.automation_score ?? 0) < 70) {
    throw new Error("Lead score is below v1 draft threshold");
  }

  const system =
    "You write concise B2B cold outreach emails for Pryro. Return ONLY JSON with subject and body. No markdown.";
  const prompt = `Lead:
Company: ${lead.company_name}
Email: ${lead.email}
Industry: ${lead.niche ?? "unknown"}
Location: ${lead.location ?? "unknown"}
Context: ${(lead.company_context ?? "").slice(0, 1800)}
AI score reason: ${lead.automation_fit_reason ?? ""}

Write a personalized email under 140 words. Mention one relevant operational pain point. Ask for a short call.`;
  const { text, model } = await callGroq(job.user_id, system, prompt);
  const draft = parseDraft(text, lead.company_name);
  if (!draft.subject || !draft.body) throw new Error("AI returned empty draft");

  const { data: saved, error: insertError } = await supabase
    .from("generated_emails")
    .insert({
      user_id: job.user_id,
      lead_id: leadId,
      subject: draft.subject,
      body: draft.body,
      tone: "Direct",
      model_used: model,
      approval_status: "pending",
      ai_score: lead.automation_score ?? null,
      ai_score_reason: lead.automation_fit_reason ?? null,
    })
    .select("id")
    .single();
  if (insertError) throw new Error(insertError.message);

  await supabase
    .from("leads")
    .update({
      pipeline_stage: "approval_pending",
      pipeline_updated_at: new Date().toISOString(),
      pipeline_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", leadId)
    .eq("user_id", job.user_id);
  log("drafted", lead.email, saved.id);
}

async function triggerLocal(pathname, method = "GET") {
  const secret = process.env.CRON_SECRET;
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
  if (!secret) {
    log("CRON_SECRET missing, skipping", pathname);
    return;
  }
  const res = await fetch(`${appUrl}${pathname}`, {
    method,
    headers: { authorization: `Bearer ${secret}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${pathname} failed ${res.status}: ${text.slice(0, 200)}`);
  }
}

async function handleJob(job) {
  if (job.job_type === "send_approved_email") {
    await sendQueuedEmail(job.user_id, job.payload?.leadId ?? null);
  } else if (job.job_type === "score_lead") {
    await scoreLead(job);
  } else if (job.job_type === "process_followups") {
    await triggerLocal("/api/followup/process", "GET");
  } else if (job.job_type === "check_inbox") {
    await triggerLocal("/api/inbox/check", "GET");
  } else if (job.job_type === "generate_draft") {
    await generateDraft(job);
  } else {
    throw new Error(`Unknown job type: ${job.job_type}`);
  }
}

async function tick() {
  const job = await claimJob();
  if (!job) {
    await sendDueQueues();
    return false;
  }
  log("claimed", job.job_type, job.id);
  try {
    await handleJob(job);
    await completeJob(job);
  } catch (err) {
    log("job failed", job.id, err instanceof Error ? err.message : err);
    await failJob(job, err);
  }
  return true;
}

async function sendDueQueues() {
  const { data: users } = await supabase
    .from("email_queue")
    .select("user_id")
    .eq("status", "pending")
    .lte("scheduled_at", new Date().toISOString())
    .limit(10);
  const uniqueUsers = [...new Set((users ?? []).map((r) => r.user_id))];
  for (const userId of uniqueUsers) {
    await sendQueuedEmail(userId);
  }
}

log("started", once ? "(once)" : `(poll ${pollMs}ms)`);
do {
  await tick();
  if (!once) await new Promise((r) => setTimeout(r, pollMs));
} while (!once);
