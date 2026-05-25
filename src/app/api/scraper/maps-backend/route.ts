import { NextResponse } from 'next/server';
import { getMapsBackendStatus } from '@/utils/gmaps-backend-status';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET — Maps scraper backend (Puppeteer vs gosom Docker from env). */
export async function GET() {
  const status = await getMapsBackendStatus();
  return NextResponse.json(status);
}
