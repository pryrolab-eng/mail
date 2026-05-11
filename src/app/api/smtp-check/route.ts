/**
 * GET /api/smtp-check
 * Returns the SMTP accounts visible to the server (service role).
 * Used to verify that accounts saved from the browser are actually
 * readable server-side before attempting to send emails.
 */
import { NextResponse } from "next/server";
import { createClient } from "../../../../supabase/server";
import { createServiceClient } from "../../../../supabase/service";

export async function GET() {
  // Authenticate
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  // Read via service role (same path the email sender uses)
  const service = createServiceClient();
  const { data, error } = await service
    .from("smtp_accounts")
    .select("id, email, provider, status, daily_limit, sent_today, created_at")
    .eq("user_id", user.id)
    .eq("status", "active")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[smtp-check] DB error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    count: data?.length ?? 0,
    accounts: data ?? [],
  });
}
