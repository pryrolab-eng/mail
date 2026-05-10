"use client";

import { useState, useEffect } from "react";
import { createClient } from "../../../supabase/client";
import { toast } from "sonner";
import {
  GitBranch, Plus, Trash2, Edit, Save, X, Loader2,
  Clock, Mail, ArrowRight, Play, Pause, CheckCircle
} from "lucide-react";

interface EmailSequence {
  id: string;
  campaign_id: string;
  sequence_number: number;
  delay_days: number;
  subject_template: string | null;
  body_template: string | null;
  tone: string | null;
  created_at: string;
}

interface Campaign {
  id: string;
  name: string;
  status: string;
}

interface SequencesModuleProps {
  userId: string;
}

export default function SequencesModule({ userId }: SequencesModuleProps) {
  const supabase = createClient();
  
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>("");
  const [sequences, setSequences] = useState<EmailSequence[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingSequence, setEditingSequence] = useState<EmailSequence | null>(null);
  
  // Form state
  const [sequenceNumber, setSequenceNumber] = useState(1);
  const [delayDays, setDelayDays] = useState(3);
  const [subjectTemplate, setSubjectTemplate] = useState("");
  const [bodyTemplate, setBodyTemplate] = useState("");
  const [tone, setTone] = useState("Direct");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    fetchCampaigns();
  }, [userId]);

  useEffect(() => {
    if (selectedCampaignId) {
      fetchSequences(selectedCampaignId);
    }
  }, [selectedCampaignId]);

  const fetchCampaigns = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('email_campaigns')
      .select('id, name, status')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('Error fetching campaigns:', error);
      toast.error('Failed to load campaigns');
    } else {
      setCampaigns(data || []);
      if (data && data.length > 0 && !selectedCampaignId) {
        setSelectedCampaignId(data[0].id);
      }
    }
    setLoading(false);
  };

  const fetchSequences = async (campaignId: string) => {
    const { data, error } = await supabase
      .from('email_sequences')
      .select('*')
      .eq('campaign_id', campaignId)
      .order('sequence_number', { ascending: true });
    
    if (error) {
      console.error('Error fetching sequences:', error);
      toast.error('Failed to load sequences');
    } else {
      setSequences(data || []);
    }
  };

  const openCreateModal = () => {
    resetForm();
    setEditingSequence(null);
    // Set next sequence number
    const maxSeq = sequences.length > 0 ? Math.max(...sequences.map(s => s.sequence_number)) : 0;
    setSequenceNumber(maxSeq + 1);
    setShowCreateModal(true);
  };

  const openEditModal = (sequence: EmailSequence) => {
    setSequenceNumber(sequence.sequence_number);
    setDelayDays(sequence.delay_days);
    setSubjectTemplate(sequence.subject_template || "");
    setBodyTemplate(sequence.body_template || "");
    setTone(sequence.tone || "Direct");
    setEditingSequence(sequence);
    setShowCreateModal(true);
  };

  const resetForm = () => {
    setSequenceNumber(1);
    setDelayDays(3);
    setSubjectTemplate("");
    setBodyTemplate("");
    setTone("Direct");
  };

  const saveSequence = async () => {
    if (!selectedCampaignId) {
      toast.error('Select a campaign first');
      return;
    }
    if (!subjectTemplate.trim() || !bodyTemplate.trim()) {
      toast.error('Subject and body are required');
      return;
    }

    setIsSaving(true);
    
    const sequenceData = {
      campaign_id: selectedCampaignId,
      sequence_number: sequenceNumber,
      delay_days: delayDays,
      subject_template: subjectTemplate,
      body_template: bodyTemplate,
      tone,
    };

    if (editingSequence) {
      // Update existing
      const { error } = await supabase
        .from('email_sequences')
        .update(sequenceData)
        .eq('id', editingSequence.id);
      
      if (error) {
        console.error('Error updating sequence:', error);
        toast.error('Failed to update sequence');
      } else {
        toast.success('Sequence updated successfully!');
        setShowCreateModal(false);
        fetchSequences(selectedCampaignId);
      }
    } else {
      // Create new
      const { error } = await supabase
        .from('email_sequences')
        .insert(sequenceData);
      
      if (error) {
        console.error('Error creating sequence:', error);
        toast.error('Failed to create sequence');
      } else {
        toast.success('Sequence created successfully!');
        setShowCreateModal(false);
        fetchSequences(selectedCampaignId);
      }
    }
    
    setIsSaving(false);
  };

  const deleteSequence = async (id: string) => {
    if (!confirm('Are you sure you want to delete this sequence step?')) return;
    
    const { error } = await supabase
      .from('email_sequences')
      .delete()
      .eq('id', id);
    
    if (error) {
      toast.error('Failed to delete sequence');
    } else {
      toast.success('Sequence deleted');
      fetchSequences(selectedCampaignId);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={32} className="animate-spin text-blue-600" />
      </div>
    );
  }

  const selectedCampaign = campaigns.find(c => c.id === selectedCampaignId);

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="border-b border-gray-200 px-8 py-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900 flex items-center gap-2">
              <GitBranch size={28} className="text-indigo-600" />
              Follow-Up Sequences
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Create automated follow-up sequences for your campaigns
            </p>
          </div>
          <button
            onClick={openCreateModal}
            disabled={!selectedCampaignId}
            className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus size={18} />
            Add Step
          </button>
        </div>

        {/* Campaign Selector */}
        <div className="mt-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">Select Campaign</label>
          <select
            value={selectedCampaignId}
            onChange={(e) => setSelectedCampaignId(e.target.value)}
            className="w-full max-w-md px-4 py-2.5 rounded-lg border border-gray-300 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none transition-all"
          >
            {campaigns.length === 0 ? (
              <option value="">No campaigns available</option>
            ) : (
              campaigns.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>
                  {campaign.name} ({campaign.status})
                </option>
              ))
            )}
          </select>
        </div>
      </div>

      {/* Sequences List */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        {!selectedCampaignId ? (
          <div className="text-center py-16">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <GitBranch size={28} className="text-gray-400" />
            </div>
            <p className="text-gray-900 font-medium text-base">No campaign selected</p>
            <p className="text-gray-500 text-sm mt-1">Create a campaign first, then add follow-up sequences</p>
          </div>
        ) : sequences.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <GitBranch size={28} className="text-gray-400" />
            </div>
            <p className="text-gray-900 font-medium text-base">No sequences yet</p>
            <p className="text-gray-500 text-sm mt-1">Add follow-up steps to automate your outreach</p>
            <button
              onClick={openCreateModal}
              className="mt-4 px-5 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors inline-flex items-center gap-2"
            >
              <Plus size={18} />
              Add First Step
            </button>
          </div>
        ) : (
          <div className="max-w-4xl">
            {/* Visual Sequence Flow */}
            <div className="mb-8">
              <h3 className="text-sm font-semibold text-gray-700 mb-4">Sequence Flow</h3>
              <div className="flex items-center gap-4 overflow-x-auto pb-4">
                {/* Initial Email */}
                <div className="flex-shrink-0 bg-blue-50 border-2 border-blue-200 rounded-lg p-4 min-w-[200px]">
                  <div className="flex items-center gap-2 mb-2">
                    <Mail size={16} className="text-blue-600" />
                    <span className="text-sm font-semibold text-blue-900">Initial Email</span>
                  </div>
                  <p className="text-xs text-blue-700">Campaign start</p>
                </div>

                {sequences.map((seq, index) => (
                  <div key={seq.id} className="flex items-center gap-4 flex-shrink-0">
                    <ArrowRight size={20} className="text-gray-400" />
                    <div className="bg-white border-2 border-indigo-200 rounded-lg p-4 min-w-[200px]">
                      <div className="flex items-center gap-2 mb-2">
                        <Clock size={16} className="text-indigo-600" />
                        <span className="text-sm font-semibold text-indigo-900">
                          Step {seq.sequence_number}
                        </span>
                      </div>
                      <p className="text-xs text-indigo-700">
                        After {seq.delay_days} day{seq.delay_days !== 1 ? 's' : ''}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Detailed Sequence Steps */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-gray-700">Sequence Steps</h3>
              {sequences.map((sequence) => (
                <div
                  key={sequence.id}
                  className="bg-white rounded-lg border border-gray-200 hover:border-gray-300 transition-colors overflow-hidden"
                >
                  <div className="p-5">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center">
                          <span className="text-indigo-700 font-bold text-sm">{sequence.sequence_number}</span>
                        </div>
                        <div>
                          <h4 className="text-base font-semibold text-gray-900">
                            Follow-up #{sequence.sequence_number}
                          </h4>
                          <div className="flex items-center gap-2 mt-1">
                            <Clock size={14} className="text-gray-400" />
                            <span className="text-sm text-gray-600">
                              Sent {sequence.delay_days} day{sequence.delay_days !== 1 ? 's' : ''} after previous email
                            </span>
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openEditModal(sequence)}
                          className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                          title="Edit"
                        >
                          <Edit size={18} />
                        </button>
                        <button
                          onClick={() => deleteSequence(sequence.id)}
                          className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Delete"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div>
                        <p className="text-xs font-medium text-gray-500 mb-1">Subject:</p>
                        <p className="text-sm text-gray-900">{sequence.subject_template}</p>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-gray-500 mb-1">Body Preview:</p>
                        <p className="text-sm text-gray-700 line-clamp-3 whitespace-pre-wrap">
                          {sequence.body_template}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs px-2 py-1 rounded-full bg-purple-50 text-purple-600 border border-purple-100">
                          {sequence.tone}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Create/Edit Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={() => setShowCreateModal(false)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-xl font-semibold text-gray-900">
                {editingSequence ? 'Edit Sequence Step' : 'Add Sequence Step'}
              </h2>
              <button onClick={() => setShowCreateModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={24} />
              </button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Step Number</label>
                  <input
                    type="number"
                    min="1"
                    value={sequenceNumber}
                    onChange={(e) => setSequenceNumber(Number(e.target.value))}
                    className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none transition-all"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Delay (Days)</label>
                  <input
                    type="number"
                    min="1"
                    value={delayDays}
                    onChange={(e) => setDelayDays(Number(e.target.value))}
                    className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Tone</label>
                <select
                  value={tone}
                  onChange={(e) => setTone(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none transition-all"
                >
                  <option value="Direct">Direct</option>
                  <option value="Aggressive">Aggressive</option>
                  <option value="Surgical">Surgical</option>
                  <option value="Professional">Professional</option>
                  <option value="Friendly">Friendly</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Subject Template *</label>
                <input
                  type="text"
                  value={subjectTemplate}
                  onChange={(e) => setSubjectTemplate(e.target.value)}
                  placeholder="Use {{company_name}}, {{location}}, etc."
                  className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none transition-all"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Body Template *</label>
                <textarea
                  value={bodyTemplate}
                  onChange={(e) => setBodyTemplate(e.target.value)}
                  placeholder="Use {{company_name}}, {{location}}, etc. for personalization"
                  rows={10}
                  className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none transition-all resize-none font-mono text-sm"
                />
                <p className="text-xs text-gray-500 mt-1">
                  💡 Tip: Reference the previous email with context. Keep follow-ups short and add value.
                </p>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 px-5 py-2.5 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={saveSequence}
                  disabled={isSaving}
                  className="flex-1 px-5 py-2.5 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isSaving ? (
                    <>
                      <Loader2 size={18} className="animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save size={18} />
                      {editingSequence ? 'Update Step' : 'Add Step'}
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
