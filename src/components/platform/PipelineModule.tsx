"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Lead,
  GeneratedEmail,
  PipelineStage,
} from "@/types/platform";
import {
  Loader2,
  Search,
  Sparkles,
  Send,
  X,
  RefreshCw,
  AlertCircle,
  Mail,
  MapPin,
  Clock,
  CheckSquare,
  Square,
  Trash2,
  ShieldCheck,
  ThumbsDown,
} from "lucide-react";
import { createClient } from "../../../supabase/client";
import { toast } from "sonner";
import {
  researchLead,
  generateEmailForLead,
  sendEmailForLead,
} from "@/app/actions";
import { deriveLeadContactFields } from "@/utils/email-prompts";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface PipelineModuleProps {
  userId: string;
  onPipelineChange?: () => void;
}

const STAGE_BADGE: Record<
  PipelineStage,
  { label: string; className: string }
> = {
  scraped: { label: "Scraped", className: "bg-slate-100 text-slate-700 border-slate-200" },
  verified: { label: "Verified", className: "bg-cyan-50 text-cyan-700 border-cyan-200" },
  enriched: { label: "Enriched", className: "bg-blue-50 text-blue-700 border-blue-200" },
  researched: { label: "Researched", className: "bg-blue-50 text-blue-700 border-blue-200" },
  email_drafted: { label: "Drafted", className: "bg-violet-50 text-violet-700 border-violet-200" },
  approval_pending: { label: "Review", className: "bg-amber-50 text-amber-800 border-amber-200" },
  approved: { label: "Approved", className: "bg-green-50 text-green-700 border-green-200" },
  queued: { label: "Queued", className: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  sent: { label: "Sent", className: "bg-green-50 text-green-700 border-green-200" },
  replied: { label: "Replied", className: "bg-emerald-50 text-emerald-800 border-emerald-200" },
  followup_due: { label: "Follow-up", className: "bg-orange-50 text-orange-700 border-orange-200" },
  completed: { label: "Done", className: "bg-gray-100 text-gray-700 border-gray-200" },
  failed: { label: "Failed", className: "bg-red-50 text-red-700 border-red-200" },
  call_list: { label: "Call list", className: "bg-amber-50 text-amber-800 border-amber-200" },
};

type LeadRow = Lead & {
  pipeline_stage?: PipelineStage | null;
  pipeline_error?: string | null;
  pipeline_updated_at?: string | null;
  automation_score?: number | null;
  automation_fit_reason?: string | null;
  automation_risk?: string | null;
  automation_recommended_action?: string | null;
};

const PIPELINE_COLUMNS: {
  key: PipelineStage | "sent_group";
  label: string;
  stages: PipelineStage[];
  hint: string;
}[] = [
  {
    key: "scraped",
    label: "Scraped",
    stages: ["scraped", "verified", "enriched"],
    hint: "Run research to enrich context",
  },
  {
    key: "call_list",
    label: "Call list",
    stages: ["call_list"],
    hint: "Phone only — retry enrich to find email",
  },
  {
    key: "researched",
    label: "Researched",
    stages: ["researched"],
    hint: "Generate a personalised email",
  },
  {
    key: "email_drafted",
    label: "Needs Review",
    stages: ["email_drafted", "approval_pending", "approved", "queued"],
    hint: "Batch approve before Gmail sends",
  },
  {
    key: "sent_group",
    label: "Sent",
    stages: ["sent", "replied", "followup_due", "completed"],
    hint: "Email delivered — awaiting reply",
  },
  {
    key: "failed",
    label: "Failed",
    stages: ["failed"],
    hint: "Check error and retry the step",
  },
];

function normalizePipelineStage(
  stage: PipelineStage | null | undefined
): PipelineStage {
  if (!stage) return "scraped";
  return stage;
}

export default function PipelineModule({
  userId,
  onPipelineChange,
}: PipelineModuleProps) {
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [draftByLead, setDraftByLead] = useState<
    Record<string, { id: string; subject: string | null; body: string | null }>
  >({});
  const [loading, setLoading] = useState(true);
  const [drawerLead, setDrawerLead] = useState<LeadRow | null>(null);
  const [drawerDraft, setDrawerDraft] = useState<GeneratedEmail | null>(null);
  const [drawerSent, setDrawerSent] = useState<{
    subject: string | null;
    sent_at: string;
    status: string;
  } | null>(null);
  const [sendPreview, setSendPreview] = useState<{
    lead: LeadRow;
    draft: { id: string; subject: string | null; body: string | null };
  } | null>(null);
  const [busyLeadId, setBusyLeadId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);
  const [approvalBusy, setApprovalBusy] = useState(false);

  const supabase = createClient();

  const allSelected =
    leads.length > 0 && leads.every((l) => selectedLeadIds.has(l.id));

  const toggleSelectLead = (leadId: string) => {
    setSelectedLeadIds((prev) => {
      const next = new Set(prev);
      if (next.has(leadId)) next.delete(leadId);
      else next.add(leadId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedLeadIds(new Set());
    } else {
      setSelectedLeadIds(new Set(leads.map((l) => l.id)));
    }
  };

  const deleteSelectedLeads = async () => {
    const ids = Array.from(selectedLeadIds);
    if (ids.length === 0) return;

    if (
      !confirm(
        `Delete ${ids.length} lead${ids.length === 1 ? "" : "s"} from Pipeline and CRM? This cannot be undone.`
      )
    ) {
      return;
    }

    setIsDeleting(true);
    try {
      const { error } = await supabase
        .from("leads")
        .delete()
        .in("id", ids)
        .eq("user_id", userId);

      if (error) {
        toast.error(error.message || "Failed to delete leads");
        return;
      }

      toast.success(
        `Deleted ${ids.length} lead${ids.length === 1 ? "" : "s"}`
      );
      setSelectedLeadIds(new Set());
      if (drawerLead && ids.includes(drawerLead.id)) {
        setDrawerLead(null);
        setDrawerDraft(null);
        setDrawerSent(null);
      }
      await fetchPipeline();
      onPipelineChange?.();
    } finally {
      setIsDeleting(false);
    }
  };

  const approveSelectedLeads = async () => {
    const ids = Array.from(selectedLeadIds);
    if (ids.length === 0) return;

    setApprovalBusy(true);
    try {
      const res = await fetch("/api/automation/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve", leadIds: ids }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Approval failed");
        return;
      }
      toast.success(`Approved ${data.approved ?? 0}, queued ${data.queued ?? 0}`);
      if (data.errors?.length) toast.warning(`${data.errors.length} skipped`);
      setSelectedLeadIds(new Set());
      await fetchPipeline();
      onPipelineChange?.();
    } finally {
      setApprovalBusy(false);
    }
  };

  const rejectSelectedLeads = async () => {
    const ids = Array.from(selectedLeadIds);
    if (ids.length === 0) return;

    setApprovalBusy(true);
    try {
      const res = await fetch("/api/automation/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reject",
          leadIds: ids,
          reason: "Rejected during batch review",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Reject failed");
        return;
      }
      toast.success(`Rejected ${data.rejected ?? 0}`);
      setSelectedLeadIds(new Set());
      await fetchPipeline();
      onPipelineChange?.();
    } finally {
      setApprovalBusy(false);
    }
  };

  const scoreSelectedLeads = async () => {
    const ids = Array.from(selectedLeadIds);
    if (ids.length === 0) return;

    setApprovalBusy(true);
    try {
      const res = await fetch("/api/automation/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadIds: ids }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Scoring failed");
        return;
      }
      toast.success(`AI scored ${data.scored ?? 0} lead${data.scored === 1 ? "" : "s"}`);
      if (data.failed) toast.warning(`${data.failed} failed to score`);
      await fetchPipeline();
      onPipelineChange?.();
    } finally {
      setApprovalBusy(false);
    }
  };

  const fetchPipeline = useCallback(async () => {
    const { data: leadData, error: leadError } = await supabase
      .from("leads")
      .select(
        "id, user_id, company_name, email, phone, website, niche, location, company_context, status, notes, pipeline_stage, pipeline_error, pipeline_updated_at, email_source, email_confidence, automation_score, automation_fit_reason, automation_risk, automation_recommended_action, created_at, updated_at"
      )
      .eq("user_id", userId)
      .not("pipeline_stage", "is", null)
      .order("pipeline_updated_at", { ascending: false, nullsFirst: false });

    if (leadError) {
      console.error("Pipeline fetch leads:", leadError);
      toast.error("Failed to load pipeline leads");
    }

    const { data: emailData } = await supabase
      .from("generated_emails")
      .select("id, lead_id, subject, body, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    const latest: Record<
      string,
      { id: string; subject: string | null; body: string | null }
    > = {};
    for (const row of emailData ?? []) {
      if (!row.lead_id || latest[row.lead_id]) continue;
      latest[row.lead_id] = {
        id: row.id,
        subject: row.subject,
        body: row.body,
      };
    }

    setLeads((leadData as LeadRow[]) ?? []);
    setDraftByLead(latest);
    setLoading(false);
  }, [userId, supabase]);

  useEffect(() => {
    fetchPipeline();
    const channel = supabase
      .channel("pipeline_leads")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "leads",
          filter: `user_id=eq.${userId}`,
        },
        () => fetchPipeline()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchPipeline, supabase]);

  const retryEnrichLead = async (lead: LeadRow) => {
    setBusyLeadId(lead.id);
    setBusyAction("enrich");
    try {
      const res = await fetch("/api/enrich-lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId: lead.id,
          companyName: lead.company_name,
          website: lead.website,
          niche: lead.niche,
          location: lead.location,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Enrich failed");
        return;
      }
      if (data.email) {
        toast.success(`Found email: ${data.email}`);
      } else {
        toast.info("No email on website yet — try again after adding a website URL");
      }
      await fetchPipeline();
      onPipelineChange?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Enrich failed");
    } finally {
      setBusyLeadId(null);
      setBusyAction(null);
    }
  };

  const runAction = async (
    leadId: string,
    action: "research" | "generate" | "send",
    emailId?: string
  ) => {
    setBusyLeadId(leadId);
    setBusyAction(action);
    const priorStage = leads.find((l) => l.id === leadId)?.pipeline_stage;
    try {
      if (action === "research") {
        const res = await researchLead(leadId);
        if (!res.success) {
          toast.error(res.error ?? "Research failed");
        } else {
          toast.success(
            priorStage === "email_drafted"
              ? "Research updated — click Generate email to replace the old draft"
              : "Research complete"
          );
        }
      } else if (action === "generate") {
        const res = await generateEmailForLead(leadId);
        if (!res.success) {
          toast.error(res.error ?? "Email generation failed");
        } else {
          toast.success("Email drafted");
        }
      } else if (action === "send" && emailId) {
        const res = await sendEmailForLead(leadId, emailId);
        if (!res.success) {
          toast.error(res.error ?? "Send failed");
        } else {
          toast.success("Email sent");
        }
      }
      await fetchPipeline();
      onPipelineChange?.();
      if (drawerLead?.id === leadId) {
        const updated = (await supabase
          .from("leads")
          .select(
            "id, user_id, company_name, email, phone, website, niche, location, company_context, status, notes, pipeline_stage, pipeline_error, pipeline_updated_at, email_source, email_confidence, automation_score, automation_fit_reason, automation_risk, automation_recommended_action, created_at, updated_at"
          )
          .eq("id", leadId)
          .single()).data as LeadRow | null;
        if (updated) {
          setDrawerLead(updated);
          const { data: draft } = await supabase
            .from("generated_emails")
            .select("*")
            .eq("lead_id", leadId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          setDrawerDraft((draft as GeneratedEmail) ?? null);
        }
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusyLeadId(null);
      setBusyAction(null);
    }
  };

  const openDrawer = async (lead: LeadRow) => {
    setDrawerLead(lead);
    const { data } = await supabase
      .from("generated_emails")
      .select("*")
      .eq("lead_id", lead.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setDrawerDraft((data as GeneratedEmail) ?? null);

    if (lead.pipeline_stage === "sent" || lead.pipeline_stage === "replied") {
      const { data: sent } = await supabase
        .from("sent_emails")
        .select("subject, sent_at, status")
        .eq("lead_id", lead.id)
        .order("sent_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      setDrawerSent(sent ?? null);
    } else {
      setDrawerSent(null);
    }
  };

  const openSendPreview = (
    lead: LeadRow,
    draft: { id: string; subject: string | null; body: string | null }
  ) => {
    if (!lead.email?.trim()) {
      toast.error("Add an email address before sending");
      return;
    }
    setSendPreview({ lead, draft });
  };

  const researchPreview = (ctx: string | null | undefined) => {
    if (!ctx?.trim()) return "No context yet";
    const block = ctx.match(/\[RESEARCH\][\s\S]*?\[\/RESEARCH\]/)?.[0] ?? ctx;
    return block.replace(/\[\/?RESEARCH\]/g, "").trim().slice(0, 400);
  };

  const stats = {
    total: leads.length,
    scraped: leads.filter((l) => normalizePipelineStage(l.pipeline_stage) === "scraped").length,
    callList: leads.filter((l) => l.pipeline_stage === "call_list").length,
    researched: leads.filter((l) => l.pipeline_stage === "researched").length,
    drafted: leads.filter((l) =>
      ["email_drafted", "approval_pending", "approved", "queued"].includes(
        l.pipeline_stage ?? ""
      )
    ).length,
    sent: leads.filter((l) =>
      ["sent", "replied", "followup_due", "completed"].includes(
        l.pipeline_stage ?? ""
      )
    ).length,
    failed: leads.filter((l) => l.pipeline_stage === "failed").length,
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 size={20} className="animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Stats */}
      <div className="flex items-center gap-4 px-5 py-3 border-b border-gray-200 flex-wrap">
        <div className="flex items-center gap-4 flex-1 min-w-0 flex-wrap">
          {[
            { label: "In pipeline", value: stats.total },
            { label: "Scraped", value: stats.scraped },
            { label: "Call list", value: stats.callList },
            { label: "Researched", value: stats.researched },
            { label: "Drafted", value: stats.drafted },
            { label: "Sent", value: stats.sent },
            { label: "Failed", value: stats.failed },
          ].map(({ label, value }) => (
            <div key={label}>
              <p className="text-[10px] text-gray-400 leading-none">{label}</p>
              <p className="text-sm font-bold text-gray-900">{value}</p>
            </div>
          ))}
        </div>
        {leads.length > 0 && (
          <button
            type="button"
            onClick={toggleSelectAll}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-300 text-gray-700 hover:bg-gray-50"
          >
            {allSelected ? <CheckSquare size={12} /> : <Square size={12} />}
            {allSelected ? "Deselect all" : "Select all"}
          </button>
        )}
        <button
          onClick={() => {
            setLoading(true);
            fetchPipeline();
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-300 text-gray-700 hover:bg-gray-50"
        >
          <RefreshCw size={12} />
          Refresh
        </button>
      </div>

      {selectedLeadIds.size > 0 && (
        <div className="flex items-center gap-3 px-5 py-2.5 border-b border-red-100 bg-red-50 flex-wrap">
          <span className="text-sm font-medium text-red-800">
            {selectedLeadIds.size} selected
          </span>
          <button
            type="button"
            disabled={isDeleting}
            onClick={deleteSelectedLeads}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
          >
            {isDeleting ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Trash2 size={12} />
            )}
            Delete selected
          </button>
          <button
            type="button"
            disabled={approvalBusy}
            onClick={scoreSelectedLeads}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {approvalBusy ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Sparkles size={12} />
            )}
            AI score
          </button>
          <button
            type="button"
            disabled={approvalBusy}
            onClick={approveSelectedLeads}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
          >
            {approvalBusy ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <ShieldCheck size={12} />
            )}
            Approve & queue
          </button>
          <button
            type="button"
            disabled={approvalBusy}
            onClick={rejectSelectedLeads}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-800 text-white hover:bg-gray-900 disabled:opacity-50"
          >
            <ThumbsDown size={12} />
            Reject
          </button>
          <button
            type="button"
            onClick={() => setSelectedLeadIds(new Set())}
            className="text-xs text-gray-600 hover:text-gray-900 underline"
          >
            Clear selection
          </button>
        </div>
      )}

      <p className="px-5 py-2 text-[11px] text-gray-500 border-b border-gray-100 bg-gray-50">
        Click a card for details, or use the checkbox to select leads for bulk delete.
        Assisted mode is on: drafts require batch approval before Gmail sending.
      </p>

      {/* Kanban */}
      <div className="flex-1 overflow-hidden bg-gray-50">
        <style>{`
          .pipeline-scroll { overflow-x: auto; overflow-y: hidden; height: 100%; }
          .pipeline-scroll::-webkit-scrollbar { height: 6px; }
          .pipeline-scroll::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 3px; }
        `}</style>
        <div className="pipeline-scroll h-full p-4">
          {leads.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center max-w-sm">
                <Search size={28} className="mx-auto mb-3 text-gray-300" />
                <p className="text-sm font-medium text-gray-500">No pipeline leads yet</p>
                <p className="text-xs mt-1 text-gray-400">
                  Scrape leads in the Scraper module — they appear here as Scraped.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex gap-4 min-w-max h-full">
              {PIPELINE_COLUMNS.map((col) => {
                const columnLeads = leads.filter((l) => {
                  const stage = normalizePipelineStage(l.pipeline_stage);
                  return col.stages.includes(stage);
                });

                return (
                  <div key={col.key} className="flex flex-col w-60 flex-shrink-0">
                    <div className="mb-2 px-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-700">
                          {col.label}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-200 text-gray-600 font-medium">
                          {columnLeads.length}
                        </span>
                      </div>
                      <p className="text-[9px] text-gray-400 mt-0.5">{col.hint}</p>
                    </div>

                    <div
                      className="flex flex-col gap-2 flex-1 rounded-lg p-2 bg-gray-100 border-2 border-dashed border-transparent overflow-y-auto"
                      style={{ minHeight: "8rem", maxHeight: "calc(100vh - 240px)" }}
                    >
                      {columnLeads.map((lead) => {
                        const stage = normalizePipelineStage(lead.pipeline_stage);
                        const draft = draftByLead[lead.id];
                        const busy = busyLeadId === lead.id;

                        return (
                          <PipelineCard
                            key={lead.id}
                            lead={lead}
                            stage={stage}
                            draftSubject={draft?.subject}
                            busy={busy}
                            busyAction={busy ? busyAction : null}
                            selected={selectedLeadIds.has(lead.id)}
                            onToggleSelect={() => toggleSelectLead(lead.id)}
                            onOpen={() => openDrawer(lead)}
                            onResearch={() => runAction(lead.id, "research")}
                            onGenerate={() => runAction(lead.id, "generate")}
                            onReviewSend={() =>
                              draft?.id
                                ? openSendPreview(lead, draft)
                                : toast.error("No drafted email — generate first")
                            }
                            onViewSent={() => openDrawer(lead)}
                          />
                        );
                      })}
                      {columnLeads.length === 0 && (
                        <div className="flex items-center justify-center h-16 rounded-md border border-dashed border-gray-300">
                          <p className="text-[10px] text-gray-400">Empty</p>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Drawer */}
      {drawerLead && (
        <div className="fixed inset-0 z-50" onClick={() => setDrawerLead(null)}>
          <div className="absolute inset-0 bg-black/30" />
          <div
            className="absolute right-0 top-0 bottom-0 w-full sm:max-w-lg flex flex-col overflow-hidden bg-white border-l border-gray-200 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <div className="min-w-0 flex-1 pr-4">
                <h2 className="text-sm font-bold text-gray-900 truncate">
                  {drawerLead.company_name}
                </h2>
                <p className="text-xs text-gray-500 truncate">{drawerLead.email ?? "No email"}</p>
              </div>
              <button
                onClick={() => setDrawerLead(null)}
                className="p-1.5 rounded-lg hover:bg-gray-100"
              >
                <X size={16} className="text-gray-500" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] px-2 py-0.5 rounded border border-gray-300 font-medium capitalize">
                  {drawerLead.pipeline_stage ?? "scraped"}
                </span>
                {drawerLead.niche && (
                  <span className="text-[10px] px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                    {drawerLead.niche}
                  </span>
                )}
                {drawerLead.location && (
                  <span className="text-[10px] text-gray-500 flex items-center gap-0.5">
                    <MapPin size={9} />
                    {drawerLead.location}
                  </span>
                )}
                {drawerLead.pipeline_updated_at && (
                  <span className="text-[10px] text-gray-400 flex items-center gap-0.5 ml-auto">
                    <Clock size={9} />
                    {new Date(drawerLead.pipeline_updated_at).toLocaleString()}
                  </span>
                )}
                {drawerLead.automation_score != null && (
                  <span className="text-[10px] px-2 py-0.5 rounded bg-green-50 text-green-700 border border-green-200 font-semibold">
                    AI score {drawerLead.automation_score}
                  </span>
                )}
              </div>

              {drawerLead.pipeline_error && (
                <div className="flex gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
                  <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                  <p>{drawerLead.pipeline_error}</p>
                </div>
              )}

              {drawerLead.automation_fit_reason && (
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-gray-400 font-semibold mb-1.5">
                    AI decision
                  </p>
                  <p className="text-xs text-gray-700 leading-relaxed bg-green-50 border border-green-200 rounded-lg p-3">
                    {drawerLead.automation_fit_reason}
                  </p>
                </div>
              )}

              <div>
                <p className="text-[10px] uppercase tracking-widest text-gray-400 font-semibold mb-1.5">
                  Research context
                </p>
                <p className="text-xs text-gray-700 leading-relaxed whitespace-pre-wrap bg-gray-50 border border-gray-200 rounded-lg p-3 max-h-40 overflow-y-auto">
                  {researchPreview(drawerLead.company_context)}
                </p>
              </div>

              {drawerDraft && (
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-gray-400 font-semibold mb-1.5">
                    Draft email
                  </p>
                  <p className="text-xs font-semibold text-gray-900 mb-2">
                    {drawerDraft.subject ?? "(no subject)"}
                  </p>
                  <pre className="text-[11px] text-gray-700 whitespace-pre-wrap font-sans leading-relaxed bg-gray-50 border border-gray-200 rounded-lg p-3 max-h-48 overflow-y-auto">
                    {drawerDraft.body}
                  </pre>
                </div>
              )}
            </div>

            <div className="px-5 py-3 border-t border-gray-200 flex flex-wrap gap-2">
              {drawerLead.pipeline_stage === "call_list" && (
                <button
                  disabled={busyLeadId === drawerLead.id}
                  onClick={() => retryEnrichLead(drawerLead)}
                  className="flex-1 min-w-[120px] flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-semibold bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  {busyLeadId === drawerLead.id && busyAction === "enrich" ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <RefreshCw size={14} />
                  )}
                  Retry enrich (find email)
                </button>
              )}
              {["scraped", "verified", "enriched"].includes(
                drawerLead.pipeline_stage ?? "scraped"
              ) && (
                <button
                  disabled={busyLeadId === drawerLead.id}
                  onClick={() => runAction(drawerLead.id, "research")}
                  className="flex-1 min-w-[120px] flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {busyLeadId === drawerLead.id && busyAction === "research" ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Search size={14} />
                  )}
                  Research
                </button>
              )}
              {drawerLead.pipeline_stage &&
                !["scraped", "verified", "enriched"].includes(
                  drawerLead.pipeline_stage
                ) && (
                  <button
                    disabled={busyLeadId === drawerLead.id}
                    onClick={() => runAction(drawerLead.id, "research")}
                    className="flex items-center justify-center gap-2 py-2 px-4 rounded-lg text-sm font-medium border border-gray-300 text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
                  >
                    {busyLeadId === drawerLead.id && busyAction === "research" ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <RefreshCw size={14} />
                    )}
                    Re-research
                  </button>
                )}
              {(drawerLead.pipeline_stage === "email_drafted" ||
                drawerLead.pipeline_stage === "approval_pending") && (
                <p className="w-full text-[10px] text-gray-500 order-first">
                  This draft is waiting for assisted-mode approval. Select it and use Approve & queue.
                </p>
              )}
              {(drawerLead.pipeline_stage === "researched" ||
                (drawerLead.pipeline_stage === "failed" && drawerLead.company_context)) && (
                <button
                  disabled={busyLeadId === drawerLead.id}
                  onClick={() => runAction(drawerLead.id, "generate")}
                  className="flex-1 min-w-[120px] flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-semibold bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50"
                >
                  {busyLeadId === drawerLead.id && busyAction === "generate" ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Sparkles size={14} />
                  )}
                  Generate email
                </button>
              )}
              {drawerLead.pipeline_stage === "approval_pending" && drawerDraft && (
                <button
                  disabled={!drawerLead.email}
                  onClick={() => {
                    setSelectedLeadIds(new Set([drawerLead.id]));
                    toast.info("Lead selected. Use Approve & queue in the selection bar.");
                  }}
                  className="flex-1 min-w-[120px] flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-semibold bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                >
                  <ShieldCheck size={14} />
                  Select for approval
                </button>
              )}
              {(drawerLead.pipeline_stage === "sent" ||
                drawerLead.pipeline_stage === "replied") &&
                drawerSent && (
                  <div className="w-full text-xs text-gray-600 bg-green-50 border border-green-200 rounded-lg p-3">
                    <p className="font-semibold text-gray-900">{drawerSent.subject}</p>
                    <p className="mt-1 text-[10px]">
                      Sent {new Date(drawerSent.sent_at).toLocaleString()} · {drawerSent.status}
                    </p>
                  </div>
                )}
              {!drawerLead.email && drawerLead.pipeline_stage === "approval_pending" && (
                <p className="w-full text-[10px] text-amber-700">Add an email address to send.</p>
              )}
              <button
                type="button"
                disabled={isDeleting}
                onClick={async () => {
                  if (
                    !confirm(
                      `Delete "${drawerLead.company_name}" from Pipeline and CRM?`
                    )
                  ) {
                    return;
                  }
                  setIsDeleting(true);
                  try {
                    const { error } = await supabase
                      .from("leads")
                      .delete()
                      .eq("id", drawerLead.id)
                      .eq("user_id", userId);
                    if (error) {
                      toast.error(error.message || "Failed to delete lead");
                      return;
                    }
                    toast.success("Lead deleted");
                    setDrawerLead(null);
                    setDrawerDraft(null);
                    setDrawerSent(null);
                    setSelectedLeadIds((prev) => {
                      const next = new Set(prev);
                      next.delete(drawerLead.id);
                      return next;
                    });
                    await fetchPipeline();
                    onPipelineChange?.();
                  } finally {
                    setIsDeleting(false);
                  }
                }}
                className="flex items-center justify-center gap-2 py-2 px-4 rounded-lg text-sm font-medium border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                <Trash2 size={14} />
                Delete lead
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Review & send modal */}
      <Dialog open={!!sendPreview} onOpenChange={(open) => !open && setSendPreview(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Review email before sending</DialogTitle>
          </DialogHeader>
          {sendPreview && (
            <div className="space-y-3">
              <p className="text-sm text-gray-600">
                To:{" "}
                <span className="font-medium text-gray-900">
                  {sendPreview.lead.email}
                </span>
              </p>
              <p className="text-sm font-semibold text-gray-900">
                {sendPreview.draft.subject ?? "(no subject)"}
              </p>
              <pre className="text-xs text-gray-700 whitespace-pre-wrap font-sans leading-relaxed bg-gray-50 border border-gray-200 rounded-lg p-3 max-h-64 overflow-y-auto">
                {sendPreview.draft.body}
              </pre>
            </div>
          )}
          <DialogFooter>
            <button
              type="button"
              onClick={() => setSendPreview(null)}
              className="px-4 py-2 rounded-lg text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busyLeadId != null}
              onClick={async () => {
                if (!sendPreview) return;
                await runAction(
                  sendPreview.lead.id,
                  "send",
                  sendPreview.draft.id
                );
                setSendPreview(null);
              }}
              className="px-4 py-2 rounded-lg text-sm font-semibold bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 flex items-center gap-2"
            >
              {busyAction === "send" ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Send size={14} />
              )}
              Send now
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PipelineCard({
  lead,
  stage,
  draftSubject,
  busy,
  busyAction,
  selected,
  onToggleSelect,
  onOpen,
  onResearch,
  onGenerate,
  onReviewSend,
  onViewSent,
}: {
  lead: LeadRow;
  stage: PipelineStage;
  draftSubject?: string | null;
  busy: boolean;
  busyAction: string | null;
  selected: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
  onResearch: () => void;
  onGenerate: () => void;
  onReviewSend: () => void;
  onViewSent: () => void;
}) {
  const failed = stage === "failed";
  const badge = STAGE_BADGE[stage];
  const { contact_name, contact_role } = deriveLeadContactFields({
    email: lead.email,
    company_name: lead.company_name,
  });

  return (
    <div
      onClick={onOpen}
      className={`rounded-lg p-3 cursor-pointer border bg-white hover:border-blue-400 hover:shadow-sm transition-all group ${
        selected
          ? "border-blue-500 ring-1 ring-blue-200 bg-blue-50/50"
          : failed
            ? "border-red-200"
            : "border-gray-200"
      }`}
    >
      <div className="flex items-start gap-2 mb-1">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect();
          }}
          className="flex-shrink-0 p-0.5 rounded text-gray-400 hover:text-blue-600"
          aria-label={selected ? "Deselect lead" : "Select lead"}
        >
          {selected ? (
            <CheckSquare size={14} className="text-blue-600" />
          ) : (
            <Square size={14} />
          )}
        </button>
        <p className="text-xs font-semibold text-gray-900 truncate leading-tight flex-1 min-w-0">
          {lead.company_name}
        </p>
        <span
          className={`text-[8px] px-1.5 py-0.5 rounded border font-semibold flex-shrink-0 ${badge.className}`}
        >
          {badge.label}
        </span>
      </div>
      {contact_name !== "Team" && (
        <p className="text-[10px] text-gray-500 truncate">
          {contact_name}
          {contact_role ? ` · ${contact_role}` : ""}
        </p>
      )}
      {lead.location && (
        <p className="text-[10px] text-gray-400 truncate flex items-center gap-0.5 mt-0.5">
          <MapPin size={8} className="flex-shrink-0" />
          {lead.location}
        </p>
      )}
      {lead.email && (
        <p className="text-[10px] text-gray-400 truncate mt-0.5">{lead.email}</p>
      )}
      {lead.niche && (
        <span className="inline-block mt-1.5 text-[9px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 border border-gray-200">
          {lead.niche}
        </span>
      )}
      {draftSubject && (
        <p className="text-[9px] text-gray-500 mt-1.5 truncate italic">{draftSubject}</p>
      )}
      {lead.pipeline_error && (
        <p className="text-[9px] text-red-600 mt-1 line-clamp-2">{lead.pipeline_error}</p>
      )}

      <div
        className="flex flex-wrap gap-1 mt-2"
        onClick={(e) => e.stopPropagation()}
      >
        {["scraped", "verified", "enriched"].includes(stage) && (
          <ActionBtn
            icon={Search}
            label="Research"
            busy={busy && busyAction === "research"}
            onClick={onResearch}
          />
        )}
        {stage === "researched" && (
          <>
            <ActionBtn
              icon={Sparkles}
              label="Generate"
              busy={busy && busyAction === "generate"}
              onClick={onGenerate}
              variant="violet"
            />
            <ActionBtn
              icon={RefreshCw}
              label="Re-research"
              busy={busy && busyAction === "research"}
              onClick={onResearch}
              variant="outline"
            />
          </>
        )}
        {stage === "email_drafted" && (
          <>
            <ActionBtn
              icon={ShieldCheck}
              label="Select to approve"
              busy={false}
              onClick={onToggleSelect}
              variant="green"
            />
            <ActionBtn
              icon={RefreshCw}
              label="Re-research"
              busy={busy && busyAction === "research"}
              onClick={onResearch}
              variant="outline"
            />
          </>
        )}
        {stage === "approval_pending" && (
          <>
            <ActionBtn
              icon={ShieldCheck}
              label="Select"
              busy={false}
              onClick={onToggleSelect}
              variant="green"
            />
            <ActionBtn
              icon={RefreshCw}
              label="Re-research"
              busy={busy && busyAction === "research"}
              onClick={onResearch}
              variant="outline"
            />
          </>
        )}
        {stage === "queued" && (
          <ActionBtn
            icon={Mail}
            label="Queued"
            busy={false}
            onClick={onViewSent}
            variant="blue"
          />
        )}
        {stage === "failed" && (
          <ActionBtn
            icon={RefreshCw}
            label="Retry"
            busy={busy}
            onClick={onResearch}
          />
        )}
        {(stage === "sent" || stage === "replied") && (
          <ActionBtn
            icon={Mail}
            label="View sent"
            busy={false}
            onClick={onViewSent}
            variant="blue"
          />
        )}
      </div>
    </div>
  );
}

function ActionBtn({
  icon: Icon,
  label,
  busy,
  onClick,
  variant = "blue",
}: {
  icon: React.ElementType;
  label: string;
  busy: boolean;
  onClick: () => void;
  variant?: "blue" | "violet" | "green" | "outline";
}) {
  const colors = {
    blue: "bg-blue-600 hover:bg-blue-700 text-white",
    violet: "bg-violet-600 hover:bg-violet-700 text-white",
    green: "bg-green-600 hover:bg-green-700 text-white",
    outline:
      "bg-white hover:bg-gray-50 text-gray-700 border border-gray-300",
  };
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium disabled:opacity-50 ${colors[variant]}`}
    >
      {busy ? <Loader2 size={9} className="animate-spin" /> : <Icon size={9} />}
      {label}
    </button>
  );
}
