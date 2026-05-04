/**
 * /api/inbox/config
 *
 * GET    — list all inbox configs for the user
 * POST   — add or update an inbox config (IMAP credentials)
 * DELETE — ?id=<uuid> remove an inbox config
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "../../../../../supabase/server";
import { createServiceClient } from "../../../../../supabase/service";

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const service = createServiceClient();
    const { data, error } = await service
      .from("email_inbox_config")
      .select("id, email_address, provider, imap_host, imap_port, imap_username, last_checked_at, is_active, auto_reply_enabled, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) throw error;

    // Never return passwords/tokens to the client
    return NextResponse.json({ success: true, configs: data ?? [] });
  } catch (err) {
    console.error("[GET /api/inbox/config]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const service = createServiceClient();
    const body = await request.json();
    const {
      email_address,
      provider = "imap",
      imap_host,
      imap_port = 993,
      imap_username,
      imap_password,
      auto_reply_enabled = false,
    } = body;

    if (!email_address || !imap_host || !imap_username || !imap_password) {
      return NextResponse.json(
        { error: "email_address, imap_host, imap_username, and imap_password are required" },
        { status: 400 }
      );
    }

    const { data, error } = await service
      .from("email_inbox_config")
      .upsert(
        {
          user_id: user.id,
          email_address,
          provider,
          imap_host,
          imap_port,
          imap_username,
          imap_password,
          auto_reply_enabled,
          is_active: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,email_address" }
      )
      .select("id, email_address, provider, imap_host, imap_port, imap_username, last_checked_at, is_active, auto_reply_enabled")
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, config: data });
  } catch (err) {
    console.error("[POST /api/inbox/config]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const id = new URL(request.url).searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const service = createServiceClient();
    const { error } = await service
      .from("email_inbox_config")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[DELETE /api/inbox/config]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
