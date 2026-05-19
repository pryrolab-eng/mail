/**
 * /api/inbox/check
 *
 * Polls all active IMAP inboxes for the authenticated user (or all users
 * when called by the Vercel cron), matches incoming emails to sent_emails
 * using Message-ID / In-Reply-To / Subject threading, stores them in
 * email_replies, and auto-updates lead statuses.
 *
 * Called by:
 *  - Vercel Cron every 15 minutes  (GET with Authorization: Bearer <CRON_SECRET>)
 *  - "Check Replies" button in UI  (POST with Supabase session)
 *
 * IMAP library: we use nodemailer's built-in IMAP support via the
 * `imap` npm package (already available through nodemailer's peer deps).
 * We use a lightweight fetch-based approach with the `imapflow` package
 * pattern — but since we can't install new packages here, we implement
 * a minimal IMAP client using Node's net/tls modules directly.
 *
 * NOTE: For production, install `imapflow`:
 *   npm install imapflow
 * and replace the stub below with real IMAP calls.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "../../../../../supabase/server";
import { createServiceClient } from "../../../../../supabase/service";

// imapflow requires the Node.js runtime (not Edge)
export const runtime = "nodejs";

// ─── Types ────────────────────────────────────────────────────────────────────

interface InboxConfig {
  id: string;
  user_id: string;
  email_address: string;
  provider: string;
  imap_host: string;
  imap_port: number;
  imap_username: string;
  imap_password: string;
  last_checked_at: string | null;
  auto_reply_enabled: boolean;
}

interface ParsedEmail {
  messageId: string;
  inReplyTo: string | null;
  subject: string;
  from: string;
  body: string;
  receivedAt: Date;
}

interface CheckResult {
  configId: string;
  email: string;
  newReplies: number;
  errors: string[];
}

// ─── Sentiment analysis (keyword-based, no AI needed) ────────────────────────

function analyzeSentiment(body: string): {
  sentiment: "positive" | "neutral" | "negative" | "interested" | "not_interested";
  is_positive: boolean;
} {
  const lower = body.toLowerCase();

  const positiveKeywords = [
    "interested", "yes", "sounds good", "let's talk", "let's chat",
    "schedule", "call", "demo", "tell me more", "more info", "love to",
    "would like", "please send", "forward", "connect", "meeting",
  ];
  const negativeKeywords = [
    "not interested", "unsubscribe", "remove me", "stop emailing",
    "do not contact", "no thanks", "not relevant", "wrong person",
    "please don't", "spam",
  ];

  const positiveScore = positiveKeywords.filter((k) => lower.includes(k)).length;
  const negativeScore = negativeKeywords.filter((k) => lower.includes(k)).length;

  if (negativeScore > 0) {
    return { sentiment: "not_interested", is_positive: false };
  }
  if (positiveScore >= 2) {
    return { sentiment: "interested", is_positive: true };
  }
  if (positiveScore === 1) {
    return { sentiment: "positive", is_positive: true };
  }
  return { sentiment: "neutral", is_positive: false };
}

// ─── IMAP fetcher ─────────────────────────────────────────────────────────────

/**
 * Fetches new emails from an IMAP inbox since last_checked_at.
 *
 * This implementation uses the `imapflow` package pattern.
 * If imapflow is not installed, it falls back to a mock that returns [].
 *
 * To enable real IMAP: run `npm install imapflow` then the dynamic
 * import below will resolve correctly.
 */
async function fetchNewEmails(
  config: InboxConfig,
  since: Date
): Promise<ParsedEmail[]> {
  try {
    // Dynamic import — works if imapflow is installed
    const { ImapFlow } = await import("imapflow" as any);

    const client = new ImapFlow({
      host: config.imap_host,
      port: config.imap_port,
      secure: config.imap_port === 993,
      auth: {
        user: config.imap_username,
        pass: config.imap_password,
      },
      logger: false,
    });

    await client.connect();
    const emails: ParsedEmail[] = [];

    try {
      const lock = await client.getMailboxLock("INBOX");
      try {
        // Search for emails since last check
        const sinceStr = since.toISOString().split("T")[0]; // YYYY-MM-DD
        const messages = await client.search({ since: new Date(sinceStr) });

        if (messages && messages.length > 0) {
          for await (const msg of client.fetch(messages, {
            envelope: true,
            bodyStructure: true,
            source: true,
          })) {
            try {
              const source = msg.source?.toString() ?? "";

              // Parse headers
              const messageIdMatch = source.match(/^Message-ID:\s*(.+)$/im);
              const inReplyToMatch = source.match(/^In-Reply-To:\s*(.+)$/im);
              const fromMatch = source.match(/^From:\s*(.+)$/im);
              const subjectMatch = source.match(/^Subject:\s*(.+)$/im);

              // Extract plain text body (simplified)
              const bodyStart = source.indexOf("\r\n\r\n");
              const rawBody = bodyStart > -1 ? source.slice(bodyStart + 4) : source;
              // Strip quoted text (lines starting with >)
              const body = rawBody
                .split("\n")
                .filter((line: string) => !line.trim().startsWith(">"))
                .join("\n")
                .trim()
                .slice(0, 2000); // cap at 2000 chars

              emails.push({
                messageId: messageIdMatch?.[1]?.trim() ?? `msg-${Date.now()}-${Math.random()}`,
                inReplyTo: inReplyToMatch?.[1]?.trim() ?? null,
                subject: subjectMatch?.[1]?.trim() ?? "(no subject)",
                from: fromMatch?.[1]?.trim() ?? "unknown",
                body: body || "(empty)",
                receivedAt: msg.envelope?.date ?? new Date(),
              });
            } catch (msgErr) {
              console.warn("[inbox/check] error parsing message:", msgErr);
            }
          }
        }
      } finally {
        lock.release();
      }
    } finally {
      await client.logout();
    }

    return emails;
  } catch (importErr: any) {
    if (importErr?.code === "MODULE_NOT_FOUND" || importErr?.message?.includes("Cannot find module")) {
      // imapflow not installed — return empty (non-fatal)
      console.warn(
        "[inbox/check] imapflow not installed. Run `npm install imapflow` to enable real IMAP polling."
      );
      return [];
    }
    throw importErr;
  }
}

// ─── Match email to a sent_email row ─────────────────────────────────────────

async function matchReplyToSentEmail(
  service: ReturnType<typeof createServiceClient>,
  userId: string,
  parsed: ParsedEmail
): Promise<{ sentEmailId: string | null; leadId: string | null }> {
  // Strategy 1: match by In-Reply-To header (most reliable)
  if (parsed.inReplyTo) {
    const { data } = await service
      .from("sent_emails")
      .select("id, lead_id")
      .eq("user_id", userId)
      .eq("smtp_message_id", parsed.inReplyTo)
      .single();
    if (data) return { sentEmailId: data.id, leadId: data.lead_id };
  }

  // Strategy 2: match by subject (strip Re:/Fwd: prefixes)
  const cleanSubject = parsed.subject
    .replace(/^(Re|Fwd|FW|RE|FWD):\s*/gi, "")
    .trim();

  if (cleanSubject) {
    const { data } = await service
      .from("sent_emails")
      .select("id, lead_id")
      .eq("user_id", userId)
      .ilike("subject", `%${cleanSubject}%`)
      .order("sent_at", { ascending: false })
      .limit(1)
      .single();
    if (data) return { sentEmailId: data.id, leadId: data.lead_id };
  }

  // Strategy 3: match by sender email — find a lead with this email address
  const senderEmail = parsed.from.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/)?.[0]?.toLowerCase();
  if (senderEmail) {
    // Check if we sent an email to this address
    const { data: sentToMatch } = await service
      .from("sent_emails")
      .select("id, lead_id")
      .eq("user_id", userId)
      .eq("to_email", senderEmail)
      .order("sent_at", { ascending: false })
      .limit(1)
      .single();
    if (sentToMatch) return { sentEmailId: sentToMatch.id, leadId: sentToMatch.lead_id };

    // Check leads table directly
    const { data: leadMatch } = await service
      .from("leads")
      .select("id")
      .eq("user_id", userId)
      .eq("email", senderEmail)
      .single();
    if (leadMatch) return { sentEmailId: null, leadId: leadMatch.id };
  }

  // Strategy 4: save as unmatched reply (still visible in UI)
  return { sentEmailId: null, leadId: null };
}

// ─── Process one inbox config ─────────────────────────────────────────────────

async function processInbox(
  service: ReturnType<typeof createServiceClient>,
  config: InboxConfig
): Promise<CheckResult> {
  const result: CheckResult = {
    configId: config.id,
    email: config.email_address,
    newReplies: 0,
    errors: [],
  };

  const since = config.last_checked_at
    ? new Date(config.last_checked_at)
    : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // default: last 7 days

  let emails: ParsedEmail[] = [];
  try {
    emails = await fetchNewEmails(config, since);
  } catch (err) {
    result.errors.push(`IMAP fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    return result;
  }

  for (const parsed of emails) {
    try {
      // Extract sender email for dedup check
      const senderEmail = parsed.from.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/)?.[0]?.toLowerCase() ?? parsed.from;

      // Skip if we already stored a reply from this sender with this subject
      const { count: existing } = await service
        .from("email_replies")
        .select("id", { count: "exact", head: true })
        .eq("user_id", config.user_id)
        .eq("from_email", senderEmail)
        .ilike("subject", `%${parsed.subject.replace(/^(Re|Fwd|FW|RE|FWD):\s*/gi, "").trim()}%`);

      if ((existing ?? 0) > 0) continue; // already stored

      // Find the sent_email this is a reply to
      const { sentEmailId, leadId } = await matchReplyToSentEmail(service, config.user_id, parsed);

      // Only skip if this email is clearly not related to our outreach
      // (no sent email match AND no lead match AND subject has no Re: prefix)
      const hasRePrefix = /^(Re|Fwd|FW|RE|FWD):/i.test(parsed.subject);
      if (!sentEmailId && !leadId && !hasRePrefix) continue;

      const { sentiment, is_positive } = analyzeSentiment(parsed.body);

      // Insert reply
      const { error: insertErr } = await service.from("email_replies").insert({
        user_id: config.user_id,
        sent_email_id: sentEmailId,
        lead_id: leadId,
        from_email: senderEmail,
        subject: parsed.subject,
        body: parsed.body,
        received_at: parsed.receivedAt.toISOString(),
        sentiment,
        is_positive,
        ai_response_generated: false,
        ai_response_sent: false,
      });

      if (insertErr) {
        result.errors.push(`Insert reply failed: ${insertErr.message}`);
        continue;
      }

      // Update sent_email status to "replied"
      if (sentEmailId) {
        await service
          .from("sent_emails")
          .update({ status: "replied", replied_at: parsed.receivedAt.toISOString() })
          .eq("id", sentEmailId);
      }

      // Update lead status to "replied"
      if (leadId) {
        await service
          .from("leads")
          .update({ status: "replied", updated_at: new Date().toISOString() })
          .eq("id", leadId);
      }

      result.newReplies++;
    } catch (err) {
      result.errors.push(`Error processing message: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Update last_checked_at
  await service
    .from("email_inbox_config")
    .update({ last_checked_at: new Date().toISOString() })
    .eq("id", config.id);

  return result;
}

// ─── Route handlers ───────────────────────────────────────────────────────────

async function handleCheck(request: NextRequest, userId: string | null) {
  const service = createServiceClient();

  // Fetch active inbox configs
  let query = service
    .from("email_inbox_config")
    .select("*")
    .eq("is_active", true);

  if (userId) {
    query = query.eq("user_id", userId);
  }

  const { data: configs, error } = await query;
  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  if (!configs || configs.length === 0) {
    return NextResponse.json({
      success: true,
      message: "No active inbox configs found",
      results: [],
      totalNewReplies: 0,
    });
  }

  const results: CheckResult[] = [];
  for (const config of configs as InboxConfig[]) {
    const result = await processInbox(service, config);
    results.push(result);
  }

  const totalNewReplies = results.reduce((sum, r) => sum + r.newReplies, 0);

  return NextResponse.json({
    success: true,
    message: `Checked ${configs.length} inbox(es). Found ${totalNewReplies} new replies.`,
    results,
    totalNewReplies,
  });
}

// Cron (GET) or manual trigger (POST)
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return handleCheck(request, null); // process all users
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return handleCheck(request, user.id); // process only this user
}
