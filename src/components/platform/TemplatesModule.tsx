"use client";

import { useState, useEffect } from "react";
import { createClient } from "../../../supabase/client";
import { toast } from "sonner";
import {
  FileText, Plus, Trash2, Edit, Copy, CheckCircle,
  Loader2, Save, X, Sparkles, Tag, Star
} from "lucide-react";

interface EmailTemplate {
  id: string;
  user_id: string;
  name: string;
  subject: string;
  body: string;
  tone: string;
  niche: string | null;
  variables: string[];
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

interface TemplatesModuleProps {
  userId: string;
}

export default function TemplatesModule({ userId }: TemplatesModuleProps) {
  const supabase = createClient();
  
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<EmailTemplate | null>(null);
  
  // Form state
  const [templateName, setTemplateName] = useState("");
  const [templateSubject, setTemplateSubject] = useState("");
  const [templateBody, setTemplateBody] = useState("");
  const [templateTone, setTemplateTone] = useState("Direct");
  const [templateNiche, setTemplateNiche] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    fetchTemplates();
    
    // Real-time subscription
    const channel = supabase
      .channel('templates_changes')
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'email_templates',
        filter: `user_id=eq.${userId}`
      }, () => {
        fetchTemplates();
      })
      .subscribe();
    
    return () => {
      channel.unsubscribe();
    };
  }, [userId]);

  const fetchTemplates = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('email_templates')
      .select('*')
      .eq('user_id', userId)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('Error fetching templates:', error);
      toast.error('Failed to load templates');
    } else {
      setTemplates(data || []);
    }
    setLoading(false);
  };

  const openCreateModal = () => {
    resetForm();
    setEditingTemplate(null);
    setShowCreateModal(true);
  };

  const openEditModal = (template: EmailTemplate) => {
    setTemplateName(template.name);
    setTemplateSubject(template.subject);
    setTemplateBody(template.body);
    setTemplateTone(template.tone);
    setTemplateNiche(template.niche || "");
    setIsDefault(template.is_default);
    setEditingTemplate(template);
    setShowCreateModal(true);
  };

  const resetForm = () => {
    setTemplateName("");
    setTemplateSubject("");
    setTemplateBody("");
    setTemplateTone("Direct");
    setTemplateNiche("");
    setIsDefault(false);
  };

  const extractVariables = (text: string): string[] => {
    const regex = /\{\{([^}]+)\}\}/g;
    const matches = text.matchAll(regex);
    const vars = new Set<string>();
    for (const match of matches) {
      vars.add(match[1].trim());
    }
    return Array.from(vars);
  };

  const saveTemplate = async () => {
    if (!templateName.trim()) {
      toast.error('Template name is required');
      return;
    }
    if (!templateSubject.trim() || !templateBody.trim()) {
      toast.error('Subject and body are required');
      return;
    }

    setIsSaving(true);
    
    const variables = extractVariables(templateSubject + " " + templateBody);
    
    const templateData = {
      user_id: userId,
      name: templateName,
      subject: templateSubject,
      body: templateBody,
      tone: templateTone,
      niche: templateNiche || null,
      variables,
      is_default: isDefault,
      updated_at: new Date().toISOString(),
    };

    if (editingTemplate) {
      // Update existing
      const { error } = await supabase
        .from('email_templates')
        .update(templateData)
        .eq('id', editingTemplate.id);
      
      if (error) {
        console.error('Error updating template:', error);
        toast.error('Failed to update template');
      } else {
        toast.success('Template updated successfully!');
        setShowCreateModal(false);
        fetchTemplates();
      }
    } else {
      // Create new
      const { error } = await supabase
        .from('email_templates')
        .insert(templateData);
      
      if (error) {
        console.error('Error creating template:', error);
        toast.error('Failed to create template');
      } else {
        toast.success('Template created successfully!');
        setShowCreateModal(false);
        fetchTemplates();
      }
    }
    
    setIsSaving(false);
  };

  const deleteTemplate = async (id: string) => {
    if (!confirm('Are you sure you want to delete this template?')) return;
    
    const { error } = await supabase
      .from('email_templates')
      .delete()
      .eq('id', id);
    
    if (error) {
      toast.error('Failed to delete template');
    } else {
      toast.success('Template deleted');
      fetchTemplates();
    }
  };

  const duplicateTemplate = async (template: EmailTemplate) => {
    const { error } = await supabase
      .from('email_templates')
      .insert({
        user_id: userId,
        name: template.name + " (Copy)",
        subject: template.subject,
        body: template.body,
        tone: template.tone,
        niche: template.niche,
        variables: template.variables,
        is_default: false,
      });
    
    if (error) {
      toast.error('Failed to duplicate template');
    } else {
      toast.success('Template duplicated');
      fetchTemplates();
    }
  };

  const setAsDefault = async (id: string) => {
    // First, unset all defaults
    await supabase
      .from('email_templates')
      .update({ is_default: false })
      .eq('user_id', userId);
    
    // Then set this one as default
    const { error } = await supabase
      .from('email_templates')
      .update({ is_default: true })
      .eq('id', id);
    
    if (error) {
      toast.error('Failed to set default template');
    } else {
      toast.success('Default template updated');
      fetchTemplates();
    }
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
              <FileText size={28} className="text-blue-600" />
              Email Templates
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Save and reuse your best-performing email templates
            </p>
          </div>
          <button
            onClick={openCreateModal}
            className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            <Plus size={18} />
            New Template
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mt-6">
          {[
            { label: 'Total Templates', value: templates.length, icon: FileText, color: 'blue' },
            { label: 'Default Template', value: templates.filter(t => t.is_default).length, icon: Star, color: 'yellow' },
            { label: 'With Variables', value: templates.filter(t => t.variables.length > 0).length, icon: Tag, color: 'blue' },
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

      {/* Templates List */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        {templates.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <FileText size={28} className="text-gray-400" />
            </div>
            <p className="text-gray-900 font-medium text-base">No templates yet</p>
            <p className="text-gray-500 text-sm mt-1">Create your first email template to save time</p>
            <button
              onClick={openCreateModal}
              className="mt-4 px-5 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors inline-flex items-center gap-2"
            >
              <Plus size={18} />
              Create Template
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 max-w-7xl">
            {templates.map((template) => (
              <div
                key={template.id}
                className="bg-white rounded-lg border border-gray-200 hover:border-gray-300 transition-colors overflow-hidden"
              >
                <div className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-base font-semibold text-gray-900 truncate">{template.name}</h3>
                        {template.is_default && (
                          <Star size={14} className="text-yellow-500 fill-yellow-500 flex-shrink-0" />
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-100">
                          {template.tone}
                        </span>
                        {template.niche && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-100">
                            {template.niche}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="mb-3">
                    <p className="text-xs font-medium text-gray-500 mb-1">Subject:</p>
                    <p className="text-sm text-gray-700 line-clamp-2">{template.subject}</p>
                  </div>

                  <div className="mb-3">
                    <p className="text-xs font-medium text-gray-500 mb-1">Body Preview:</p>
                    <p className="text-xs text-gray-600 line-clamp-3">{template.body}</p>
                  </div>

                  {template.variables.length > 0 && (
                    <div className="mb-3">
                      <p className="text-xs font-medium text-gray-500 mb-1">Variables:</p>
                      <div className="flex flex-wrap gap-1">
                        {template.variables.map((v) => (
                          <span key={v} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-mono">
                            {`{{${v}}}`}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-2 pt-3 border-t border-gray-100">
                    <button
                      onClick={() => openEditModal(template)}
                      className="flex-1 p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors text-xs font-medium flex items-center justify-center gap-1"
                    >
                      <Edit size={14} />
                      Edit
                    </button>
                    <button
                      onClick={() => duplicateTemplate(template)}
                      className="flex-1 p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors text-xs font-medium flex items-center justify-center gap-1"
                    >
                      <Copy size={14} />
                      Duplicate
                    </button>
                    {!template.is_default && (
                      <button
                        onClick={() => setAsDefault(template.id)}
                        className="p-2 text-yellow-600 hover:bg-yellow-50 rounded-lg transition-colors"
                        title="Set as default"
                      >
                        <Star size={14} />
                      </button>
                    )}
                    <button
                      onClick={() => deleteTemplate(template.id)}
                      className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      title="Delete"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create/Edit Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={() => setShowCreateModal(false)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-xl font-semibold text-gray-900">
                {editingTemplate ? 'Edit Template' : 'Create New Template'}
              </h2>
              <button onClick={() => setShowCreateModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={24} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Template Name *</label>
                <input
                  type="text"
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder="e.g., Cold Outreach - Healthcare"
                  className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none transition-all"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Tone</label>
                  <select
                    value={templateTone}
                    onChange={(e) => setTemplateTone(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none transition-all"
                  >
                    <option value="Direct">Direct</option>
                    <option value="Aggressive">Aggressive</option>
                    <option value="Surgical">Surgical</option>
                    <option value="Professional">Professional</option>
                    <option value="Friendly">Friendly</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Niche (Optional)</label>
                  <input
                    type="text"
                    value={templateNiche}
                    onChange={(e) => setTemplateNiche(e.target.value)}
                    placeholder="e.g., Healthcare, SaaS, etc."
                    className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Subject Line *</label>
                <input
                  type="text"
                  value={templateSubject}
                  onChange={(e) => setTemplateSubject(e.target.value)}
                  placeholder="Use {{company_name}}, {{location}}, etc. for personalization"
                  className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none transition-all"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Email Body *</label>
                <textarea
                  value={templateBody}
                  onChange={(e) => setTemplateBody(e.target.value)}
                  placeholder="Use {{company_name}}, {{location}}, {{niche}}, etc. for personalization"
                  rows={12}
                  className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none transition-all resize-none font-mono text-sm"
                />
                <p className="text-xs text-gray-500 mt-1">
                  💡 Tip: Use {`{{variable_name}}`} for dynamic content. Common variables: company_name, location, niche, your_company, your_service
                </p>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isDefault"
                  checked={isDefault}
                  onChange={(e) => setIsDefault(e.target.checked)}
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <label htmlFor="isDefault" className="text-sm text-gray-700">
                  Set as default template
                </label>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 px-5 py-2.5 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={saveTemplate}
                  disabled={isSaving}
                  className="flex-1 px-5 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isSaving ? (
                    <>
                      <Loader2 size={18} className="animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save size={18} />
                      {editingTemplate ? 'Update Template' : 'Create Template'}
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
