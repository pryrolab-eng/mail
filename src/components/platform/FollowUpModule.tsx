"use client";

import { useState, useEffect } from "react";
import { Lead, EmailReply, AIReply, SentEmail } from "@/types/platform";
import {
  Mail, Send, Clock, Loader2, CheckCircle, X,
  MessageSquare, Sparkles, RefreshCw, ThumbsUp, ThumbsDown,
  Inbox, TrendingUp, Bot, Settings2,
} from "lucide-react";
import { createClient } from "../../../supabase/client";
import { toast } from "sonner";
import InboxConfigPanel from "./InboxConfigPanel";

interface FollowUpModuleProps {
  userId: string;
}

export default function FollowUpModule({ userId }: FollowUpModuleProps) {
  const [activeTab, setActiveTab] = useState("sent");
  const [sentEmails, setSentEmails] = useState([]);
  const [emailReplies, setEmailReplies] = useState([]);
  const [aiReplies, setAIReplies] = useState([]);
  const [leads, setLeads] = useState(new Map());
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(null);
  const [selectedReply, setSelectedReply] = useState(null);
  const [showAIModal, setShowAIModal] = useState(false);
  const [aiDraft, setAIDraft] = useState(null);
  const [checkingReplies, setCheckingReplies] = useState(false);

  const supabase = createClient();

  useEffect(() => {
    fetchData();
    const repliesChannel = supabase
      .channel("email_replies_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "email_replies" }, () => fetchData())
      .subscribe();
    return () => { repliesChannel.unsubscribe(); };
  }, []);

  const fetchData = async () => {
    setLoading(true);
    const [sentRes, repliesRes, aiRes] = await Promise.all([
      supabase.from("sent_emails").select("*").eq("user_id", userId).order("sent_at", { ascending: false }).limit(100),
      supabase.from("email_replies").select("*").eq("user_id", userId).order("received_at", { ascending: false }),
      supabase.from("ai_replies").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
    ]);
    if (sentRes.data) setSentEmails(sentRes.data);
    if (repliesRes.data) setEmailReplies(repliesRes.data);
    if (aiRes.data) setAIReplies(aiRes.data);
    const leadIds = new Set([
      ...(sentRes.data?.map((e) => e.lead_id) || []),
      ...(repliesRes.data?.map((r) => r.lead_id) || []),
    ]);
    if (leadIds.size > 0) {
      const { data: leadsData } = await supabase.from("leads").select("*").in("id", Array.from(leadIds));
      if (leadsData) {
        const map = new Map();
        leadsData.forEach((l) => map.set(l.id, l));
        setLeads(map);
      }
    }
    setLoading(false);
  };

  const checkReplies = async () => {
    setCheckingReplies(true);
    try {
      const res = await fetch("/api/inbox/check", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        if (data.totalNewReplies > 0) {
          toast.success(`Found ${data.totalNewReplies} new reply${data.totalNewReplies > 1 ? "ies" : ""}!`);
          fetchData();
        } else {
          toast.info("No new replies found");
        }
      } else {
        toast.error(data.error || "Check failed");
      }
    } catch {
      toast.error("Could not reach inbox check endpoint");
    } finally {
      setCheckingReplies(false);
    }
  };

  const generateAIResponse = async (reply) => {
    setGenerating(reply.id);
    setSelectedReply(reply);
    try {
      const lead = leads.get(reply.lead_id);
      if (!lead) throw new Error("Lead not found");
      await new Promise((r) => setTimeout(r, 1500));
      const aiResponse = {
        subject: `Re: ${reply.subject}`,
        body: `Hi ${lead.company_name} team,\n\nThank you for your interest! I'd love to share more about how we can help.\n\nBased on your work in ${lead.niche || "your industry"}, I think there's a strong fit. Would you be available for a quick 15-minute call this week?\n\nLooking forward to connecting!\n\nBest regards`,
      };
      const { data, error } = await supabase.from("ai_replies").insert({
        user_id: userId, reply_id: reply.id, lead_id: reply.lead_id,
        subject: aiResponse.subject, body: aiResponse.body,
        tone: "professional", model_used: "template", status: "draft",
      }).select().single();
      if (error) throw error;
      await supabase.from("email_replies").update({ ai_response_generated: true }).eq("id", reply.id);
      setAIDraft(aiResponse);
      setShowAIModal(true);
      toast.success("AI response generated!");
      fetchData();
    } catch (err) {
      toast.error("Failed to generate AI response");
    } finally {
      setGenerating(null);
    }
  };

  const sendAIReply = async (aiReplyId) => {
    try {
      const aiReply = aiReplies.find((r) => r.id === aiReplyId);
      if (!aiReply) return;
      const lead = leads.get(aiReply.lead_id);
      if (!lead?.email) { toast.error("Lead has no email address"); return; }
      const res = await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: aiReply.lead_id, to: lead.email, subject: aiReply.subject, body: aiReply.body }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      await supabase.from("ai_replies").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", aiReplyId);
      await supabase.from("email_replies").update({ ai_response_sent: true }).eq("id", aiReply.reply_id);
      toast.success("Reply sent!");
      setShowAIModal(false);
      setAIDraft(null);
      fetchData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send reply");
    }
  };

  const stats = {
    totalSent: sentEmails.length,
    replied: emailReplies.length,
    positiveReplies: emailReplies.filter((r) => r.is_positive).length,
    aiGenerated: aiReplies.length,
    aiSent: aiReplies.filter((r) => r.status === "sent").length,
  };

  const tabs = [
    { id: "sent", label: "Sent Emails", count: stats.totalSent },
    { id: "replies", label: "Replies", count: stats.replied },
    { id: "ai-responses", label: "AI Responses", count: stats.aiGenerated },
    { id: "inbox", label: "Inbox Setup", count: null },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={24} className="animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-gray-900">Follow-Up & Replies</h2>
          <button
            onClick={checkReplies}
            disabled={checkingReplies}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {checkingReplies ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            Check Replies
          </button>
        </div>
        <div className="grid grid-cols-5 gap-4">
          {[
            { label: "Emails Sent", value: stats.totalSent, icon: Send, color: "#2563EB" },
            { label: "Replies", value: stats.replied, icon: MessageSquare, color: "#10B981" },
            { label: "Positive", value: stats.positiveReplies, icon: ThumbsUp, color: "#F59E0B" },
            { label: "AI Responses", value: stats.aiGenerated, icon: Bot, color: "#8B5CF6" },
            { label: "AI Sent", value: stats.aiSent, icon: Sparkles, color: "#EC4899" },
          ].map((s) => {
            const Icon = s.icon;
            return (
              <div key={s.label} className="rounded-xl p-4 flex items-center justify-between bg-gray-50 border border-gray-200">
                <div>
                  <p className="text-xs text-gray-500 mb-1">{s.label.toUpperCase()}</p>
                  <p className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</p>
                </div>
                <Icon size={20} style={{ color: s.color, opacity: 0.4 }} />
              </div>
            );
          })}
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b border-gray-200 px-6">
        <div className="flex gap-6">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === tab.id ? "border-blue-600 text-blue-600" : "border-transparent text-gray-600 hover:text-gray-900"
              }`}
            >
              {tab.label}{tab.count !== null ? ` (${tab.count})` : ""}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">

        {/* Sent Emails */}
        {activeTab === "sent" && (
          <div className="space-y-3">
            {sentEmails.length === 0 ? (
              <div className="text-center py-12">
                <Mail size={48} className="text-gray-300 mx-auto mb-4" />
                <p className="text-gray-600 font-medium">No emails sent yet</p>
              </div>
            ) : sentEmails.map((email) => {
              const lead = leads.get(email.lead_id);
              const hasReply = emailReplies.some((r) => r.sent_email_id === email.id);
              return (
                <div key={email.id} className="bg-white rounded-xl p-5 border border-gray-200">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-base font-semibold text-gray-900">{lead?.company_name || "Unknown"}</h3>
                        {hasReply && <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-medium rounded-full">Replied</span>}
                        <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                          email.status === "replied" ? "bg-green-100 text-green-700" :
                          email.status === "opened" ? "bg-yellow-100 text-yellow-700" :
                          "bg-blue-100 text-blue-700"
                        }`}>{email.status?.toUpperCase()}</span>
                      </div>
                      <p className="text-sm text-gray-600 mb-1"><strong>Subject:</strong> {email.subject}</p>
                      <p className="text-xs text-gray-500">Sent {new Date(email.sent_at).toLocaleString()}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Replies */}
        {activeTab === "replies" && (
          <div className="space-y-3">
            {emailReplies.length === 0 ? (
              <div className="text-center py-12">
                <Inbox size={48} className="text-gray-300 mx-auto mb-4" />
                <p className="text-gray-600 font-medium">No replies yet</p>
                <p className="text-sm text-gray-500 mt-1">Click "Check Replies" to scan your inbox</p>
              </div>
            ) : emailReplies.map((reply) => {
              const lead = leads.get(reply.lead_id);
              const hasAI = aiReplies.some((a) => a.reply_id === reply.id);
              return (
                <div key={reply.id} className="bg-white rounded-xl p-5 border border-gray-200">
                  <div className="flex items-center gap-3 mb-3">
                    <h3 className="text-base font-semibold text-gray-900">{lead?.company_name || "Unknown"}</h3>
                    {reply.sentiment && (
                      <span className={`px-2 py-0.5 text-xs font-medium rounded-full flex items-center gap-1 ${
                        reply.is_positive ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                      }`}>
                        {reply.is_positive ? <ThumbsUp size={10} /> : <ThumbsDown size={10} />}
                        {reply.sentiment}
                      </span>
                    )}
                    {hasAI && <span className="px-2 py-0.5 bg-purple-100 text-purple-700 text-xs font-medium rounded-full flex items-center gap-1"><Bot size={10} />AI Ready</span>}
                  </div>
                  <p className="text-sm text-gray-600 mb-1"><strong>From:</strong> {reply.from_email}</p>
                  <p className="text-sm text-gray-600 mb-2"><strong>Subject:</strong> {reply.subject}</p>
                  <div className="bg-gray-50 rounded-lg p-3 mb-3">
                    <p className="text-sm text-gray-700 whitespace-pre-wrap">{reply.body}</p>
                  </div>
                  <p className="text-xs text-gray-500 mb-3">Received {new Date(reply.received_at).toLocaleString()}</p>
                  {!reply.ai_response_generated && (
                    <button
                      onClick={() => generateAIResponse(reply)}
                      disabled={generating === reply.id}
                      className="w-full py-2 bg-purple-600 text-white rounded-lg text-sm font-semibold hover:bg-purple-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {generating === reply.id ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                      {generating === reply.id ? "Generating..." : "Generate AI Response"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* AI Responses */}
        {activeTab === "ai-responses" && (
          <div className="space-y-3">
            {aiReplies.length === 0 ? (
              <div className="text-center py-12">
                <Bot size={48} className="text-gray-300 mx-auto mb-4" />
                <p className="text-gray-600 font-medium">No AI responses yet</p>
                <p className="text-sm text-gray-500 mt-1">Generate responses from the Replies tab</p>
              </div>
            ) : aiReplies.map((aiReply) => {
              const lead = leads.get(aiReply.lead_id);
              const original = emailReplies.find((r) => r.id === aiReply.reply_id);
              return (
                <div key={aiReply.id} className="bg-white rounded-xl p-5 border border-gray-200">
                  <div className="flex items-center gap-3 mb-3">
                    <h3 className="text-base font-semibold text-gray-900">{lead?.company_name || "Unknown"}</h3>
                    <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                      aiReply.status === "sent" ? "bg-green-100 text-green-700" :
                      aiReply.status === "rejected" ? "bg-red-100 text-red-700" :
                      "bg-gray-100 text-gray-700"
                    }`}>{aiReply.status?.toUpperCase()}</span>
                  </div>
                  {original && (
                    <div className="bg-gray-50 rounded-lg p-3 mb-3 border-l-4 border-gray-300">
                      <p className="text-xs text-gray-500 mb-1">Original reply:</p>
                      <p className="text-sm text-gray-700 line-clamp-2">{original.body}</p>
                    </div>
                  )}
                  <div className="bg-purple-50 rounded-lg p-3 mb-3 border-l-4 border-purple-500">
                    <p className="text-xs text-purple-600 mb-1 flex items-center gap-1"><Bot size={10} />AI Response:</p>
                    <p className="text-sm text-gray-700 whitespace-pre-wrap">{aiReply.body}</p>
                  </div>
                  <p className="text-xs text-gray-500 mb-3">Generated {new Date(aiReply.created_at).toLocaleString()}</p>
                  {aiReply.status === "draft" && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => sendAIReply(aiReply.id)}
                        className="flex-1 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-700 transition-colors flex items-center justify-center gap-2"
                      >
                        <Send size={14} />Send Reply
                      </button>
                      <button
                        onClick={() => supabase.from("ai_replies").update({ status: "rejected" }).eq("id", aiReply.id).then(() => { toast.success("Rejected"); fetchData(); })}
                        className="px-4 py-2 bg-red-100 text-red-700 rounded-lg text-sm font-semibold hover:bg-red-200 transition-colors"
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Inbox Setup */}
        {activeTab === "inbox" && (
          <div className="max-w-2xl">
            <InboxConfigPanel onRepliesFound={(count) => { fetchData(); }} />
          </div>
        )}
      </div>

      {/* AI Modal */}
      {showAIModal && aiDraft && selectedReply && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setShowAIModal(false)}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <div className="relative bg-white rounded-2xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2"><Sparkles className="text-purple-600" size={20} />AI Response</h2>
              <button onClick={() => setShowAIModal(false)}><X size={20} className="text-gray-500" /></button>
            </div>
            <div className="bg-gray-50 rounded-lg p-4 border-l-4 border-gray-300 mb-4">
              <p className="text-xs text-gray-500 mb-1">Original reply:</p>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{selectedReply.body}</p>
            </div>
            <div className="bg-purple-50 rounded-lg p-4 border-l-4 border-purple-500 mb-4">
              <p className="text-xs text-purple-600 mb-2">Subject: {aiDraft.subject}</p>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{aiDraft.body}</p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowAIModal(false)} className="flex-1 py-2.5 border border-gray-300 text-gray-700 rounded-xl font-medium hover:bg-gray-50">Close</button>
              <button
                onClick={() => {
                  const latest = aiReplies.find((r) => r.reply_id === selectedReply.id && r.status === "draft");
                  if (latest) sendAIReply(latest.id);
                }}
                className="flex-1 py-2.5 bg-green-600 text-white rounded-xl font-semibold hover:bg-green-700 flex items-center justify-center gap-2"
              >
                <Send size={16} />Send Reply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
