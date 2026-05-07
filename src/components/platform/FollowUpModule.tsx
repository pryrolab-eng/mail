"use client";

import { useState, useEffect, useCallback } from "react";
import { Lead, EmailReply, AIReply, SentEmail } from "@/types/platform";
import {
  Mail, Send, Loader2, X,
  MessageSquare, Sparkles, RefreshCw, ThumbsUp, ThumbsDown,
  Inbox, Bot,
} from "lucide-react";
import { createClient } from "../../../supabase/client";
import { toast } from "sonner";
import InboxConfigPanel from "./InboxConfigPanel";

interface FollowUpModuleProps {
  userId: string;
}

interface AIDraft {
  subject: string;
  body: string;
}

export default function FollowUpModule({ userId }: FollowUpModuleProps) {
  const [activeTab, setActiveTab] = useState<"sent" | "replies" | "ai-responses" | "inbox">("sent");
  const [sentEmails, setSentEmails] = useState<SentEmail[]>([]);
  const [emailReplies, setEmailReplies] = useState<EmailReply[]>([]);
  const [aiReplies, setAIReplies] = useState<AIReply[]>([]);
  const [leads, setLeads] = useState<Map<string, Lead>>(new Map());
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState<string | null>(null);
  const [selectedReply, setSelectedReply] = useState<EmailReply | null>(null);
  const [showAIModal, setShowAIModal] = useState(false);
  const [aiDraft, setAIDraft] = useState<AIDraft | null>(null);
  const [checkingReplies, setCheckingReplies] = useState(false);

  const supabase = createClient();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [sentRes, repliesRes, aiRes] = await Promise.all([
        supabase.from("sent_emails").select("*").eq("user_id", userId).order("sent_at", { ascending: false }).limit(100),
        supabase.from("email_replies").select("*").eq("user_id", userId).order("received_at", { ascending: false }),
        supabase.from("ai_replies").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
      ]);
      
      if (sentRes.data) setSentEmails(sentRes.data as SentEmail[]);
      if (repliesRes.data) setEmailReplies(repliesRes.data as EmailReply[]);
      if (aiRes.data) setAIReplies(aiRes.data as AIReply[]);
      
      const leadIds = new Set<string>([
        ...(sentRes.data?.map((e: any) => e.lead_id) || []),
        ...(repliesRes.data?.map((r: any) => r.lead_id) || []),
      ]);
      
      if (leadIds.size > 0) {
        const { data: leadsData } = await supabase.from("leads").select("*").in("id", Array.from(leadIds));
        if (leadsData) {
          const map = new Map<string, Lead>();
          leadsData.forEach((l: Lead) => map.set(l.id, l));
          setLeads(map);
        }
      }
    } catch (error) {
      console.error("Error fetching data:", error);
      toast.error("Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [userId, supabase]);

  useEffect(() => {
    fetchData();
    
    const repliesChannel = supabase
      .channel("email_replies_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "email_replies" }, () => fetchData())
      .subscribe();
    
    return () => { 
      repliesChannel.unsubscribe(); 
    };
  }, [fetchData, supabase]);

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
    } catch (error) {
      console.error("Error checking replies:", error);
      toast.error("Could not reach inbox check endpoint");
    } finally {
      setCheckingReplies(false);
    }
  };

  const generateAIResponse = async (reply: EmailReply) => {
    setGenerating(reply.id);
    setSelectedReply(reply);
    try {
      const lead = leads.get(reply.lead_id);
      if (!lead) throw new Error("Lead not found");
      
      // Call AI API to generate response
      const res = await fetch("/api/ai/generate-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          replyBody: reply.body,
          replySubject: reply.subject,
          leadName: lead.company_name,
          leadNiche: lead.niche,
          fromEmail: reply.from_email,
        }),
      });
      
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed to generate AI response");
      
      const aiResponse: AIDraft = {
        subject: data.subject || `Re: ${reply.subject}`,
        body: data.body,
      };
      
      const { error } = await supabase.from("ai_replies").insert({
        user_id: userId, 
        reply_id: reply.id, 
        lead_id: reply.lead_id,
        subject: aiResponse.subject, 
        body: aiResponse.body,
        tone: "professional", 
        model_used: data.model || "ai", 
        status: "draft",
      }).select().single();
      
      if (error) throw error;
      
      await supabase.from("email_replies").update({ ai_response_generated: true }).eq("id", reply.id);
      
      setAIDraft(aiResponse);
      setShowAIModal(true);
      toast.success("AI response generated!");
      fetchData();
    } catch (err) {
      console.error("Error generating AI response:", err);
      toast.error(err instanceof Error ? err.message : "Failed to generate AI response");
    } finally {
      setGenerating(null);
    }
  };

  const sendAIReply = async (aiReplyId: string) => {
    try {
      const aiReply = aiReplies.find((r) => r.id === aiReplyId);
      if (!aiReply) {
        toast.error("AI reply not found");
        return;
      }
      
      const lead = leads.get(aiReply.lead_id);
      if (!lead?.email) { 
        toast.error("Lead has no email address"); 
        return; 
      }
      
      const res = await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          leadId: aiReply.lead_id, 
          to: lead.email, 
          subject: aiReply.subject, 
          body: aiReply.body 
        }),
      });
      
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      
      await supabase.from("ai_replies").update({ 
        status: "sent", 
        sent_at: new Date().toISOString() 
      }).eq("id", aiReplyId);
      
      await supabase.from("email_replies").update({ 
        ai_response_sent: true 
      }).eq("id", aiReply.reply_id);
      
      toast.success("Reply sent!");
      setShowAIModal(false);
      setAIDraft(null);
      fetchData();
    } catch (err) {
      console.error("Error sending AI reply:", err);
      toast.error(err instanceof Error ? err.message : "Failed to send reply");
    }
  };

  const handleRejectAIReply = async (aiReplyId: string) => {
    try {
      await supabase.from("ai_replies").update({ status: "rejected" }).eq("id", aiReplyId);
      toast.success("Rejected");
      fetchData();
    } catch (error) {
      console.error("Error rejecting AI reply:", error);
      toast.error("Failed to reject reply");
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
    { id: "sent" as const, label: "Sent Emails", count: stats.totalSent },
    { id: "replies" as const, label: "Replies", count: stats.replied },
    { id: "ai-responses" as const, label: "AI Responses", count: stats.aiGenerated },
    { id: "inbox" as const, label: "Inbox Setup", count: null },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={24} className="animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="border-b border-gray-200 px-8 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Follow-Up Manager</h1>
            <p className="text-sm text-gray-500 mt-1">Track sent emails and manage replies</p>
          </div>
          <button
            onClick={checkReplies}
            disabled={checkingReplies}
            className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {checkingReplies ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            Check Inbox
          </button>
        </div>
        
        {/* Stats */}
        <div className="grid grid-cols-5 gap-3">
          {[
            { label: "Sent", value: stats.totalSent, icon: Send },
            { label: "Replies", value: stats.replied, icon: MessageSquare },
            { label: "Positive", value: stats.positiveReplies, icon: ThumbsUp },
            { label: "AI Generated", value: stats.aiGenerated, icon: Bot },
            { label: "AI Sent", value: stats.aiSent, icon: Sparkles },
          ].map((s) => {
            const Icon = s.icon;
            return (
              <div key={s.label} className="bg-gray-50 rounded-lg px-4 py-3 border border-gray-100">
                <div className="flex items-center gap-2 mb-1">
                  <Icon size={14} className="text-gray-400" />
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{s.label}</p>
                </div>
                <p className="text-2xl font-semibold text-gray-900">{s.value}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 px-8">
        <div className="flex gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-3 text-sm font-medium rounded-t-lg transition-colors ${
                activeTab === tab.id 
                  ? "bg-gray-100 text-gray-900" 
                  : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
              }`}
            >
              {tab.label}
              {tab.count !== null && <span className="ml-2 text-xs text-gray-500">({tab.count})</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-8 py-6">

        {/* Sent Emails */}
        {activeTab === "sent" && (
          <div className="space-y-2 max-w-5xl">
            {sentEmails.length === 0 ? (
              <div className="text-center py-16">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Mail size={28} className="text-gray-400" />
                </div>
                <p className="text-gray-900 font-medium text-base">No emails sent yet</p>
                <p className="text-gray-500 text-sm mt-1">Sent emails will appear here</p>
              </div>
            ) : sentEmails.map((email) => {
              const lead = leads.get(email.lead_id);
              const hasReply = emailReplies.some((r) => r.sent_email_id === email.id);
              return (
                <div key={email.id} className="bg-white rounded-lg p-4 border border-gray-200 hover:border-gray-300 transition-colors">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <h3 className="text-sm font-semibold text-gray-900">{lead?.company_name || "Unknown"}</h3>
                        {hasReply && (
                          <span className="px-2 py-0.5 bg-green-50 text-green-700 text-xs font-medium rounded">
                            Replied
                          </span>
                        )}
                        <span className={`px-2 py-0.5 text-xs font-medium rounded ${
                          email.status === "replied" ? "bg-green-50 text-green-700" :
                          email.status === "opened" ? "bg-yellow-50 text-yellow-700" :
                          "bg-blue-50 text-blue-700"
                        }`}>
                          {email.status?.toUpperCase()}
                        </span>
                      </div>
                      <p className="text-sm text-gray-700 mb-1">{email.subject}</p>
                      <p className="text-xs text-gray-500">
                        {lead?.email} • {new Date(email.sent_at).toLocaleDateString()} at {new Date(email.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Replies */}
        {activeTab === "replies" && (
          <div className="space-y-3 max-w-5xl">
            {emailReplies.length === 0 ? (
              <div className="text-center py-16">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Inbox size={28} className="text-gray-400" />
                </div>
                <p className="text-gray-900 font-medium text-base">No replies yet</p>
                <p className="text-gray-500 text-sm mt-1">Click "Check Inbox" to scan for new replies</p>
              </div>
            ) : emailReplies.map((reply) => {
              const lead = leads.get(reply.lead_id);
              const hasAI = aiReplies.some((a) => a.reply_id === reply.id);
              return (
                <div key={reply.id} className="bg-white rounded-lg p-5 border border-gray-200 hover:border-gray-300 transition-colors">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <h3 className="text-sm font-semibold text-gray-900">{lead?.company_name || "Unknown"}</h3>
                        {reply.sentiment && (
                          <span className={`px-2 py-0.5 text-xs font-medium rounded flex items-center gap-1 ${
                            reply.is_positive ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
                          }`}>
                            {reply.is_positive ? <ThumbsUp size={12} /> : <ThumbsDown size={12} />}
                            {reply.sentiment}
                          </span>
                        )}
                        {hasAI && (
                          <span className="px-2 py-0.5 bg-blue-50 text-blue-700 text-xs font-medium rounded flex items-center gap-1">
                            <Bot size={12} />AI Ready
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-700 font-medium mb-1">{reply.subject}</p>
                      <p className="text-xs text-gray-500 mb-3">
                        From {reply.from_email} • {new Date(reply.received_at).toLocaleDateString()} at {new Date(reply.received_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-4 mb-3 border border-gray-100">
                    <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{reply.body}</p>
                  </div>
                  {!reply.ai_response_generated && (
                    <button
                      onClick={() => generateAIResponse(reply)}
                      disabled={generating === reply.id}
                      className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      {generating === reply.id ? (
                        <>
                          <Loader2 size={16} className="animate-spin" />
                          Generating...
                        </>
                      ) : (
                        <>
                          <Sparkles size={16} />
                          Generate AI Response
                        </>
                      )}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* AI Responses */}
        {activeTab === "ai-responses" && (
          <div className="space-y-3 max-w-5xl">
            {aiReplies.length === 0 ? (
              <div className="text-center py-16">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Bot size={28} className="text-gray-400" />
                </div>
                <p className="text-gray-900 font-medium text-base">No AI responses yet</p>
                <p className="text-gray-500 text-sm mt-1">Generate responses from the Replies tab</p>
              </div>
            ) : aiReplies.map((aiReply) => {
              const lead = leads.get(aiReply.lead_id);
              const original = emailReplies.find((r) => r.id === aiReply.reply_id);
              return (
                <div key={aiReply.id} className="bg-white rounded-lg p-5 border border-gray-200 hover:border-gray-300 transition-colors">
                  <div className="flex items-center gap-2 mb-4">
                    <h3 className="text-sm font-semibold text-gray-900">{lead?.company_name || "Unknown"}</h3>
                    <span className={`px-2 py-0.5 text-xs font-medium rounded ${
                      aiReply.status === "sent" ? "bg-green-50 text-green-700" :
                      aiReply.status === "rejected" ? "bg-red-50 text-red-700" :
                      "bg-gray-100 text-gray-700"
                    }`}>
                      {aiReply.status?.toUpperCase()}
                    </span>
                  </div>
                  
                  {original && (
                    <div className="bg-gray-50 rounded-lg p-4 mb-3 border-l-2 border-gray-300">
                      <p className="text-xs font-medium text-gray-500 mb-2">ORIGINAL REPLY</p>
                      <p className="text-sm text-gray-700 line-clamp-3">{original.body}</p>
                    </div>
                  )}
                  
                  <div className="bg-blue-50 rounded-lg p-4 mb-3 border-l-2 border-blue-500">
                    <div className="flex items-center gap-1 mb-2">
                      <Bot size={14} className="text-blue-600" />
                      <p className="text-xs font-medium text-blue-600">AI GENERATED RESPONSE</p>
                    </div>
                    <p className="text-sm font-medium text-gray-900 mb-2">{aiReply.subject}</p>
                    <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{aiReply.body}</p>
                  </div>
                  
                  <p className="text-xs text-gray-500 mb-3">
                    Generated {new Date(aiReply.created_at).toLocaleDateString()} at {new Date(aiReply.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                  
                  {aiReply.status === "draft" && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => sendAIReply(aiReply.id)}
                        className="flex-1 py-2.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors flex items-center justify-center gap-2"
                      >
                        <Send size={16} />
                        Send Reply
                      </button>
                      <button
                        onClick={() => handleRejectAIReply(aiReply.id)}
                        className="px-5 py-2.5 bg-red-50 text-red-700 rounded-lg text-sm font-medium hover:bg-red-100 transition-colors"
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
          <div className="max-w-3xl">
            <InboxConfigPanel onRepliesFound={() => { fetchData(); }} />
          </div>
        )}
      </div>

      {/* AI Modal */}
      {showAIModal && aiDraft && selectedReply && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setShowAIModal(false)}>
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
          <div className="relative bg-white rounded-xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                  <Sparkles className="text-blue-600" size={16} />
                </div>
                <h2 className="text-lg font-semibold text-gray-900">AI Generated Response</h2>
              </div>
              <button 
                onClick={() => setShowAIModal(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            
            <div className="bg-gray-50 rounded-lg p-4 mb-4 border-l-2 border-gray-300">
              <p className="text-xs font-medium text-gray-500 mb-2">ORIGINAL REPLY</p>
              <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{selectedReply.body}</p>
            </div>
            
            <div className="bg-blue-50 rounded-lg p-4 mb-5 border-l-2 border-blue-500">
              <div className="flex items-center gap-1 mb-3">
                <Bot size={14} className="text-blue-600" />
                <p className="text-xs font-medium text-blue-600">AI RESPONSE</p>
              </div>
              <p className="text-sm font-medium text-gray-900 mb-3">{aiDraft.subject}</p>
              <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{aiDraft.body}</p>
            </div>
            
            <div className="flex gap-3">
              <button 
                onClick={() => setShowAIModal(false)} 
                className="flex-1 py-2.5 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50 transition-colors"
              >
                Close
              </button>
              <button
                onClick={() => {
                  const latest = aiReplies.find((r) => r.reply_id === selectedReply.id && r.status === "draft");
                  if (latest) sendAIReply(latest.id);
                }}
                className="flex-1 py-2.5 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition-colors flex items-center justify-center gap-2"
              >
                <Send size={16} />
                Send Reply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}