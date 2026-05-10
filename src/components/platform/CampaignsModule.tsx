"use client";

import { useState, useEffect } from "react";
import { createClient } from "../../../supabase/client";
import { toast } from "sonner";
import {
  Megaphone, Plus, Play, Pause, Trash2, Edit, Calendar,
  Users, Mail, TrendingUp, Clock, CheckCircle, XCircle,
  BarChart2, Loader2, Send, Eye
} from "lucide-react";

interface Campaign {
  id: string;
  name: string;
  description?: string;
  status: 'draft' | 'scheduled' | 'active' | 'paused' | 'completed';
  template_subject: string;
  template_body: string;
  total_recipients: number;
  sent_count: number;
  opened_count: number;
  clicked_count: number;
  replied_count: number;
  bounced_count: number;
  failed_count: number;
  scheduled_at?: string;
  completed_at?: string;
  created_at: string;
  niche?: string;
}

interface CampaignsModuleProps {
  userId: string;
}

export default function CampaignsModule({ userId }: CampaignsModuleProps) {
  const supabase = createClient();
  
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  
  // Create campaign form
  const [campaignName, setCampaignName] = useState("");
  const [campaignDescription, setCampaignDescription] = useState("");
  const [templateSubject, setTemplateSubject] = useState("");
  const [templateBody, setTemplateBody] = useState("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const [selectedNiche, setSelectedNiche] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    fetchCampaigns();
    
    // Real-time subscription
    const channel = supabase
      .channel('campaigns_changes')
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'email_campaigns',
        filter: `user_id=eq.${userId}`
      }, () => {
        fetchCampaigns();
      })
      .subscribe();
    
    return () => {
      channel.unsubscribe();
    };
  }, [userId]);

  const fetchCampaigns = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('email_campaigns')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('Error fetching campaigns:', error);
      toast.error('Failed to load campaigns');
    } else {
      setCampaigns(data || []);
    }
    setLoading(false);
  };

  const createCampaign = async () => {
    if (!campaignName.trim()) {
      toast.error('Campaign name is required');
      return;
    }
    if (!templateSubject.trim() || !templateBody.trim()) {
      toast.error('Email subject and body are required');
      return;
    }

    setIsCreating(true);
    
    const scheduledAt = scheduledDate && scheduledTime 
      ? new Date(`${scheduledDate}T${scheduledTime}`).toISOString()
      : null;

    const { data, error } = await supabase
      .from('email_campaigns')
      .insert({
        user_id: userId,
        name: campaignName,
        description: campaignDescription || null,
        template_subject: templateSubject,
        template_body: templateBody,
        status: scheduledAt ? 'scheduled' : 'draft',
        scheduled_at: scheduledAt,
        niche: selectedNiche || null,
        total_recipients: 0,
        sent_count: 0,
        opened_count: 0,
        clicked_count: 0,
        replied_count: 0,
        bounced_count: 0,
        failed_count: 0,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating campaign:', error);
      toast.error('Failed to create campaign');
    } else {
      toast.success('Campaign created successfully!');
      setShowCreateModal(false);
      resetForm();
      fetchCampaigns();
    }
    
    setIsCreating(false);
  };

  const resetForm = () => {
    setCampaignName("");
    setCampaignDescription("");
    setTemplateSubject("");
    setTemplateBody("");
    setScheduledDate("");
    setScheduledTime("");
    setSelectedNiche("");
  };

  const deleteCampaign = async (id: string) => {
    if (!confirm('Are you sure you want to delete this campaign?')) return;
    
    const { error } = await supabase
      .from('email_campaigns')
      .delete()
      .eq('id', id);
    
    if (error) {
      toast.error('Failed to delete campaign');
    } else {
      toast.success('Campaign deleted');
      fetchCampaigns();
    }
  };

  const pauseCampaign = async (id: string) => {
    const { error } = await supabase
      .from('email_campaigns')
      .update({ status: 'paused' })
      .eq('id', id);
    
    if (error) {
      toast.error('Failed to pause campaign');
    } else {
      toast.success('Campaign paused');
      fetchCampaigns();
    }
  };

  const resumeCampaign = async (id: string) => {
    const { error } = await supabase
      .from('email_campaigns')
      .update({ status: 'active' })
      .eq('id', id);
    
    if (error) {
      toast.error('Failed to resume campaign');
    } else {
      toast.success('Campaign resumed');
      fetchCampaigns();
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'draft': return 'bg-gray-100 text-gray-700';
      case 'scheduled': return 'bg-blue-100 text-blue-700';
      case 'active': return 'bg-green-100 text-green-700';
      case 'paused': return 'bg-yellow-100 text-yellow-700';
      case 'completed': return 'bg-purple-100 text-purple-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'active': return <Play size={14} />;
      case 'paused': return <Pause size={14} />;
      case 'completed': return <CheckCircle size={14} />;
      case 'scheduled': return <Clock size={14} />;
      default: return <Edit size={14} />;
    }
  };

  const calculateStats = (campaign: Campaign) => {
    const openRate = campaign.sent_count > 0 
      ? ((campaign.opened_count / campaign.sent_count) * 100).toFixed(1)
      : '0.0';
    const clickRate = campaign.sent_count > 0
      ? ((campaign.clicked_count / campaign.sent_count) * 100).toFixed(1)
      : '0.0';
    const replyRate = campaign.sent_count > 0
      ? ((campaign.replied_count / campaign.sent_count) * 100).toFixed(1)
      : '0.0';
    const bounceRate = campaign.sent_count > 0
      ? ((campaign.bounced_count / campaign.sent_count) * 100).toFixed(1)
      : '0.0';
    
    return { openRate, clickRate, replyRate, bounceRate };
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={32} className="animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="border-b border-gray-200 px-8 py-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900 flex items-center gap-2">
              <Megaphone size={28} className="text-blue-600" />
              Email Campaigns
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Create, schedule, and manage your email campaigns
            </p>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            <Plus size={18} />
            New Campaign
          </button>
        </div>

        {/* Stats Overview */}
        <div className="grid grid-cols-5 gap-4 mt-6">
          {[
            { label: 'Total Campaigns', value: campaigns.length, icon: Megaphone, color: 'blue' },
            { label: 'Active', value: campaigns.filter(c => c.status === 'active').length, icon: Play, color: 'green' },
            { label: 'Scheduled', value: campaigns.filter(c => c.status === 'scheduled').length, icon: Clock, color: 'blue' },
            { label: 'Completed', value: campaigns.filter(c => c.status === 'completed').length, icon: CheckCircle, color: 'purple' },
            { label: 'Total Sent', value: campaigns.reduce((sum, c) => sum + c.sent_count, 0), icon: Send, color: 'indigo' },
          ].map((stat) => {
            const Icon = stat.icon;
            return (
              <div key={stat.label} className="bg-gray-50 rounded-lg px-4 py-3 border border-gray-100">
                <div className="flex items-center gap-2 mb-1">
                  <Icon size={14} className={`text-${stat.color}-600`} />
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{stat.label}</p>
                </div>
                <p className="text-2xl font-semibold text-gray-900">{stat.value}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Campaigns List */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        {campaigns.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Megaphone size={28} className="text-gray-400" />
            </div>
            <p className="text-gray-900 font-medium text-base">No campaigns yet</p>
            <p className="text-gray-500 text-sm mt-1">Create your first email campaign to get started</p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="mt-4 px-5 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors inline-flex items-center gap-2"
            >
              <Plus size={18} />
              Create Campaign
            </button>
          </div>
        ) : (
          <div className="space-y-4 max-w-6xl">
            {campaigns.map((campaign) => {
              const stats = calculateStats(campaign);
              return (
                <div
                  key={campaign.id}
                  className="bg-white rounded-lg border border-gray-200 hover:border-gray-300 transition-colors overflow-hidden"
                >
                  <div className="p-5">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="text-lg font-semibold text-gray-900">{campaign.name}</h3>
                          <span className={`px-2.5 py-1 rounded-full text-xs font-medium flex items-center gap-1 ${getStatusColor(campaign.status)}`}>
                            {getStatusIcon(campaign.status)}
                            {campaign.status.toUpperCase()}
                          </span>
                          {campaign.niche && (
                            <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-purple-50 text-purple-700">
                              {campaign.niche}
                            </span>
                          )}
                        </div>
                        {campaign.description && (
                          <p className="text-sm text-gray-600">{campaign.description}</p>
                        )}
                        <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                          <span className="flex items-center gap-1">
                            <Calendar size={12} />
                            Created {new Date(campaign.created_at).toLocaleDateString()}
                          </span>
                          {campaign.scheduled_at && (
                            <span className="flex items-center gap-1">
                              <Clock size={12} />
                              Scheduled for {new Date(campaign.scheduled_at).toLocaleString()}
                            </span>
                          )}
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setSelectedCampaign(campaign)}
                          className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                          title="View Details"
                        >
                          <Eye size={18} />
                        </button>
                        {campaign.status === 'active' && (
                          <button
                            onClick={() => pauseCampaign(campaign.id)}
                            className="p-2 text-yellow-600 hover:bg-yellow-50 rounded-lg transition-colors"
                            title="Pause Campaign"
                          >
                            <Pause size={18} />
                          </button>
                        )}
                        {campaign.status === 'paused' && (
                          <button
                            onClick={() => resumeCampaign(campaign.id)}
                            className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                            title="Resume Campaign"
                          >
                            <Play size={18} />
                          </button>
                        )}
                        <button
                          onClick={() => deleteCampaign(campaign.id)}
                          className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Delete Campaign"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </div>

                    {/* Campaign Stats */}
                    <div className="grid grid-cols-6 gap-4 pt-4 border-t border-gray-100">
                      <div>
                        <p className="text-xs text-gray-500 mb-1">Recipients</p>
                        <p className="text-lg font-semibold text-gray-900">{campaign.total_recipients}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 mb-1">Sent</p>
                        <p className="text-lg font-semibold text-gray-900">{campaign.sent_count}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 mb-1">Open Rate</p>
                        <p className="text-lg font-semibold text-green-600">{stats.openRate}%</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 mb-1">Click Rate</p>
                        <p className="text-lg font-semibold text-blue-600">{stats.clickRate}%</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 mb-1">Reply Rate</p>
                        <p className="text-lg font-semibold text-purple-600">{stats.replyRate}%</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 mb-1">Bounce Rate</p>
                        <p className="text-lg font-semibold text-red-600">{stats.bounceRate}%</p>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Create Campaign Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={() => setShowCreateModal(false)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-xl font-semibold text-gray-900">Create New Campaign</h2>
              <button onClick={() => setShowCreateModal(false)} className="text-gray-400 hover:text-gray-600">
                <XCircle size={24} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Campaign Name *</label>
                <input
                  type="text"
                  value={campaignName}
                  onChange={(e) => setCampaignName(e.target.value)}
                  placeholder="e.g., Rwanda Clinics Outreach Q1"
                  className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none transition-all"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Description</label>
                <textarea
                  value={campaignDescription}
                  onChange={(e) => setCampaignDescription(e.target.value)}
                  placeholder="Brief description of this campaign..."
                  rows={2}
                  className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none transition-all resize-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Niche/Category</label>
                <input
                  type="text"
                  value={selectedNiche}
                  onChange={(e) => setSelectedNiche(e.target.value)}
                  placeholder="e.g., Healthcare, Education, etc."
                  className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none transition-all"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Email Subject *</label>
                <input
                  type="text"
                  value={templateSubject}
                  onChange={(e) => setTemplateSubject(e.target.value)}
                  placeholder="Subject line for your emails"
                  className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none transition-all"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Email Body *</label>
                <textarea
                  value={templateBody}
                  onChange={(e) => setTemplateBody(e.target.value)}
                  placeholder="Your email content... Use {{company_name}}, {{location}}, etc. for personalization"
                  rows={8}
                  className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none transition-all resize-none font-mono text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Schedule Date (Optional)</label>
                  <input
                    type="date"
                    value={scheduledDate}
                    onChange={(e) => setScheduledDate(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none transition-all"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Schedule Time (Optional)</label>
                  <input
                    type="time"
                    value={scheduledTime}
                    onChange={(e) => setScheduledTime(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none transition-all"
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 px-5 py-2.5 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={createCampaign}
                  disabled={isCreating}
                  className="flex-1 px-5 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isCreating ? (
                    <>
                      <Loader2 size={18} className="animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <Plus size={18} />
                      Create Campaign
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Campaign Details Modal */}
      {selectedCampaign && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={() => setSelectedCampaign(null)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-xl font-semibold text-gray-900">{selectedCampaign.name}</h2>
              <button onClick={() => setSelectedCampaign(null)} className="text-gray-400 hover:text-gray-600">
                <XCircle size={24} />
              </button>
            </div>

            <div className="space-y-4">
              <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Email Template</h3>
                <p className="text-sm font-medium text-gray-900 mb-2">Subject: {selectedCampaign.template_subject}</p>
                <div className="bg-white rounded p-3 border border-gray-200">
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{selectedCampaign.template_body}</p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                {[
                  { label: 'Total Recipients', value: selectedCampaign.total_recipients, icon: Users },
                  { label: 'Sent', value: selectedCampaign.sent_count, icon: Send },
                  { label: 'Opened', value: selectedCampaign.opened_count, icon: Mail },
                  { label: 'Clicked', value: selectedCampaign.clicked_count, icon: TrendingUp },
                  { label: 'Replied', value: selectedCampaign.replied_count, icon: CheckCircle },
                  { label: 'Bounced', value: selectedCampaign.bounced_count, icon: XCircle },
                ].map((stat) => {
                  const Icon = stat.icon;
                  return (
                    <div key={stat.label} className="bg-gray-50 rounded-lg p-4 border border-gray-100">
                      <div className="flex items-center gap-2 mb-1">
                        <Icon size={14} className="text-gray-500" />
                        <p className="text-xs font-medium text-gray-500">{stat.label}</p>
                      </div>
                      <p className="text-2xl font-semibold text-gray-900">{stat.value}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
