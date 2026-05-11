/**
 * /api/csv-import
 * Handles bulk CSV import of leads with:
 * - Auto column detection
 * - Email validation
 * - Deduplication
 * - Progress tracking
 * - Error logging
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '../../../../supabase/server';
import { createServiceClient } from '../../../../supabase/service';

export const runtime = 'nodejs';

// ─── Column detection ─────────────────────────────────────────────────────────

const COLUMN_PATTERNS: Record<string, RegExp[]> = {
  company_name: [/company/i, /organization/i, /org/i, /business/i, /name/i, /company_name/i],
  email: [/email/i, /e-mail/i, /mail/i, /email_address/i],
  phone: [/phone/i, /tel/i, /mobile/i, /cell/i, /contact/i],
  website: [/website/i, /url/i, /domain/i, /web/i, /site/i],
  niche: [/niche/i, /industry/i, /sector/i, /category/i, /type/i, /vertical/i],
  location: [/location/i, /city/i, /country/i, /region/i, /address/i, /place/i, /area/i],
  first_name: [/first_name/i, /firstname/i, /first/i, /fname/i],
  last_name: [/last_name/i, /lastname/i, /last/i, /lname/i, /surname/i],
  notes: [/notes/i, /description/i, /comment/i, /info/i, /details/i],
  status: [/status/i, /stage/i, /state/i],
  tags: [/tags/i, /labels/i, /keywords/i],
};

function detectColumns(headers: string[]): Record<string, number> {
  const mapping: Record<string, number> = {};

  for (const [field, patterns] of Object.entries(COLUMN_PATTERNS)) {
    for (let i = 0; i < headers.length; i++) {
      const header = headers[i].trim().toLowerCase();
      if (patterns.some(p => p.test(header))) {
        if (!(field in mapping)) {
          mapping[field] = i;
        }
      }
    }
  }

  return mapping;
}

// ─── Email validation ─────────────────────────────────────────────────────────

function isValidEmail(email: string): boolean {
  if (!email || typeof email !== 'string') return false;
  const trimmed = email.trim().toLowerCase();
  const emailRegex = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;
  if (!emailRegex.test(trimmed)) return false;

  // Filter obvious fake emails
  const blockedDomains = ['example.com', 'test.com', 'localhost', 'placeholder.com'];
  const domain = trimmed.split('@')[1];
  if (blockedDomains.includes(domain)) return false;

  return true;
}

// ─── CSV parser ───────────────────────────────────────────────────────────────

function parseCSV(content: string): string[][] {
  const rows: string[][] = [];
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    if (!line.trim()) continue;

    const row: string[] = [];
    let inQuotes = false;
    let current = '';

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        row.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    row.push(current.trim());
    rows.push(row);
  }

  return rows;
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const service = createServiceClient();

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const mappingJson = formData.get('mapping') as string | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const content = await file.text();
    const rows = parseCSV(content);

    if (rows.length < 2) {
      return NextResponse.json({ error: 'CSV file is empty or has no data rows' }, { status: 400 });
    }

    const headers = rows[0];
    const dataRows = rows.slice(1);

    // Auto-detect or use provided mapping
    let columnMapping: Record<string, number>;
    if (mappingJson) {
      columnMapping = JSON.parse(mappingJson);
    } else {
      columnMapping = detectColumns(headers);
    }

    // Create import record
    const { data: importRecord } = await service
      .from('csv_imports')
      .insert({
        user_id: user.id,
        filename: file.name,
        total_rows: dataRows.length,
        status: 'processing',
      })
      .select('id')
      .single();

    const importId = importRecord?.id;

    // Fetch existing emails for deduplication
    const { data: existingLeads } = await service
      .from('leads')
      .select('email')
      .eq('user_id', user.id);

    const existingEmails = new Set(
      (existingLeads || []).map(l => l.email?.toLowerCase()).filter(Boolean)
    );

    // Process rows
    const toInsert: any[] = [];
    const errors: Array<{ row: number; error: string; data?: any }> = [];
    let duplicates = 0;

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const rowNum = i + 2; // 1-indexed, +1 for header

      try {
        const getValue = (field: string) => {
          const idx = columnMapping[field];
          return idx !== undefined ? (row[idx] || '').trim() : '';
        };

        // Build company name
        let companyName = getValue('company_name');
        if (!companyName) {
          const firstName = getValue('first_name');
          const lastName = getValue('last_name');
          if (firstName || lastName) {
            companyName = `${firstName} ${lastName}`.trim();
          }
        }

        if (!companyName) {
          errors.push({ row: rowNum, error: 'Missing company/contact name', data: row });
          continue;
        }

        const email = getValue('email').toLowerCase();

        // Validate email if present
        if (email && !isValidEmail(email)) {
          errors.push({ row: rowNum, error: `Invalid email: ${email}`, data: row });
          continue;
        }

        // Check for duplicates
        if (email && existingEmails.has(email)) {
          duplicates++;
          continue;
        }

        if (email) existingEmails.add(email);

        // Map status
        const rawStatus = getValue('status');
        const validStatuses = ['new', 'contacted', 'opened', 'clicked', 'replied', 'interested', 'bounced', 'failed', 'New', 'Email Sent', 'Replied', 'Interested', 'Closed', 'Dead'];
        const status = validStatuses.includes(rawStatus) ? rawStatus : 'new';

        toInsert.push({
          user_id: user.id,
          company_name: companyName,
          email: email || null,
          phone: getValue('phone') || null,
          website: getValue('website') || null,
          niche: getValue('niche') || null,
          location: getValue('location') || null,
          notes: getValue('notes') || null,
          status,
          source: 'csv_import',
          email_verified: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      } catch (err) {
        errors.push({
          row: rowNum,
          error: err instanceof Error ? err.message : 'Unknown error',
          data: row,
        });
      }
    }

    // Batch insert in chunks of 100
    let imported = 0;
    const CHUNK_SIZE = 100;

    for (let i = 0; i < toInsert.length; i += CHUNK_SIZE) {
      const chunk = toInsert.slice(i, i + CHUNK_SIZE);
      const { error: insertError } = await service.from('leads').insert(chunk);

      if (insertError) {
        console.error('Batch insert error:', insertError);
        // Add all rows in this chunk to errors
        for (let j = 0; j < chunk.length; j++) {
          errors.push({
            row: i + j + 2,
            error: insertError.message,
            data: chunk[j],
          });
        }
      } else {
        imported += chunk.length;
      }
    }

    // Update import record
    if (importId) {
      await service
        .from('csv_imports')
        .update({
          imported_rows: imported,
          failed_rows: errors.length,
          duplicate_rows: duplicates,
          status: 'completed',
          error_log: errors.slice(0, 100), // cap at 100 errors
          completed_at: new Date().toISOString(),
        })
        .eq('id', importId);
    }

    // Create notification
    await service.from('notifications').insert({
      user_id: user.id,
      type: 'info',
      title: 'CSV Import Complete',
      message: `Imported ${imported} leads from ${file.name}. ${duplicates} duplicates skipped, ${errors.length} errors.`,
      data: { importId, imported, duplicates, errors: errors.length },
    });

    return NextResponse.json({
      success: true,
      importId,
      total: dataRows.length,
      imported,
      duplicates,
      failed: errors.length,
      errors: errors.slice(0, 20), // return first 20 errors
      detectedColumns: columnMapping,
      headers,
    });
  } catch (err) {
    console.error('[csv-import] error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Import failed' },
      { status: 500 }
    );
  }
}

// GET — return column detection preview
export async function PUT(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { headers } = body;

  if (!Array.isArray(headers)) {
    return NextResponse.json({ error: 'headers array required' }, { status: 400 });
  }

  const mapping = detectColumns(headers);
  return NextResponse.json({ mapping, headers });
}
