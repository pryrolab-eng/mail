/**
 * /api/notifications
 * GET  — fetch unread notifications for the authenticated user
 * POST — mark notifications as read
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '../../../../supabase/server';
import { createServiceClient } from '../../../../supabase/service';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get('limit') || '20');
  const unreadOnly = searchParams.get('unread') === 'true';

  const service = createServiceClient();
  let query = service
    .from('notifications')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (unreadOnly) {
    query = query.eq('is_read', false);
  }

  const { data, error: fetchError } = await query;
  if (fetchError) {
    // Table may not exist yet — return empty instead of 500
    console.warn('[notifications] fetch error (table may not exist):', fetchError.message);
    return NextResponse.json({ notifications: [], unreadCount: 0 });
  }

  const { count: unreadCount } = await service
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('is_read', false);

  return NextResponse.json({ notifications: data || [], unreadCount: unreadCount || 0 });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { ids, markAllRead } = body;

  const service = createServiceClient();

  if (markAllRead) {
    await service
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', user.id)
      .eq('is_read', false);
  } else if (Array.isArray(ids) && ids.length > 0) {
    await service
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', user.id)
      .in('id', ids);
  }

  return NextResponse.json({ success: true });
}
