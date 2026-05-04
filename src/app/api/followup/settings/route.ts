import { NextRequest, NextResponse } from "next/server";
import { createClient } from "../../../../../supabase/server";
import { createServiceClient } from "../../../../../supabase/service";

export interface FollowupSettingsPayload {
  auto_followup_enabled?: boolean;
  default_delay_days?: number;
  max_followups?: number;
  stop_on_reply?: boolean;
  followup_tone?: "professional" | "casual" | "friendly";
  followup_subject_prefix?: string;
  your_company?: string;
  your_service?: string;
}

// GET /api/followup/settings — fetch current user's settings
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const service = createServiceClient();
    const { data, error } = await service
      .from("followup_settings")
      .select("*")
      .eq("user_id", user.id)
      .single();

    if (error && error.code !== "PGRST116") {
      // PGRST116 = no rows found — that's fine, we'll return defaults
      throw error;
    }

    // Return existing settings or sensible defaults
    const settings = data ?? {
      user_id: user.id,
      auto_followup_enabled: false,
      default_delay_days: 3,
      max_followups: 3,
      stop_on_reply: true,
      followup_tone: "professional",
      followup_subject_prefix: "Re: ",
      your_company: null,
      your_service: null,
    };

    return NextResponse.json({ success: true, settings });
  } catch (err) {
    console.error("[GET /api/followup/settings]", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}

// POST /api/followup/settings — upsert settings
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as FollowupSettingsPayload;

    // Validate ranges
    if (body.default_delay_days !== undefined) {
      if (body.default_delay_days < 1 || body.default_delay_days > 30) {
        return NextResponse.json(
          { success: false, error: "default_delay_days must be between 1 and 30" },
          { status: 400 }
        );
      }
    }
    if (body.max_followups !== undefined) {
      if (body.max_followups < 1 || body.max_followups > 10) {
        return NextResponse.json(
          { success: false, error: "max_followups must be between 1 and 10" },
          { status: 400 }
        );
      }
    }

    const service = createServiceClient();
    const { data, error } = await service
      .from("followup_settings")
      .upsert(
        {
          user_id: user.id,
          ...body,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      )
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, settings: data });
  } catch (err) {
    console.error("[POST /api/followup/settings]", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
