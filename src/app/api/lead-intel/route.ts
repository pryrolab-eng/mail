import { NextRequest, NextResponse } from "next/server";
import { createClient } from "../../../../supabase/server";
import {
  buildLeadIntel,
  formatLeadIntelForPrompt,
  resolveLeadIntel,
  type LeadIntelInput,
} from "@/utils/lead-intel";
import { loadAIProviderForUser } from "@/utils/load-ai-provider-server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as LeadIntelInput & {
      skipFetch?: boolean;
      useAi?: boolean;
    };
    if (!body.company_name?.trim()) {
      return NextResponse.json({ error: "company_name is required" }, { status: 400 });
    }

    const aiProvider = await loadAIProviderForUser(supabase);

    const intel = body.skipFetch
      ? buildLeadIntel(body, null)
      : await resolveLeadIntel(body, {
          aiProvider,
          useAi: body.useAi !== false && !!aiProvider,
        });

    return NextResponse.json({
      success: true,
      intel,
      formatted: formatLeadIntelForPrompt(intel),
      fetchedWebsite: !!body.website && !body.skipFetch,
      source: intel.source || "rules",
      usedAi: intel.source === "ai",
    });
  } catch (err) {
    console.error("[/api/lead-intel]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to build lead intel" },
      { status: 500 }
    );
  }
}
