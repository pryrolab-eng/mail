"use client";

import { useState, useEffect } from "react";
import { Plus, Mail, Trash2, CheckCircle, XCircle, AlertCircle, Settings } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "../../../supabase/client";

interface SMTPManagerProps {
  userId: string;
}

// Only Gmail SMTP is supported
const GMAIL_SMTP = {
  name: "Gmail",
  host: "smtp.gmail.com",
  port: 587,
  limit: 500, // Gmail allows 500 emails per day for free accounts
};

export default function SMTPManager({ userId }: SMTPManagerProps) {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [capacity, setCapacity] = useState({ total: 0, used: 0, remaining: 0 });
  const [showAddForm, setShowAddForm] = useState(false);
  const [loading, setLoading] = useState(false);
  
  const [formData, setFormData] = useState({
    provider: "Gmail",
    email: "",
    host: GMAIL_SMTP.host,
    port: GMAIL_SMTP.port,
    user: "",
    password: "",
    daily_limit: GMAIL_SMTP.limit,
  });

  const supabase = createClient();

  useEffect(() => {
    loadAccounts();
  }, [userId]);

  const loadAccounts = async () => {
    const { data, error } = await supabase
      .from('smtp_accounts')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error loading SMTP accounts:', error);
      console.error('Error details:', JSON.stringify(error, null, 2));
      toast.error('Failed to load SMTP accounts: ' + (error.message || 'Unknown error'));
      return;
    }

    setAccounts(data || []);

    // Calculate capacity
    const totalCapacity = (data || []).reduce((sum: number, acc: any) => sum + acc.daily_limit, 0);
    const totalUsed = (data || []).reduce((sum: number, acc: any) => sum + (acc.sent_today || 0), 0);

    setCapacity({
      total: totalCapacity,
      used: totalUsed,
      remaining: totalCapacity - totalUsed
    });
  };

  const handleEmailChange = (email: string) => {
    // Validate that it's a Gmail address
    if (email && !email.toLowerCase().endsWith('@gmail.com')) {
      toast.error("Only Gmail addresses are supported");
      return;
    }
    setFormData({
      ...formData,
      email,
      user: email, // Use email as username
    });
  };

  const handleAddAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Validate email format
      if (!formData.email.includes('@')) {
        toast.error("Invalid email address");
        setLoading(false);
        return;
      }

      // Create new account object matching the database schema
      const newAccount = {
        user_id: userId,
        email: formData.email,
        host: formData.host,
        port: formData.port,
        user_name: formData.user || formData.email,
        password: formData.password,
        provider: formData.provider,
        daily_limit: formData.daily_limit,
        sent_today: 0,
        status: 'active',
        last_reset: new Date().toISOString(),
      };

      console.log('Inserting SMTP account:', { ...newAccount, password: '***' });

      // Insert into Supabase
      const { data, error } = await supabase
        .from('smtp_accounts')
        .insert(newAccount)
        .select();

      if (error) {
        console.error('Supabase error:', error);
        console.error('Error details:', JSON.stringify(error, null, 2));
        console.error('Error code:', error.code);
        console.error('Error message:', error.message);
        console.error('Error hint:', error.hint);
        console.error('Error details:', error.details);
        
        if (error.code === '23505') { // Unique constraint violation
          toast.error("This email address is already added");
        } else {
          toast.error("Failed to add SMTP account: " + (error.message || 'Unknown error. Check console for details.'));
        }
        setLoading(false);
        return;
      }

      console.log('SMTP account added successfully:', data);

      setShowAddForm(false);
      setFormData({
        provider: "Gmail",
        email: "",
        host: GMAIL_SMTP.host,
        port: GMAIL_SMTP.port,
        user: "",
        password: "",
        daily_limit: GMAIL_SMTP.limit,
      });

      await loadAccounts();

      // Verify the account is visible server-side (same path the email sender uses)
      try {
        const checkRes = await fetch("/api/smtp-check");
        const checkData = await checkRes.json();
        if (checkData.success && checkData.count > 0) {
          toast.success(`Gmail account added ✓ — server can see ${checkData.count} account(s), ready to send`);
        } else {
          toast.warning("Account saved, but the server can't see it yet. Try refreshing the page. If the problem persists, check your Supabase RLS policies.");
        }
      } catch {
        // Non-critical — just show the basic success
        toast.success("Gmail SMTP account added successfully!");
      }
    } catch (error) {
      console.error('Exception adding SMTP account:', error);
      toast.error("An error occurred: " + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAccount = async (accountId: string) => {
    const { error } = await supabase
      .from('smtp_accounts')
      .delete()
      .eq('id', accountId)
      .eq('user_id', userId);

    if (error) {
      console.error('Error deleting SMTP account:', error);
      toast.error('Failed to delete SMTP account');
      return;
    }

    toast.success("SMTP account deleted");
    await loadAccounts();
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "active":
        return <CheckCircle size={16} className="text-green-500" />;
      case "error":
        return <XCircle size={16} className="text-red-500" />;
      case "paused":
        return <AlertCircle size={16} className="text-yellow-500" />;
      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col gap-6 p-6 h-full bg-white">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Gmail SMTP Accounts</h2>
          <p className="text-sm text-gray-600 mt-1">
            Manage your Gmail accounts for sending emails
          </p>
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus size={16} />
          Add Account
        </button>
      </div>

      {/* Capacity Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <div className="flex items-center gap-2 mb-2">
            <Mail size={20} className="text-blue-600" />
            <span className="text-sm font-medium text-gray-700">Total Capacity</span>
          </div>
          <p className="text-3xl font-bold text-gray-900">{capacity.total.toLocaleString()}</p>
          <p className="text-xs text-gray-500 mt-1">emails per day</p>
        </div>

        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle size={20} className="text-blue-600" />
            <span className="text-sm font-medium text-gray-700">Remaining</span>
          </div>
          <p className="text-3xl font-bold text-gray-900">{capacity.remaining.toLocaleString()}</p>
          <p className="text-xs text-gray-500 mt-1">emails available today</p>
        </div>

        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <div className="flex items-center gap-2 mb-2">
            <Settings size={20} className="text-blue-600" />
            <span className="text-sm font-medium text-gray-700">Active Accounts</span>
          </div>
          <p className="text-3xl font-bold text-gray-900">{accounts.filter(a => a.status === 'active').length}</p>
          <p className="text-xs text-gray-500 mt-1">of {accounts.length} total</p>
        </div>
      </div>

      {/* Add Account Form */}
      {showAddForm && (
        <div className="bg-gray-50 rounded-xl p-6 border border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Add Gmail SMTP Account</h3>
          <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-sm text-blue-800">
              <strong>Note:</strong> Only Gmail accounts are supported. You'll need to use an App Password, not your regular Gmail password.
              <a 
                href="https://support.google.com/accounts/answer/185833" 
                target="_blank" 
                rel="noopener noreferrer"
                className="underline ml-1"
              >
                Learn how to create an App Password
              </a>
            </p>
          </div>
          <form onSubmit={handleAddAccount} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Gmail Address *
                </label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => handleEmailChange(e.target.value)}
                  placeholder="your-email@gmail.com"
                  className="w-full px-3 py-2 text-gray-900 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 placeholder:text-gray-400"
                  required
                  pattern=".*@gmail\.com$"
                  title="Please enter a valid Gmail address"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  App Password *
                </label>
                <input
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  placeholder="16-character app password"
                  className="w-full px-3 py-2 text-gray-900 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 placeholder:text-gray-400"
                  required
                />
                <p className="text-xs text-gray-500 mt-1">
                  Use a 16-character App Password from your Google Account settings
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Daily Sending Limit
                </label>
                <input
                  type="number"
                  value={formData.daily_limit}
                  onChange={(e) => setFormData({ ...formData, daily_limit: parseInt(e.target.value) })}
                  className="w-full px-3 py-2 text-gray-900 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  min="1"
                  max="500"
                  required
                />
                <p className="text-xs text-gray-500 mt-1">
                  Gmail allows up to 500 emails per day
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  SMTP Configuration
                </label>
                <div className="px-3 py-2 bg-gray-100 border border-gray-300 rounded-lg text-sm text-gray-600">
                  {GMAIL_SMTP.host}:{GMAIL_SMTP.port}
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Automatically configured for Gmail
                </p>
              </div>
            </div>

            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? "Adding..." : "Add Gmail Account"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Accounts List */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">
                Status
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">
                Email
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">
                Provider
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">
                Usage Today
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">
                Daily Limit
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {accounts.map((account) => (
              <tr key={account.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {getStatusIcon(account.status)}
                    <span className="text-sm capitalize">{account.status}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-gray-900">{account.email}</td>
                <td className="px-4 py-3 text-sm text-gray-600">{account.provider}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-gray-200 rounded-full h-2 max-w-[100px]">
                      <div
                        className="bg-blue-600 h-2 rounded-full"
                        style={{
                          width: `${(account.sent_today / account.daily_limit) * 100}%`,
                        }}
                      />
                    </div>
                    <span className="text-sm text-gray-600">{account.sent_today}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-gray-600">{account.daily_limit}</td>
                <td className="px-4 py-3">
                  <button 
                    onClick={() => handleDeleteAccount(account.id)}
                    className="text-red-600 hover:text-red-700"
                  >
                    <Trash2 size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {accounts.length === 0 && (
          <div className="text-center py-12">
            <Mail size={48} className="mx-auto text-gray-300 mb-4" />
            <p className="text-gray-600">No Gmail accounts configured</p>
            <p className="text-sm text-gray-500 mt-1">Add your first Gmail account to start sending emails</p>
          </div>
        )}
      </div>
    </div>
  );
}
