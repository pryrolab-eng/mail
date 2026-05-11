/**
 * /api/track/open
 * Email open tracking pixel endpoint.
 * Returns a 1x1 transparent GIF and records the open event.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '../../../../../supabase/service';

export const runtime = 'nodejs';

// 1x1 transparent GIF
const TRACKING_PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const pixelId = searchParams.get('id');

  if (pixelId) {
    try {
      const service = createServiceClient();

      // Find the sent email by tracking pixel ID
      const { data: sentEmail } = await service
        .from('sent_emails')
        .select('id, user_id, lead_id, campaign_id, opened_at')
        .eq('tracking_pixel_id', pixelId)
        .single();

      if (sentEmail && !sentEmail.opened_at) {
        const now = new Date().toISOString();

        // Mark as opened
        await service
          .from('sent_emails')
          .update({ opened_at: now, status: 'opened' })
          .eq('id', sentEmail.id);

        // Update lead status to 'opened' if still 'contacted'
        if (sentEmail.lead_id) {
          await service
            .from('leads')
            .update({ status: 'opened', updated_at: now })
            .eq('id', sentEmail.lead_id)
            .in('status', ['contacted', 'Email Sent', 'new', 'New']);
        }

        // Log analytics event
        await service.from('analytics_events').insert({
          user_id: sentEmail.user_id,
          event_type: 'email_opened',
          sent_email_id: sentEmail.id,
          lead_id: sentEmail.lead_id,
          campaign_id: sentEmail.campaign_id,
          metadata: {
            ip: request.headers.get('x-forwarded-for') || 'unknown',
            user_agent: request.headers.get('user-agent') || 'unknown',
          },
        });

        // Update campaign opened_count
        if (sentEmail.campaign_id) {
          await service.rpc('increment_campaign_stat', {
            p_campaign_id: sentEmail.campaign_id,
            p_column: 'opened_count',
          }).catch(() => {});
        }

        // Create notification
        await service.from('notifications').insert({
          user_id: sentEmail.user_id,
          type: 'info',
          title: 'Email Opened',
          message: 'A recipient opened your email',
          data: { sent_email_id: sentEmail.id, lead_id: sentEmail.lead_id },
        }).catch(() => {});
      }
    } catch (err) {
      // Non-fatal — always return the pixel
      console.error('[track/open] error:', err);
    }
  }

  return new NextResponse(TRACKING_PIXEL, {
    status: 200,
    headers: {
      'Content-Type': 'image/gif',
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    },
  });
}
