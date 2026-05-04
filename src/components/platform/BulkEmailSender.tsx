"use client";

import { useState } from "react";
import { Mail, Send, Loader2, CheckCircle, XCircle, Clock, Zap } from "lucide-react";
import { generateBulkEmailsAction } from "@/app/actions";
import { toast } from "sonner";
import type { SendBulkResponse } from "@/app/api/send-bulk/route";

interface BulkEmailSenderProps {
  userId: string;
  selectedLeads: Array<{
    id: string;
    company_name: string;
    email: string;
    niche: string;
    location: string;
    company_context: string;
  }>;
  onComplete?: () => void;
}

export default function BulkEmailSender({ userId, selectedLeads, onComplete }: BulkEmailSenderProps) {
  const [step, setStep] = useState<'config' | 'generating' | 'preview' | 'sending' | 'complete'>('config');
  const [tone, setTone] = useState<'professional' | 'casual' | 'friendly'>('professional');
  const [purpose, setPurpose] = useState<'introduction' | 'partnership' | 'sales' | 'networking'>('introduction');
  const [yourCompany, setYourCompany] = useState('');
  const [yourService, setYourService] = useState('');
  const [generatedEmails, setGeneratedEmails] = useState<any[]>([]);
  const [sendingProgress, setSendingProgress] = useState({ sent: 0, total: 0, chunk: 0 });
  const [results, setResults] = useState<any>(null);

  const handleGenerateEmails = async () => {
    if (!yourCompany || !yourService) {
      toast.error('Please fill in your company name and service');
      return;
    }

    setStep('generating');

    try {
      const result = await generateBulkEmailsAction(
        userId,
        selectedLeads.map(l => l.id),
        { tone, purpose, yourCompany, yourService }
      );

      if (result.success) {
        setGeneratedEmails(result.emails);
        setStep('preview');
        toast.success(`Generated ${result.count} personalized emails!`);
      } else {
        toast.error(result.error || 'Failed to generate emails');
        setStep('config');
      }
    } catch (error) {
      toast.error('An error occurred');
      setStep('config');
    }
  };

  const handleSendEmails = async () => {
    setStep('sending');
    setSendingProgress({ sent: 0, total: generatedEmails.length, chunk: 0 });

    try {
      const res = await fetch("/api/send-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emails: generatedEmails.map((e) => ({
            leadId: e.lead_id,
            to: e.lead_email,
            companyName: e.company_name,
            subject: e.subject,
            body: e.body,
          })),
          delayMs: 1500,
          verifyEmails: true,
        }),
      });

      const data: SendBulkResponse = await res.json();

      if (data.success && data.results) {
        setResults(data.results);
        setStep('complete');
        toast.success(
          `Sent ${data.results.sent}/${data.results.total} emails. ${data.results.queued} queued. ${data.results.failed} failed.`
        );
        onComplete?.();
      } else {
        if (res.status === 429) {
          toast.error("Daily SMTP limit reached. Add more accounts or try tomorrow.");
        } else {
          toast.error(data.error || 'Failed to send emails');
        }
        setStep('preview');
      }
    } catch (error) {
      toast.error('Network error — could not reach send endpoint');
      setStep('preview');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 rounded-t-2xl">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">Bulk Email Campaign</h2>
              <p className="text-sm text-gray-600 mt-1">
                {selectedLeads.length} leads selected
              </p>
            </div>
            <div className="flex items-center gap-2">
              {['config', 'generating', 'preview', 'sending', 'complete'].map((s, i) => (
                <div
                  key={s}
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold ${
                    step === s
                      ? 'bg-blue-600 text-white'
                      : ['config', 'generating', 'preview', 'sending', 'complete'].indexOf(step) > i
                      ? 'bg-green-500 text-white'
                      : 'bg-gray-200 text-gray-500'
                  }`}
                >
                  {i + 1}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="p-6">
          {/* Step 1: Configuration */}
          {step === 'config' && (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Your Company Name
                </label>
                <input
                  type="text"
                  value={yourCompany}
                  onChange={(e) => setYourCompany(e.target.value)}
                  placeholder="e.g., Acme Solutions"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Your Service/Product
                </label>
                <input
                  type="text"
                  value={yourService}
                  onChange={(e) => setYourService(e.target.value)}
                  placeholder="e.g., AI-powered marketing automation"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Email Tone
                  </label>
                  <select
                    value={tone}
                    onChange={(e) => setTone(e.target.value as any)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="professional">Professional</option>
                    <option value="casual">Casual</option>
                    <option value="friendly">Friendly</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Purpose
                  </label>
                  <select
                    value={purpose}
                    onChange={(e) => setPurpose(e.target.value as any)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="introduction">Introduction</option>
                    <option value="partnership">Partnership</option>
                    <option value="sales">Sales</option>
                    <option value="networking">Networking</option>
                  </select>
                </div>
              </div>

              <button
                onClick={handleGenerateEmails}
                className="w-full py-4 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
              >
                <Zap size={20} />
                Generate {selectedLeads.length} Personalized Emails
              </button>
            </div>
          )}

          {/* Step 2: Generating */}
          {step === 'generating' && (
            <div className="text-center py-12">
              <Loader2 size={48} className="animate-spin text-blue-600 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                Generating Personalized Emails...
              </h3>
              <p className="text-gray-600">
                Creating unique emails for {selectedLeads.length} companies
              </p>
            </div>
          )}

          {/* Step 3: Preview */}
          {step === 'preview' && (
            <div className="space-y-4">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-sm text-blue-900">
                  <strong>{generatedEmails.length} emails ready to send</strong>
                  <br />
                  Using 60 Gmail SMTP accounts with automatic rotation
                  <br />
                  Sending in chunks of 100 with 2-second delays between emails
                </p>
              </div>

              <div className="max-h-96 overflow-y-auto space-y-3">
                {generatedEmails.slice(0, 5).map((email, i) => (
                  <div key={i} className="border border-gray-200 rounded-lg p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="font-semibold text-gray-900">{email.company_name}</p>
                        <p className="text-sm text-gray-600">{email.lead_email}</p>
                      </div>
                      <Mail size={16} className="text-gray-400" />
                    </div>
                    <p className="text-sm font-medium text-gray-700 mb-1">
                      Subject: {email.subject}
                    </p>
                    <p className="text-xs text-gray-500 line-clamp-2">
                      {email.body.replace(/<[^>]*>/g, '').substring(0, 150)}...
                    </p>
                  </div>
                ))}
                {generatedEmails.length > 5 && (
                  <p className="text-center text-sm text-gray-500">
                    + {generatedEmails.length - 5} more emails
                  </p>
                )}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setStep('config')}
                  className="flex-1 py-3 border border-gray-300 text-gray-700 rounded-lg font-semibold hover:bg-gray-50 transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handleSendEmails}
                  className="flex-1 py-3 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 transition-colors flex items-center justify-center gap-2"
                >
                  <Send size={20} />
                  Send All Emails
                </button>
              </div>
            </div>
          )}

          {/* Step 4: Sending */}
          {step === 'sending' && (
            <div className="text-center py-12">
              <Loader2 size={48} className="animate-spin text-green-600 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                Sending Emails...
              </h3>
              <p className="text-gray-600 mb-4">
                Progress: {sendingProgress.sent} / {sendingProgress.total}
              </p>
              <div className="w-full bg-gray-200 rounded-full h-3 max-w-md mx-auto">
                <div
                  className="bg-green-600 h-3 rounded-full transition-all duration-300"
                  style={{
                    width: `${(sendingProgress.sent / sendingProgress.total) * 100}%`,
                  }}
                />
              </div>
            </div>
          )}

          {/* Step 5: Complete */}
          {step === 'complete' && results && (
            <div className="space-y-6">
              <div className="text-center">
                <CheckCircle size={64} className="text-green-600 mx-auto mb-4" />
                <h3 className="text-2xl font-bold text-gray-900 mb-2">
                  Campaign Complete!
                </h3>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
                  <CheckCircle size={24} className="text-green-600 mx-auto mb-2" />
                  <p className="text-2xl font-bold text-green-900">{results.sent}</p>
                  <p className="text-sm text-green-700">Sent</p>
                </div>

                <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-center">
                  <XCircle size={24} className="text-red-600 mx-auto mb-2" />
                  <p className="text-2xl font-bold text-red-900">{results.failed}</p>
                  <p className="text-sm text-red-700">Failed</p>
                </div>

                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-center">
                  <Clock size={24} className="text-yellow-600 mx-auto mb-2" />
                  <p className="text-2xl font-bold text-yellow-900">{results.queued}</p>
                  <p className="text-sm text-yellow-700">Queued</p>
                </div>

                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-center">
                  <Mail size={24} className="text-blue-600 mx-auto mb-2" />
                  <p className="text-2xl font-bold text-blue-900">{results.total}</p>
                  <p className="text-sm text-blue-700">Total</p>
                </div>
              </div>

              <button
                onClick={onComplete}
                className="w-full py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors"
              >
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
