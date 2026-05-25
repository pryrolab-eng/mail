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
import { DEFAULT_YOUR_COMPANY } from "@/utils/email-prompts";
import { isWeakLeadContext } from "@/utils/lead-context-builder";

interface EmailWriterProps {
  userId: string;
  preloadedLead?: Lead | null;
}

const TONE_OPTIONS: { value: ToneType; label: string; desc: string }[] = [
  { value: "Direct",     label: "Direct",     desc: "Hard direct. No politeness. Problem → Solution → CTA" },
  { value: "Aggressive", label: "Aggressive", desc: "High urgency, creates FOMO, pushes action hard" },
  { value: "Surgical",   label: "Surgical",   desc: "Hyper-personalized, proves you did your homework" },
];

export default function EmailWriterModule({ userId, preloadedLead }: EmailWriterProps) {
  const supabase = createClient();

  // ── Shared ────────────────────────────────────────────────────────────────
  const [leads, setLeads]           = useState<Lead[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [mode, setMode]             = useState<"single" | "bulk" | "manual">("single");

  const [yourCompany, setYourCompany] = useState(DEFAULT_YOUR_COMPANY);
  const [yourService, setYourService] = useState("");
  const [pryroProfileLoading, setPryroProfileLoading] = useState(true);

  useEffect(() => {
    fetch("/api/pryro-profile")
      .then((r) => r.json())
      .then((data) => {
        if (data.offerFormatted || data.serviceOffer) {
          setYourService(data.offerFormatted || data.serviceOffer);
        }
        if (data.company) setYourCompany(data.company);
      })
      .catch(() => toast.error("Could not load Pryro info from website"))
      .finally(() => setPryroProfileLoading(false));
  }, []);

  // ── Single mode ───────────────────────────────────────────────────────────
  const [selectedLead, setSelectedLead]       = useState<Lead | null>(preloadedLead || null);
  const [tone, setTone]                       = useState<ToneType>("Direct");
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
  const [previewIndex, setPreviewIndex]       = useState(-1);
  const [isSendingBulk, setIsSendingBulk]     = useState(false);
  const [bulkTone, setBulkTone]               = useState<ToneType>("Direct");
  const [bulkPainPoint, setBulkPainPoint]     = useState("");
  const [nicheFilter, setNicheFilter]         = useState("all");
  const [bulkUseWebResearch, setBulkUseWebResearch] = useState(false);

  // ── Init ──────────────────────────────────────────────────────────────────
  useEffect(() => { fetchLeads(); loadSenderProfile(); }, []);

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

  /** Load saved company/service from followup_settings */
  const loadSenderProfile = async () => {
    // Profile is now hardcoded — nothing to load
  };

  /** Save company/service — no-op since profile is hardcoded */
  const saveSenderProfile = async (_company: string, _service: string) => {};

  const filteredLeads = nicheFilter === "all"
    ? leads
    : leads.filter((l) => l.niche === nicheFilter);

  // Split filtered leads into unsent vs already contacted
  const SENT_STATUSES = new Set(["contacted", "Email Sent", "opened", "clicked", "replied", "Replied", "interested", "Interested", "Closed"]);
  const unsentLeads  = filteredLeads.filter((l) => !SENT_STATUSES.has(l.status));
  const alreadySent  = filteredLeads.filter((l) => SENT_STATUSES.has(l.status));

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
    if (res.status === 429) {
      toast.error("Daily SMTP limit reached. Try again tomorrow.");
    } else if (
      res.status === 400 &&
      data?.error?.toLowerCase().includes("no smtp accounts")
    ) {
      toast.error("No SMTP accounts configured. Add one in SMTP Manager.");
    } else {
      toast.error(data?.error || "Failed to send email");
    }
  };

  // ── Single: generate ──────────────────────────────────────────────────────
  const generateEmail = async () => {
    if (!selectedLead) { toast.error("Select a lead first"); return; }
    if (!yourService) {
      toast.error(pryroProfileLoading ? "Loading Pryro website info…" : "Pryro website profile unavailable");
      return;
    }
    setIsGenerating(true);
    setGeneratedEmail(null);
    setIsEditing(false);
    try {
      let leadForGen = selectedLead;
      if (
        isWeakLeadContext(selectedLead.company_context, selectedLead.company_name) &&
        (selectedLead.website || selectedLead.company_name)
      ) {
        toast.info("Enriching lead first for a stronger email…");
        const enriched = await enrichLead(selectedLead);
        if (enriched) leadForGen = enriched;
      }

      const { generateAIEmail } = await import("@/utils/ai-email-generator");
      const { subject, body, quality } = await generateAIEmail({
        lead: {
          company_name: leadForGen.company_name,
          niche: leadForGen.niche,
          location: leadForGen.location,
          company_context: leadForGen.company_context,
          website: leadForGen.website,
          phone: leadForGen.phone,
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
      if (quality.isGeneric) {
        toast.warning(
          `Email may sound generic (score ${quality.score}/10). Enrich the lead or edit before sending.`,
          { duration: 6000 }
        );
      } else if (quality.score >= 8) {
        toast.success(`Strong draft (${quality.score}/10)`);
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to generate email. Check AI settings.");
    } finally {
      setIsGenerating(false);
    }
  };

  const enrichLead = async (lead: Lead): Promise<Lead | null> => {
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
      
      if (!data.success) {
        toast.error(data.error || "Enrichment failed");
        return null;
      }
      
      if (data.enriched) {
        const updated: Lead = { 
          ...lead, 
          email: data.email ?? lead.email, 
          company_context: data.company_context ?? lead.company_context,
          website: data.website ?? data.sourceUrl ?? lead.website,
        };
        setSelectedLead(updated);
        setLeads((prev) => prev.map((l) => (l.id === lead.id ? updated : l)));
        setEnriched(true);
        
        if (data.email && data.email !== lead.email) {
          toast.success(`✓ Found real email: ${data.email}`);
        } else if (data.company_context) {
          toast.success("✓ Added company context");
        } else {
          toast.info("Enriched, but no new email found");
        }
        return updated;
      } else {
        setEnriched(true);
        toast.warning("No email found on website. Try using a custom email.");
        return lead;
      }
    } catch (err) {
      console.error("Enrichment error:", err);
      toast.error("Failed to enrich lead");
      return null;
    } finally { 
      setIsEnriching(false); 
    }
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
      // Only pass leadId if the lead is actually saved in the DB (has a real UUID)
      // Leads from the scraper results panel are NOT saved until "Add to CRM" is clicked
      const isDbLead = selectedLead?.id && !useCustomRecipient;
      const { res, data } = await callSendEmail(
        recipient,
        isEditing ? editSubject : generatedEmail.subject,
        isEditing ? editBody : generatedEmail.body,
        isDbLead ? selectedLead!.id : undefined
      );
      if (data.success) {
        toast.success("Sent to " + recipient + " via " + data.accountUsed);
        // Update local lead status immediately — don't wait for CRM refresh
        const updatedLeadId = data.leadId ?? (isDbLead ? selectedLead!.id : null);
        if (updatedLeadId) {
          setSelectedLead((prev) => prev ? { ...prev, status: "Email Sent" } : prev);
          setLeads((prev) => prev.map((l) =>
            l.id === updatedLeadId ? { ...l, status: "Email Sent" } : l
          ));
        }
        if (isDbLead && selectedLead) {
          await supabase.from("generated_emails").insert({
            user_id: userId, lead_id: selectedLead.id,
            subject: isEditing ? editSubject : generatedEmail.subject,
            body: isEditing ? editBody : generatedEmail.body,
            tone, model_used: generatedEmail.model,
          });
        }
      } else { 
        handleSendError(res, data);
        // Update lead status to 'failed' on error
        const updatedLeadId = data.leadId ?? (isDbLead ? selectedLead!.id : null);
        if (updatedLeadId) {
          setSelectedLead((prev) => prev ? { ...prev, status: "failed" } : prev);
          setLeads((prev) => prev.map((l) =>
            l.id === updatedLeadId ? { ...l, status: "failed" } : l
          ));
        }
        // Refresh leads from database to get latest status
        await fetchLeads();
      }
    } catch { 
      toast.error("Network error");
      // Refresh leads on network error too
      await fetchLeads();
    }
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
    const allSelected = unsentLeads.every((l) => selectedLeadIds.has(l.id));
    const n = new Set(selectedLeadIds);
    unsentLeads.forEach((l) => allSelected ? n.delete(l.id) : n.add(l.id));
    setSelectedLeadIds(n);
  };

  const generateBulkEmails = async () => {
    if (selectedLeadIds.size === 0) { toast.error("Select at least one lead"); return; }
    if (!yourService) {
      toast.error(pryroProfileLoading ? "Loading Pryro website info…" : "Pryro website profile unavailable");
      return;
    }

    const selected = leads.filter((l) => selectedLeadIds.has(l.id));
    const withEmail = selected.filter(l => l.email && l.email.trim());
    const noEmail = selected.filter(l => !l.email || !l.email.trim());

    if (noEmail.length > 0) {
      toast.warning(`${noEmail.length} lead${noEmail.length > 1 ? 's' : ''} have no email and will be skipped.`);
    }
    if (withEmail.length === 0) {
      toast.error("None of the selected leads have an email address. Add emails first.");
      return;
    }

    setIsGenerating(true);
    setBulkEmails([]);

    try {
      const res = await fetch("/api/generate-emails-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leads: withEmail.map((l) => ({
            id: l.id,
            company_name: l.company_name,
            niche: l.niche,
            location: l.location,
            company_context: l.company_context,
            email: l.email,
            website: l.website ?? null,
            phone: l.phone ?? null,
            email_confidence: l.email_confidence ?? null,
          })),
          minEmailConfidence: "medium",
          yourCompany,
          yourService,
          tone: bulkTone,
          customPainPoint: bulkPainPoint || undefined,
        }),
      });

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Failed to start generation");
        setIsGenerating(false);
        return;
      }

      // ── Read SSE stream ──────────────────────────────────────────────────
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const eventLine = part.match(/^event:\s*(.+)/m);
          const dataLine  = part.match(/^data:\s*(.+)/m);
          if (!eventLine || !dataLine) continue;

          const event = eventLine[1].trim();
          let payload: any;
          try { payload = JSON.parse(dataLine[1]); } catch { continue; }

          if (event === "start") {
            // nothing — we already cleared bulkEmails above
          } else if (event === "email") {
            const e = payload.email;
            setBulkEmails((prev) => [
              ...prev,
              {
                lead: selected.find((l) => l.id === e.lead_id) ?? null,
                lead_email: e.lead_email,
                company_name: e.company_name,
                subject: e.subject,
                body: e.body,
                model: e.model,
                isFallback: e.isFallback,
                isEditing: false,
                editSubject: e.subject,
                editBody: e.body,
              },
            ]);
          } else if (event === "done") {
            const { ai, fallback } = payload;
            if (fallback === 0) {
              toast.success(`Generated ${ai} AI emails!`);
            } else if (ai === 0) {
              toast.warning(`All ${fallback} emails used fallback template. Review before sending.`);
            } else {
              toast.success(`Generated ${ai} AI + ${fallback} fallback emails`);
            }
          }
        }
      }
    } catch (err: any) {
      toast.error(err.message || "Network error — could not reach generation server");
    } finally {
      setIsGenerating(false);
    }
  };

  const sendBulkEmails = async () => {
    if (bulkEmails.length === 0) return;

    // Filter out any emails with no recipient — warn the user
    const validEmails = bulkEmails.filter(e => e.lead_email && e.lead_email.trim());
    const skipped = bulkEmails.length - validEmails.length;
    if (skipped > 0) {
      toast.warning(`${skipped} lead${skipped > 1 ? 's' : ''} skipped — no email address. Add emails to those leads first.`);
    }
    if (validEmails.length === 0) {
      toast.error("None of the selected leads have an email address.");
      return;
    }

    setIsSendingBulk(true);
    const sendToastId = toast.loading(`Sending ${validEmails.length} emails in batches of 10…`);
    try {
      const emailsToSend = validEmails.map(email => ({
        lead_id: email.lead?.id || "",
        lead_email: email.lead_email,
        company_name: email.company_name,
        subject: email.editSubject || email.subject,
        body: email.editBody || email.body,
      }));
      
      const { sendBulkEmailsChunkedAction } = await import("@/app/actions");
      const result = await sendBulkEmailsChunkedAction(userId, emailsToSend, {
        chunkSize: 10,            // 10 emails per batch
        delayBetweenEmails: 45_000,  // 45 seconds between each email
        delayBetweenChunks: 600_000, // 10 minutes between batches
        verifyEmails: false,
      });
      
      toast.dismiss(sendToastId);
      
      if (result.success) {
        const r = (result as any).results;
        const sent = r?.sent ?? 0;
        const failed = r?.failed ?? 0;
        const total = r?.total ?? emailsToSend.length;
        
        if (failed === 0) {
          toast.success(`All ${sent} emails sent successfully!`);
        } else if (sent === 0) {
          toast.error(`All ${failed} emails failed. Check your SMTP account in SMTP Manager.`);
        } else {
          toast.warning(`${sent} sent, ${failed} failed out of ${total} total.`);
        }
        
        setBulkEmails([]);
        setMode("single");
        setSelectedLeadIds(new Set());
        fetchLeads();
      } else { 
        toast.error(result.error || "Failed to send emails");
      }
    } catch (err: any) { 
      toast.dismiss(sendToastId);
      toast.error(err?.message || "Error sending emails");
    }
    finally { setIsSendingBulk(false); }
  };

  const sendTestEmail = async () => {
    const testAddr = prompt("Enter your email to receive a test:");
    if (!testAddr?.includes("@")) { toast.error("Invalid email"); return; }
    setIsSendingBulk(true);
    try {
      const cur = bulkEmails[previewIndex >= 0 ? previewIndex : 0];
      const { sendBulkEmailsChunkedAction } = await import("@/app/actions");
      const result = await sendBulkEmailsChunkedAction(userId, [{ lead_id: cur.lead?.id || "test", lead_email: testAddr, company_name: cur.company_name, subject: "[TEST] " + (cur.editSubject || cur.subject), body: cur.editBody || cur.body }], { chunkSize: 1, delayBetweenEmails: 0, verifyEmails: false });
      if (result.success) toast.success("Test sent to " + testAddr);
      else toast.error(result.error || "Failed");
    } catch (e: any) { toast.error(e.message || "Error"); }
    finally { setIsSendingBulk(false); }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* Mode tabs */}
      <div className="flex items-center gap-2 px-6 pt-4 pb-3 border-b border-gray-200 bg-white flex-shrink-0">
        {[
          { id: "single", label: "Single Email",   icon: Sparkles },
          { id: "bulk",   label: "Bulk Generator", icon: Users    },
          { id: "manual", label: "Manual Compose", icon: PenLine  },
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setMode(id as any)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
              mode === id ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
        {mode === "bulk" && (
          <span className="ml-auto text-sm text-gray-600 font-medium">
            {selectedLeadIds.size} selected · {leads.filter(l => !SENT_STATUSES.has(l.status)).length} unsent
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">

        {/* ══════════════════════════════════════════════════════════════════
            SINGLE EMAIL MODE
        ══════════════════════════════════════════════════════════════════ */}
        {mode === "single" && (
          <div className="p-6 flex flex-col gap-5 w-full max-w-3xl">

            {/* Lead selector */}
            <div>
              <label className="block text-sm font-semibold text-gray-800 mb-2">Target Lead</label>
              <div className="relative" ref={dropdownRef}>
                <button
                  onClick={() => setLeadDropdownOpen((v) => !v)}
                  className="w-full flex items-center justify-between px-4 py-3 rounded-lg border border-gray-300 bg-white text-sm text-gray-700 hover:border-blue-400 transition-all"
                >
                  <span className={selectedLead ? "text-gray-900 font-medium" : "text-gray-400"}>
                    {selectedLead ? `${selectedLead.company_name}${selectedLead.email ? " — " + selectedLead.email : ""}` : "Select a lead…"}
                  </span>
                  <ChevronDown size={15} className="text-gray-400 flex-shrink-0" />
                </button>
                {leadDropdownOpen && (
                  <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
                    <div className="p-2 border-b border-gray-100">
                      <input
                        autoFocus
                        value={leadSearch}
                        onChange={(e) => setLeadSearch(e.target.value)}
                        placeholder="Search leads…"
                        className="w-full px-3 py-2 text-sm text-gray-900 rounded-lg border border-gray-200 outline-none focus:border-blue-400 placeholder:text-gray-400"
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
                <div className="mt-2 flex flex-col gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
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
                  
                  {/* Warning for generated emails */}
                  {selectedLead.email && !enriched && (
                    selectedLead.email.startsWith('info@') || 
                    selectedLead.email.startsWith('contact@') || 
                    selectedLead.email.startsWith('hello@')
                  ) && (
                    <div className="flex items-start gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                      <span className="text-yellow-600 text-sm">⚠️</span>
                      <div className="flex-1">
                        <p className="text-xs font-medium text-yellow-800">Generated Email - May Bounce</p>
                        <p className="text-xs text-yellow-700 mt-0.5">
                          {selectedLead.email} appears auto-generated. Try enriching the lead first or use a custom email.
                        </p>
                      </div>
                    </div>
                  )}
                  
                  {/* Info after enrichment if email is still generated */}
                  {selectedLead.email && enriched && (
                    selectedLead.email.startsWith('info@') || 
                    selectedLead.email.startsWith('contact@') || 
                    selectedLead.email.startsWith('hello@')
                  ) && (
                    <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                      <span className="text-blue-600 text-sm">ℹ️</span>
                      <div className="flex-1">
                        <p className="text-xs font-medium text-blue-800">No Real Email Found</p>
                        <p className="text-xs text-blue-700 mt-0.5">
                          Enrichment couldn't find a real email on their website. You can try using a custom email or search for their contact info manually.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Tone selector */}
            <div>
              <label className="block text-sm font-semibold text-gray-800 mb-2">Tone</label>
              <div className="grid grid-cols-3 gap-2">
                {TONE_OPTIONS.map((t) => (
                  <button
                    key={t.value}
                    onClick={() => setTone(t.value)}
                    className={`flex flex-col gap-1 p-3 rounded-lg border-2 text-left transition-all ${
                      tone === t.value
                        ? "border-blue-600 bg-blue-50"
                        : "border-gray-200 bg-white hover:border-gray-300"
                    }`}
                  >
                    <span className={`text-xs font-bold ${tone === t.value ? "text-blue-700" : "text-gray-900"}`}>{t.label}</span>
                    <span className="text-[10px] text-gray-500 leading-tight">{t.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Optional pain point */}
            <div>
              <label className="block text-sm font-semibold text-gray-800 mb-2">
                Specific Pain Point <span className="normal-case font-normal text-gray-400">(optional — makes email sharper)</span>
              </label>
              <input
                value={customPainPoint}
                onChange={(e) => setCustomPainPoint(e.target.value)}
                placeholder="e.g. losing leads due to slow follow-up, high customer churn, manual reporting…"
                className="w-full px-4 py-3 rounded-lg text-sm border border-gray-300 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 bg-white outline-none transition-all"
              />
            </div>

            {/* Generate button */}
            <button
              onClick={generateEmail}
              disabled={isGenerating || !selectedLead}
              className="w-full py-3.5 rounded-lg text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-white bg-blue-600 hover:bg-blue-700"
            >
              {isGenerating
                ? <><Loader2 size={16} className="animate-spin" /> Generating with AI…</>
                : <><Sparkles size={16} /> Generate Email</>}
            </button>

            {/* Generated email output */}
            {generatedEmail && (
              <div className="rounded-lg border border-gray-200 overflow-hidden">
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
                  <p className="text-xs font-semibold text-gray-700 mb-1">Subject</p>
                  {isEditing
                    ? <input value={editSubject} onChange={(e) => setEditSubject(e.target.value)} className="w-full text-sm font-semibold text-gray-900 bg-white border border-blue-400 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-200" />
                    : <p className="text-sm font-semibold text-gray-900">{generatedEmail.subject}</p>}
                </div>

                {/* Body */}
                <div className="px-4 py-3">
                  <p className="text-xs font-semibold text-gray-700 mb-2">Body</p>
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
                      className="w-full px-4 py-2.5 rounded-lg text-sm text-gray-900 border border-gray-300 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 bg-white outline-none transition-all placeholder:text-gray-400"
                    />
                  )}

                  <button
                    onClick={sendSingleEmail}
                    disabled={isSendingSingle}
                    className="w-full py-3 rounded-lg text-sm font-semibold transition-all disabled:opacity-50 flex items-center justify-center gap-2 text-white bg-blue-600 hover:bg-blue-700"
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
            {bulkEmails.length === 0 && !isGenerating ? (
              <>
                {/* Tone */}
                <div>
                  <label className="block text-sm font-semibold text-gray-800 mb-2">Tone</label>
                  <div className="grid grid-cols-3 gap-2">
                    {TONE_OPTIONS.map((t) => (
                      <button key={t.value} onClick={() => setBulkTone(t.value)}
                        className={`flex flex-col gap-1 p-3 rounded-lg border-2 text-left transition-all ${
                          bulkTone === t.value
                            ? "border-blue-600 bg-blue-50"
                            : "border-gray-200 bg-white hover:border-gray-300"
                        }`}>
                        <span className={`text-xs font-bold ${bulkTone === t.value ? "text-blue-700" : "text-gray-900"}`}>{t.label}</span>
                        <span className="text-[10px] text-gray-500 leading-tight">{t.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Pain point */}
                <div>
                  <label className="block text-sm font-semibold text-gray-800 mb-2">Pain Point <span className="normal-case font-normal text-gray-400">(optional)</span></label>
                  <input value={bulkPainPoint} onChange={(e) => setBulkPainPoint(e.target.value)} placeholder="e.g. slow follow-up, high churn…"
                    className="w-full px-4 py-3 rounded-lg text-sm border border-gray-300 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 bg-white outline-none transition-all" />
                </div>

                {/* Niche filter — clicking a niche auto-selects all leads in it */}
                {categories.length > 0 && (
                  <div>
                    <label className="block text-sm font-semibold text-gray-800 mb-2">
                      Filter by Niche <span className="normal-case font-normal text-gray-400">(click to auto-select all leads in that niche)</span>
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => { setNicheFilter("all"); setSelectedLeadIds(new Set()); }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border-2 transition-all ${nicheFilter === "all" ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-200 hover:border-blue-400"}`}>
                        All ({leads.filter(l => !SENT_STATUSES.has(l.status)).length} unsent)
                      </button>
                      {categories.map((cat) => {
                        const catUnsent = leads.filter((l) => l.niche === cat && !SENT_STATUSES.has(l.status));
                        const catSent   = leads.filter((l) => l.niche === cat && SENT_STATUSES.has(l.status));
                        return (
                          <button key={cat} onClick={() => {
                            setNicheFilter(cat);
                            // Auto-select ONLY unsent leads in this niche
                            setSelectedLeadIds(new Set(catUnsent.map(l => l.id)));
                          }}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium border-2 transition-all ${nicheFilter === cat ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-200 hover:border-blue-400"}`}>
                            {cat}
                            <span className="ml-1 text-green-600 font-bold">{catUnsent.length}</span>
                            {catSent.length > 0 && <span className="ml-1 text-gray-400">({catSent.length} sent)</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Lead list */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-semibold text-gray-800">
                      Unsent Leads ({selectedLeadIds.size} selected)
                    </label>
                    <button onClick={selectAll} className="text-xs text-blue-600 hover:text-blue-700 font-medium">
                      {unsentLeads.every((l) => selectedLeadIds.has(l.id)) ? "Deselect all" : "Select all unsent"}
                    </button>
                  </div>
                  <div className="border border-gray-200 rounded-lg overflow-hidden max-h-72 overflow-y-auto">
                    {unsentLeads.length === 0 && alreadySent.length === 0 && (
                      <p className="text-xs text-gray-400 text-center py-6">No leads found</p>
                    )}

                    {/* Unsent leads — selectable */}
                    {unsentLeads.length === 0 && alreadySent.length > 0 && (
                      <div className="px-4 py-4 text-center">
                        <p className="text-sm font-semibold text-green-700">✅ All leads in this niche have been contacted!</p>
                        <p className="text-xs text-gray-500 mt-1">Add more leads from the Scraper to send more emails.</p>
                      </div>
                    )}

                    {unsentLeads.map((lead, i) => (
                      <div key={lead.id}
                        onClick={() => toggleLead(lead.id)}
                        className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors ${i !== 0 || alreadySent.length > 0 ? "border-t border-gray-100" : ""} ${selectedLeadIds.has(lead.id) ? "bg-blue-50" : "hover:bg-gray-50"}`}>
                        {selectedLeadIds.has(lead.id)
                          ? <CheckSquare size={15} className="text-blue-600 flex-shrink-0" />
                          : <Square size={15} className="text-gray-300 flex-shrink-0" />}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">{lead.company_name}</p>
                          <p className="text-xs text-gray-400 truncate">{lead.email || "no email"}{lead.niche ? " · " + lead.niche : ""}</p>
                        </div>
                      </div>
                    ))}

                    {/* Already sent — greyed out, non-selectable, collapsed */}
                    {alreadySent.length > 0 && (
                      <div className="border-t-2 border-dashed border-gray-200">
                        <div className="px-4 py-2 bg-gray-50 flex items-center gap-2">
                          <CheckCircle size={12} className="text-green-500" />
                          <span className="text-xs font-semibold text-gray-500">
                            Already Sent ({alreadySent.length}) — excluded from selection
                          </span>
                        </div>
                        {alreadySent.map((lead, i) => (
                          <div key={lead.id}
                            className="flex items-center gap-3 px-4 py-2.5 border-t border-gray-100 opacity-40 cursor-not-allowed bg-gray-50">
                            <CheckCircle size={13} className="text-green-500 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium text-gray-600 truncate line-through">{lead.company_name}</p>
                              <p className="text-[10px] text-gray-400 truncate">{lead.email} · {lead.status}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <button onClick={generateBulkEmails} disabled={isGenerating || selectedLeadIds.size === 0}
                  className="w-full py-3.5 rounded-lg text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-white bg-blue-600 hover:bg-blue-700">
                  {isGenerating
                    ? <><Loader2 size={16} className="animate-spin" /> Generating… {bulkEmails.length > 0 ? `${bulkEmails.length} / ${selectedLeadIds.size}` : ""}</>
                    : <><Sparkles size={16} /> Generate {selectedLeadIds.size} Emails</>}
                </button>
              </>
            ) : (
              /* ── Bulk review table ─────────────────────────────────────── */
              <div className="flex flex-col h-full">
                {/* Header bar */}
                <div className="flex items-center justify-between mb-3 flex-shrink-0">
                  <div className="flex items-center gap-3">
                    <p className="text-sm font-bold text-gray-900">
                      {isGenerating
                        ? <span className="flex items-center gap-2"><Loader2 size={14} className="animate-spin text-blue-600" /> Generating… {bulkEmails.length} / {selectedLeadIds.size}</span>
                        : `${bulkEmails.length} emails ready to send`
                      }
                    </p>
                    {!isGenerating && <span className="text-xs text-gray-500">Review and edit before sending</span>}
                  </div>
                  {!isGenerating && (
                    <button
                      onClick={() => setBulkEmails([])}
                      className="text-xs text-gray-500 hover:text-gray-700 border border-gray-300 px-3 py-1.5 rounded-lg hover:bg-gray-50"
                    >
                      ← Back
                    </button>
                  )}
                </div>

                {/* Table */}
                <div className="border border-gray-200 rounded-lg overflow-hidden flex-1 min-h-0">
                  <div className="overflow-auto" style={{ maxHeight: "calc(100vh - 320px)" }}>
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-gray-50 border-b border-gray-200 z-10">
                        <tr>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600 w-40">Company</th>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600 w-48">Email</th>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600">Subject</th>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600 w-24">Status</th>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600 w-16">Edit</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {bulkEmails.map((email, idx) => (
                          <tr
                            key={idx}
                            className={`hover:bg-gray-50 transition-colors ${email.isFallback ? "bg-amber-50/40" : ""}`}
                          >
                            <td className="px-4 py-3">
                              <p className="text-xs font-semibold text-gray-900 truncate max-w-[140px]">{email.company_name}</p>
                            </td>
                            <td className="px-4 py-3">
                              <p className="text-xs text-gray-500 truncate max-w-[180px]">{email.lead_email || "—"}</p>
                            </td>
                            <td className="px-4 py-3">
                              {email.isEditing ? (
                                <input
                                  value={email.editSubject}
                                  onChange={(e) => {
                                    const updated = [...bulkEmails];
                                    updated[idx].editSubject = e.target.value;
                                    setBulkEmails(updated);
                                  }}
                                  className="w-full text-xs text-gray-900 border border-blue-400 rounded px-2 py-1 outline-none focus:ring-1 focus:ring-blue-300"
                                />
                              ) : (
                                <p className="text-xs text-gray-800 truncate max-w-xs">{email.editSubject || email.subject}</p>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              {email.isFallback ? (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-200 font-medium">Template</span>
                              ) : (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 font-medium">AI</span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <button
                                onClick={() => setPreviewIndex(idx)}
                                className="p-1.5 rounded hover:bg-blue-50 text-gray-500 hover:text-blue-600 transition-colors"
                                title="View & edit full email"
                              >
                                <Edit3 size={13} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Action bar */}
                <div className="flex gap-3 mt-3 flex-shrink-0">
                  <button
                    onClick={sendTestEmail}
                    disabled={isSendingBulk || isGenerating}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    <Mail size={14} /> Send Test
                  </button>
                  <button
                    onClick={sendBulkEmails}
                    disabled={isSendingBulk || isGenerating}
                    className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {isSendingBulk
                      ? <><Loader2 size={15} className="animate-spin" /> Sending…</>
                      : isGenerating
                      ? <><Loader2 size={15} className="animate-spin" /> Generating {bulkEmails.length}/{selectedLeadIds.size}…</>
                      : <><Send size={15} /> Send {bulkEmails.length} Emails · 10 per batch · 10 min apart</>
                    }
                  </button>
                </div>

                {/* Full email edit modal */}
                {previewIndex >= 0 && bulkEmails[previewIndex] && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setPreviewIndex(-1)}>
                    <div className="absolute inset-0 bg-black/30" />
                    <div
                      className="relative bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden mx-4"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {/* Modal header */}
                      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
                        <div>
                          <p className="text-sm font-bold text-gray-900">{bulkEmails[previewIndex].company_name}</p>
                          <p className="text-xs text-gray-500">{bulkEmails[previewIndex].lead_email}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-400">{previewIndex + 1} / {bulkEmails.length}</span>
                          <button
                            onClick={() => setPreviewIndex(Math.max(0, previewIndex - 1))}
                            disabled={previewIndex === 0}
                            className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30"
                          >
                            <ChevronLeft size={15} />
                          </button>
                          <button
                            onClick={() => setPreviewIndex(Math.min(bulkEmails.length - 1, previewIndex + 1))}
                            disabled={previewIndex === bulkEmails.length - 1}
                            className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30"
                          >
                            <ChevronRight size={15} />
                          </button>
                          <button onClick={() => setPreviewIndex(-1)} className="p-1.5 rounded hover:bg-gray-100 ml-1">
                            <X size={16} className="text-gray-500" />
                          </button>
                        </div>
                      </div>

                      {/* Modal body */}
                      <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
                        <div>
                          <label className="block text-xs font-semibold text-gray-700 mb-1.5">Subject</label>
                          <input
                            value={bulkEmails[previewIndex].editSubject}
                            onChange={(e) => {
                              const updated = [...bulkEmails];
                              updated[previewIndex].editSubject = e.target.value;
                              setBulkEmails(updated);
                            }}
                            className="w-full px-3 py-2.5 rounded-lg text-sm font-semibold text-gray-900 border border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none"
                          />
                        </div>
                        <div className="flex-1">
                          <label className="block text-xs font-semibold text-gray-700 mb-1.5">Body</label>
                          <textarea
                            value={bulkEmails[previewIndex].editBody}
                            onChange={(e) => {
                              const updated = [...bulkEmails];
                              updated[previewIndex].editBody = e.target.value;
                              setBulkEmails(updated);
                            }}
                            rows={16}
                            className="w-full px-3 py-2.5 rounded-lg text-sm text-gray-900 border border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none resize-none font-sans leading-relaxed"
                          />
                        </div>
                      </div>

                      {/* Modal footer */}
                      <div className="px-5 py-3 border-t border-gray-200 flex justify-end gap-2">
                        <button
                          onClick={() => setPreviewIndex(-1)}
                          className="px-4 py-2 rounded-lg text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50"
                        >
                          Done
                        </button>
                        {previewIndex < bulkEmails.length - 1 && (
                          <button
                            onClick={() => setPreviewIndex(previewIndex + 1)}
                            className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700"
                          >
                            Next →
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            MANUAL COMPOSE MODE
        ══════════════════════════════════════════════════════════════════ */}
        {mode === "manual" && (
          <div className="p-6 flex flex-col gap-5 w-full max-w-3xl">
            <div className="rounded-lg p-4 bg-blue-50 border border-blue-200">
              <p className="text-sm font-semibold text-blue-700">Manual Compose</p>
              <p className="text-xs mt-1 text-blue-700/80">Write and send to any email address — no lead required. Sent via your configured SMTP account.</p>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-800 mb-2">To</label>
              <div className="relative">
                <AtSign size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input type="email" value={manualTo} onChange={(e) => setManualTo(e.target.value)}
                  placeholder="recipient@company.com"
                  className="w-full pl-9 pr-4 py-3 rounded-lg text-sm text-gray-900 border border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 bg-white outline-none transition-all placeholder:text-gray-400" />
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-800 mb-2">Subject</label>
              <input type="text" value={manualSubject} onChange={(e) => setManualSubject(e.target.value)}
                placeholder="e.g. Quick question about your business"
                className="w-full px-4 py-3 rounded-lg text-sm text-gray-900 border border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 bg-white outline-none transition-all placeholder:text-gray-400" />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-800 mb-2">Body</label>
              <textarea value={manualBody} onChange={(e) => setManualBody(e.target.value)} rows={14}
                placeholder={"Hi,\n\nWrite your email here...\n\nBest,\nYour Name"}
                className="w-full px-4 py-3 rounded-lg text-sm text-gray-900 border border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 bg-white outline-none transition-all resize-none placeholder:text-gray-400"
                style={{ lineHeight: "1.7" }} />
            </div>

            <button onClick={sendManualCompose} disabled={isSendingManual || !manualTo || !manualSubject || !manualBody}
              className="w-full py-4 rounded-lg text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-white bg-blue-600 hover:bg-blue-700">
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
