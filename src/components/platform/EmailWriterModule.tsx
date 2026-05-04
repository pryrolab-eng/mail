"use client";

import { useState, useEffect } from "react";
import { Lead, ToneType } from "@/types/platform";
import {
  Mail, RefreshCw, Copy, Save, ChevronDown, Loader2,
  CheckCircle, Zap, Send, CheckSquare, ChevronLeft,
  ChevronRight, X, AtSign,
} from "lucide-react";
import { createClient } from "../../../supabase/client";
import { toast } from "sonner";

interface EmailWriterProps {
  userId: string;
  preloadedLead?: Lead | null;
}

const TONE_OPTIONS: { value: ToneType; desc: string }[] = [
  { value: "Direct", desc: "Clear, concise, professional - no fluff" },
  { value: "Aggressive", desc: "Hooks hard, creates urgency, pushes action" },
  { value: "Surgical", desc: "Deeply personalized, sniper-precise targeting" },
];

const SAMPLE_EMAILS: Record<ToneType, { subject: string; body: string; model: string }> = {
  Direct: {
    model: "groq/llama-3-70b",
    subject: "Quick question about {company}'s growth",
    body: "Hi {name},\n\nNoticed {company} is {context_snippet}.\n\nWe help companies like yours {value_prop} - typically seeing results within 30 days.\n\nWorth a 15-minute call to see if there's a fit?\n\nBest,\n[Your Name]",
  },
  Aggressive: {
    model: "groq/llama-3-70b",
    subject: "You're losing {X} every month - here's how to fix it",
    body: "{name},\n\nMost {niche} companies are hemorrhaging revenue on {pain_point} and don't even realize it.\n\n{company} is likely the same - and it's costing you more than you think.\n\nWe've solved this for 50+ companies. The ones that waited regret it.\n\n15 minutes. This week. Yes or no?\n\n[Your Name]",
  },
  Surgical: {
    model: "groq/llama-3-70b",
    subject: "{company}'s approach to {specific_thing} caught my attention",
    body: "Hi {name},\n\nI've been following {company}'s work on {specific_initiative} - particularly the way you {specific_detail}.\n\nThat approach makes the {pain_point} challenge even more acute for a company at your stage.\n\nWe've built a solution specifically for {niche} companies that {value_prop_specific}. Our work with {similar_company} resulted in {specific_metric}.\n\nWould it make sense to spend 20 minutes exploring whether we can do the same for {company}?\n\n[Your Name]",
  },
};


export default function EmailWriterModule({ userId, preloadedLead }: EmailWriterProps) {
  const supabase = createClient();

  // Single email state
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

  // Mode: single | bulk | manual
  const [mode, setMode] = useState<"single" | "bulk" | "manual">("single");

  // Manual compose state
  const [manualTo, setManualTo] = useState("");
  const [manualSubject, setManualSubject] = useState("");
  const [manualBody, setManualBody] = useState("");
  const [isSendingManual, setIsSendingManual] = useState(false);

  // "Send to any email" modal (from generated email actions)
  const [showSendModal, setShowSendModal] = useState(false);
  const [modalEmail, setModalEmail] = useState("");
  const [isSendingModal, setIsSendingModal] = useState(false);

  // Bulk state
const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(new Set());
const [bulkEmails, setBulkEmails] = useState<any[]>([]);
const [previewIndex, setPreviewIndex] = useState(0);
const [isSendingBulk, setIsSendingBulk] = useState(false);
const [yourCompany, setYourCompany] = useState("");
const [yourService, setYourService] = useState("");
const [categoryFilter, setCategoryFilter] = useState("all");
const [categories, setCategories] = useState<string[]>([]);

useEffect(() => { fetchLeads(); }, []);

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
    
    // Fixed: Better type handling for categories
    const uniqueCategories = Array.from(
      new Set(
        data
          .map((l: Lead) => l.niche)
          .filter((niche): niche is string => Boolean(niche))
      )
    );
    setCategories(uniqueCategories);
  }
};
  const filteredLeads = categoryFilter === "all"
    ? leads
    : leads.filter((l: any) => l.niche === categoryFilter);

  // ── Single email generation ───────────────────────────────────────────────
  const generateEmail = async () => {
    if (!selectedLead) { toast.error("Please select a lead first"); return; }
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
      .replace(/{context_snippet}/g, (selectedLead.company_context?.slice(0, 60) ?? "growing fast") + "...")
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
    await navigator.clipboard.writeText(
      "Subject: " + (editSubject || generatedEmail.subject) + "\n\n" + (editBody || generatedEmail.body)
    );
    setIsCopied(true);
    toast.success("Email copied to clipboard");
    setTimeout(() => setIsCopied(false), 2000);
  };

  const copyAndMarkSent = async () => {
    if (!generatedEmail || !selectedLead) return;
    await copyEmail();
    await supabase
      .from("leads")
      .update({ status: "Email Sent", updated_at: new Date().toISOString() })
      .eq("id", selectedLead.id);
    toast.success("Lead marked as Email Sent");
    setSelectedLead({ ...selectedLead, status: "Email Sent" });
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
    if (!error) toast.success("Email saved to lead profile");
    else toast.error("Failed to save email");
    setIsSaving(false);
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
        const updated: Lead = {
          ...lead,
          email: data.email ?? lead.email,
          company_context: data.company_context ?? lead.company_context,
        };
        setSelectedLead(updated);
        setLeads((prev) => prev.map((l) => (l.id === lead.id ? updated : l)));
        setEnriched(true);
        if (data.email && data.email !== lead.email) {
          toast.success("Found real email: " + data.email);
        }
      }
    } catch {
      // silent fail - enrichment is best-effort
    } finally {
      setIsEnriching(false);
    }
  };

  // ── Shared send helper ────────────────────────────────────────────────────
  const callSendEmail = async (
    to: string,
    subject: string,
    body: string,
    leadId?: string
  ) => {
    const res = await fetch("/api/send-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to, subject, body, ...(leadId ? { leadId } : {}) }),
    });
    return { res, data: await res.json() };
  };

  const handleSendError = (res: Response, data: any) => {
    if (res.status === 429) toast.error("Daily SMTP limit reached. Try again tomorrow.");
    else if (res.status === 404) toast.error("No SMTP accounts configured. Add one in SMTP Manager.");
    else toast.error(data.error || "Failed to send email");
  };

  const sendSingleEmail = async () => {
    if (!generatedEmail || !selectedLead?.email) {
      toast.error("Lead has no email address");
      return;
    }
    setIsSendingSingle(true);
    try {
      const { res, data } = await callSendEmail(
        selectedLead.email,
        editSubject || generatedEmail.subject,
        editBody || generatedEmail.body,
        selectedLead.id
      );
      if (data.success) {
        toast.success("Sent to " + selectedLead.email + " via " + data.accountUsed);
        setSelectedLead({ ...selectedLead, status: "Email Sent" });
        await supabase.from("generated_emails").insert({
          user_id: userId,
          lead_id: selectedLead.id,
          subject: editSubject || generatedEmail.subject,
          body: editBody || generatedEmail.body,
          tone,
          model_used: generatedEmail.model,
        });
      } else {
        handleSendError(res, data);
      }
    } catch {
      toast.error("Network error");
    } finally {
      setIsSendingSingle(false);
    }
  };

  const sendModalEmail = async () => {
    if (!generatedEmail) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(modalEmail)) {
      toast.error("Enter a valid email address");
      return;
    }
    setIsSendingModal(true);
    try {
      const { res, data } = await callSendEmail(
        modalEmail,
        editSubject || generatedEmail.subject,
        editBody || generatedEmail.body
      );
      if (data.success) {
        toast.success("Sent to " + modalEmail + " via " + data.accountUsed);
        setShowSendModal(false);
        setModalEmail("");
      } else {
        handleSendError(res, data);
      }
    } catch {
      toast.error("Network error");
    } finally {
      setIsSendingModal(false);
    }
  };

  const sendManualCompose = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(manualTo)) {
      toast.error("Enter a valid recipient email");
      return;
    }
    if (!manualSubject.trim()) { toast.error("Enter a subject"); return; }
    if (!manualBody.trim()) { toast.error("Enter an email body"); return; }
    setIsSendingManual(true);
    try {
      const { res, data } = await callSendEmail(manualTo, manualSubject, manualBody);
      if (data.success) {
        toast.success("Sent to " + manualTo + " via " + data.accountUsed);
        setManualTo("");
        setManualSubject("");
        setManualBody("");
      } else {
        handleSendError(res, data);
      }
    } catch {
      toast.error("Network error");
    } finally {
      setIsSendingManual(false);
    }
  };

  // ── Bulk helpers ──────────────────────────────────────────────────────────
  const toggleLead = (id: string) => {
    setSelectedLeadIds((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const selectAll = () => {
    if (filteredLeads.every((l) => selectedLeadIds.has(l.id))) {
      const n = new Set(selectedLeadIds);
      filteredLeads.forEach((l) => n.delete(l.id));
      setSelectedLeadIds(n);
    } else {
      const n = new Set(selectedLeadIds);
      filteredLeads.forEach((l) => n.add(l.id));
      setSelectedLeadIds(n);
    }
  };

  const generateBulkEmails = async () => {
    if (selectedLeadIds.size === 0) { toast.error("Select at least one lead"); return; }
    if (!yourCompany || !yourService) { toast.error("Enter your company name and service"); return; }
    setIsGenerating(true);
    setBulkEmails([]);
    try {
      const selected = leads.filter((l) => selectedLeadIds.has(l.id));
      const emails: any[] = [];
      for (const lead of selected) {
        try {
          const { generateAIEmail } = await import("@/utils/ai-email-generator");
          const { subject, body } = await generateAIEmail({
            lead: {
              company_name: lead.company_name,
              niche: lead.niche,
              location: lead.location,
              company_context: lead.company_context,
            },
            yourCompany,
            yourService,
            tone,
            customPainPoint: customPainPoint || undefined,
            userId,
          });
          emails.push({
            lead,
            lead_email: lead.email,
            company_name: lead.company_name,
            subject,
            body,
            model: "AI Generated",
          });
        } catch {
          const t = SAMPLE_EMAILS[tone];
          const company = lead.company_name;
          const niche = lead.niche || "your industry";
          const painPoint = customPainPoint || "scaling outreach efficiency";
          emails.push({
            lead,
            lead_email: lead.email,
            company_name: lead.company_name,
            subject: t.subject.replace("{company}", company).replace("{niche}", niche),
            body: t.body
              .replace(/{company}/g, company)
              .replace(/{niche}/g, niche)
              .replace(/{pain_point}/g, painPoint)
              .replace(/{name}/g, "there")
              .replace(/{context_snippet}/g, (lead.company_context?.slice(0, 60) ?? "growing fast") + "...")
              .replace(/{value_prop}/g, "help with " + yourService)
              .replace(/{value_prop_specific}/g, yourService)
              .replace(/{specific_initiative}/g, niche + " operations")
              .replace(/{specific_detail}/g, "approach your growth strategy")
              .replace(/{specific_metric}/g, "40% improvement in 60 days")
              .replace(/{similar_company}/g, "a top competitor")
              .replace(/{specific_thing}/g, niche + " strategy")
              .replace(/{X}/g, "$10K")
              .replace(/\[Your Name\]/g, yourCompany),
            model: "Template",
          });
        }
      }
      setBulkEmails(emails);
      setPreviewIndex(0);
      toast.success("Generated " + emails.length + " emails!");
    } catch {
      toast.error("Failed to generate emails");
    } finally {
      setIsGenerating(false);
    }
  };

  const sendTestEmail = async () => {
    const testAddr = prompt("Enter your email to receive a test:");
    if (!testAddr?.includes("@")) { toast.error("Invalid email"); return; }
    setIsSendingBulk(true);
    try {
      const cur = bulkEmails[previewIndex];
      const { sendBulkEmailsChunkedAction } = await import("@/app/actions");
      const result = await sendBulkEmailsChunkedAction(
        userId,
        [{ lead_id: cur.lead?.id || "test", lead_email: testAddr, company_name: cur.company_name, subject: "[TEST] " + cur.subject, body: cur.body }],
        { chunkSize: 1, delayBetweenEmails: 0, verifyEmails: false }
      );
      if (result.success) {
        toast.success("Test sent to " + testAddr + "!");
      } else {
        toast.error(result.error || "Failed");
      }
    } catch (e: any) {
      toast.error(e.message || "Error");
    } finally {
      setIsSendingBulk(false);
    }
  };

  const sendBulkEmails = async () => {
    if (bulkEmails.length === 0) return;
    setIsSendingBulk(true);
    try {
      const { sendBulkEmailsChunkedAction } = await import("@/app/actions");
      const result = await sendBulkEmailsChunkedAction(userId, bulkEmails, {
        chunkSize: 100,
        delayBetweenEmails: 2000,
        verifyEmails: true,
      });
      if (result.success) {
        toast.success((result as any).message || "Emails sent!");
        setBulkEmails([]);
        setMode("single");
        setSelectedLeadIds(new Set());
        fetchLeads();
      } else {
        toast.error(result.error || "Failed");
      }
    } catch {
      toast.error("Error sending");
    } finally {
      setIsSendingBulk(false);
    }
  };

  return (
    <div className="flex flex-col h-full p-6 gap-5">

      {/* Mode tabs */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMode("single")}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${mode === "single" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
          >
            Single Email
          </button>
          <button
            onClick={() => setMode("bulk")}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${mode === "bulk" ? "bg-purple-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
          >
            Bulk Generator
          </button>
          <button
            onClick={() => setMode("manual")}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${mode === "manual" ? "bg-orange-500 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
          >
            Manual Send
          </button>
        </div>
        {mode === "bulk" && (
          <span className="text-sm text-gray-500">{selectedLeadIds.size} of {leads.length} selected</span>
        )}
      </div>

      {/* MANUAL COMPOSE MODE */}
      {mode === "manual" && (
        <div className="flex flex-col gap-5">
          <div className="rounded-xl p-4 bg-orange-50 border border-orange-200">
            <p className="text-sm font-semibold text-orange-600">Manual Email Compose</p>
            <p className="text-xs mt-1 text-gray-500">Write and send an email to any address. No lead required. Sent via your SMTP account.</p>
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest mb-2 text-gray-600">To (Recipient Email)</label>
            <input
              type="email"
              value={manualTo}
              onChange={(e) => setManualTo(e.target.value)}
              placeholder="e.g. john@company.com"
              className="w-full px-4 py-3 rounded-xl text-sm border border-gray-300 focus:border-orange-400 focus:ring-2 focus:ring-orange-100 bg-white text-gray-800 placeholder:text-gray-400 outline-none transition-all"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest mb-2 text-gray-600">Subject</label>
            <input
              type="text"
              value={manualSubject}
              onChange={(e) => setManualSubject(e.target.value)}
              placeholder="e.g. Quick question about your business"
              className="w-full px-4 py-3 rounded-xl text-sm border border-gray-300 focus:border-orange-400 focus:ring-2 focus:ring-orange-100 bg-white text-gray-800 placeholder:text-gray-400 outline-none transition-all"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest mb-2 text-gray-600">Email Body</label>
            <textarea
              value={manualBody}
              onChange={(e) => setManualBody(e.target.value)}
              rows={12}
              placeholder="Hi,&#10;&#10;Write your email here...&#10;&#10;Best,&#10;Your Name"
              className="w-full px-4 py-3 rounded-xl text-sm border border-gray-300 focus:border-orange-400 focus:ring-2 focus:ring-orange-100 bg-white text-gray-800 placeholder:text-gray-400 outline-none transition-all resize-none"
              style={{ lineHeight: "1.7" }}
            />
          </div>
          <button
            onClick={sendManualCompose}
            disabled={isSendingManual || !manualTo || !manualSubject || !manualBody}
            className="w-full py-4 rounded-xl text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-white bg-orange-500 hover:bg-orange-600"
          >
            {isSendingManual
              ? <><Loader2 size={16} className="animate-spin" /> Sending...</>
              : <><Send size={16} /> Send Email</>
            }
          </button>
        </div>
      )}
    </div>
  );
}