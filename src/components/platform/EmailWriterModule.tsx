"use client";

import { useState, useEffect, useRef } from "react";
import { Lead, ToneType } from "@/types/platform";
import {
  Mail, RefreshCw, Copy, Save, ChevronDown, Loader2,
  CheckCircle, Zap, Send, CheckSquare, Square,
  ChevronLeft, ChevronRight, X, AtSign, Edit3,
  Users, Sparkles, PenLine,
} from "lucide-react";
import { createClient } from "../../../supabase/client";
import { toast } from "sonner";

interface EmailWriterProps {
  userId: string;
  preloadedLead?: Lead | null;
}

const TONE_OPTIONS: { value: ToneType; label: string; desc: string; color: string }[] = [
  { value: "Direct",    label: "Direct",    desc: "Hard direct. No politeness. Problem → Solution → CTA",              color: "#2563EB" },
  { value: "Aggressive",label: "Aggressive",desc: "High urgency, creates FOMO, pushes action hard",       color: "#DC2626" },
  { value: "Surgical",  label: "Surgical",  desc: "Hyper-personalized, proves you did your homework",     color: "#7C3AED" },
];

export default function EmailWriterModule({ userId, preloadedLead }: EmailWriterProps) {
  const supabase = createClient();

  // ── Shared ────────────────────────────────────────────────────────────────
  const [leads, setLeads]           = useState<Lead[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [mode, setMode]             = useState<"single" | "bulk" | "manual">("single");

  // ── Single mode ───────────────────────────────────────────────────────────
  const [selectedLead, setSelectedLead]       = useState<Lead | null>(preloadedLead || null);
  const [tone, setTone]                       = useState<ToneType>("Direct");
  const [yourCompany, setYourCompany]         = useState("");
  const [yourService, setYourService]         = useState("");
  const [customPainPoint, setCustomPainPoint] = useState("");
  const [isGenerating, setIsGenerating]       = useState(false);
  const [generatedEmail, setGeneratedEmail]   = useState<{ subject: string; body: string; model: string } | null>(null);
  const [isEditing, setIsEditing]             = useState(false);
  const [editSubject, setEditSubject]         = useState("");
  const [editBody, setEditBody]               = useState("");
  const [isCopied, setIsCopied]               = useState(false);
  const [leadDropdownOpen, setLeadDropdownOpen] = useState(false);
  const [leadSearch, setLeadSearch]           = useState("");
  const [isSaving, setIsSaving]               = useState(false);
  const [isSendingSingle, setIsSendingSingle] = useState(false);
  const [isEnriching, setIsEnriching]         = useState(false);
  const [enriched, setEnriched]               = useState(false);
  // Custom recipient override for single mode
  const [useCustomRecipient, setUseCustomRecipient] = useState(false);
  const [customRecipient, setCustomRecipient]       = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  // ── Manual compose ────────────────────────────────────────────────────────
  const [manualTo, setManualTo]           = useState("");
  const [manualSubject, setManualSubject] = useState("");
  const [manualBody, setManualBody]       = useState("");
  const [isSendingManual, setIsSendingManual] = useState(false);

  // ── Bulk mode ─────────────────────────────────────────────────────────────
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(new Set());
  const [bulkEmails, setBulkEmails]           = useState<any[]>([]);
  const [previewIndex, setPreviewIndex]       = useState(0);
  const [isSendingBulk, setIsSendingBulk]     = useState(false);
  const [bulkYourCompany, setBulkYourCompany] = useState("");
  const [bulkYourService, setBulkYourService] = useState("");
  const [bulkTone, setBulkTone]               = useState<ToneType>("Direct");
  const [bulkPainPoint, setBulkPainPoint]     = useState("");
  const [categoryFilter, setCategoryFilter]   = useState("all");

  // ── Init ──────────────────────────────────────────────────────────────────
  useEffect(() => { fetchLeads(); }, []);

  useEffect(() => {
    if (preloadedLead) {
      setSelectedLead(preloadedLead);
      setMode("single");
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
      setCategories(
        Array.from(new Set(data.map((l: Lead) => l.niche).filter((n): n is string => Boolean(n))))
      );
    }
  };

  const filteredLeads = categoryFilter === "all"
    ? leads
    : leads.filter((l) => l.niche === categoryFilter);

  const searchedLeads = leadSearch.trim()
    ? leads.filter((l) =>
        l.company_name.toLowerCase().includes(leadSearch.toLowerCase()) ||
        (l.email ?? "").toLowerCase().includes(leadSearch.toLowerCase())
      )
    : leads;

  // ── Shared send helper ────────────────────────────────────────────────────
  const callSendEmail = async (to: string, subject: string, body: string, leadId?: string) => {
    const res = await fetch("/api/send-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to, subject, body, ...(leadId ? { leadId } : {}) }),
    });
    return { res, data: await res.json() };
  };

  const handleSendError = (res: Response, data: any) => {
    if (res.status === 429)      toast.error("Daily SMTP limit reached. Try again tomorrow.");
    else if (res.status === 404) toast.error("No SMTP accounts configured. Add one in SMTP Manager.");
    else                         toast.error(data.error || "Failed to send email");
  };

  // ── Single: generate ──────────────────────────────────────────────────────
  const generateEmail = async () => {
    if (!selectedLead) { toast.error("Select a lead first"); return; }
    if (!yourCompany.trim()) { toast.error("Enter your company name"); return; }
    if (!yourService.trim()) { toast.error("Enter your service / product"); return; }
    setIsGenerating(true);
    setGeneratedEmail(null);
    setIsEditing(false);
    try {
      const { generateAIEmail } = await import("@/utils/ai-email-generator");
      const { subject, body } = await generateAIEmail({
        lead: {
          company_name: selectedLead.company_name,
          niche: selectedLead.niche,
          location: selectedLead.location,
          company_context: selectedLead.company_context,
        },
        yourCompany,
        yourService,
        tone,
        customPainPoint: customPainPoint || undefined,
        userId,
      });
      setGeneratedEmail({ subject, body, model: "AI" });
      setEditSubject(subject);
      setEditBody(body);
    } catch (err: any) {
      toast.error(err.message || "Failed to generate email. Check AI settings.");
    } finally {
      setIsGenerating(false);
    }
  };

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
        const updated: Lead = { ...lead, email: data.email ?? lead.email, company_context: data.company_context ?? lead.company_context };
        setSelectedLead(updated);
        setLeads((prev) => prev.map((l) => (l.id === lead.id ? updated : l)));
        setEnriched(true);
        if (data.email && data.email !== lead.email) toast.success("Found email: " + data.email);
      }
    } catch { /* silent */ }
    finally { setIsEnriching(false); }
  };

  const copyEmail = async () => {
    if (!generatedEmail) return;
    await navigator.clipboard.writeText("Subject: " + (isEditing ? editSubject : generatedEmail.subject) + "\n\n" + (isEditing ? editBody : generatedEmail.body));
    setIsCopied(true);
    toast.success("Copied to clipboard");
    setTimeout(() => setIsCopied(false), 2000);
  };

  const saveToLead = async () => {
    if (!generatedEmail || !selectedLead) return;
    setIsSaving(true);
    const { error } = await supabase.from("generated_emails").insert({
      user_id: userId,
      lead_id: selectedLead.id,
      subject: isEditing ? editSubject : generatedEmail.subject,
      body: isEditing ? editBody : generatedEmail.body,
      tone,
      model_used: generatedEmail.model,
    });
    if (!error) toast.success("Saved to lead profile");
    else toast.error("Failed to save");
    setIsSaving(false);
  };

  const sendSingleEmail = async () => {
    if (!generatedEmail) return;
    const recipient = useCustomRecipient ? customRecipient : selectedLead?.email;
    if (!recipient) {
      toast.error(useCustomRecipient ? "Enter a recipient email" : "This lead has no email address. Use a custom recipient.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) { toast.error("Invalid email address"); return; }
    setIsSendingSingle(true);
    try {
      const { res, data } = await callSendEmail(
        recipient,
        isEditing ? editSubject : generatedEmail.subject,
        isEditing ? editBody : generatedEmail.body,
        !useCustomRecipient ? selectedLead?.id : undefined
      );
      if (data.success) {
        toast.success("Sent to " + recipient + " via " + data.accountUsed);
        if (!useCustomRecipient && selectedLead) {
          setSelectedLead({ ...selectedLead, status: "Email Sent" });
          await supabase.from("generated_emails").insert({
            user_id: userId, lead_id: selectedLead.id,
            subject: isEditing ? editSubject : generatedEmail.subject,
            body: isEditing ? editBody : generatedEmail.body,
            tone, model_used: generatedEmail.model,
          });
        }
      } else { handleSendError(res, data); }
    } catch { toast.error("Network error"); }
    finally { setIsSendingSingle(false); }
  };

  // ── Manual compose ────────────────────────────────────────────────────────
  const sendManualCompose = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(manualTo)) { toast.error("Enter a valid recipient email"); return; }
    if (!manualSubject.trim()) { toast.error("Enter a subject"); return; }
    if (!manualBody.trim()) { toast.error("Enter an email body"); return; }
    setIsSendingManual(true);
    try {
      const { res, data } = await callSendEmail(manualTo, manualSubject, manualBody);
      if (data.success) {
        toast.success("Sent to " + manualTo + " via " + data.accountUsed);
        setManualTo(""); setManualSubject(""); setManualBody("");
      } else { handleSendError(res, data); }
    } catch { toast.error("Network error"); }
    finally { setIsSendingManual(false); }
  };

  // ── Bulk helpers ──────────────────────────────────────────────────────────
  const toggleLead = (id: string) => {
    setSelectedLeadIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const selectAll = () => {
    const allSelected = filteredLeads.every((l) => selectedLeadIds.has(l.id));
    const n = new Set(selectedLeadIds);
    filteredLeads.forEach((l) => allSelected ? n.delete(l.id) : n.add(l.id));
    setSelectedLeadIds(n);
  };

  const generateBulkEmails = async () => {
    if (selectedLeadIds.size === 0) { toast.error("Select at least one lead"); return; }
    if (!bulkYourCompany || !bulkYourService) { toast.error("Enter your company name and service"); return; }
    setIsGenerating(true);
    setBulkEmails([]);
    try {
      const selected = leads.filter((l) => selectedLeadIds.has(l.id));
      const emails: any[] = [];
      let successCount = 0;
      let failCount = 0;
      
      for (let i = 0; i < selected.length; i++) {
        const lead = selected[i];
        try {
          const { generateAIEmail } = await import("@/utils/ai-email-generator");
          const { subject, body } = await generateAIEmail({
            lead: { company_name: lead.company_name, niche: lead.niche, location: lead.location, company_context: lead.company_context },
            yourCompany: bulkYourCompany,
            yourService: bulkYourService,
            tone: bulkTone,
            customPainPoint: bulkPainPoint || undefined,
            userId,
          });
          emails.push({ 
            lead, 
            lead_email: lead.email, 
            company_name: lead.company_name, 
            subject, 
            body, 
            model: "AI",
            isEditing: false,
            editSubject: subject,
            editBody: body,
          });
          successCount++;
          
          // Add delay between requests to avoid rate limits (1.5 seconds)
          if (i < selected.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1500));
          }
        } catch (error: any) {
          failCount++;
          // If rate limit error, add longer delay and retry once
          if (error.message?.includes('rate limit')) {
            toast.warning(`Rate limit hit. Waiting 5 seconds before continuing...`);
            await new Promise(resolve => setTimeout(resolve, 5000));
            
            // Retry this lead
            try {
              const { generateAIEmail } = await import("@/utils/ai-email-generator");
              const { subject, body } = await generateAIEmail({
                lead: { company_name: lead.company_name, niche: lead.niche, location: lead.location, company_context: lead.company_context },
                yourCompany: bulkYourCompany,
                yourService: bulkYourService,
                tone: bulkTone,
                customPainPoint: bulkPainPoint || undefined,
                userId,
              });
              emails.push({ 
                lead, 
                lead_email: lead.email, 
                company_name: lead.company_name, 
                subject, 
                body, 
                model: "AI",
                isEditing: false,
                editSubject: subject,
                editBody: body,
              });
              successCount++;
              failCount--;
            } catch {
              // Use fallback if retry fails
              emails.push({ 
                lead, 
                lead_email: lead.email, 
                company_name: lead.company_name, 
                subject: "Quick question about " + lead.company_name, 
                body: "Hi,\n\nI came across " + lead.company_name + " and wanted to reach out about " + bulkYourService + ".\n\nWould you be open to a quick call?\n\nBest,\n" + bulkYourCompany, 
                model: "Fallback",
                isEditing: false,
                editSubject: "Quick question about " + lead.company_name,
                editBody: "Hi,\n\nI came across " + lead.company_name + " and wanted to reach out about " + bulkYourService + ".\n\nWould you be open to a quick call?\n\nBest,\n" + bulkYourCompany,
              });
            }
          } else {
            // Use fallback for other errors
            emails.push({ 
              lead, 
              lead_email: lead.email, 
              company_name: lead.company_name, 
              subject: "Quick question about " + lead.company_name, 
              body: "Hi,\n\nI came across " + lead.company_name + " and wanted to reach out about " + bulkYourService + ".\n\nWould you be open to a quick call?\n\nBest,\n" + bulkYourCompany, 
              model: "Fallback",
              isEditing: false,
              editSubject: "Quick question about " + lead.company_name,
              editBody: "Hi,\n\nI came across " + lead.company_name + " and wanted to reach out about " + bulkYourService + ".\n\nWould you be open to a quick call?\n\nBest,\n" + bulkYourCompany,
            });
          }
        }
        
        // Update progress
        setBulkEmails([...emails]);
      }
      
      setPreviewIndex(0);
      if (failCount > 0) {
        toast.success(`Generated ${successCount} emails (${failCount} used fallback)`);
      } else {
        toast.success(`Generated ${emails.length} emails successfully!`);
      }
    } catch (error: any) { 
      toast.error(error.message || "Failed to generate emails"); 
    }
    finally { setIsGenerating(false); }
  };

  const sendBulkEmails = async () => {
    if (bulkEmails.length === 0) return;
    setIsSendingBulk(true);
    try {
      // Use edited versions if available
      const emailsToSend = bulkEmails.map(email => ({
        ...email,
        subject: email.editSubject || email.subject,
        body: email.editBody || email.body,
      }));
      
      const { sendBulkEmailsChunkedAction } = await import("@/app/actions");
      const result = await sendBulkEmailsChunkedAction(userId, emailsToSend, { chunkSize: 100, delayBetweenEmails: 2000, verifyEmails: true });
      if (result.success) {
        toast.success((result as any).message || "Emails sent!");
        setBulkEmails([]); setMode("single"); setSelectedLeadIds(new Set()); fetchLeads();
      } else { toast.error(result.error || "Failed"); }
    } catch { toast.error("Error sending"); }
    finally { setIsSendingBulk(false); }
  };

  const sendTestEmail = async () => {
    const testAddr = prompt("Enter your email to receive a test:");
    if (!testAddr?.includes("@")) { toast.error("Invalid email"); return; }
    setIsSendingBulk(true);
    try {
      const cur = bulkEmails[previewIndex];
      const { sendBulkEmailsChunkedAction } = await import("@/app/actions");
      const result = await sendBulkEmailsChunkedAction(userId, [{ lead_id: cur.lead?.id || "test", lead_email: testAddr, company_name: cur.company_name, subject: "[TEST] " + cur.subject, body: cur.body }], { chunkSize: 1, delayBetweenEmails: 0, verifyEmails: false });
      if (result.success) toast.success("Test sent to " + testAddr);
      else toast.error(result.error || "Failed");
    } catch (e: any) { toast.error(e.message || "Error"); }
    finally { setIsSendingBulk(false); }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* Mode tabs */}
      <div className="flex items-center gap-2 px-6 pt-5 pb-4 border-b border-gray-200 bg-white flex-shrink-0">
        {[
          { id: "single", label: "Single Email", icon: Sparkles, activeColor: "bg-blue-600 text-white" },
          { id: "bulk",   label: "Bulk Generator", icon: Users,    activeColor: "bg-blue-600 text-white" },
          { id: "manual", label: "Manual Compose", icon: PenLine,  activeColor: "bg-orange-500 text-white" },
        ].map(({ id, label, icon: Icon, activeColor }) => (
          <button
            key={id}
            onClick={() => setMode(id as any)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${mode === id ? activeColor : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
        {mode === "bulk" && (
          <span className="ml-auto text-sm text-gray-500">{selectedLeadIds.size} of {leads.length} selected</span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">

        {/* ══════════════════════════════════════════════════════════════════
            SINGLE EMAIL MODE
        ══════════════════════════════════════════════════════════════════ */}
        {mode === "single" && (
          <div className="p-6 flex flex-col gap-5 max-w-2xl">

            {/* Lead selector */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-widest mb-2 text-gray-500">Target Lead</label>
              <div className="relative" ref={dropdownRef}>
                <button
                  onClick={() => setLeadDropdownOpen((v) => !v)}
                  className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-gray-300 bg-white text-sm text-gray-700 hover:border-blue-400 transition-all"
                >
                  <span className={selectedLead ? "text-gray-900 font-medium" : "text-gray-400"}>
                    {selectedLead ? `${selectedLead.company_name}${selectedLead.email ? " — " + selectedLead.email : ""}` : "Select a lead…"}
                  </span>
                  <ChevronDown size={15} className="text-gray-400 flex-shrink-0" />
                </button>
                {leadDropdownOpen && (
                  <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
                    <div className="p-2 border-b border-gray-100">
                      <input
                        autoFocus
                        value={leadSearch}
                        onChange={(e) => setLeadSearch(e.target.value)}
                        placeholder="Search leads…"
                        className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 outline-none focus:border-blue-400"
                      />
                    </div>
                    <div className="max-h-52 overflow-y-auto">
                      {searchedLeads.length === 0 && (
                        <p className="text-xs text-gray-400 text-center py-4">No leads found</p>
                      )}
                      {searchedLeads.map((l) => (
                        <button
                          key={l.id}
                          onClick={() => { setSelectedLead(l); setLeadDropdownOpen(false); setLeadSearch(""); setGeneratedEmail(null); setEnriched(false); setUseCustomRecipient(false); }}
                          className="w-full text-left px-4 py-2.5 hover:bg-blue-50 transition-colors"
                        >
                          <p className="text-sm font-medium text-gray-800">{l.company_name}</p>
                          <p className="text-xs text-gray-400">{l.email || "no email"} {l.niche ? "· " + l.niche : ""}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              {selectedLead && (
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  {selectedLead.niche && <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-100">{selectedLead.niche}</span>}
                  {selectedLead.location && <span className="text-[10px] text-gray-400">📍 {selectedLead.location}</span>}
                  <button
                    onClick={() => enrichLead(selectedLead)}
                    disabled={isEnriching}
                    className="ml-auto flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors disabled:opacity-50"
                  >
                    {isEnriching ? <Loader2 size={10} className="animate-spin" /> : <Zap size={10} />}
                    {enriched ? "Enriched ✓" : "Enrich lead"}
                  </button>
                </div>
              )}
            </div>

            {/* Sender info */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-widest mb-2 text-gray-500">Your Company</label>
                <input
                  value={yourCompany}
                  onChange={(e) => setYourCompany(e.target.value)}
                  placeholder="e.g. Acme Inc"
                  className="w-full px-4 py-3 rounded-xl text-sm border border-gray-300 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 bg-white outline-none transition-all"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-widest mb-2 text-gray-500">Your Service / Product</label>
                <input
                  value={yourService}
                  onChange={(e) => setYourService(e.target.value)}
                  placeholder="e.g. AI-powered CRM"
                  className="w-full px-4 py-3 rounded-xl text-sm border border-gray-300 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 bg-white outline-none transition-all"
                />
              </div>
            </div>

            {/* Tone selector */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-widest mb-2 text-gray-500">Tone</label>
              <div className="grid grid-cols-3 gap-2">
                {TONE_OPTIONS.map((t) => (
                  <button
                    key={t.value}
                    onClick={() => setTone(t.value)}
                    className="flex flex-col gap-1 p-3 rounded-xl border-2 text-left transition-all"
                    style={{
                      borderColor: tone === t.value ? t.color : "#E5E7EB",
                      background: tone === t.value ? t.color + "10" : "#F9FAFB",
                    }}
                  >
                    <span className="text-xs font-bold" style={{ color: tone === t.value ? t.color : "#374151" }}>{t.label}</span>
                    <span className="text-[10px] text-gray-500 leading-tight">{t.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Optional pain point */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-widest mb-2 text-gray-500">
                Specific Pain Point <span className="normal-case font-normal text-gray-400">(optional — makes email sharper)</span>
              </label>
              <input
                value={customPainPoint}
                onChange={(e) => setCustomPainPoint(e.target.value)}
                placeholder="e.g. losing leads due to slow follow-up, high customer churn, manual reporting…"
                className="w-full px-4 py-3 rounded-xl text-sm border border-gray-300 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 bg-white outline-none transition-all"
              />
            </div>

            {/* Generate button */}
            <button
              onClick={generateEmail}
              disabled={isGenerating || !selectedLead}
              className="w-full py-3.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-white bg-blue-600 hover:bg-blue-700"
            >
              {isGenerating
                ? <><Loader2 size={16} className="animate-spin" /> Generating with AI…</>
                : <><Sparkles size={16} /> Generate Email</>}
            </button>

            {/* Generated email output */}
            {generatedEmail && (
              <div className="rounded-xl border border-gray-200 overflow-hidden">
                {/* Email header */}
                <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-200">
                  <div className="flex items-center gap-2">
                    <CheckCircle size={14} className="text-green-500" />
                    <span className="text-xs font-semibold text-gray-700">Generated Email</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">{generatedEmail.model}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => { setIsEditing((v) => !v); setEditSubject(generatedEmail.subject); setEditBody(generatedEmail.body); }}
                      className="p-1.5 rounded-lg hover:bg-gray-200 transition-colors" title="Edit">
                      <Edit3 size={13} className="text-gray-500" />
                    </button>
                    <button onClick={copyEmail} className="p-1.5 rounded-lg hover:bg-gray-200 transition-colors" title="Copy">
                      {isCopied ? <CheckCircle size={13} className="text-green-500" /> : <Copy size={13} className="text-gray-500" />}
                    </button>
                    <button onClick={saveToLead} disabled={isSaving} className="p-1.5 rounded-lg hover:bg-gray-200 transition-colors" title="Save to lead">
                      {isSaving ? <Loader2 size={13} className="animate-spin text-gray-400" /> : <Save size={13} className="text-gray-500" />}
                    </button>
                    <button onClick={generateEmail} disabled={isGenerating} className="p-1.5 rounded-lg hover:bg-gray-200 transition-colors" title="Regenerate">
                      <RefreshCw size={13} className={`text-gray-500 ${isGenerating ? "animate-spin" : ""}`} />
                    </button>
                  </div>
                </div>

                {/* Subject */}
                <div className="px-4 py-3 border-b border-gray-100">
                  <p className="text-[10px] uppercase tracking-widest text-gray-400 mb-1">Subject</p>
                  {isEditing
                    ? <input value={editSubject} onChange={(e) => setEditSubject(e.target.value)} className="w-full text-sm font-semibold text-gray-900 bg-white border border-blue-400 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-200" />
                    : <p className="text-sm font-semibold text-gray-900">{generatedEmail.subject}</p>}
                </div>

                {/* Body */}
                <div className="px-4 py-3">
                  <p className="text-[10px] uppercase tracking-widest text-gray-400 mb-2">Body</p>
                  {isEditing
                    ? <textarea value={editBody} onChange={(e) => setEditBody(e.target.value)} rows={12} className="w-full text-sm text-gray-900 bg-white border border-blue-400 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-200 resize-none" style={{ lineHeight: "1.7" }} />
                    : <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">{generatedEmail.body}</pre>}
                </div>

                {/* Send section */}
                <div className="px-4 py-4 bg-gray-50 border-t border-gray-200 flex flex-col gap-3">
                  {/* Recipient toggle */}
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setUseCustomRecipient(false)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${!useCustomRecipient ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-300 hover:border-blue-400"}`}
                    >
                      <Mail size={11} />
                      Lead's email {selectedLead?.email ? `(${selectedLead.email})` : "(none)"}
                    </button>
                    <button
                      onClick={() => setUseCustomRecipient(true)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${useCustomRecipient ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-300 hover:border-blue-400"}`}
                    >
                      <AtSign size={11} />
                      Custom recipient
                    </button>
                  </div>

                  {useCustomRecipient && (
                    <input
                      type="email"
                      value={customRecipient}
                      onChange={(e) => setCustomRecipient(e.target.value)}
                      placeholder="Enter any email address…"
                      className="w-full px-4 py-2.5 rounded-xl text-sm border border-gray-300 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 bg-white outline-none transition-all"
                    />
                  )}

                  <button
                    onClick={sendSingleEmail}
                    disabled={isSendingSingle}
                    className="w-full py-3 rounded-xl text-sm font-semibold transition-all disabled:opacity-50 flex items-center justify-center gap-2 text-white bg-green-600 hover:bg-green-700"
                  >
                    {isSendingSingle
                      ? <><Loader2 size={15} className="animate-spin" /> Sending…</>
                      : <><Send size={15} /> Send Email</>}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            BULK GENERATOR MODE
        ══════════════════════════════════════════════════════════════════ */}
        {mode === "bulk" && (
          <div className="p-6 flex flex-col gap-5">
            {bulkEmails.length === 0 ? (
              <>
                {/* Sender info */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-widest mb-2 text-gray-500">Your Company</label>
                    <input value={bulkYourCompany} onChange={(e) => setBulkYourCompany(e.target.value)} placeholder="e.g. Acme Inc"
                      className="w-full px-4 py-3 rounded-xl text-sm border border-gray-300 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 bg-white outline-none transition-all" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-widest mb-2 text-gray-500">Your Service / Product</label>
                    <input value={bulkYourService} onChange={(e) => setBulkYourService(e.target.value)} placeholder="e.g. AI-powered CRM"
                      className="w-full px-4 py-3 rounded-xl text-sm border border-gray-300 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 bg-white outline-none transition-all" />
                  </div>
                </div>

                {/* Tone */}
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-widest mb-2 text-gray-500">Tone</label>
                  <div className="grid grid-cols-3 gap-2">
                    {TONE_OPTIONS.map((t) => (
                      <button key={t.value} onClick={() => setBulkTone(t.value)}
                        className="flex flex-col gap-1 p-3 rounded-xl border-2 text-left transition-all"
                        style={{ borderColor: bulkTone === t.value ? t.color : "#E5E7EB", background: bulkTone === t.value ? t.color + "10" : "#F9FAFB" }}>
                        <span className="text-xs font-bold" style={{ color: bulkTone === t.value ? t.color : "#374151" }}>{t.label}</span>
                        <span className="text-[10px] text-gray-500 leading-tight">{t.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Pain point */}
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-widest mb-2 text-gray-500">Pain Point <span className="normal-case font-normal text-gray-400">(optional)</span></label>
                  <input value={bulkPainPoint} onChange={(e) => setBulkPainPoint(e.target.value)} placeholder="e.g. slow follow-up, high churn…"
                    className="w-full px-4 py-3 rounded-xl text-sm border border-gray-300 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 bg-white outline-none transition-all" />
                </div>

                {/* Category filter */}
                {categories.length > 0 && (
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-widest mb-2 text-gray-500">Filter by Category</label>
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => setCategoryFilter("all")}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border-2 transition-all ${categoryFilter === "all" ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-200 hover:border-blue-400"}`}>
                        All ({leads.length})
                      </button>
                      {categories.map((cat) => (
                        <button key={cat} onClick={() => setCategoryFilter(cat)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium border-2 transition-all ${categoryFilter === cat ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-200 hover:border-blue-400"}`}>
                          {cat} ({leads.filter((l) => l.niche === cat).length})
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Lead list */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-semibold uppercase tracking-widest text-gray-500">Select Leads ({selectedLeadIds.size} selected)</label>
                    <button onClick={selectAll} className="text-xs text-blue-600 hover:text-blue-700 font-medium">
                      {filteredLeads.every((l) => selectedLeadIds.has(l.id)) ? "Deselect all" : "Select all"}
                    </button>
                  </div>
                  <div className="border border-gray-200 rounded-xl overflow-hidden max-h-64 overflow-y-auto">
                    {filteredLeads.length === 0 && (
                      <p className="text-xs text-gray-400 text-center py-6">No leads found</p>
                    )}
                    {filteredLeads.map((lead, i) => (
                      <div key={lead.id}
                        onClick={() => toggleLead(lead.id)}
                        className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors ${i !== 0 ? "border-t border-gray-100" : ""} ${selectedLeadIds.has(lead.id) ? "bg-blue-50" : "hover:bg-gray-50"}`}>
                        {selectedLeadIds.has(lead.id)
                          ? <CheckSquare size={15} className="text-blue-600 flex-shrink-0" />
                          : <Square size={15} className="text-gray-300 flex-shrink-0" />}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">{lead.company_name}</p>
                          <p className="text-xs text-gray-400 truncate">{lead.email || "no email"}{lead.niche ? " · " + lead.niche : ""}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <button onClick={generateBulkEmails} disabled={isGenerating || selectedLeadIds.size === 0}
                  className="w-full py-3.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-white bg-blue-600 hover:bg-blue-700">
                  {isGenerating
                    ? <><Loader2 size={16} className="animate-spin" /> Generating {selectedLeadIds.size} emails…</>
                    : <><Sparkles size={16} /> Generate {selectedLeadIds.size} Emails</>}
                </button>
              </>
            ) : (
              /* Bulk preview */
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-gray-700">{bulkEmails.length} emails ready</p>
                  <button onClick={() => setBulkEmails([])} className="text-xs text-gray-500 hover:text-gray-700">← Back to selection</button>
                </div>

                {/* Preview navigator */}
                <div className="rounded-xl border border-gray-200 overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-200">
                    <span className="text-xs font-semibold text-gray-600">{bulkEmails[previewIndex]?.company_name}</span>
                    <div className="flex items-center gap-3">
                      <button 
                        onClick={() => {
                          const updated = [...bulkEmails];
                          updated[previewIndex].isEditing = !updated[previewIndex].isEditing;
                          setBulkEmails(updated);
                        }}
                        className="p-1.5 rounded-lg hover:bg-gray-200 transition-colors" 
                        title="Edit email"
                      >
                        <Edit3 size={13} className="text-gray-500" />
                      </button>
                      <div className="flex items-center gap-2 border-l border-gray-300 pl-3">
                        <button onClick={() => setPreviewIndex((v) => Math.max(0, v - 1))} disabled={previewIndex === 0} className="p-1 rounded hover:bg-gray-200 disabled:opacity-30"><ChevronLeft size={14} /></button>
                        <span className="text-xs text-gray-500">{previewIndex + 1} / {bulkEmails.length}</span>
                        <button onClick={() => setPreviewIndex((v) => Math.min(bulkEmails.length - 1, v + 1))} disabled={previewIndex === bulkEmails.length - 1} className="p-1 rounded hover:bg-gray-200 disabled:opacity-30"><ChevronRight size={14} /></button>
                      </div>
                    </div>
                  </div>
                  <div className="px-4 py-3 border-b border-gray-100">
                    <p className="text-[10px] uppercase tracking-widest text-gray-400 mb-1">Subject</p>
                    {bulkEmails[previewIndex]?.isEditing ? (
                      <input 
                        value={bulkEmails[previewIndex]?.editSubject || ''} 
                        onChange={(e) => {
                          const updated = [...bulkEmails];
                          updated[previewIndex].editSubject = e.target.value;
                          setBulkEmails(updated);
                        }}
                        className="w-full text-sm font-semibold text-gray-900 bg-white border border-blue-400 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-200" 
                      />
                    ) : (
                      <p className="text-sm font-semibold text-gray-900">{bulkEmails[previewIndex]?.editSubject || bulkEmails[previewIndex]?.subject}</p>
                    )}
                  </div>
                  <div className="px-4 py-3">
                    <p className="text-[10px] uppercase tracking-widest text-gray-400 mb-2">Body</p>
                    {bulkEmails[previewIndex]?.isEditing ? (
                      <textarea 
                        value={bulkEmails[previewIndex]?.editBody || ''} 
                        onChange={(e) => {
                          const updated = [...bulkEmails];
                          updated[previewIndex].editBody = e.target.value;
                          setBulkEmails(updated);
                        }}
                        rows={12}
                        className="w-full text-sm text-gray-900 bg-white border border-blue-400 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-200 font-sans leading-relaxed resize-none"
                      />
                    ) : (
                      <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed max-h-64 overflow-y-auto">{bulkEmails[previewIndex]?.editBody || bulkEmails[previewIndex]?.body}</pre>
                    )}
                  </div>
                </div>

                <div className="flex gap-3">
                  <button onClick={sendTestEmail} disabled={isSendingBulk}
                    className="flex-1 py-3 rounded-xl text-sm font-semibold border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                    <Mail size={15} /> Send Test
                  </button>
                  <button onClick={sendBulkEmails} disabled={isSendingBulk}
                    className="flex-1 py-3 rounded-xl text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                    {isSendingBulk ? <><Loader2 size={15} className="animate-spin" /> Sending…</> : <><Send size={15} /> Send All {bulkEmails.length}</>}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            MANUAL COMPOSE MODE
        ══════════════════════════════════════════════════════════════════ */}
        {mode === "manual" && (
          <div className="p-6 flex flex-col gap-5 max-w-2xl">
            <div className="rounded-xl p-4 bg-orange-50 border border-orange-200">
              <p className="text-sm font-semibold text-orange-700">Manual Compose</p>
              <p className="text-xs mt-1 text-orange-600/80">Write and send to any email address — no lead required. Sent via your configured SMTP account.</p>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-widest mb-2 text-gray-500">To</label>
              <div className="relative">
                <AtSign size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input type="email" value={manualTo} onChange={(e) => setManualTo(e.target.value)}
                  placeholder="recipient@company.com"
                  className="w-full pl-9 pr-4 py-3 rounded-xl text-sm border border-gray-300 focus:border-orange-400 focus:ring-2 focus:ring-orange-100 bg-white outline-none transition-all" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-widest mb-2 text-gray-500">Subject</label>
              <input type="text" value={manualSubject} onChange={(e) => setManualSubject(e.target.value)}
                placeholder="e.g. Quick question about your business"
                className="w-full px-4 py-3 rounded-xl text-sm border border-gray-300 focus:border-orange-400 focus:ring-2 focus:ring-orange-100 bg-white outline-none transition-all" />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-widest mb-2 text-gray-500">Body</label>
              <textarea value={manualBody} onChange={(e) => setManualBody(e.target.value)} rows={14}
                placeholder={"Hi,\n\nWrite your email here...\n\nBest,\nYour Name"}
                className="w-full px-4 py-3 rounded-xl text-sm border border-gray-300 focus:border-orange-400 focus:ring-2 focus:ring-orange-100 bg-white outline-none transition-all resize-none"
                style={{ lineHeight: "1.7" }} />
            </div>

            <button onClick={sendManualCompose} disabled={isSendingManual || !manualTo || !manualSubject || !manualBody}
              className="w-full py-4 rounded-xl text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-white bg-orange-500 hover:bg-orange-600">
              {isSendingManual
                ? <><Loader2 size={16} className="animate-spin" /> Sending…</>
                : <><Send size={16} /> Send Email</>}
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
