/**
 * /api/analytics
 * Returns analytics data for the authenticated user.
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
  const days = parseInt(searchParams.get('days') || '30');
  const campaignId = searchParams.get('campaignId');

  const service = createServiceClient();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  // ── Overall stats ─────────────────────────────────────────────────────────
  let emailQuery = service
    .from('sent_emails')
    .select('id, status, opened_at, clicked_at, replied_at, sent_at, campaign_id')
    .eq('user_id', user.id)
    .gte('sent_at', since);

  if (campaignId) {
    emailQuery = emailQuery.eq('campaign_id', campaignId);
  }

  const { data: emails } = await emailQuery;
  const emailList = emails || [];

  const stats = {
    total_sent: emailList.length,
    total_opened: emailList.filter(e => e.opened_at).length,
    total_clicked: emailList.filter(e => e.clicked_at).length,
    total_replied: emailList.filter(e => e.replied_at).length,
    total_bounced: emailList.filter(e => e.status === 'bounced').length,
    total_failed: emailList.filter(e => e.status === 'failed').length,
    open_rate: 0,
    click_rate: 0,
    reply_rate: 0,
    bounce_rate: 0,
  };

  if (stats.total_sent > 0) {
    stats.open_rate = Math.round((stats.total_opened / stats.total_sent) * 100 * 10) / 10;
    stats.click_rate = Math.round((stats.total_clicked / stats.total_sent) * 100 * 10) / 10;
    stats.reply_rate = Math.round((stats.total_replied / stats.total_sent) * 100 * 10) / 10;
    stats.bounce_rate = Math.round((stats.total_bounced / stats.total_sent) * 100 * 10) / 10;
  }

  // ── Daily breakdown ───────────────────────────────────────────────────────
  const dailyMap = new Map<string, { sent: number; opened: number; replied: number; bounced: number }>();

  for (const email of emailList) {
    const day = email.sent_at.split('T')[0];
    const existing = dailyMap.get(day) || { sent: 0, opened: 0, replied: 0, bounced: 0 };
    existing.sent++;
    if (email.opened_at) existing.opened++;
    if (email.replied_at) existing.replied++;
    if (email.status === 'bounced') existing.bounced++;
    dailyMap.set(day, existing);
  }

  const daily = Array.from(dailyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, data]) => ({ date, ...data }));

  // ── Lead status breakdown ─────────────────────────────────────────────────
  const { data: leads } = await service
    .from('leads')
    .select('status')
    .eq('user_id', user.id);

  const leadStatusMap: Record<string, number> = {};
  for (const lead of leads || []) {
    leadStatusMap[lead.status] = (leadStatusMap[lead.status] || 0) + 1;
  }

  // ── SMTP account performance ──────────────────────────────────────────────
  const { data: smtpAccounts } = await service
    .from('smtp_accounts')
    .select('id, email, sent_today, daily_limit, status, health_score, total_sent, total_bounced')
    .eq('user_id', user.id);

  // ── Campaign performance ──────────────────────────────────────────────────
  const { data: campaigns } = await service
    .from('email_campaigns')
    .select('id, name, status, sent_count, opened_count, replied_count, bounced_count, total_recipients, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(10);

  // ── Recent replies ────────────────────────────────────────────────────────
  const { data: recentReplies } = await service
    .from('email_replies')
    .select('id, from_email, subject, sentiment, received_at, lead_id')
    .eq('user_id', user.id)
    .order('received_at', { ascending: false })
    .limit(5);

  return NextResponse.json({
    stats,
    daily,
    leadStatusBreakdown: leadStatusMap,
    smtpAccounts: smtpAccounts || [],
    campaigns: campaigns || [],
    recentReplies: recentReplies || [],
    period: { days, since },
  });
}
