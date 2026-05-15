import { NextRequest, NextResponse } from "next/server";
import { createClient } from "../../../../supabase/server";
import { createServiceClient } from "../../../../supabase/service";

export async function GET(req: NextRequest) {
  try {
    // Try auth first
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    // If no session, allow passing userId as query param for debugging
    const userId = user?.id ?? req.nextUrl.searchParams.get("userId");

    if (!userId) {
      return NextResponse.json({
        error: "Not logged in. Visit this URL while logged into the dashboard, or add ?userId=YOUR_USER_ID",
        tip: "Go to /dashboard first, then come back to this URL"
      }, { status: 401 });
    }

    const service = createServiceClient();

    const { data: accounts, error } = await service
      .from("smtp_accounts")
      .select("id, email, status, sent_today, daily_limit, last_reset, user_name, user_id")
      .eq("user_id", userId);

    if (error) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 500 });
    }

    const now = new Date();
    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);

    return NextResponse.json({
      success: true,
      userId,
      count: accounts?.length ?? 0,
      serverTime: now.toISOString(),
      todayMidnight: todayMidnight.toISOString(),
      accounts: accounts?.map(a => ({
        email: a.email,
        status: a.status,
        sent_today: a.sent_today,
        daily_limit: a.daily_limit,
        remaining: (a.daily_limit ?? 0) - (a.sent_today ?? 0),
        last_reset: a.last_reset,
        needs_reset: a.last_reset ? new Date(a.last_reset) < todayMidnight : true,
        has_user_name: !!a.user_name,
        user_name_value: a.user_name ?? "(missing)",
      })),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
