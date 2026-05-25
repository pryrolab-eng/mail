import { NextRequest, NextResponse } from "next/server";
import { createClient } from "../../../../../supabase/server";
import { insertScrapedLeadsToCrm } from "@/utils/scrape-lead-crm";
import type { ScrapedLead } from "@/types/platform";

export const runtime = "nodejs";

type LeadInput = {
  company_name: string;
  email: string;
  phone?: string | null;
  website?: string | null;
  niche?: string;
  location?: string;
  company_context?: string;
  emailIsReal?: boolean;
  business_address?: string;
  source_snippet?: string;
};

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as {
    leads?: LeadInput[];
    category?: string;
    searchLocation?: string;
  };

  const rawLeads = body.leads ?? [];
  if (rawLeads.length === 0) {
    return NextResponse.json({ error: "No leads provided" }, { status: 400 });
  }

  const searchLocation =
    body.searchLocation?.trim() || rawLeads[0]?.location?.trim() || "";

  const scraped: ScrapedLead[] = rawLeads
    .filter((l) => l.email?.trim())
    .map((l) => ({
      company_name: l.company_name,
      email: l.email.trim(),
      phone: l.phone ?? undefined,
      website: l.website ?? undefined,
      niche: l.niche ?? "",
      location: l.location ?? searchLocation,
      company_context: l.company_context ?? "",
      emailIsReal: l.emailIsReal,
      business_address: l.business_address,
      source_snippet: l.source_snippet,
    }));

  try {
    const result = await insertScrapedLeadsToCrm(supabase, user.id, scraped, {
      searchLocation,
      category: body.category,
      niche: scraped[0]?.niche,
    });

    if (result.added === 0 && result.duplicates === 0 && result.junkFiltered > 0) {
      return NextResponse.json({
        ...result,
        message: "No valid leads to add after filtering",
      });
    }

    return NextResponse.json({
      ...result,
      message:
        result.researched > 0
          ? `${result.added} added, ${result.researched} researched`
          : undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Insert failed";
    console.error("[leads/import]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
