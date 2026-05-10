"use client";

import { useState, useEffect, useCallback } from "react";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from "recharts";
import {
  Send, Mail, MousePointer, MessageSquare, AlertTriangle,
  TrendingUp, RefreshCw, Loader2, Activity, Users, Zap,
} from "lucide-react";
import { toast } from "sonner";

interface AnalyticsDashboardProps {
  userId: string;
}

interface Stats {
  total_sent: number;
  total_opened: number;
  total_clicked: number;
  total_replied: number;
  total_bounced: number;
  total_failed: number;
  open_rate: number;
  click_rate: number;
  reply_rate: number;
  bounce_rate: number;
}

interface DailyData {
  date: string;
  sent: number;
  opened: number;
  replied: number;
  bounced: number;
}

interface SMTPAccount {
  id: string;
  email: string;
  sent_today: number;
  daily_limit: number;
  status: string;
  health_score: number;
}

interface Campaign {
  id: string;
  name: string;
  status: string;
  sent_count: number;
  opened_count: number;
  replied_count: number;
  bounced_count: number;
  total_recipients: number;
  created_at: string;
}

const COLORS = ['#2563EB', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#06B6D4'];

const STATUS_COLORS: Record<string, string> = {
  new: '#2563EB',
  contacted: '#F59E0B',
  opened: '#8B5CF6',
  clicked: '#06B6D4',
  replied: '#10B981',
  interested: '#059669',
  bounced: '#EF4444',
  failed: '#DC2626',
  New: '#2563EB',
  'Email Sent': '#F59E0B',
  Replied: '#10B981',
  Interested: '#059669',
  Closed: '#059669',
  Dead: '#EF4444',
};

export default function AnalyticsDashboard({ userId }: AnalyticsDashboardProps) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [daily, setDaily] = useState<DailyData[]>([]);
  const [leadStatusBreakdown, setLeadStatusBreakdown] = useState<Record<string, number>>({});
  const [smtpAccounts, setSmtpAccounts] = useState<SMTPAccount[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);
  const [refreshing, setRefreshing] = useState(false);

  const fetchAnalytics = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const res = await fetch(`/api/analytics?days=${days}`);
      if (!res.ok) throw new Error('Failed to fetch analytics');
      const data = await res.json();

      setStats(data.stats);
      setDaily(data.daily || []);
      setLeadStatusBreakdown(data.leadStatusBreakdown || {});
      setSmtpAccounts(data.smtpAccounts || []);
      setCampaigns(data.campaigns || []);
    } catch (err) {
      toast.error('Failed to load analytics');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [days]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  const pieData = Object.entries(leadStatusBreakdown)
    .filter(([, count]) => count > 0)
    .map(([status, count]) => ({ name: status, value: count }));

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 size={24} className="animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-5 bg-gray-50 min-h-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Analytics Dashboard</h2>
          <p className="text-sm text-gray-500 mt-0.5">Real-time campaign performance</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={days}
            onChange={e => setDays(Number(e.target.value))}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          <button
            onClick={() => fetchAnalytics(true)}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { label: 'Sent', value: stats.total_sent, icon: Send, color: '#2563EB', bg: '#EFF6FF' },
            { label: 'Opened', value: stats.total_opened, icon: Mail, sub: `${stats.open_rate}%`, color: '#8B5CF6', bg: '#F3E8FF' },
            { label: 'Clicked', value: stats.total_clicked, icon: MousePointer, sub: `${stats.click_rate}%`, color: '#06B6D4', bg: '#ECFEFF' },
            { label: 'Replied', value: stats.total_replied, icon: MessageSquare, sub: `${stats.reply_rate}%`, color: '#10B981', bg: '#D1FAE5' },
            { label: 'Bounced', value: stats.total_bounced, icon: AlertTriangle, sub: `${stats.bounce_rate}%`, color: '#EF4444', bg: '#FEE2E2' },
            { label: 'Failed', value: stats.total_failed, icon: Zap, color: '#DC2626', bg: '#FEE2E2' },
          ].map(({ label, value, icon: Icon, sub, color, bg }) => (
            <div key={label} className="rounded-xl p-4 bg-white border border-gray-200 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">{label}</span>
                <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: bg }}>
                  <Icon size={13} style={{ color }} />
                </div>
              </div>
              <p className="text-2xl font-bold" style={{ color }}>{value.toLocaleString()}</p>
              {sub && <p className="text-xs text-gray-500 mt-0.5">{sub} rate</p>}
            </div>
          ))}
        </div>
      )}

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Daily Activity Chart */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Activity size={15} className="text-blue-600" />
            <h3 className="text-sm font-semibold text-gray-900">Daily Activity</h3>
          </div>
          {daily.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={daily} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: '#9CA3AF' }}
                  tickFormatter={d => d.slice(5)} // MM-DD
                />
                <YAxis tick={{ fontSize: 10, fill: '#9CA3AF' }} />
                <Tooltip
                  contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #E5E7EB' }}
                />
                <Line type="monotone" dataKey="sent" stroke="#2563EB" strokeWidth={2} dot={false} name="Sent" />
                <Line type="monotone" dataKey="opened" stroke="#8B5CF6" strokeWidth={2} dot={false} name="Opened" />
                <Line type="monotone" dataKey="replied" stroke="#10B981" strokeWidth={2} dot={false} name="Replied" />
                <Line type="monotone" dataKey="bounced" stroke="#EF4444" strokeWidth={2} dot={false} name="Bounced" />
                <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[220px] text-gray-400 text-sm">
              No data for this period
            </div>
          )}
        </div>

        {/* Lead Status Pie */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Users size={15} className="text-blue-600" />
            <h3 className="text-sm font-semibold text-gray-900">Lead Status</h3>
          </div>
          {pieData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {pieData.map((entry, index) => (
                    <Cell
                      key={entry.name}
                      fill={STATUS_COLORS[entry.name] || COLORS[index % COLORS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #E5E7EB' }}
                />
                <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[220px] text-gray-400 text-sm">
              No leads yet
            </div>
          )}
        </div>
      </div>

      {/* SMTP Performance + Campaigns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* SMTP Accounts */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Zap size={15} className="text-blue-600" />
            <h3 className="text-sm font-semibold text-gray-900">SMTP Performance</h3>
          </div>
          {smtpAccounts.length > 0 ? (
            <div className="flex flex-col gap-3">
              {smtpAccounts.map(account => {
                const pct = account.daily_limit > 0
                  ? Math.round((account.sent_today / account.daily_limit) * 100)
                  : 0;
                const health = account.health_score ?? 100;
                return (
                  <div key={account.id} className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-gray-700 truncate max-w-[180px]">
                        {account.email}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-gray-500">{account.sent_today}/{account.daily_limit}</span>
                        <span
                          className="text-[9px] px-1.5 py-0.5 rounded-full font-medium"
                          style={{
                            background: account.status === 'active' ? '#D1FAE5' : '#FEE2E2',
                            color: account.status === 'active' ? '#059669' : '#DC2626',
                          }}
                        >
                          {account.status}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                        <div
                          className="h-1.5 rounded-full transition-all"
                          style={{
                            width: `${pct}%`,
                            background: pct > 80 ? '#EF4444' : pct > 60 ? '#F59E0B' : '#2563EB',
                          }}
                        />
                      </div>
                      <span className="text-[10px] text-gray-400 w-8 text-right">{pct}%</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-[9px] text-gray-400">Health:</span>
                      <div className="flex-1 bg-gray-100 rounded-full h-1">
                        <div
                          className="h-1 rounded-full"
                          style={{
                            width: `${health}%`,
                            background: health > 70 ? '#10B981' : health > 40 ? '#F59E0B' : '#EF4444',
                          }}
                        />
                      </div>
                      <span className="text-[9px] text-gray-400">{health}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-gray-400 text-center py-8">No SMTP accounts configured</p>
          )}
        </div>

        {/* Campaign Performance */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp size={15} className="text-blue-600" />
            <h3 className="text-sm font-semibold text-gray-900">Campaign Performance</h3>
          </div>
          {campaigns.length > 0 ? (
            <div className="flex flex-col gap-2">
              {campaigns.slice(0, 5).map(campaign => {
                const openRate = campaign.sent_count > 0
                  ? Math.round((campaign.opened_count / campaign.sent_count) * 100)
                  : 0;
                const replyRate = campaign.sent_count > 0
                  ? Math.round((campaign.replied_count / campaign.sent_count) * 100)
                  : 0;
                return (
                  <div key={campaign.id} className="p-3 rounded-lg bg-gray-50 border border-gray-100">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-medium text-gray-800 truncate max-w-[160px]">
                        {campaign.name}
                      </span>
                      <span
                        className="text-[9px] px-1.5 py-0.5 rounded-full font-medium"
                        style={{
                          background: campaign.status === 'completed' ? '#D1FAE5' : campaign.status === 'active' ? '#EFF6FF' : '#F3F4F6',
                          color: campaign.status === 'completed' ? '#059669' : campaign.status === 'active' ? '#2563EB' : '#6B7280',
                        }}
                      >
                        {campaign.status}
                      </span>
                    </div>
                    <div className="grid grid-cols-4 gap-1 text-center">
                      {[
                        { label: 'Sent', value: campaign.sent_count, color: '#2563EB' },
                        { label: 'Open', value: `${openRate}%`, color: '#8B5CF6' },
                        { label: 'Reply', value: `${replyRate}%`, color: '#10B981' },
                        { label: 'Bounce', value: campaign.bounced_count, color: '#EF4444' },
                      ].map(({ label, value, color }) => (
                        <div key={label}>
                          <p className="text-[10px] text-gray-400">{label}</p>
                          <p className="text-xs font-bold" style={{ color }}>{value}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-gray-400 text-center py-8">No campaigns yet</p>
          )}
        </div>
      </div>
    </div>
  );
}
