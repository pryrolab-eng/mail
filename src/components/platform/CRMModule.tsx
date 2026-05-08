"use client";

import { useState, useEffect, useCallback } from "react";
import { Lead, LeadStatus } from "@/types/platform";
import {
  Filter,
  Mail,
  X,
  ChevronRight,
  Loader2,
  Users,
  Send,
  MessageSquare,
  TrendingUp,
  Save,
  Clock,
  Upload,
  Trash2,
} from "lucide-react";
import { createClient } from "../../../supabase/client";
import { toast } from "sonner";
import CSVImportModal from "./CSVImportModal";

interface CRMModuleProps {
  userId: string;
  onWriteEmail?: (lead: Lead) => void;
}

const STATUSES: { value: LeadStatus; color: string; dot: string }[] = [
  { value: "New", color: "#2563EB", dot: "status-dot-blue" },
  { value: "Email Sent", color: "#F59E0B", dot: "status-dot-amber" },
  { value: "Replied", color: "#8B5CF6", dot: "status-dot-purple" },
  { value: "Interested", color: "#10B981", dot: "status-dot-green" },
  { value: "Closed", color: "#059669", dot: "status-dot-emerald" },
  { value: "Dead", color: "#EF4444", dot: "status-dot-red" },
];

const STATUS_COLORS: Record<LeadStatus, string> = {
  New: "#2563EB",
  "Email Sent": "#F59E0B",
  Replied: "#8B5CF6",
  Interested: "#10B981",
  Closed: "#059669",
  Dead: "#EF4444",
};

const STATUS_BG: Record<LeadStatus, string> = {
  New: "#EFF6FF",
  "Email Sent": "#FEF3C7",
  Replied: "#F3E8FF",
  Interested: "#D1FAE5",
  Closed: "#D1FAE5",
  Dead: "#FEE2E2",
};

interface LeadWithEmails extends Lead {
  generated_emails?: Array<{ id: string; subject: string; body: string; model_used: string; created_at: string; tone: string }>;
}

export default function CRMModule({ userId, onWriteEmail }: CRMModuleProps) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerLead, setDrawerLead] = useState<LeadWithEmails | null>(null);
  const [drawerEmails, setDrawerEmails] = useState<LeadWithEmails["generated_emails"]>([]);
  const [notes, setNotes] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);
  const [filterStatus, setFilterStatus] = useState<LeadStatus | "all">("all");
  const [filterCategory, setFilterCategory] = useState<string | "all">("all");
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
    
    if (error) {
      console.error('Error fetching leads:', error);
    }
    
    if (data) {
      setLeads(data as Lead[]);
      
      // Extract unique categories from niche field (fallback since category column has schema issues)
      const uniqueCategories = Array.from(new Set(
        data
          .map((l: any) => l.niche)
          .filter(Boolean)
      )) as string[];
      
      console.log('📊 Categories found (from niche):', uniqueCategories);
      console.log('📊 Total leads:', data.length);
      console.log('📊 Sample lead:', data[0]);
      
      setCategories(uniqueCategories);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    fetchLeads();

    // Real-time subscription
    const channel = supabase
      .channel("leads_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "leads", filter: `user_id=eq.${userId}` }, () => {
        fetchLeads();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [fetchLeads]);

  const updateLeadStatus = async (leadId: string, newStatus: LeadStatus, oldStatus: LeadStatus) => {
    const { error } = await supabase
      .from("leads")
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq("id", leadId);
    if (!error) {
      // Log status history
      await supabase.from("lead_status_history").insert({
        lead_id: leadId,
        old_status: oldStatus,
        new_status: newStatus,
      });
      setLeads((prev) => prev.map((l) => l.id === leadId ? { ...l, status: newStatus } : l));
    }
  };

  const openDrawer = async (lead: Lead) => {
    setDrawerLead(lead as LeadWithEmails);
    setNotes(lead.notes || "");
    // Fetch generated emails for this lead
    const { data } = await supabase
      .from("generated_emails")
      .select("*")
      .eq("lead_id", lead.id)
      .order("created_at", { ascending: false });
    setDrawerEmails(data || []);
  };

  const saveNotes = async () => {
    if (!drawerLead) return;
    setSavingNotes(true);
    await supabase
      .from("leads")
      .update({ notes, updated_at: new Date().toISOString() })
      .eq("id", drawerLead.id);
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

  const deleteSelected = async () => {
    // Used for bulk delete — not wired to UI yet but available
  };

  // Drag & Drop
  const handleDragStart = (e: React.DragEvent, leadId: string) => {
    e.dataTransfer.setData("leadId", leadId);
    setDraggingLead(leadId);
  };

  const handleDragEnd = () => {
    setDraggingLead(null);
    setDragOver(null);
  };

  const handleDrop = async (e: React.DragEvent, status: LeadStatus) => {
    e.preventDefault();
    const leadId = e.dataTransfer.getData("leadId");
    const lead = leads.find((l) => l.id === leadId);
    if (lead && lead.status !== status) {
      await updateLeadStatus(leadId, status, lead.status);
      toast.success(`Lead moved to ${status}`);
    }
    setDragOver(null);
    setDraggingLead(null);
  };

  const handleDragOver = (e: React.DragEvent, status: LeadStatus) => {
    e.preventDefault();
    setDragOver(status);
  };

  const filteredLeads = leads.filter((l) => {
    const statusMatch = filterStatus === "all" || l.status === filterStatus;
    const categoryMatch = filterCategory === "all" || (l as any).niche === filterCategory;
    return statusMatch && categoryMatch;
  });

  const stats = {
    total: leads.length,
    emailSent: leads.filter((l) => l.status === "Email Sent").length,
    interested: leads.filter((l) => l.status === "Interested").length,
    closed: leads.filter((l) => l.status === "Closed").length,
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 size={24} className="animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Stats Strip */}
      <div className="px-4 sm:px-6 pt-4 sm:pt-5 pb-3 sm:pb-4 bg-gray-50 border-b border-gray-200">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
          {[
            { label: "Total Leads", value: stats.total, icon: Users, color: "#2563EB" },
            { label: "Emails Sent", value: stats.emailSent, icon: Send, color: "#F59E0B" },
            { label: "Interested", value: stats.interested, icon: TrendingUp, color: "#10B981" },
            { label: "Closed", value: stats.closed, icon: MessageSquare, color: "#8B5CF6" },
          ].map((stat) => {
            const Icon = stat.icon;
            return (
              <div
                key={stat.label}
                className="rounded-xl p-3 flex items-center justify-between bg-white border border-gray-200"
              >
                <div>
                  <p className="text-[10px] mb-1 text-gray-500 uppercase tracking-wide font-medium">
                    {stat.label}
                  </p>
                  <p className="text-xl sm:text-2xl font-bold" style={{ color: stat.color }}>
                    {stat.value}
                  </p>
                </div>
                <Icon size={18} style={{ color: stat.color, opacity: 0.35 }} />
              </div>
            );
          })}
        </div>
      </div>

      {/* Filter Bar */}
      <div className="px-4 sm:px-6 py-3 space-y-2 bg-gray-50 border-b border-gray-200">
        {/* Status Filter + Import button */}
        <div className="flex items-center gap-2 flex-wrap">
          <Filter size={13} className="text-gray-500 flex-shrink-0" />
          <span className="text-xs text-gray-500 font-medium">Status:</span>
          <button
            onClick={() => setFilterStatus("all")}
            className="px-3 py-1 rounded-full text-[11px] font-medium transition-all border"
            style={{
              background: filterStatus === "all" ? "#EFF6FF" : "#fff",
              borderColor: filterStatus === "all" ? "#2563EB" : "#D1D5DB",
              color: filterStatus === "all" ? "#2563EB" : "#6B7280",
            }}
          >
            All ({leads.length})
          </button>
          {STATUSES.map((s) => {
            const count = leads.filter((l) => l.status === s.value).length;
            return (
              <button
                key={s.value}
                onClick={() => setFilterStatus(s.value)}
                className="px-3 py-1 rounded-full text-[11px] font-medium transition-all border"
                style={{
                  background: filterStatus === s.value ? `${s.color}15` : "#fff",
                  borderColor: filterStatus === s.value ? s.color : "#D1D5DB",
                  color: filterStatus === s.value ? s.color : "#6B7280",
                }}
              >
                {s.value} ({count})
              </button>
            );
          })}

          {/* Import CSV button */}
          <button
            onClick={() => setShowCSVImport(true)}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold border border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors flex-shrink-0"
          >
            <Upload size={12} />
            Import CSV
          </button>
        </div>

        {/* Category Filter */}
        {categories.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-gray-600 ml-5">📁 Category:</span>
            <button
              onClick={() => setFilterCategory("all")}
              className="px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all border-2"
              style={{
                background: filterCategory === "all" ? "#2563EB" : "#fff",
                borderColor: filterCategory === "all" ? "#2563EB" : "#E5E7EB",
                color: filterCategory === "all" ? "#fff" : "#6B7280",
              }}
            >
              All Categories
            </button>
            {categories.map((cat) => {
              const count = leads.filter((l: any) => l.niche === cat).length;
              return (
                <button
                  key={cat}
                  onClick={() => setFilterCategory(cat)}
                  className="px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all border-2"
                  style={{
                    background: filterCategory === cat ? "#2563EB" : "#fff",
                    borderColor: filterCategory === cat ? "#2563EB" : "#E5E7EB",
                    color: filterCategory === cat ? "#fff" : "#6B7280",
                  }}
                >
                  {cat} ({count})
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Kanban Board */}
      <div className="flex-1 px-4 sm:px-6 py-4 sm:py-6 overflow-hidden bg-gray-50">
        <style>{`
          .kanban-scroll { overflow-x: auto; overflow-y: hidden; height: 100%; padding-bottom: 8px; }
          .kanban-scroll::-webkit-scrollbar { height: 8px; }
          .kanban-scroll::-webkit-scrollbar-track { background: #E5E7EB; border-radius: 8px; }
          .kanban-scroll::-webkit-scrollbar-thumb { background: #9CA3AF; border-radius: 8px; border: 2px solid #E5E7EB; }
          .kanban-scroll::-webkit-scrollbar-thumb:hover { background: #6B7280; }
        `}</style>
        <div className="kanban-scroll h-full">
          {leads.length === 0 ? (
            <div className="flex items-center justify-center h-full min-h-[200px]">
              <div className="text-center">
                <Users size={32} className="mx-auto mb-3 text-gray-300" />
                <p className="text-sm font-medium text-gray-500">No leads in CRM yet</p>
                <p className="text-xs mt-1 text-gray-400">Add leads from the Scraper module to get started</p>
              </div>
            </div>
          ) : filterStatus !== "all" ? (
            <div className="flex flex-col gap-2 max-w-2xl">
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
            </div>
          ) : (
            <div className="flex gap-3 sm:gap-4 min-w-max h-full pb-2">
              {STATUSES.map((status, index) => {
                const columnLeads = filteredLeads.filter((l) => l.status === status.value);
                const isOver = dragOver === status.value;
                const isLastColumn = index === STATUSES.length - 1;

                return (
                  <div
                    key={status.value}
                    className="flex flex-col gap-3 flex-shrink-0"
                    style={{
                      width: "clamp(200px, 240px, 260px)",
                      borderRight: isLastColumn ? "none" : "2px dashed #D1D5DB",
                      paddingRight: isLastColumn ? "0" : "16px",
                      marginRight: isLastColumn ? "0" : "8px",
                    }}
                    onDrop={(e) => handleDrop(e, status.value)}
                    onDragOver={(e) => handleDragOver(e, status.value)}
                    onDragLeave={() => setDragOver(null)}
                  >
                    {/* Column header */}
                    <div
                      className="flex items-center gap-2 pb-2"
                      style={{ borderBottom: `2px solid ${status.color}` }}
                    >
                      <div
                        style={{
                          background: status.color,
                          borderRadius: "50%",
                          width: 6,
                          height: 6,
                          boxShadow: `0 0 6px ${status.color}`,
                          flexShrink: 0,
                        }}
                      />
                      <span
                        className="text-[11px] font-semibold uppercase tracking-wider truncate"
                        style={{ color: status.color }}
                      >
                        {status.value}
                      </span>
                      <span
                        className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0"
                        style={{ background: `${status.color}15`, color: status.color }}
                      >
                        {columnLeads.length}
                      </span>
                    </div>

                    {/* Drop zone */}
                    <div
                      className="flex flex-col gap-2 rounded-xl p-2 transition-all overflow-y-auto"
                      style={{
                        minHeight: "6rem",
                        maxHeight: "calc(100vh - 300px)",
                        background: isOver ? `${status.color}10` : "#F9FAFB",
                        border: isOver ? `2px dashed ${status.color}` : "2px dashed transparent",
                      }}
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
                        <div
                          className="flex flex-col items-center justify-center h-32 rounded-lg"
                          style={{ border: "2px dashed #D1D5DB", background: "#F9FAFB" }}
                        >
                          <svg width="32" height="32" viewBox="0 0 40 40" fill="none" className="mb-2 opacity-40">
                            <circle cx="20" cy="20" r="3" fill="#9CA3AF" />
                            <circle cx="20" cy="10" r="2" fill="#D1D5DB" />
                            <circle cx="20" cy="30" r="2" fill="#D1D5DB" />
                            <circle cx="10" cy="20" r="2" fill="#D1D5DB" />
                            <circle cx="30" cy="20" r="2" fill="#D1D5DB" />
                          </svg>
                          <p className="text-[10px] text-gray-400">Drop cards here</p>
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

      {/* Lead Detail Drawer */}
      {drawerLead && (
        <div className="fixed inset-0 z-50" onClick={() => setDrawerLead(null)}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <div
            className="absolute right-0 top-0 bottom-0 w-full sm:max-w-lg flex flex-col overflow-hidden bg-white border-l border-gray-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drawer header */}
            <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-gray-200">
              <div className="min-w-0 flex-1 pr-4">
                <h2 className="text-base font-bold text-gray-900 truncate">{drawerLead.company_name}</h2>
                <p className="text-xs mt-0.5 text-gray-500 truncate">{drawerLead.email}</p>
              </div>
              <button
                onClick={() => setDrawerLead(null)}
                className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors flex-shrink-0"
              >
                <X size={18} className="text-gray-500" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 sm:p-6 flex flex-col gap-5">
              {/* Status + meta */}
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className="text-[10px] px-2.5 py-1 rounded-full font-medium border"
                  style={{
                    background: STATUS_BG[drawerLead.status],
                    color: STATUS_COLORS[drawerLead.status],
                    borderColor: `${STATUS_COLORS[drawerLead.status]}33`,
                  }}
                >
                  {drawerLead.status}
                </span>
                {drawerLead.niche && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-100">
                    {drawerLead.niche}
                  </span>
                )}
                {drawerLead.location && (
                  <span className="text-xs text-gray-500">📍 {drawerLead.location}</span>
                )}
                <span className="text-xs flex items-center gap-1 text-gray-500">
                  <Clock size={10} />
                  {new Date(drawerLead.created_at).toLocaleDateString()}
                </span>
              </div>

              {/* Quick status change */}
              <div>
                <p className="text-[10px] uppercase tracking-widest mb-2 text-gray-500 font-semibold">
                  Update Status
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {STATUSES.map((s) => (
                    <button
                      key={s.value}
                      onClick={() => {
                        updateLeadStatus(drawerLead.id, s.value, drawerLead.status);
                        setDrawerLead({ ...drawerLead, status: s.value });
                      }}
                      className="text-[10px] px-2.5 py-1 rounded-full transition-all border"
                      style={{
                        background: drawerLead.status === s.value ? STATUS_BG[s.value] : "#F9FAFB",
                        borderColor: drawerLead.status === s.value ? s.color : "#E5E7EB",
                        color: drawerLead.status === s.value ? s.color : "#6B7280",
                      }}
                    >
                      {s.value}
                    </button>
                  ))}
                </div>
              </div>

              {/* Company context */}
              {drawerLead.company_context && (
                <div>
                  <p className="text-[10px] uppercase tracking-widest mb-2 text-gray-500 font-semibold">
                    Company Context
                  </p>
                  <p className="text-xs leading-relaxed p-3 rounded-lg text-gray-700 bg-gray-50 border border-gray-200">
                    {drawerLead.company_context}
                  </p>
                </div>
              )}

              {/* Generated emails */}
              {drawerEmails && drawerEmails.length > 0 && (
                <div>
                  <p className="text-[10px] uppercase tracking-widest mb-2 text-gray-500 font-semibold">
                    Generated Emails ({drawerEmails.length})
                  </p>
                  <div className="flex flex-col gap-2">
                    {drawerEmails.map((em) => (
                      <div key={em.id} className="p-3 rounded-lg bg-gray-50 border border-gray-200">
                        <div className="flex items-center justify-between mb-1 gap-2">
                          <p className="text-xs font-medium text-gray-900 truncate">{em.subject}</p>
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 flex-shrink-0">
                            {em.tone}
                          </span>
                        </div>
                        <p className="text-[10px] truncate text-gray-500">{em.model_used}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Notes */}
              <div>
                <p className="text-[10px] uppercase tracking-widest mb-2 text-gray-500 font-semibold">
                  Notes
                </p>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={4}
                  placeholder="Add notes about this lead..."
                  className="w-full px-3 py-2.5 rounded-lg text-xs outline-none resize-none bg-gray-50 border border-gray-200 text-gray-700 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all"
                  style={{ lineHeight: "1.6" }}
                />
                <button
                  onClick={saveNotes}
                  disabled={savingNotes}
                  className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all bg-green-50 border border-green-300 text-green-700 hover:bg-green-100 disabled:opacity-50"
                >
                  {savingNotes ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
                  Save Notes
                </button>
              </div>
            </div>

            {/* Drawer footer */}
            <div className="px-5 sm:px-6 py-4 border-t border-gray-200 flex gap-2">
              <button
                onClick={() => { onWriteEmail?.(drawerLead); setDrawerLead(null); }}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold bg-blue-50 border border-blue-300 text-blue-700 hover:bg-blue-100 transition-colors"
              >
                <Mail size={14} />
                Generate Email
              </button>
              <button
                onClick={() => {
                  if (confirm(`Delete "${drawerLead.company_name}"? This cannot be undone.`)) {
                    deleteLead(drawerLead.id);
                  }
                }}
                className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold bg-red-50 border border-red-200 text-red-600 hover:bg-red-100 transition-colors"
              >
                <Trash2 size={14} />
                Delete
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
          onImported={(count) => {
            setShowCSVImport(false);
            fetchLeads();
          }}
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
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, lead.id)}
      onDragEnd={onDragEnd}
      className="rounded-xl p-3 cursor-grab active:cursor-grabbing transition-all group bg-white border border-gray-200 hover:border-blue-400 hover:-translate-y-px"
      style={{
        opacity: isDragging ? 0.5 : 1,
        transform: isDragging ? "rotate(1deg)" : undefined,
      }}
    >
      <p className="text-xs font-semibold leading-tight text-gray-900 truncate">
        {lead.company_name}
      </p>
      {lead.email && (
        <p className="text-[10px] mt-1 truncate text-blue-600">{lead.email}</p>
      )}
      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        <span
          className="text-[9px] px-2 py-0.5 rounded-full font-medium border"
          style={{
            background: STATUS_BG[lead.status],
            color: STATUS_COLORS[lead.status],
            borderColor: `${STATUS_COLORS[lead.status]}33`,
          }}
        >
          {lead.status}
        </span>
        {lead.niche && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">
            {lead.niche}
          </span>
        )}
      </div>

      {/* Action buttons — visible on hover */}
      <div className="flex items-center gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={(e) => { e.stopPropagation(); onOpen(lead); }}
          className="text-[9px] px-1.5 py-0.5 rounded flex items-center gap-0.5 bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
        >
          <ChevronRight size={9} />
          View
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onWriteEmail?.(lead); }}
          className="text-[9px] px-1.5 py-0.5 rounded flex items-center gap-0.5 bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
        >
          <Mail size={9} />
          Email
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (confirm(`Delete "${lead.company_name}"?`)) onDelete(lead.id);
          }}
          className="text-[9px] px-1.5 py-0.5 rounded flex items-center gap-0.5 bg-red-50 text-red-500 hover:bg-red-100 transition-colors ml-auto"
        >
          <Trash2 size={9} />
        </button>
      </div>
    </div>
  );
}
