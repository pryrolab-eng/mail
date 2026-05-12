"use client";

import { useState, useEffect } from "react";
import { Inbox, Plus, Trash2, RefreshCw, Loader2, CheckCircle, AlertCircle, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";

interface InboxConfig {
  id: string;
  email_address: string;
  provider: string;
  imap_host: string;
  imap_port: number;
  imap_username: string;
  last_checked_at: string | null;
  is_active: boolean;
  auto_reply_enabled: boolean;
}

interface InboxConfigPanelProps {
  onRepliesFound?: (count: number) => void;
}

export default function InboxConfigPanel({ onRepliesFound }: InboxConfigPanelProps) {
  const [configs, setConfigs] = useState<InboxConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    email_address: "",
    imap_host: "imap.gmail.com",
    imap_port: 993,
    imap_username: "",
    imap_password: "",
    auto_reply_enabled: false,
  });

  useEffect(() => {
    fetchConfigs();
  }, []);

  const fetchConfigs = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/inbox/config");
      const data = await res.json();
      if (data.success) setConfigs(data.configs);
    } catch {
      toast.error("Failed to load inbox configs");
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/inbox/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Inbox connected successfully");
        setShowAddForm(false);
        setForm({ email_address: "", imap_host: "imap.gmail.com", imap_port: 993, imap_username: "", imap_password: "", auto_reply_enabled: false });
        fetchConfigs();
      } else {
        toast.error(data.error ?? "Failed to add inbox");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Remove this inbox? Reply detection will stop for this account.")) return;
    const res = await fetch(`/api/inbox/config?id=${id}`, { method: "DELETE" });
    const data = await res.json();
    if (data.success) {
      toast.success("Inbox removed");
      setConfigs((prev) => prev.filter((c) => c.id !== id));
    } else {
      toast.error(data.error ?? "Failed to remove inbox");
    }
  };

  const handleCheck = async () => {
    setChecking(true);
    try {
      const res = await fetch("/api/inbox/check", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        if (data.totalNewReplies > 0) {
          toast.success(`Found ${data.totalNewReplies} new repl${data.totalNewReplies === 1 ? "y" : "ies"}!`);
          onRepliesFound?.(data.totalNewReplies);
        } else {
          toast.info("No new replies found");
        }
        fetchConfigs(); // refresh last_checked_at
      } else {
        toast.error(data.error ?? "Check failed");
      }
    } finally {
      setChecking(false);
    }
  };

  // Provider presets
  const PRESETS: Record<string, { host: string; port: number }> = {
    gmail: { host: "imap.gmail.com", port: 993 },
    outlook: { host: "outlook.office365.com", port: 993 },
    yahoo: { host: "imap.mail.yahoo.com", port: 993 },
    custom: { host: "", port: 993 },
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Connected Inboxes</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            IMAP accounts polled every 15 minutes for replies
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCheck}
            disabled={checking || configs.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors disabled:opacity-50"
          >
            {checking ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            Check now
          </button>
          <button
            onClick={() => setShowAddForm(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors"
          >
            <Plus size={12} />
            Add inbox
          </button>
        </div>
      </div>

      {/* Config list */}
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 size={20} className="animate-spin text-gray-400" />
        </div>
      ) : configs.length === 0 ? (
        <div className="text-center py-8 border-2 border-dashed border-gray-200 rounded-xl">
          <Inbox size={32} className="text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-500">No inboxes connected</p>
          <p className="text-xs text-gray-400 mt-1">Add an IMAP account to start detecting replies</p>
        </div>
      ) : (
        <div className="space-y-2">
          {configs.map((config) => (
            <div
              key={config.id}
              className="flex items-center justify-between p-3 rounded-xl border border-gray-200 bg-white"
            >
              <div className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${config.is_active ? "bg-green-500" : "bg-gray-300"}`} />
                <div>
                  <p className="text-sm font-medium text-gray-900">{config.email_address}</p>
                  <p className="text-xs text-gray-500">
                    {config.imap_host} · Port {config.imap_port}
                    {config.last_checked_at && (
                      <> · Last checked {new Date(config.last_checked_at).toLocaleTimeString()}</>
                    )}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {config.auto_reply_enabled && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-200">
                    Auto-reply on
                  </span>
                )}
                <button
                  onClick={() => handleDelete(config.id)}
                  className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add form modal */}
      {showAddForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setShowAddForm(false)}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <div
            className="relative bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-gray-900 mb-4">Connect Inbox</h3>

            <form onSubmit={handleAdd} className="space-y-4">
              {/* Provider preset buttons */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-2">Provider</label>
                <div className="flex gap-2 flex-wrap">
                  {Object.entries(PRESETS).map(([key, preset]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, imap_host: preset.host, imap_port: preset.port }))}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                        form.imap_host === preset.host
                          ? "bg-blue-600 text-white border-blue-600"
                          : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                      }`}
                    >
                      {key.charAt(0).toUpperCase() + key.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Email address</label>
                <input
                  type="email"
                  required
                  value={form.email_address}
                  onChange={(e) => setForm((f) => ({ ...f, email_address: e.target.value, imap_username: e.target.value }))}
                  placeholder="you@gmail.com"
                  className="w-full px-3 py-2 text-sm text-gray-900 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 placeholder:text-gray-400"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-700 mb-1">IMAP host</label>
                  <input
                    type="text"
                    required
                    value={form.imap_host}
                    onChange={(e) => setForm((f) => ({ ...f, imap_host: e.target.value }))}
                    placeholder="imap.gmail.com"
                    className="w-full px-3 py-2 text-sm text-gray-900 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 placeholder:text-gray-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Port</label>
                  <input
                    type="number"
                    required
                    value={form.imap_port}
                    onChange={(e) => setForm((f) => ({ ...f, imap_port: parseInt(e.target.value) }))}
                    className="w-full px-3 py-2 text-sm text-gray-900 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Password / App Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    value={form.imap_password}
                    onChange={(e) => setForm((f) => ({ ...f, imap_password: e.target.value }))}
                    placeholder="Gmail: use App Password, not your regular password"
                    className="w-full px-3 py-2 pr-10 text-sm text-gray-900 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 placeholder:text-gray-400"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                {form.imap_host.includes("gmail") && (
                  <p className="text-xs text-amber-600 mt-1">
                    Gmail requires an App Password. Enable 2FA → Google Account → Security → App Passwords.
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="auto_reply"
                  checked={form.auto_reply_enabled}
                  onChange={(e) => setForm((f) => ({ ...f, auto_reply_enabled: e.target.checked }))}
                  className="rounded"
                />
                <label htmlFor="auto_reply" className="text-xs text-gray-700">
                  Enable auto-reply for positive responses
                </label>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="flex-1 py-2.5 border border-gray-300 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {saving ? <Loader2 size={14} className="animate-spin" /> : null}
                  Connect inbox
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
