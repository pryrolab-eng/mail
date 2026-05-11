/**
 * /api/track/click
 * Email click tracking redirect endpoint.
 * Records the click event and redirects to the original URL.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '../../../../../supabase/service';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const pixelId = searchParams.get('id');
  const url = searchParams.get('url');

  if (!url) {
    return NextResponse.redirect('https://pryro.com');
  }

  if (pixelId) {
    try {
      const service = createServiceClient();

      const { data: sentEmail } = await service
        .from('sent_emails')
        .select('id, user_id, lead_id, campaign_id, clicked_at')
        .eq('tracking_pixel_id', pixelId)
        .single();

      if (sentEmail && !sentEmail.clicked_at) {
        const now = new Date().toISOString();

        await service
          .from('sent_emails')
          .update({ clicked_at: now, status: 'clicked' })
          .eq('id', sentEmail.id);

        if (sentEmail.lead_id) {
          await service
            .from('leads')
            .update({ status: 'clicked', updated_at: now })
            .eq('id', sentEmail.lead_id);
        }

        await service.from('analytics_events').insert({
          user_id: sentEmail.user_id,
          event_type: 'email_clicked',
          sent_email_id: sentEmail.id,
          lead_id: sentEmail.lead_id,
          campaign_id: sentEmail.campaign_id,
          metadata: { url, ip: request.headers.get('x-forwarded-for') || 'unknown' },
        });
      }
    } catch (err) {
      console.error('[track/click] error:', err);
    }
  }

  return NextResponse.redirect(decodeURIComponent(url));
}
