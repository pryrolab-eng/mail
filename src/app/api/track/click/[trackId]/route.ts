/**
 * Email click tracking redirect.
 * Links in outgoing emails are wrapped as:
 *   /api/track/click/<pixelId>?url=<encoded-destination>
 *
 * Marks the email as clicked then redirects to the original URL.
 * No auth required — recipient has no session.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "../../../../../../supabase/service";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ trackId: string }> }
) {
  const { trackId } = await params;
  const destination = req.nextUrl.searchParams.get("url") || "https://pryro.com";

  // Validate destination URL
  let safeDestination = destination;
  try {
    const parsed = new URL(destination);
    // Only allow http/https
    if (!["http:", "https:"].includes(parsed.protocol)) {
      safeDestination = "https://pryro.com";
    }
  } catch {
    safeDestination = "https://pryro.com";
  }

  if (trackId) {
    try {
      const supabase = createServiceClient();

      const { data: email } = await supabase
        .from("sent_emails")
        .select("id, user_id, lead_id, clicked_at, status")
        .eq("tracking_pixel_id", trackId)
        .maybeSingle();

      if (email && !email.clicked_at) {
        const now = new Date().toISOString();

        await supabase
          .from("sent_emails")
          .update({ clicked_at: now, status: "clicked" })
          .eq("id", email.id);

        if (email.lead_id) {
          await supabase
            .from("leads")
            .update({ status: "clicked", updated_at: now })
            .eq("id", email.lead_id);
        }

        await supabase.from("analytics_events").insert({
          user_id: email.user_id,
          event_type: "email_clicked",
          sent_email_id: email.id,
          lead_id: email.lead_id ?? null,
          metadata: { track_id: trackId, destination: safeDestination },
        }).catch(() => {});

        console.log(`[track/click] ✅ Email ${email.id} marked as clicked → ${safeDestination}`);
      }
    } catch (err) {
      console.error("[track/click] Error:", err);
    }
  }

  return NextResponse.redirect(safeDestination);
}
