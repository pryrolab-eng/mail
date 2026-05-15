/**
 * SMTP Server Manager - Server-side only
 * Handles nodemailer and email sending
 */

import nodemailer from 'nodemailer';
import { createServiceClient } from '../../supabase/service';
import type { SMTPAccount } from './smtp-manager';

export class SMTPManager {
  private accounts: SMTPAccount[] = [];
  private currentIndex: number = 0;

  /**
   * Load SMTP accounts from database.
   * Resets daily counters for any account whose last_reset date is before today.
   */
  async loadAccounts(userId: string): Promise<void> {
    const supabase = createServiceClient();

    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);
    const todayISO = todayMidnight.toISOString();

    // Reset own accounts with NULL last_reset
    await supabase
      .from('smtp_accounts')
      .update({ sent_today: 0, last_reset: new Date().toISOString(), status: 'active' })
      .eq('user_id', userId)
      .is('last_reset', null);

    // Reset own accounts where last_reset is before today midnight
    await supabase
      .from('smtp_accounts')
      .update({ sent_today: 0, last_reset: new Date().toISOString(), status: 'active' })
      .eq('user_id', userId)
      .lt('last_reset', todayISO);

    // Reset shared accounts that need resetting
    await supabase
      .from('smtp_accounts')
      .update({ sent_today: 0, last_reset: new Date().toISOString(), status: 'active' })
      .eq('is_shared', true)
      .is('last_reset', null);

    await supabase
      .from('smtp_accounts')
      .update({ sent_today: 0, last_reset: new Date().toISOString(), status: 'active' })
      .eq('is_shared', true)
      .lt('last_reset', todayISO);

    // Load user's own accounts + all shared accounts
    const { data: ownAccounts, error: ownError } = await supabase
      .from('smtp_accounts')
      .select('*')
      .eq('user_id', userId)
      .in('status', ['active', 'error'])
      .order('sent_today', { ascending: true });

    const { data: sharedAccounts, error: sharedError } = await supabase
      .from('smtp_accounts')
      .select('*')
      .eq('is_shared', true)
      .in('status', ['active', 'error'])
      .order('sent_today', { ascending: true });

    if (ownError) {
      console.error('Error loading own SMTP accounts:', ownError);
    }
    if (sharedError) {
      console.error('Error loading shared SMTP accounts:', sharedError);
    }

    // Merge — deduplicate by id, own accounts take priority
    const allAccounts = [...(ownAccounts ?? []), ...(sharedAccounts ?? [])];
    const seen = new Set<string>();
    this.accounts = allAccounts
      .filter(a => { if (seen.has(a.id)) return false; seen.add(a.id); return true; })
      .map(acc => ({ ...acc, status: 'active' as const }));

    const totalSent = this.accounts.reduce((s, a) => s + (a.sent_today || 0), 0);
    console.log(`Loaded ${this.accounts.length} SMTP accounts (${ownAccounts?.length ?? 0} own + ${sharedAccounts?.length ?? 0} shared) — ${totalSent} sent today`);

    if (this.accounts.length === 0) {
      console.warn('No SMTP accounts found. Add one in SMTP Manager or mark an existing one as shared.');
    }
  }

  /**
   * @deprecated — reset is now handled inside loadAccounts directly in the DB.
   * Kept for backwards compatibility but does nothing.
   */
  async resetDailyCounters(): Promise<void> {
    // No-op — reset is done in loadAccounts via a single DB update
  }

  /**
   * Get next available SMTP account using round-robin with capacity check
   */
  getNextAccount(): SMTPAccount | null {
    if (this.accounts.length === 0) {
      return null;
    }

    // Try to find an account with available capacity
    let attempts = 0;
    while (attempts < this.accounts.length) {
      const account = this.accounts[this.currentIndex];
      
      if (account.sent_today < account.daily_limit && account.status === 'active') {
        this.currentIndex = (this.currentIndex + 1) % this.accounts.length;
        return account;
      }
      
      this.currentIndex = (this.currentIndex + 1) % this.accounts.length;
      attempts++;
    }

    return null; // All accounts at capacity
  }

  /**
   * Create nodemailer transporter for an SMTP account
   */
  createTransporter(account: SMTPAccount) {
    // user_name is the DB column; fall back to email if missing
    const authUser = account.user_name || account.user || account.email;
    return nodemailer.createTransport({
      host: account.host,
      port: account.port,
      secure: account.port === 465,
      auth: {
        user: authUser,
        pass: account.password,
      },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
  }

  /**
   * Send email using available SMTP account
   */
  async sendEmail(
    to: string,
    subject: string,
    html: string,
    text?: string
  ): Promise<{ success: boolean; accountUsed?: string; error?: string }> {
    const account = this.getNextAccount();
    
    if (!account) {
      return {
        success: false,
        error: 'No SMTP accounts available or all at daily limit'
      };
    }

    try {
      const transporter = this.createTransporter(account);
      
      await transporter.sendMail({
        from: `"${account.sender_name || account.email.split('@')[0]}" <${account.email}>`,
        to,
        subject,
        html,
        text: text || html.replace(/<[^>]*>/g, ''),
      });

      // Update sent count
      const supabase = createServiceClient();
      await supabase
        .from('smtp_accounts')
        .update({
          sent_today: account.sent_today + 1
        })
        .eq('id', account.id);

      account.sent_today += 1;

      return {
        success: true,
        accountUsed: account.email
      };
    } catch (error) {
      console.error(`Error sending email with account ${account.email}:`, error);
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      // Only disable the account for clear authentication/config failures.
      // Recipient errors (550, invalid address, etc.) must NOT disable the account.
      const isAccountIssue =
        errorMessage.toLowerCase().includes('invalid login') ||
        errorMessage.toLowerCase().includes('invalid credentials') ||
        errorMessage.toLowerCase().includes('username and password not accepted') ||
        errorMessage.toLowerCase().includes('authentication failed') ||
        errorMessage.toLowerCase().includes('connection refused') ||
        errorMessage.toLowerCase().includes('econnrefused') ||
        errorMessage.toLowerCase().includes('host not found') ||
        errorMessage.toLowerCase().includes('getaddrinfo');

      const supabase = createServiceClient();

      if (isAccountIssue) {
        console.error(`⚠️  SMTP account ${account.email} auth/config issue — marking error`);
        await supabase
          .from('smtp_accounts')
          .update({ status: 'error' })
          .eq('id', account.id);
        // Remove from in-memory list so we don't retry this account
        this.accounts = this.accounts.filter(a => a.id !== account.id);
      } else {
        // Recipient-specific failure — account is fine, just log it
        console.warn(`⚠️  Send failed for ${to} (account OK): ${errorMessage}`);
      }

      return {
        success: false,
        error: errorMessage
      };
    }
  }

  /**
   * Get total available capacity across all accounts
   */
  getTotalCapacity(): { total: number; used: number; remaining: number } {
    const total = this.accounts.reduce((sum, acc) => sum + acc.daily_limit, 0);
    const used = this.accounts.reduce((sum, acc) => sum + acc.sent_today, 0);
    
    return {
      total,
      used,
      remaining: total - used
    };
  }

  /**
   * Get account statistics
   */
  getAccountStats(): Array<{
    email: string;
    sent: number;
    limit: number;
    percentage: number;
    status: string;
  }> {
    return this.accounts.map(acc => ({
      email: acc.email,
      sent: acc.sent_today,
      limit: acc.daily_limit,
      percentage: (acc.sent_today / acc.daily_limit) * 100,
      status: acc.status
    }));
  }
}
