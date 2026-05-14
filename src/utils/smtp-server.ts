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

    // ── Reset daily counters for accounts not yet reset today ─────────────
    // Use a raw RPC call to avoid PostgREST filter syntax issues.
    // This resets sent_today=0 for any account where last_reset < today midnight.
    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);
    const todayISO = todayMidnight.toISOString(); // e.g. "2026-05-14T00:00:00.000Z"

    // First: reset accounts with NULL last_reset
    await supabase
      .from('smtp_accounts')
      .update({ sent_today: 0, last_reset: new Date().toISOString() })
      .eq('user_id', userId)
      .is('last_reset', null);

    // Second: reset accounts where last_reset is before today midnight
    await supabase
      .from('smtp_accounts')
      .update({ sent_today: 0, last_reset: new Date().toISOString() })
      .eq('user_id', userId)
      .lt('last_reset', todayISO);

    // ── Load the (freshly reset) accounts ─────────────────────────────────
    const { data, error } = await supabase
      .from('smtp_accounts')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('sent_today', { ascending: true });

    if (error) {
      console.error('Error loading SMTP accounts:', error);
      throw new Error('Failed to load SMTP accounts');
    }

    this.accounts = data || [];

    const totalSent = this.accounts.reduce((s, a) => s + (a.sent_today || 0), 0);
    console.log(`Loaded ${this.accounts.length} SMTP accounts — ${totalSent} sent today`);

    if (this.accounts.length === 0) {
      console.warn('No active SMTP accounts found.');
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
    return nodemailer.createTransport({
      host: account.host,
      port: account.port,
      secure: account.port === 465,
      auth: {
        user: account.user_name,
        pass: account.password,
      },
      pool: true, // Use connection pooling
      maxConnections: 5,
      maxMessages: 100,
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
      
      // Only mark account as error for authentication/configuration issues
      // Don't disable for recipient-specific issues (invalid email, mailbox full, etc.)
      const isAccountIssue = 
        errorMessage.toLowerCase().includes('authentication') ||
        errorMessage.toLowerCase().includes('invalid login') ||
        errorMessage.toLowerCase().includes('invalid credentials') ||
        errorMessage.toLowerCase().includes('connection refused') ||
        errorMessage.toLowerCase().includes('econnrefused') ||
        errorMessage.toLowerCase().includes('smtp server') ||
        errorMessage.toLowerCase().includes('host not found');
      
      if (isAccountIssue) {
        // This is an SMTP account configuration problem - disable it
        console.error(`⚠️  SMTP account ${account.email} has configuration issues - marking as error`);
        const supabase = createServiceClient();
        await supabase
          .from('smtp_accounts')
          .update({ 
            status: 'error',
            last_error: errorMessage
          })
          .eq('id', account.id);
      } else {
        // This is a recipient-specific issue - keep account active
        console.warn(`⚠️  Email to recipient failed, but SMTP account ${account.email} is still working`);
        const supabase = createServiceClient();
        await supabase
          .from('smtp_accounts')
          .update({ 
            last_error: errorMessage
          })
          .eq('id', account.id);
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
