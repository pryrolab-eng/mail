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
   * Load SMTP accounts from database
   */
  async loadAccounts(userId: string): Promise<void> {
    const supabase = createServiceClient();
    
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
    
    console.log(`Loaded ${this.accounts.length} SMTP accounts for user ${userId}`);
    
    if (this.accounts.length === 0) {
      console.warn('No active SMTP accounts found. Please add SMTP accounts to send emails.');
    }
    
    // Reset daily counters if needed
    await this.resetDailyCounters();
  }

  /**
   * Reset daily counters for accounts that haven't been reset today
   */
  async resetDailyCounters(): Promise<void> {
    const supabase = createServiceClient();
    const today = new Date().toISOString().split('T')[0];
    
    for (const account of this.accounts) {
      const lastReset = account.last_reset?.split('T')[0];
      
      if (lastReset !== today) {
        await supabase
          .from('smtp_accounts')
          .update({
            sent_today: 0,
            last_reset: new Date().toISOString()
          })
          .eq('id', account.id);
        
        account.sent_today = 0;
        account.last_reset = new Date().toISOString();
      }
    }
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
        from: `"${account.email.split('@')[0]}" <${account.email}>`,
        to,
        subject,
        html,
        text: text || html.replace(/<[^>]*>/g, ''), // Strip HTML for text version
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
      
      // Mark account as error if it fails
      const supabase = createServiceClient();
      await supabase
        .from('smtp_accounts')
        .update({ status: 'error' })
        .eq('id', account.id);

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
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
