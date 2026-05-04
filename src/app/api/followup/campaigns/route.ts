import { NextRequest, NextResponse } from "next/server";
import { createClient } from "../../../../../supabase/server";
import { createServiceClient } from "../../../../../supabase/service";

// GET /api/followup/campaigns — list campaigns with their sequences
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

    const { data: campaigns, error } = await service
      .from("email_campaigns")
      .select(`
        *,
        email_sequences (
          id,
          sequence_number,
          delay_days,
          subject_template,
          body_template,
          tone,
          created_at
        )
      `)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) throw error;

    return NextResponse.json({ success: true, campaigns: campaigns ?? [] });
  } catch (err) {
    console.error("[GET /api/followup/campaigns]", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}

// POST /api/followup/campaigns — create a campaign with sequences
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

    const body = await request.json();
    const { name, sequences } = body as {
      name: string;
      sequences: Array<{
        sequence_number: number;
        delay_days: number;
        subject_template: string;
        body_template: string;
        tone?: string;
      }>;
    };

    if (!name?.trim()) {
      return NextResponse.json(
        { success: false, error: "Campaign name is required" },
        { status: 400 }
      );
    }

    if (!Array.isArray(sequences) || sequences.length === 0) {
      return NextResponse.json(
        { success: false, error: "At least one sequence step is required" },
        { status: 400 }
      );
    }

    // Validate sequences
    for (const seq of sequences) {
      if (!seq.subject_template?.trim() || !seq.body_template?.trim()) {
        return NextResponse.json(
          { success: false, error: `Sequence step ${seq.sequence_number} is missing subject or body` },
          { status: 400 }
        );
      }
      if (seq.delay_days < 1 || seq.delay_days > 30) {
        return NextResponse.json(
          { success: false, error: "delay_days must be between 1 and 30" },
          { status: 400 }
        );
      }
    }

    const service = createServiceClient();

    // Create campaign
    const { data: campaign, error: campaignError } = await service
      .from("email_campaigns")
      .insert({
        user_id: user.id,
        name: name.trim(),
        template_subject: sequences[0].subject_template,
        template_body: sequences[0].body_template,
        status: "active",
      })
      .select()
      .single();

    if (campaignError) throw campaignError;

    // Create sequences
    const { data: createdSequences, error: seqError } = await service
      .from("email_sequences")
      .insert(
        sequences.map((seq) => ({
          campaign_id: campaign.id,
          sequence_number: seq.sequence_number,
          delay_days: seq.delay_days,
          subject_template: seq.subject_template,
          body_template: seq.body_template,
          tone: seq.tone ?? "professional",
        }))
      )
      .select();

    if (seqError) throw seqError;

    return NextResponse.json({
      success: true,
      campaign: { ...campaign, email_sequences: createdSequences },
    });
  } catch (err) {
    console.error("[POST /api/followup/campaigns]", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
