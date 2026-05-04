"use client";

import { useState, useEffect } from "react";
import { Lead, GeneratedEmail, ToneType } from "@/types/platform";
import {
  Mail,
  RefreshCw,
  Copy,
  Save,
  ChevronDown,
  Loader2,
  CheckCircle,
  AlertCircle,
  Zap,
  Send,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  X,
  AtSign,
} from "lucide-react";
import { createClient } from "../../../supabase/client";
import { toast } from "sonner";

interface EmailWriterProps {
  userId: string;
  preloadedLead?: Lead | null;
}

const TONE_OPTIONS: { value: ToneType; desc: string }[] = [
  { value: "Direct", desc: "Clear, concise, professional — no fluff" },
  { value: "Aggressive", desc: "Hooks hard, creates urgency, pushes action" },
  { value: "Surgical", desc: "Deeply personalized, sniper-precise targeting" },
];

const SAMPLE_EMAILS: Record<
  ToneType,
  { subject: string; body: string; model: string }
> = {
  Direct: {
    model: "groq/llama-3-70b",
    subject: "Quick question about {company}'s growth",
    body: `Hi {name},

Noticed {company} is {context_snippet}.

We help companies like yours {value_prop} — typically seeing results within 30 days.

Worth a 15-minute call to see if there's a fit?

Best,
[Your Name]`,
  },
  Aggressive: {
    model: "groq/llama-3-70b",
    subject: "You're losing {X} every month — here's how to fix it",
    body: `{name},

Most {niche} companies are hemorrhaging revenue on {pain_point} and don't even realize it.

{company} is likely the same — and it's costing you more than you think.

We've solved this for 50+ companies. The ones that waited regret it.

15 minutes. This week. Yes or no?

[Your Name]`,
  },
  Surgical: {
    model: "groq/llama-3-70b",
    subject: "{company}'s approach to {specific_thing} caught my attention",
    body: `Hi {name},

I've been following {company}'s work on {specific_initiative} — particularly the way you {specific_detail}.

That approach makes the {pain_point} challenge even more acute for a company at your stage.

We've built a solution specifically for {niche} companies that {value_prop_specific}. Our work with {similar_company} resulted in {specific_metric}.

Would it make sense to spend 20 minutes exploring whether we can do the same for {company}?

[Your Name]`,
  },
};

export default function EmailWriterModule({ userId, preloadedLead }: EmailWriterProps) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(preloadedLead || null);
  const [tone, setTone] = useState<ToneType>("Direct");
  const [customPainPoint, setCustomPainPoint] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedEmail, setGeneratedEmail] = useState<{ subject: string; body: string; model: string } | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editSubject, setEditSubject] = useState("");
  const [editBody, setEditBody] = useState("");
  const [isCopied, setIsCopied] = useState(false);
  const [leadDropdownOpen, setLeadDropdownOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSendingSingle, setIsSendingSingle] = useState(false);
  const [isEnriching, setIsEnriching] = useState(false);
  const [enriched, setEnriched] = useState(false);

  // Manual send modal state
  const [showManualSendModal, setShowManualSendModal] = useState(false);
  const [manualEmail, setManualEmail] = useState("");
  const [isSendingManual, setIsSendingManual] = useState(false);

  // Bulk email generation states
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(new Set());
  const [bulkEmails, setBulkEmails] = useState<any[]>([]);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [isSending, setIsSending] = useState(false);
  const [yourCompany, setYourCompany] = useState("");
  const [yourService, setYourService] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [categories, setCategories] = useState<string[]>([]);

  const supabase = createClient();

  useEffect(() => {
    fetchLeads();
  }, []);

  useEffect(() => {
    if (preloadedLead) {
      setSelectedLead(preloadedLead);
      enrichLead(preloadedLead);
    }
  }, [preloadedLead]);

  const fetchLeads = async () => {
    const { data } = await supabase
      .from("leads")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (data) {
      setLeads(data as Lead[]);
      
      // Extract unique categories from niche
      const uniqueCategories = [...new Set(
        data
          .map((l: any) => l.niche)
          .filter(Boolean)
      )] as string[];
      setCategories(uniqueCategories);
    }
  };
  
  // Filter leads by category
  const filteredLeads = categoryFilter === "all" 
    ? leads 
    : leads.filter((l: any) => l.niche === categoryFilter);

  const generateEmail = async () => {
    if (!selectedLead) {
      toast.error("Please select a lead first");
      return;
    }
    setIsGenerating(true);
    setGeneratedEmail(null);

    await new Promise((r) => setTimeout(r, 1800));

    const template = SAMPLE_EMAILS[tone];
    const company = selectedLead.company_name;
    const niche = selectedLead.niche || "your industry";
    const painPoint = customPainPoint || "scaling outreach efficiency";

    const subject = template.subject
      .replace("{company}", company)
      .replace("{niche}", niche);

    const body = template.body
      .replace(/{company}/g, company)
      .replace(/{niche}/g, niche)
      .replace(/{pain_point}/g, painPoint)
      .replace(/{name}/g, "there")
      .replace(/{context_snippet}/g, selectedLead.company_context?.slice(0, 60) + "..." || "growing fast")
      .replace(/{value_prop}/g, "dramatically improve " + painPoint)
      .replace(/{value_prop_specific}/g, "solves exactly this problem")
      .replace(/{specific_initiative}/g, niche + " operations")
      .replace(/{specific_detail}/g, "approach your growth strategy")
      .replace(/{specific_metric}/g, "40% improvement in 60 days")
      .replace(/{similar_company}/g, "a top competitor")
      .replace(/{specific_thing}/g, niche + " strategy")
      .replace(/{X}/g, "$10K");

    setGeneratedEmail({ subject, body, model: template.model });
    setEditSubject(subject);
    setEditBody(body);
    setIsEditing(false);
    setIsGenerating(false);
  };

  const copyEmail = async () => {
    if (!generatedEmail) return;
    const text = `Subject: ${editSubject || generatedEmail.subject}\n\n${editBody || generatedEmail.body}`;
    await navigator.clipboard.writeText(text);
    setIsCopied(true);
    toast.success("Email copied to clipboard");
    setTimeout(() => setIsCopied(false), 2000);
  };

  const copyAndMarkSent = async () => {
    if (!generatedEmail || !selectedLead) return;
    await copyEmail();
    const { error } = await supabase
      .from("leads")
      .update({ status: "Email Sent", updated_at: new Date().toISOString() })
      .eq("id", selectedLead.id);
    if (!error) {
      toast.success("Lead marked as Email Sent");
      setSelectedLead({ ...selectedLead, status: "Email Sent" });
    }
  };

  const saveToLead = async () => {
    if (!generatedEmail || !selectedLead) return;
    setIsSaving(true);
    const { error } = await supabase.from("generated_emails").insert({
      user_id: userId,
      lead_id: selectedLead.id,
      subject: editSubject || generatedEmail.subject,
      body: editBody || generatedEmail.body,
      tone,
      model_used: generatedEmail.model,
    });
    if (!error) {
      toast.success("Email saved to lead profile");
    } else {
      toast.error("Failed to save email");
    }
    setIsSaving(false);
  };

  /**
   * Enrich a lead: visit their website, find real email, build real context.
   * Fires automatically when a lead is selected from the dropdown.
   */
  const enrichLead = async (lead: Lead) => {
    setIsEnriching(true);
    setEnriched(false);
    try {
      const res = await fetch("/api/enrich-lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId: lead.id,
          companyName: lead.company_name,
          website: (lead as any).website || null,
          niche: lead.niche || "",
          location: lead.location || "",
        }),
      });
      const data = await res.json();
      if (data.success && data.enriched) {
        // Update local state with real data
        const updated: Lead = {
          ...lead,
          email: data.email ?? lead.email,
          company_context: data.company_context ?? lead.company_context,
        };
        setSelectedLead(updated);
        // Also update the leads list so the dropdown shows the real email
        setLeads((prev) => prev.map((l) => (l.id === lead.id ? updated : l)));
        setEnriched(true);
        if (data.email && data.email !== lead.email) {
          toast.success(`Found real email: ${data.email}`);
        }
      } else {
        // No enrichment found — keep original data, still usable
        setEnriched(false);
      }
    } catch {
      // Silent fail — enrichment is best-effort
    } finally {
      setIsEnriching(false);
    }
  };

  /** Send the current single email via SMTP through /api/send-email */
  const sendSingleEmail = async () => {
    if (!generatedEmail || !selectedLead) return;
    if (!selectedLead.email) {
      toast.error("This lead has no email address");
      return;
    }

    setIsSendingSingle(true);
    try {
      const res = await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId: selectedLead.id,
          to: selectedLead.email,
          subject: editSubject || generatedEmail.subject,
          body: editBody || generatedEmail.body,
        }),
      });

      const data = await res.json();

      if (data.success) {
        toast.success(`Email sent to ${selectedLead.email} via ${data.accountUsed}`);
        // Optimistically update lead status in local state
        setSelectedLead({ ...selectedLead, status: "Email Sent" });
        // Also save to generated_emails for history
        await supabase.from("generated_emails").insert({
          user_id: userId,
          lead_id: selectedLead.id,
          subject: editSubject || generatedEmail.subject,
          body: editBody || generatedEmail.body,
          tone,
          model_used: generatedEmail.model,
        });
      } else {
        if (res.status === 429) {
          toast.error("Daily SMTP limit reached. Add more accounts or try tomorrow.");
        } else if (res.status === 404) {
          toast.error("No SMTP accounts configured. Add one in SMTP Manager first.");
        } else {
          toast.error(data.error || "Failed to send email");
        }
      }
    } catch (err) {
      toast.error("Network error — could not reach send endpoint");
    } finally {
      setIsSendingSingle(false);
    }
  };

  /** Send the current email to a manually entered address (no lead required) */
  const sendManualEmail = async () => {
    if (!generatedEmail) return;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(manualEmail)) {
      toast.error("Please enter a valid email address");
      return;
    }

    setIsSendingManual(true);
    try {
      const res = await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: manualEmail,
          subject: editSubject || generatedEmail.subject,
          body: editBody || generatedEmail.body,
          // leadId intentionally omitted — this is a manual send
        }),
      });

      const data = await res.json();

      if (data.success) {
        toast.success(`Email sent to ${manualEmail} via ${data.accountUsed}`);
        setShowManualSendModal(false);
        setManualEmail("");
      } else {
        if (res.status === 429) {
          toast.error("Daily SMTP limit reached. Add more accounts or try tomorrow.");
        } else if (res.status === 404) {
          toast.error("No SMTP accounts configured. Add one in SMTP Manager first.");
        } else {
          toast.error(data.error || "Failed to send email");
        }
      }
    } catch (err) {
      toast.error("Network error — could not reach send endpoint");
    } finally {
      setIsSendingManual(false);
    }
  };

  // Bulk email generation functions
  const toggleLeadSelection = (leadId: string) => {
    setSelectedLeadIds(prev => {
      const next = new Set(prev);
      if (next.has(leadId)) {
        next.delete(leadId);
      } else {
        next.add(leadId);
      }
      return next;
    });
  };

  const selectAllLeads = () => {
    if (selectedLeadIds.size === filteredLeads.length && filteredLeads.every(l => selectedLeadIds.has(l.id))) {
      // Deselect all filtered leads
      const newSet = new Set(selectedLeadIds);
      filteredLeads.forEach(l => newSet.delete(l.id));
      setSelectedLeadIds(newSet);
    } else {
      // Select all filtered leads
      const newSet = new Set(selectedLeadIds);
      filteredLeads.forEach(l => newSet.add(l.id));
      setSelectedLeadIds(newSet);
    }
  };

  const generateBulkEmails = async () => {
    if (selectedLeadIds.size === 0) {
      toast.error("Please select at least one lead");
      return;
    }

    if (!yourCompany || !yourService) {
      toast.error("Please enter your company name and service");
      return;
    }

    setIsGenerating(true);
    setBulkEmails([]);

    try {
      const selectedLeadsArray = leads.filter(l => selectedLeadIds.has(l.id));
      const emails = [];

      // Import the AI email generation function
      const { generatePersonalizedEmail } = await import('@/utils/smtp-manager');

      for (const lead of selectedLeadsArray) {
        try {
          // Use real AI to generate personalized email
          const { generateAIEmail } = await import('@/utils/ai-email-generator');
          
          const { subject, body } = await generateAIEmail({
            lead: {
              company_name: lead.company_name,
              niche: lead.niche,
              location: lead.location,
              company_context: lead.company_context
            },
            yourCompany,
            yourService,
            tone,
            customPainPoint: customPainPoint || undefined,
            userId
          });

          emails.push({
            lead,
            subject,
            body,
            model: "AI Generated"
          });
        } catch (error) {
          console.error(`Failed to generate email for ${lead.company_name}:`, error);
          
          // Fallback to template if AI fails
          const template = SAMPLE_EMAILS[tone];
          const company = lead.company_name;
          const niche = lead.niche || "your industry";
          const painPoint = customPainPoint || "scaling outreach efficiency";

          const subject = template.subject
            .replace("{company}", company)
            .replace("{niche}", niche);

          const body = template.body
            .replace(/{company}/g, company)
            .replace(/{niche}/g, niche)
            .replace(/{pain_point}/g, painPoint)
            .replace(/{name}/g, "there")
            .replace(/{context_snippet}/g, lead.company_context?.slice(0, 60) + "..." || "growing fast")
            .replace(/{value_prop}/g, `help with ${yourService}`)
            .replace(/{value_prop_specific}/g, yourService)
            .replace(/{specific_initiative}/g, niche + " operations")
            .replace(/{specific_detail}/g, "approach your growth strategy")
            .replace(/{specific_metric}/g, "40% improvement in 60 days")
            .replace(/{similar_company}/g, "a top competitor")
            .replace(/{specific_thing}/g, niche + " strategy")
            .replace(/{X}/g, "$10K")
            .replace(/\[Your Name\]/g, yourCompany);

          emails.push({
            lead,
            subject,
            body,
            model: "Template (AI failed)"
          });
        }
      }

      setBulkEmails(emails);
      setPreviewIndex(0);
      toast.success(`Generated ${emails.length} personalized emails using AI!`);
    } catch (error) {
      toast.error("Failed to generate emails");
    } finally {
      setIsGenerating(false);
    }
  };

  const sendTestEmail = async () => {
    if (bulkEmails.length === 0) {
      toast.error("No emails generated yet. Please generate emails first.");
      return;
    }
    
    const testEmail = prompt("Enter your email address to receive a test:");
    if (!testEmail || !testEmail.includes('@')) {
      toast.error("Please enter a valid email address");
      return;
    }
    
    setIsSending(true);
    try {
      const { sendBulkEmailsChunkedAction } = await import("@/app/actions");
      
      // Send only the current preview email as a test
      const currentEmail = bulkEmails[previewIndex];
      
      // Match the expected data structure from sendBulkEmailsChunkedAction
      const testEmailData = [{
        lead_id: currentEmail.lead?.id || 'test-lead',
        lead_email: testEmail,
        company_name: currentEmail.lead?.company_name || 'Test Company',
        subject: `[TEST] ${currentEmail.subject}`,
        body: currentEmail.body
      }];
      
      const result = await sendBulkEmailsChunkedAction(userId, testEmailData, {
        chunkSize: 1,
        delayBetweenEmails: 0,
        verifyEmails: false // Skip email verification for test sends
      });
      
      if (result.success) {
        toast.success(`Test email sent to ${testEmail}!`);
      } else {
        // Provide more detailed error message
        const errorMsg = result.error || "Failed to send test email";
        if (errorMsg.includes('No SMTP accounts')) {
          toast.error("No SMTP accounts configured. Please add an SMTP account first.");
        } else {
          toast.error(errorMsg);
        }
      }
    } catch (error) {
      console.error('Test email error:', error);
      const errorMsg = error instanceof Error ? error.message : "Failed to send test email";
      toast.error(errorMsg);
    } finally {
      setIsSending(false);
    }
  };

  const sendBulkEmails = async () => {
    if (bulkEmails.length === 0) return;

    setIsSending(true);

    try {
      // Import the action dynamically
      const { sendBulkEmailsChunkedAction } = await import("@/app/actions");
      
      const result = await sendBulkEmailsChunkedAction(userId, bulkEmails, {
        chunkSize: 100,
        delayBetweenEmails: 2000,
        verifyEmails: true
      });

      if (result.success) {
        toast.success(result.message || "Emails sent successfully!");
        setBulkEmails([]);
        setBulkMode(false);
        setSelectedLeadIds(new Set());
        fetchLeads(); // Refresh leads
      } else {
        toast.error(result.error || "Failed to send emails");
      }
    } catch (error) {
      toast.error("An error occurred while sending");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="flex flex-col h-full p-6 gap-5">
      {/* Mode Toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setBulkMode(false)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
              !bulkMode
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            Single Email
          </button>
          <button
            onClick={() => setBulkMode(true)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
              bulkMode
                ? "bg-purple-600 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            Bulk Email Generator
          </button>
        </div>
        {bulkMode && (
          <div className="text-sm text-gray-600">
            {selectedLeadIds.size} of {leads.length} leads selected
          </div>
        )}
      </div>

      {/* Bulk Mode UI */}
      {bulkMode ? (
        <div className="flex flex-col gap-5">
          {/* Company Info */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs uppercase tracking-widest mb-2 text-gray-600 font-semibold">
                Your Company Name
              </label>
              <input
                type="text"
                value={yourCompany}
                onChange={(e) => setYourCompany(e.target.value)}
                placeholder="e.g., Acme Solutions"
                className="w-full px-4 py-3 rounded-xl text-sm border border-gray-300 focus:border-gray-400 focus:ring-2 focus:ring-gray-200 bg-white text-gray-800 placeholder:text-gray-400"
              />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-widest mb-2 text-gray-600 font-semibold">
                Your Service/Product
              </label>
              <input
                type="text"
                value={yourService}
                onChange={(e) => setYourService(e.target.value)}
                placeholder="e.g., AI-powered marketing automation"
                className="w-full px-4 py-3 rounded-xl text-sm border border-gray-300 focus:border-gray-400 focus:ring-2 focus:ring-gray-200 bg-white text-gray-800 placeholder:text-gray-400"
              />
            </div>
          </div>

          {/* Tone & Pain Point */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs uppercase tracking-widest mb-2 text-gray-600 font-semibold">
                Tone
              </label>
              <div className="flex gap-2">
                {TONE_OPTIONS.map((t) => (
                  <button
                    key={t.value}
                    onClick={() => setTone(t.value)}
                    className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all ${
                      tone === t.value
                        ? "bg-blue-600 text-white"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}
                  >
                    {t.value}
                  </button>
                ))}
              </div>
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs uppercase tracking-widest mb-2 text-gray-600 font-semibold">
                Custom Pain Point (Optional)
              </label>
              <input
                type="text"
                placeholder="e.g., reducing churn, scaling sales team..."
                value={customPainPoint}
                onChange={(e) => setCustomPainPoint(e.target.value)}
                className="w-full px-4 py-3 rounded-xl text-sm border border-gray-300 focus:border-gray-400 focus:ring-2 focus:ring-gray-200 bg-white text-gray-800 placeholder:text-gray-400"
              />
            </div>
          </div>

          {/* Category Filter */}
          {categories.length > 0 && (
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Filter by Category
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setCategoryFilter("all")}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                  style={{
                    background: categoryFilter === "all" ? "#2563EB" : "#FFFFFF",
                    borderWidth: "2px",
                    borderStyle: "solid",
                    borderColor: categoryFilter === "all" ? "#2563EB" : "#E5E7EB",
                    color: categoryFilter === "all" ? "#FFFFFF" : "#6B7280"
                  }}
                >
                  All ({leads.length})
                </button>
                {categories.map((cat) => {
                  const count = leads.filter((l: any) => l.niche === cat).length;
                  return (
                    <button
                      key={cat}
                      onClick={() => setCategoryFilter(cat)}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                      style={{
                        background: categoryFilter === cat ? "#2563EB" : "#FFFFFF",
                        borderWidth: "2px",
                        borderStyle: "solid",
                        borderColor: categoryFilter === cat ? "#2563EB" : "#E5E7EB",
                        color: categoryFilter === cat ? "#FFFFFF" : "#6B7280"
                      }}
                    >
                      {cat} ({count})
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Lead Selection */}
          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <div className="bg-gray-50 px-4 py-3 flex items-center justify-between border-b border-gray-200">
              <h3 className="text-sm font-semibold text-gray-900">
                Select Leads ({selectedLeadIds.size} selected)
              </h3>
              <button
                onClick={selectAllLeads}
                className="text-sm text-blue-600 hover:text-blue-700 font-medium"
              >
                {selectedLeadIds.size === filteredLeads.length ? "Deselect All" : "Select All"}
              </button>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {filteredLeads.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  {categoryFilter === "all" 
                    ? "No leads in CRM. Add leads from the Scraper."
                    : `No leads found in "${categoryFilter}" category.`
                  }
                </div>
              ) : (
                filteredLeads.map((lead) => (
                  <div
                    key={lead.id}
                    onClick={() => toggleLeadSelection(lead.id)}
                    className={`px-4 py-3 border-b border-gray-100 cursor-pointer transition-colors ${
                      selectedLeadIds.has(lead.id)
                        ? "bg-blue-50 hover:bg-blue-100"
                        : "hover:bg-gray-50"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-5 h-5 rounded border-2 flex items-center justify-center ${
                          selectedLeadIds.has(lead.id)
                            ? "bg-blue-600 border-blue-600"
                            : "border-gray-300"
                        }`}
                      >
                        {selectedLeadIds.has(lead.id) && (
                          <CheckSquare size={14} className="text-white" />
                        )}
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-900">
                          {lead.company_name}
                        </p>
                        <p className="text-xs text-gray-600">
                          {lead.email} • {lead.niche}
                        </p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Generate Button */}
          <button
            onClick={generateBulkEmails}
            disabled={isGenerating || selectedLeadIds.size === 0}
            className="w-full py-4 bg-purple-600 text-white rounded-xl text-sm font-semibold hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isGenerating ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Generating {selectedLeadIds.size} Emails...
              </>
            ) : (
              <>
                <Zap size={16} />
                Generate {selectedLeadIds.size} Personalized Emails
              </>
            )}
          </button>

          {/* Preview Generated Emails */}
          {bulkEmails.length > 0 && (
            <div className="border border-purple-200 rounded-xl overflow-hidden bg-purple-50">
              <div className="bg-purple-600 px-4 py-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white">
                  Preview Generated Emails ({bulkEmails.length} total)
                </h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPreviewIndex(Math.max(0, previewIndex - 1))}
                    disabled={previewIndex === 0}
                    className="p-1 rounded hover:bg-purple-700 disabled:opacity-50"
                  >
                    <ChevronLeft size={16} className="text-white" />
                  </button>
                  <span className="text-sm text-white">
                    {previewIndex + 1} / {bulkEmails.length}
                  </span>
                  <button
                    onClick={() => setPreviewIndex(Math.min(bulkEmails.length - 1, previewIndex + 1))}
                    disabled={previewIndex === bulkEmails.length - 1}
                    className="p-1 rounded hover:bg-purple-700 disabled:opacity-50"
                  >
                    <ChevronRight size={16} className="text-white" />
                  </button>
                </div>
              </div>
              <div className="p-4 bg-white">
                <div className="mb-3">
                  <p className="text-xs text-gray-600 mb-1">To:</p>
                  <p className="text-sm font-medium text-gray-900">
                    {bulkEmails[previewIndex].company_name} ({bulkEmails[previewIndex].lead_email})
                  </p>
                </div>
                <div className="mb-3">
                  <p className="text-xs text-gray-600 mb-1">Subject:</p>
                  <p className="text-sm font-medium text-gray-900">
                    {bulkEmails[previewIndex].subject}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-600 mb-1">Body:</p>
                  <pre className="text-xs text-gray-700 whitespace-pre-wrap leading-relaxed bg-gray-50 p-3 rounded-lg">
                    {bulkEmails[previewIndex].body}
                  </pre>
                </div>
              </div>
              <div className="bg-gray-50 px-4 py-3 flex items-center justify-between border-t border-gray-200">
                <button
                  onClick={() => {
                    setBulkEmails([]);
                    setPreviewIndex(0);
                  }}
                  className="px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900"
                >
                  Cancel
                </button>
                <div className="flex items-center gap-2">
                  <button
                    onClick={sendTestEmail}
                    disabled={isSending}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center gap-2"
                  >
                    <Mail size={14} />
                    Send Test
                  </button>
                  <button
                    onClick={sendBulkEmails}
                    disabled={isSending}
                    className="px-6 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-700 transition-colors disabled:opacity-50 flex items-center gap-2"
                  >
                    {isSending ? (
                      <>
                        <Loader2 size={14} className="animate-spin" />
                        Sending...
                      </>
                    ) : (
                      <>
                        <Send size={14} />
                        Send All {bulkEmails.length} Emails
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Single Email Mode (existing UI) */
        <>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Lead Selector */}
        <div className="lg:col-span-2">
          <label className="block text-[10px] uppercase tracking-widest mb-2" style={{ color: "#000000", fontFamily: "Poppins, sans-serif", fontWeight: 600 }}>
            Select Lead
          </label>
          <div className="relative">
            <button
              onClick={() => setLeadDropdownOpen(!leadDropdownOpen)}
              className="w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm transition-all"
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid #2A2D35",
                color: selectedLead ? "#e8eaed" : "#555",
                fontFamily: "Poppins, sans-serif",
              }}
            >
              <span>
                {selectedLead ? `${selectedLead.company_name} — ${selectedLead.email}` : "Choose a lead..."}
              </span>
              <ChevronDown size={14} style={{ color: "#555" }} />
            </button>

            {leadDropdownOpen && (
              <div
                className="absolute top-full mt-1 left-0 right-0 rounded-lg z-20 overflow-hidden shadow-lg"
                style={{ 
                  background: "#F3F4F6", 
                  border: "1px solid #D1D5DB", 
                  maxHeight: "400px", 
                  overflowY: "auto",
                  scrollbarWidth: "none",
                  msOverflowStyle: "none"
                }}
              >
                <style jsx>{`
                  div::-webkit-scrollbar {
                    display: none;
                  }
                `}</style>
                {leads.length === 0 ? (
                  <div className="px-4 py-3 text-sm text-center" style={{ color: "#6B7280", fontFamily: "Poppins, sans-serif" }}>
                    No leads in CRM yet. Add leads from the Scraper.
                  </div>
                ) : (
                  leads.map((lead) => (
                    <button
                      key={lead.id}
                      className="w-full text-left px-4 py-3 hover:bg-gray-200 transition-colors border-b"
                      style={{ borderColor: "#E5E7EB" }}
                      onClick={() => {
                        setSelectedLead(lead);
                        setLeadDropdownOpen(false);
                        setGeneratedEmail(null);
                        enrichLead(lead);
                      }}
                    >
                      <p className="text-sm font-medium" style={{ color: "#111827", fontFamily: "Poppins, sans-serif" }}>
                        {lead.company_name}
                      </p>
                      <p className="text-xs mt-0.5" style={{ color: "#6B7280", fontFamily: "Poppins, sans-serif" }}>
                        {lead.email} · {lead.niche}
                      </p>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        {/* Tone selector */}
        <div>
          <label className="block text-[10px] uppercase tracking-widest mb-2" style={{ color: "#000000", fontFamily: "Poppins, sans-serif", fontWeight: 600 }}>
            Tone
          </label>
          <div className="flex gap-1.5">
            {TONE_OPTIONS.map((t) => (
              <button
                key={t.value}
                onClick={() => setTone(t.value)}
                className="flex-1 py-3 rounded-xl text-xs font-semibold transition-all"
                style={{
                  background: tone === t.value ? "#2563EB" : "rgba(255,255,255,0.03)",
                  border: tone === t.value ? "1px solid #2563EB" : "1px solid #2A2D35",
                  color: tone === t.value ? "#FFFFFF" : "#666",
                  fontFamily: "Poppins, sans-serif",
                }}
              >
                {t.value}
              </button>
            ))}
          </div>
          <p className="text-[10px] mt-1.5" style={{ color: "#000000", fontFamily: "Poppins, sans-serif" }}>
            {TONE_OPTIONS.find((t) => t.value === tone)?.desc}
          </p>
        </div>
      </div>

      {/* Lead context preview */}
      {selectedLead && (
        <div
          className="rounded-xl p-4"
          style={{ background: "rgba(0,212,255,0.04)", border: "1px solid rgba(0,212,255,0.12)" }}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <p className="text-sm font-semibold" style={{ color: "#e8eaed", fontFamily: "Poppins, sans-serif" }}>
                {selectedLead.company_name}
              </p>
              <div className="flex items-center gap-3 mt-1.5">
                {selectedLead.niche && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: "rgba(0,212,255,0.08)", color: "#00D4FF", border: "1px solid rgba(0,212,255,0.15)", fontFamily: "Poppins, sans-serif" }}>
                    {selectedLead.niche}
                  </span>
                )}
                {selectedLead.location && (
                  <span className="text-xs" style={{ color: "#666", fontFamily: "Poppins, sans-serif" }}>
                    📍 {selectedLead.location}
                  </span>
                )}
                <span
                  className="text-[10px] px-2 py-0.5 rounded-full"
                  style={{
                    background: selectedLead.status === "Email Sent" ? "rgba(245,166,35,0.1)" : "rgba(0,232,122,0.1)",
                    color: selectedLead.status === "Email Sent" ? "#F5A623" : "#00E87A",
                    border: `1px solid ${selectedLead.status === "Email Sent" ? "rgba(245,166,35,0.2)" : "rgba(0,232,122,0.2)"}`,
                    fontFamily: "Poppins, sans-serif"
                  }}
                >
                  {selectedLead.status}
                </span>
              </div>
              {selectedLead.company_context && (
                <p className="text-xs mt-2 line-clamp-2" style={{ color: "#666", fontFamily: "Poppins, sans-serif" }}>
                  {selectedLead.company_context}
                </p>
              )}
              {/* Enrichment status */}
              <div className="flex items-center gap-2 mt-2">
                {isEnriching && (
                  <span className="flex items-center gap-1 text-[10px]" style={{ color: "#F5A623" }}>
                    <Loader2 size={10} className="animate-spin" />
                    Researching company website…
                  </span>
                )}
                {!isEnriching && enriched && (
                  <span className="flex items-center gap-1 text-[10px]" style={{ color: "#00E87A" }}>
                    <CheckCircle size={10} />
                    Real data found — email will be personalised
                  </span>
                )}
                {!isEnriching && !enriched && selectedLead && (
                  <span className="flex items-center gap-1 text-[10px]" style={{ color: "#888" }}>
                    Using scraped data — add website URL for better results
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Custom pain point */}
      <div>
        <label className="block text-[10px] uppercase tracking-widest mb-2" style={{ color: "#000000", fontFamily: "Poppins, sans-serif", fontWeight: 600 }}>
          Custom Pain Point Override (Optional)
        </label>
        <input
          type="text"
          placeholder="e.g. reducing churn, scaling sales team, automating outreach..."
          value={customPainPoint}
          onChange={(e) => setCustomPainPoint(e.target.value)}
          className="w-full px-4 py-3 rounded-xl text-sm outline-none transition-all bg-white text-gray-800 placeholder:text-gray-400 border border-gray-300 focus:border-gray-400 focus:ring-2 focus:ring-gray-200"
          style={{
            fontFamily: "Poppins, sans-serif",
          }}
        />
      </div>

      {/* Generate button */}
      <button
        onClick={generateEmail}
        disabled={isGenerating || !selectedLead || isEnriching}
        className="flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold transition-all disabled:opacity-40"
        style={{
          background: "#2563EB",
          border: "1px solid #2563EB",
          color: "#FFFFFF",
          fontFamily: "Poppins, sans-serif",
        }}
      >
        {isGenerating ? (
          <>
            <Loader2 size={16} className="animate-spin" />
            Generating with AI...
          </>
        ) : (
          <>
            <Zap size={16} />
            Generate Email
          </>
        )}
      </button>

      {/* Generated Email */}
      {generatedEmail && (
        <div
          className="flex-1 rounded-xl overflow-hidden"
          style={{ border: "1px solid #2A2D35", background: "#13161e" }}
        >
          {/* Email header */}
          <div
            className="flex items-center justify-between px-4 py-3"
            style={{ background: "rgba(0,0,0,0.3)", borderBottom: "1px solid #1A1D24" }}
          >
            <div className="flex items-center gap-3">
              <Mail size={14} style={{ color: "#00D4FF" }} />
              <span className="text-xs font-medium" style={{ color: "#e8eaed", fontFamily: "Space Grotesk, sans-serif" }}>
                Generated Email
              </span>
            </div>
            <div className="flex items-center gap-2">
              {/* Model badge */}
              <span
                className="text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1"
                style={{ background: "rgba(245,166,35,0.08)", color: "#F5A623", border: "1px solid rgba(245,166,35,0.2)", fontFamily: "JetBrains Mono, monospace" }}
              >
                <Zap size={9} />
                {generatedEmail.model}
              </span>
              <button
                onClick={() => setIsEditing(!isEditing)}
                className="text-[10px] px-2 py-0.5 rounded-md transition-colors"
                style={{ color: "#666", background: "rgba(255,255,255,0.04)", border: "1px solid #2A2D35" }}
              >
                {isEditing ? "Preview" : "Edit"}
              </button>
            </div>
          </div>

          <div className="p-4 flex flex-col gap-3">
            {/* Subject */}
            <div>
              <label className="block text-[9px] uppercase tracking-widest mb-1.5" style={{ color: "#94a3b8", fontFamily: "JetBrains Mono, monospace" }}>
                Subject
              </label>
              {isEditing ? (
                <input
                  type="text"
                  value={editSubject}
                  onChange={(e) => setEditSubject(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                  style={{
                    background: "rgba(255,255,255,0.07)",
                    border: "1px solid #3A3D45",
                    color: "#f1f5f9",
                    fontFamily: "Space Grotesk, sans-serif",
                  }}
                />
              ) : (
                <p className="text-sm font-semibold px-3 py-2 rounded-lg" style={{ color: "#f1f5f9", background: "rgba(255,255,255,0.05)", fontFamily: "Space Grotesk, sans-serif" }}>
                  {editSubject || generatedEmail.subject}
                </p>
              )}
            </div>

            {/* Body */}
            <div>
              <label className="block text-[9px] uppercase tracking-widest mb-1.5" style={{ color: "#94a3b8", fontFamily: "JetBrains Mono, monospace" }}>
                Body
              </label>
              {isEditing ? (
                <textarea
                  value={editBody}
                  onChange={(e) => setEditBody(e.target.value)}
                  rows={8}
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none resize-none"
                  style={{
                    background: "rgba(255,255,255,0.07)",
                    border: "1px solid #3A3D45",
                    color: "#e2e8f0",
                    fontFamily: "JetBrains Mono, monospace",
                    lineHeight: "1.7",
                  }}
                />
              ) : (
                <pre
                  className="text-xs px-3 py-3 rounded-lg whitespace-pre-wrap leading-relaxed"
                  style={{
                    background: "rgba(255,255,255,0.05)",
                    color: "#e2e8f0",
                    fontFamily: "JetBrains Mono, monospace",
                    lineHeight: "1.7",
                    border: "1px solid rgba(255,255,255,0.06)",
                  }}
                >
                  {editBody || generatedEmail.body}
                </pre>
              )}
            </div>
          </div>

          {/* Actions */}
          <div
            className="flex items-center gap-2 px-4 py-3 flex-wrap"
            style={{ borderTop: "1px solid #1A1D24", background: "rgba(0,0,0,0.2)" }}
          >
            <button
              onClick={generateEmail}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all"
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid #2A2D35", color: "#888" }}
            >
              <RefreshCw size={12} />
              Regenerate
            </button>
            <button
              onClick={copyEmail}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all"
              style={{ background: "rgba(0,212,255,0.08)", border: "1px solid rgba(0,212,255,0.2)", color: "#00D4FF" }}
            >
              {isCopied ? <CheckCircle size={12} /> : <Copy size={12} />}
              {isCopied ? "Copied!" : "Copy"}
            </button>
            <button
              onClick={saveToLead}
              disabled={isSaving}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all"
              style={{ background: "rgba(0,232,122,0.08)", border: "1px solid rgba(0,232,122,0.2)", color: "#00E87A" }}
            >
              {isSaving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              Save to Lead
            </button>
            <button
              onClick={copyAndMarkSent}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ml-auto"
              style={{ background: "rgba(245,166,35,0.1)", border: "1px solid rgba(245,166,35,0.3)", color: "#F5A623" }}
            >
              <Send size={12} />
              Copy & Mark Sent
            </button>
            <button
              onClick={sendSingleEmail}
              disabled={isSendingSingle || !selectedLead?.email}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: "rgba(37,99,235,0.1)", border: "1px solid rgba(37,99,235,0.35)", color: "#2563EB" }}
              title={!selectedLead?.email ? "Lead has no email address" : "Send via your SMTP account"}
            >
              {isSendingSingle ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
              {isSendingSingle ? "Sending…" : "Send via SMTP"}
            </button>
            <button
              onClick={() => setShowManualSendModal(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all"
              style={{ background: "rgba(168,85,247,0.1)", border: "1px solid rgba(168,85,247,0.35)", color: "#a855f7" }}
              title="Send to any email address you enter manually"
            >
              <AtSign size={12} />
              Send to Any Email
            </button>
          </div>
        </div>
      )}

      {/* Manual Send Modal */}
      {showManualSendModal && generatedEmail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)" }}>
          <div className="w-full max-w-md rounded-2xl overflow-hidden shadow-2xl" style={{ background: "#1a1d24", border: "1px solid #2A2D35" }}>
            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid #2A2D35" }}>
              <div className="flex items-center gap-2">
                <AtSign size={16} style={{ color: "#a855f7" }} />
                <span className="text-sm font-semibold" style={{ color: "#e8eaed", fontFamily: "Poppins, sans-serif" }}>
                  Send to Custom Email
                </span>
              </div>
              <button
                onClick={() => { setShowManualSendModal(false); setManualEmail(""); }}
                className="p-1 rounded-lg transition-colors hover:bg-white/10"
              >
                <X size={16} style={{ color: "#666" }} />
              </button>
            </div>

            {/* Modal body */}
            <div className="p-5 flex flex-col gap-4">
              <p className="text-xs" style={{ color: "#888", fontFamily: "Poppins, sans-serif" }}>
                Send this email to any address — not just leads in your CRM. The email will be sent via your configured SMTP account.
              </p>

              {/* Email preview summary */}
              <div className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid #2A2D35" }}>
                <p className="text-[10px] uppercase tracking-widest mb-1" style={{ color: "#666", fontFamily: "JetBrains Mono, monospace" }}>Subject</p>
                <p className="text-xs font-medium" style={{ color: "#e8eaed", fontFamily: "Space Grotesk, sans-serif" }}>
                  {editSubject || generatedEmail.subject}
                </p>
              </div>

              {/* Recipient input */}
              <div>
                <label className="block text-[10px] uppercase tracking-widest mb-2" style={{ color: "#94a3b8", fontFamily: "JetBrains Mono, monospace" }}>
                  Recipient Email Address
                </label>
                <input
                  type="email"
                  value={manualEmail}
                  onChange={(e) => setManualEmail(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") sendManualEmail(); }}
                  placeholder="e.g. john@company.com"
                  autoFocus
                  className="w-full px-4 py-3 rounded-xl text-sm outline-none transition-all"
                  style={{
                    background: "rgba(255,255,255,0.07)",
                    border: "1px solid #3A3D45",
                    color: "#f1f5f9",
                    fontFamily: "Space Grotesk, sans-serif",
                  }}
                />
              </div>

              {/* Actions */}
              <div className="flex items-center gap-3 pt-1">
                <button
                  onClick={() => { setShowManualSendModal(false); setManualEmail(""); }}
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-all"
                  style={{ background: "rgba(255,255,255,0.05)", border: "1px solid #2A2D35", color: "#888" }}
                >
                  Cancel
                </button>
                <button
                  onClick={sendManualEmail}
                  disabled={isSendingManual || !manualEmail}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  style={{ background: "#a855f7", border: "1px solid #a855f7", color: "#fff" }}
                >
                  {isSendingManual ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      Sending…
                    </>
                  ) : (
                    <>
                      <Send size={14} />
                      Send Email
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {!generatedEmail && !isGenerating && selectedLead && (
        <div
          className="flex-1 rounded-xl flex items-center justify-center"
          style={{ border: "1px dashed #1A1D24" }}
        >
          <div className="text-center">
            <Mail size={28} className="mx-auto mb-2" style={{ color: "#2A2D35" }} />
            <p className="text-sm" style={{ color: "#000000", fontFamily: "Space Grotesk, sans-serif" }}>
              Click Generate Email to create a personalized cold email
            </p>
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );
}
