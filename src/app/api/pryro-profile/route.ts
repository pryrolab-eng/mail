import { NextResponse } from "next/server";
import { formatPryroOfferForPrompt, getPryroProfile } from "@/utils/pryro-website-profile";

export const runtime = "nodejs";

/** GET — Pryro pitch loaded from the live website (cached 1h) */
export async function GET() {
  try {
    const profile = await getPryroProfile();
    return NextResponse.json({
      success: true,
      company: profile.company,
      website: profile.website,
      serviceOffer: profile.serviceOffer,
      offerFormatted: formatPryroOfferForPrompt(profile),
      oneLiner: profile.oneLiner,
      whoItsFor: profile.whoItsFor,
      outcomes: profile.outcomes,
      proof: profile.proof,
      cachedAt: profile.fetchedAt,
    });
  } catch (err) {
    console.error("[/api/pryro-profile]", err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Failed to load Pryro profile",
      },
      { status: 500 }
    );
  }
}
