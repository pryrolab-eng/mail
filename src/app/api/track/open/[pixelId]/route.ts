/**
 * Email open tracking pixel.
 * Embedded as a 1×1 transparent GIF in every outgoing email.
 * When the recipient's email client loads the image, this fires
 * and marks the email as opened — no auth required.
 *
 * URL: GET /api/track/open/<pixelId>
 */

import { NextRequest } from "next/server";
import { createServiceClient } from "../../../../../../supabase/service";

// 1×1 transparent GIF
const TRANSPARENT_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

const PIXEL_RESPONSE = new Response(TRANSPARENT_GIF, {
  status: 200,
  headers: {
    "Content-Type": "image/gif",
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
  },
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ pixelId: string }> }
) {
  try {
    const { pixelId } = await params;
    if (!pixelId) return PIXEL_RESPONSE;

    // Service client — no auth session needed (recipient has no session)
    const supabase = createServiceClient();

    const { data: email, error } = await supabase
      .from("sent_emails")
      .select("id, user_id, lead_id, opened_at, status")
      .eq("tracking_pixel_id", pixelId)
      .maybeSingle();

    if (error) {
      console.error("[track/open] DB error:", error.message);
      return PIXEL_RESPONSE;
    }

    if (!email) {
      console.warn("[track/open] No email found for pixelId:", pixelId);
      return PIXEL_RESPONSE;
    }

    // Only mark as opened once
    if (!email.opened_at) {
      const now = new Date().toISOString();

      await supabase
        .from("sent_emails")
        .update({ opened_at: now, status: "opened" })
        .eq("id", email.id);

      // Update lead status
      if (email.lead_id) {
        await supabase
          .from("leads")
          .update({ status: "opened", updated_at: now })
          .eq("id", email.lead_id)
          .in("status", ["contacted", "new", "Email Sent"]);
      }

      // Log analytics event
      try {
        await supabase.from("analytics_events").insert({
          user_id: email.user_id,
          event_type: "email_opened",
          sent_email_id: email.id,
          lead_id: email.lead_id ?? null,
          metadata: { pixel_id: pixelId, ip: req.headers.get("x-forwarded-for") ?? "" },
        });
      } catch {
        /* analytics optional */
      }

      console.log(`[track/open] ✅ Email ${email.id} marked as opened`);
    }
  } catch (err) {
    console.error("[track/open] Unexpected error:", err);
  }

  return PIXEL_RESPONSE;
}
