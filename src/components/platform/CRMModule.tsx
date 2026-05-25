"use client";

import { useState, useEffect, useCallback } from "react";
import { Lead, LeadStatus, LEAD_STATUSES } from "@/types/platform";
import {
  Mail, X, Loader2, Users, Save, Clock, Upload, Trash2, Filter,
} from "lucide-react";
import { createClient } from "../../../supabase/client";
import { toast } from "sonner";
import CSVImportModal from "./CSVImportModal";

interface CRMModuleProps {
  userId: string;
  onWriteEmail?: (lead: Lead) => void;
}

// Simplified kanban columns — only the ones that matter
const KANBAN_COLUMNS: { value: LeadStatus; label: string }[] = [
  { value: "new",        label: "New" },
  { value: "contacted",  label: "Contacted" },
  { value: "replied",    label: "Replied" },
  { value: "interested", label: "Interested" },
  { value: "failed",     label: "Failed" },
];

interface LeadWithEmails extends Lead {
  generated_emails?: Array<{ id: string; subject: string; body: string; model_used: string; created_at: string; tone: string }>;
}

export default function CRMModule({ userId, onWriteEmail }: CRMModuleProps) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerLead, setDrawerLead] = useState<LeadWithEmails | null>(null);
  const [drawerEmails, setDrawerEmails] = useState<LeadWithEmails["generated_emails"]>([]);
  const [drawerSentEmails, setDrawerSentEmails] = useState<Array<{
    id: string; subject: string | null; to_email: string | null;
    status: string; sent_at: string; bounce_reason: string | null;
  }>>([]);
  const [notes, setNotes] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);
  const [filterStatus, setFilterStatus] = useState<LeadStatus | "all">("all");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [categories, setCategories] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState<LeadStatus | null>(null);
  const [draggingLead, setDraggingLead] = useState<string | null>(null);
  const [showCSVImport, setShowCSVImport] = useState(false);

  const supabase = createClient();

  const fetchLeads = useCallback(async () => {
    const { data, error } = await supabase
      .from("leads")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) console.error("Error fetching leads:", error);

    if (data) {
      setLeads(data as Lead[]);
      const uniqueCategories = Array.from(
        new Set(data.map((l: any) => l.niche).filter(Boolean))
      ) as string[];
      setCategories(uniqueCategories);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    fetchLeads();
    const channel = supabase
      .channel("leads_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "leads", filter: `user_id=eq.${userId}` }, () => fetchLeads())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchLeads]);

  const updateLeadStatus = async (leadId: string, newStatus: LeadStatus, oldStatus: LeadStatus) => {
    const { error } = await supabase
      .from("leads")
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq("id", leadId);
    if (!error) {
      await supabase.from("lead_status_history").insert({ lead_id: leadId, old_status: oldStatus, new_status: newStatus });
      setLeads((prev) => prev.map((l) => l.id === leadId ? { ...l, status: newStatus } : l));
    }
  };

  const openDrawer = async (lead: Lead) => {
    setDrawerLead(lead as LeadWithEmails);
    setNotes(lead.notes || "");
    const { data } = await supabase
      .from("generated_emails").select("*").eq("lead_id", lead.id).order("created_at", { ascending: false });
    setDrawerEmails(data || []);
    const { data: sentData } = await supabase
      .from("sent_emails").select("id, subject, to_email, status, sent_at, bounce_reason")
      .eq("lead_id", lead.id).order("sent_at", { ascending: false });
    setDrawerSentEmails(sentData || []);
  };

  const saveNotes = async () => {
    if (!drawerLead) return;
    setSavingNotes(true);
    await supabase.from("leads").update({ notes, updated_at: new Date().toISOString() }).eq("id", drawerLead.id);
    toast.success("Notes saved");
    setSavingNotes(false);
    setLeads((prev) => prev.map((l) => l.id === drawerLead.id ? { ...l, notes } : l));
  };

  const deleteLead = async (leadId: string) => {
    const { error } = await supabase.from("leads").delete().eq("id", leadId);
    if (!error) {
      setLeads((prev) => prev.filter((l) => l.id !== leadId));
      if (drawerLead?.id === leadId) setDrawerLead(null);
      toast.success("Lead deleted");
    } else {
      toast.error("Failed to delete lead");
    }
  };

  // Drag & Drop
  const handleDragStart = (e: React.DragEvent, leadId: string) => {
    e.dataTransfer.setData("leadId", leadId);
    setDraggingLead(leadId);
  };
  const handleDragEnd = () => { setDraggingLead(null); setDragOver(null); };
  const handleDrop = async (e: React.DragEvent, status: LeadStatus) => {
    e.preventDefault();
    const leadId = e.dataTransfer.getData("leadId");
    const lead = leads.find((l) => l.id === leadId);
    if (lead && lead.status !== status) {
      await updateLeadStatus(leadId, status, lead.status);
      toast.success(`Moved to ${status}`);
    }
    setDragOver(null);
    setDraggingLead(null);
  };
  const handleDragOver = (e: React.DragEvent, status: LeadStatus) => { e.preventDefault(); setDragOver(status); };

  // Normalize legacy statuses for column matching
  const normalizeStatus = (status: LeadStatus): LeadStatus => {
    if (status === "Email Sent") return "contacted";
    if (status === "Replied") return "replied";
    if (status === "Interested") return "interested";
    if (status === "New") return "new";
    return status;
  };

  const filteredLeads = leads.filter((l) => {
    const statusMatch = filterStatus === "all" || normalizeStatus(l.status) === filterStatus;
    const categoryMatch = filterCategory === "all" || (l as any).niche === filterCategory;
    return statusMatch && categoryMatch;
  });

  const stats = {
    total: leads.length,
    contacted: leads.filter((l) => normalizeStatus(l.status) === "contacted").length,
    replied: leads.filter((l) => normalizeStatus(l.status) === "replied").length,
    interested: leads.filter((l) => normalizeStatus(l.status) === "interested").length,
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

      {/* ── Top bar: stats + actions ─────────────────────────────────── */}
      <div className="flex items-center gap-4 px-5 py-3 border-b border-gray-200 flex-wrap">
        {/* Stats — same layout as Pipeline */}
        <div className="flex items-center gap-4 flex-1 min-w-0 flex-wrap">
          {[
            { label: "Total", value: stats.total },
            { label: "Contacted", value: stats.contacted },
            { label: "Replied", value: stats.replied },
            { label: "Interested", value: stats.interested },
          ].map(({ label, value }) => (
            <div key={label}>
              <p className="text-[10px] text-gray-400 leading-none">{label}</p>
              <p className="text-sm font-bold text-gray-900">{value}</p>
            </div>
          ))}
        </div>

        {/* Import CSV */}
        <button
          onClick={() => setShowCSVImport(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition-colors flex-shrink-0"
        >
          <Upload size={12} />
          Import CSV
        </button>
      </div>

      {/* ── Filter bar ───────────────────────────────────────────────── */}
      <div className="px-5 py-2.5 border-b border-gray-200 flex items-center gap-2 flex-wrap">
        <Filter size={12} className="text-gray-400 flex-shrink-0" />

        {/* Status pills */}
        <button
          onClick={() => setFilterStatus("all")}
          className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors border ${
            filterStatus === "all"
              ? "bg-blue-600 text-white border-blue-600"
              : "bg-white text-gray-600 border-gray-300 hover:border-gray-400"
          }`}
        >
          All ({leads.length})
        </button>
        {KANBAN_COLUMNS.map((col) => {
          const count = leads.filter((l) => normalizeStatus(l.status) === col.value).length;
          return (
            <button
              key={col.value}
              onClick={() => setFilterStatus(col.value)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors border ${
                filterStatus === col.value
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white text-gray-600 border-gray-300 hover:border-gray-400"
              }`}
            >
              {col.label} ({count})
            </button>
          );
        })}

        {/* Category filter — only show if there are categories */}
        {categories.length > 0 && (
          <>
            <span className="text-gray-300 mx-1">|</span>
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="px-2.5 py-1 rounded-md text-[11px] border border-gray-300 bg-white text-gray-700 outline-none focus:border-blue-500"
            >
              <option value="all">All categories</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </>
        )}
      </div>

      {/* ── Kanban board ─────────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden bg-gray-50">
        <style>{`
          .crm-scroll { overflow-x: auto; overflow-y: hidden; height: 100%; }
          .crm-scroll::-webkit-scrollbar { height: 6px; }
          .crm-scroll::-webkit-scrollbar-track { background: #f3f4f6; }
          .crm-scroll::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 3px; }
        `}</style>
        <div className="crm-scroll h-full p-4">
          {leads.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <Users size={28} className="mx-auto mb-3 text-gray-300" />
                <p className="text-sm font-medium text-gray-500">No leads yet</p>
                <p className="text-xs mt-1 text-gray-400">Add leads from the Scraper module</p>
              </div>
            </div>
          ) : filterStatus !== "all" ? (
            /* List view when a status is selected */
            <div className="flex flex-col gap-2 max-w-xl">
              {filteredLeads.map((lead) => (
                <LeadCard
                  key={lead.id}
                  lead={lead}
                  onOpen={openDrawer}
                  onWriteEmail={onWriteEmail}
                  onDelete={deleteLead}
                  isDragging={draggingLead === lead.id}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                />
              ))}
              {filteredLeads.length === 0 && (
                <p className="text-sm text-gray-400 py-8 text-center">No leads in this status</p>
              )}
            </div>
          ) : (
            /* Kanban view */
            <div className="flex gap-4 min-w-max h-full">
              {KANBAN_COLUMNS.map((col) => {
                const columnLeads = filteredLeads.filter((l) => normalizeStatus(l.status) === col.value);
                const isOver = dragOver === col.value;

                return (
                  <div
                    key={col.value}
                    className="flex flex-col w-56 flex-shrink-0"
                    onDrop={(e) => handleDrop(e, col.value)}
                    onDragOver={(e) => handleDragOver(e, col.value)}
                    onDragLeave={() => setDragOver(null)}
                  >
                    {/* Column header */}
                    <div className="flex items-center justify-between mb-2 px-1">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-700">
                        {col.label}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-200 text-gray-600 font-medium">
                        {columnLeads.length}
                      </span>
                    </div>

                    {/* Drop zone */}
                    <div
                      className={`flex flex-col gap-2 flex-1 rounded-lg p-2 transition-all overflow-y-auto ${
                        isOver ? "bg-blue-50 border-2 border-dashed border-blue-300" : "bg-gray-100 border-2 border-dashed border-transparent"
                      }`}
                      style={{ minHeight: "8rem", maxHeight: "calc(100vh - 260px)" }}
                    >
                      {columnLeads.map((lead) => (
                        <LeadCard
                          key={lead.id}
                          lead={lead}
                          onOpen={openDrawer}
                          onWriteEmail={onWriteEmail}
                          onDelete={deleteLead}
                          isDragging={draggingLead === lead.id}
                          onDragStart={handleDragStart}
                          onDragEnd={handleDragEnd}
                        />
                      ))}
                      {columnLeads.length === 0 && (
                        <div className="flex items-center justify-center h-20 rounded-md border border-dashed border-gray-300">
                          <p className="text-[10px] text-gray-400">Drop here</p>
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

      {/* ── Lead detail drawer ───────────────────────────────────────── */}
      {drawerLead && (
        <div className="fixed inset-0 z-50" onClick={() => setDrawerLead(null)}>
          <div className="absolute inset-0 bg-black/30" />
          <div
            className="absolute right-0 top-0 bottom-0 w-full sm:max-w-md flex flex-col overflow-hidden bg-white border-l border-gray-200 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <div className="min-w-0 flex-1 pr-4">
                <h2 className="text-sm font-bold text-gray-900 truncate">{drawerLead.company_name}</h2>
                <p className="text-xs mt-0.5 text-gray-500 truncate">{drawerLead.email}</p>
              </div>
              <button onClick={() => setDrawerLead(null)} className="p-1.5 rounded-lg hover:bg-gray-100 flex-shrink-0">
                <X size={16} className="text-gray-500" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">

              {/* Meta */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] px-2 py-0.5 rounded border border-gray-300 text-gray-700 font-medium">
                  {drawerLead.status}
                </span>
                {drawerLead.niche && (
                  <span className="text-[10px] px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                    {drawerLead.niche}
                  </span>
                )}
                {drawerLead.location && (
                  <span className="text-[10px] text-gray-500">📍 {drawerLead.location}</span>
                )}
                <span className="text-[10px] text-gray-400 flex items-center gap-1 ml-auto">
                  <Clock size={9} />
                  {new Date(drawerLead.created_at).toLocaleDateString()}
                </span>
              </div>

              {/* Status update */}
              <div>
                <p className="text-[10px] uppercase tracking-widest mb-2 text-gray-400 font-semibold">Update Status</p>
                <div className="flex flex-wrap gap-1.5">
                  {KANBAN_COLUMNS.map((col) => (
                    <button
                      key={col.value}
                      onClick={() => {
                        updateLeadStatus(drawerLead.id, col.value, drawerLead.status);
                        setDrawerLead({ ...drawerLead, status: col.value });
                      }}
                      className={`text-[10px] px-2.5 py-1 rounded border transition-all font-medium ${
                        normalizeStatus(drawerLead.status) === col.value
                          ? "bg-blue-600 text-white border-blue-600"
                          : "bg-white text-gray-600 border-gray-300 hover:border-blue-400"
                      }`}
                    >
                      {col.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Company context */}
              {drawerLead.company_context && (
                <div>
                  <p className="text-[10px] uppercase tracking-widest mb-1.5 text-gray-400 font-semibold">About</p>
                  <p className="text-xs leading-relaxed p-3 rounded-lg text-gray-700 bg-gray-50 border border-gray-200">
                    {drawerLead.company_context}
                  </p>
                </div>
              )}

              {/* Email history */}
              {drawerSentEmails.length > 0 && (
                <div>
                  <p className="text-[10px] uppercase tracking-widest mb-1.5 text-gray-400 font-semibold">
                    Sent Emails ({drawerSentEmails.length})
                  </p>
                  <div className="flex flex-col gap-1.5">
                    {drawerSentEmails.map((se) => (
                      <div key={se.id} className="p-2.5 rounded-lg border border-gray-200 bg-white">
                        <div className="flex items-center justify-between gap-2 mb-0.5">
                          <p className="text-xs font-medium text-gray-900 truncate">{se.subject || "(no subject)"}</p>
                          <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold flex-shrink-0 ${
                            se.status === "sent" || se.status === "opened" || se.status === "replied"
                              ? "bg-blue-50 text-blue-700"
                              : "bg-red-50 text-red-600"
                          }`}>
                            {se.status.toUpperCase()}
                          </span>
                        </div>
                        <p className="text-[10px] text-gray-400">{new Date(se.sent_at).toLocaleString()}</p>
                        {se.bounce_reason && (
                          <p className="text-[10px] text-red-500 mt-0.5 truncate">⚠ {se.bounce_reason}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Notes */}
              <div>
                <p className="text-[10px] uppercase tracking-widest mb-1.5 text-gray-400 font-semibold">Notes</p>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={4}
                  placeholder="Add notes about this lead..."
                  className="w-full px-3 py-2 rounded-lg text-xs outline-none resize-none bg-white border border-gray-300 text-gray-700 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all"
                />
                <button
                  onClick={saveNotes}
                  disabled={savingNotes}
                  className="mt-1.5 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {savingNotes ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
                  Save Notes
                </button>
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-gray-200 flex gap-2">
              <button
                onClick={() => { onWriteEmail?.(drawerLead); setDrawerLead(null); }}
                className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 transition-colors"
              >
                <Mail size={14} />
                Write Email
              </button>
              <button
                onClick={() => {
                  if (confirm(`Delete "${drawerLead.company_name}"?`)) deleteLead(drawerLead.id);
                }}
                className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border border-gray-300 text-gray-600 hover:bg-gray-50 transition-colors"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CSV Import Modal */}
      {showCSVImport && (
        <CSVImportModal
          userId={userId}
          onClose={() => setShowCSVImport(false)}
          onImported={() => { setShowCSVImport(false); fetchLeads(); }}
        />
      )}
    </div>
  );
}

function LeadCard({
  lead,
  onOpen,
  onWriteEmail,
  onDelete,
  isDragging,
  onDragStart,
  onDragEnd,
}: {
  lead: Lead;
  onOpen: (lead: Lead) => void;
  onWriteEmail?: (lead: Lead) => void;
  onDelete: (leadId: string) => void;
  isDragging: boolean;
  onDragStart: (e: React.DragEvent, leadId: string) => void;
  onDragEnd: () => void;
}) {
  const isFailed = lead.status === "failed" || lead.status === "bounced";
  const isSent = lead.status === "contacted" || lead.status === "Email Sent";

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, lead.id)}
      onDragEnd={onDragEnd}
      onClick={() => onOpen(lead)}
      className="rounded-lg p-3 cursor-pointer border border-gray-200 bg-white hover:border-blue-400 hover:shadow-sm transition-all group"
      style={{ opacity: isDragging ? 0.4 : 1 }}
    >
      <div className="flex items-start justify-between gap-1 mb-1">
        <p className="text-xs font-semibold text-gray-900 truncate flex-1 leading-tight">
          {lead.company_name}
        </p>
        {isFailed && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-50 text-red-600 border border-red-200 font-semibold flex-shrink-0">FAIL</span>
        )}
        {isSent && !isFailed && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-200 font-semibold flex-shrink-0">SENT</span>
        )}
      </div>

      {lead.email && (
        <p className="text-[10px] text-gray-400 truncate mb-1.5">{lead.email}</p>
      )}

      <div className="flex items-center gap-1.5 flex-wrap">
        {lead.niche && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 border border-gray-200">
            {lead.niche}
          </span>
        )}
      </div>

      {/* Hover actions */}
      <div className="flex items-center gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={(e) => { e.stopPropagation(); onWriteEmail?.(lead); }}
          className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium bg-blue-600 text-white hover:bg-blue-700"
        >
          <Mail size={9} />Email
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); if (confirm(`Delete "${lead.company_name}"?`)) onDelete(lead.id); }}
          className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50"
        >
          <Trash2 size={11} />
        </button>
      </div>
    </div>
  );
}
