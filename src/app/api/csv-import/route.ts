/**
 * CSV Import endpoint — chunk-based processing.
 *
 * Accepts a CSV file upload, parses it, and inserts leads in chunks of 100.
 * Returns a scrape_job record ID so the client can poll progress.
 *
 * Expected CSV columns (case-insensitive):
 *   company_name | name | company
 *   email
 *   phone        (optional)
 *   website      (optional)
 *   niche        (optional)
 *   location     (optional)
 *   context | company_context (optional)
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "../../../../supabase/server";

export const runtime = "nodejs";
export const maxDuration = 120;

const CHUNK_SIZE = 100;

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  // Parse header
  const headers = lines[0].split(",").map((h) =>
    h.trim().replace(/^"|"$/g, "").toLowerCase()
  );

  return lines.slice(1).map((line) => {
    // Handle quoted fields with commas inside
    const values: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === "," && !inQuotes) {
        values.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    values.push(current.trim());

    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = (values[i] ?? "").replace(/^"|"$/g, "").trim();
    });
    return row;
  });
}

function normalizeRow(row: Record<string, string>) {
  return {
    company_name:
      row["company_name"] || row["name"] || row["company"] || "",
    email: (row["email"] || "").toLowerCase(),
    phone: row["phone"] || null,
    website: row["website"] || null,
    niche: row["niche"] || null,
    location: row["location"] || null,
    company_context: row["context"] || row["company_context"] || null,
  };
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const text = await file.text();
  const rows = parseCSV(text);

  if (rows.length === 0) {
    return NextResponse.json({ error: "CSV is empty or invalid" }, { status: 400 });
  }

  const totalChunks = Math.ceil(rows.length / CHUNK_SIZE);

  // Create a scrape_job to track progress
  const { data: job, error: jobError } = await supabase
    .from("scrape_jobs")
    .insert({
      user_id: user.id,
      niche: "CSV Import",
      location: "—",
      max_results: rows.length,
      chunk_size: CHUNK_SIZE,
      total_chunks: totalChunks,
      status: "running",
      source: "csv_import",
      original_filename: file.name,
    })
    .select()
    .single();

  if (jobError || !job) {
    return NextResponse.json({ error: "Failed to create import job" }, { status: 500 });
  }

  // Process in background (fire-and-forget) — client polls job status
  processChunks(user.id, job.id, rows, supabase).catch(console.error);

  return NextResponse.json({
    success: true,
    jobId: job.id,
    totalRows: rows.length,
    totalChunks,
    message: `Processing ${rows.length} rows in ${totalChunks} chunks of ${CHUNK_SIZE}`,
  });
}

async function processChunks(
  userId: string,
  jobId: string,
  rows: Record<string, string>[],
  supabase: Awaited<ReturnType<typeof createClient>>
) {
  let totalSaved = 0;
  let totalFailed = 0;
  let totalDuplicates = 0;
  const errorLog: string[] = [];

  const totalChunks = Math.ceil(rows.length / CHUNK_SIZE);

  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    const chunkNumber = Math.floor(i / CHUNK_SIZE) + 1;

    try {
      const normalized = chunk
        .map(normalizeRow)
        .filter((r) => r.company_name && r.email && r.email.includes("@"));

      if (normalized.length === 0) {
        totalFailed += chunk.length;
        continue;
      }

      // Deduplication check
      const emails = normalized.map((r) => r.email);
      const { data: existing } = await supabase
        .from("leads")
        .select("email")
        .eq("user_id", userId)
        .in("email", emails);

      const existingSet = new Set((existing ?? []).map((r: any) => r.email.toLowerCase()));
      const newLeads = normalized.filter((r) => !existingSet.has(r.email.toLowerCase()));
      totalDuplicates += normalized.length - newLeads.length;

      if (newLeads.length > 0) {
        const inserts = newLeads.map((r) => ({
          user_id: userId,
          company_name: r.company_name,
          email: r.email,
          phone: r.phone,
          website: r.website,
          niche: r.niche || "Imported",
          location: r.location || "Unknown",
          company_context: r.company_context || "",
          status: "new",
          source: "csv_import",
          confidence_score: 70,
          email_verified: false,
        }));

        const { error: insertError } = await supabase.from("leads").insert(inserts);
        if (insertError) {
          errorLog.push(`Chunk ${chunkNumber}: ${insertError.message}`);
          totalFailed += newLeads.length;
        } else {
          totalSaved += newLeads.length;
        }
      }
    } catch (err: any) {
      const msg = `Chunk ${chunkNumber} failed: ${err?.message || "Unknown error"}`;
      errorLog.push(msg);
      totalFailed += chunk.length;
    }

    // Update job progress after each chunk
    await supabase
      .from("scrape_jobs")
      .update({
        current_chunk: chunkNumber,
        total_scraped: i + chunk.length,
        total_saved: totalSaved,
        total_failed: totalFailed,
        error_log: errorLog,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);
  }

  // Mark complete
  await supabase
    .from("scrape_jobs")
    .update({
      status: "completed",
      total_scraped: rows.length,
      total_saved: totalSaved,
      total_failed: totalFailed,
      current_chunk: totalChunks,
      error_log: errorLog,
      completed_at: new Date().toISOString(),
    })
    .eq("id", jobId);
}
