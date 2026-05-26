import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const userId = request.nextUrl.searchParams.get("userId");
    if (!userId) {
      return NextResponse.json({ error: "userId required" }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        {
          error: "Server configuration error",
          details: "Missing Supabase credentials",
        },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: activeProvider, error } = await supabase
      .from("ai_settings")
      .select("*")
      .eq("user_id", userId)
      .eq("is_active", true)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        {
          error: "Database error",
          details: error.message,
          code: error.code,
          hint: error.hint,
        },
        { status: 500 }
      );
    }

    if (activeProvider) {
      return NextResponse.json(activeProvider);
    }

    const { data: anyProvider, error: anyError } = await supabase
      .from("ai_settings")
      .select("*")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();

    if (anyError) {
      return NextResponse.json(
        { error: "Database error", details: anyError.message },
        { status: 500 }
      );
    }

    if (!anyProvider) {
      return NextResponse.json(
        {
          error: "No AI provider configured",
          details: "No records found in ai_settings table for this user",
          hint: "Open AI Settings and add Groq for the free v1 stack.",
        },
        { status: 404 }
      );
    }

    const { data: updated, error: updateError } = await supabase
      .from("ai_settings")
      .update({ is_active: true })
      .eq("id", anyProvider.id)
      .select("*")
      .single();

    if (updateError) {
      return NextResponse.json(
        { error: "Database error", details: updateError.message },
        { status: 500 }
      );
    }

    return NextResponse.json(updated);
  } catch (err) {
    return NextResponse.json(
      {
        error: "Internal server error",
        details: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
