import { NextRequest, NextResponse } from "next/server";
import {
  fetchLiveProviderModels,
  mergeSavedModel,
} from "@/utils/fetch-provider-models";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const provider = String(body.provider || "");
    const apiKey = String(body.apiKey || "");
    const savedModel = body.savedModel ? String(body.savedModel) : undefined;

    if (!provider) {
      return NextResponse.json({ error: "provider required" }, { status: 400 });
    }

    const result = await fetchLiveProviderModels(provider, apiKey);

    const liveOnly = result.models;
    const models = mergeSavedModel(liveOnly, savedModel);
    const savedDeprecated = !!(
      savedModel?.trim() &&
      result.source === "live" &&
      liveOnly.length > 0 &&
      !liveOnly.includes(savedModel.trim())
    );

    return NextResponse.json({
      models,
      source: result.source,
      error: result.error,
      savedDeprecated,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg, models: [], source: "fallback" }, { status: 500 });
  }
}
