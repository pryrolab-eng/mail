/**
 * Pryro Platform — Unified Type Definitions
 * All modules share these types for consistent communication.
 */

// ─── Lead Status ──────────────────────────────────────────────────────────────

export type LeadStatus =
  | 'new'
  | 'contacted'
  | 'opened'
  | 'clicked'
  | 'replied'
  | 'interested'
  | 'bounced'
  | 'failed'
  // Legacy statuses (kept for backward compat)
  | 'New'
  | 'Email Sent'
  | 'Replied'
  | 'Interested'
  | 'Closed'
  | 'Dead';

export const LEAD_STATUSES: { value: LeadStatus; label: string; color: string; bg: string }[] = [
  { value: 'new',        label: 'New',        color: '#2563EB', bg: '#EFF6FF' },
  { value: 'contacted',  label: 'Contacted',  color: '#2563EB', bg: '#EFF6FF' },
  { value: 'opened',     label: 'Opened',     color: '#2563EB', bg: '#EFF6FF' },
  { value: 'clicked',    label: 'Clicked',    color: '#2563EB', bg: '#EFF6FF' },
  { value: 'replied',    label: 'Replied',    color: '#111827', bg: '#F3F4F6' },
  { value: 'interested', label: 'Interested', color: '#111827', bg: '#F3F4F6' },
  { value: 'bounced',    label: 'Bounced',    color: '#DC2626', bg: '#FEE2E2' },
  { value: 'failed',     label: 'Failed',     color: '#DC2626', bg: '#FEE2E2' },
];

// ─── Pipeline stage (leads.pipeline_stage) ────────────────────────────────────

export type PipelineStage =
  | 'scraped'
  | 'call_list'
  | 'researched'
  | 'email_drafted'
  | 'sent'
  | 'replied'
  | 'failed';

export const PIPELINE_STAGES: PipelineStage[] = [
  'scraped',
  'call_list',
  'researched',
  'email_drafted',
  'sent',
  'replied',
  'failed',
];

// ─── Lead ─────────────────────────────────────────────────────────────────────

export interface Lead {
  id: string;
  user_id: string;
  company_name: string;
  email: string | null;
  phone?: string | null;
  website?: string | null;
  niche: string | null;
  location: string | null;
  company_context: string | null;
  status: LeadStatus;
  notes: string | null;
  category: string | null;
  source: string | null;
  tags: string[] | null;
  confidence_score?: number | null;
  email_verified?: boolean | null;
  last_contacted_at?: string | null;
  pipeline_stage?: PipelineStage | null;
  pipeline_updated_at?: string | null;
  pipeline_error?: string | null;
  email_source?: string | null;
  email_confidence?: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Scraped Lead (from scraper, before saving to DB) ────────────────────────

export interface ScrapedLead {
  company_name: string;
  email: string;
  /** Maps row with phone but no email — saved to CRM as call_list */
  phoneOnly?: boolean;
  emailIsReal?: boolean;
  niche?: string;
  /** Search target (e.g. "Kigali, Rwanda") — not necessarily where the business is */
  location: string;
  company_context?: string;
  source_url?: string;
  phone?: string;
  website?: string;
  confidence_score?: number;
  /** Maps listing address */
  business_address?: string;
  source_snippet?: string;
  email_from_csv?: string;
  email_from_website?: string;
  email_verify_status?: string;
  email_source?: string;
  email_confidence?: string;
}

// ─── Generated Email ──────────────────────────────────────────────────────────

export interface GeneratedEmail {
  id: string;
  user_id: string;
  lead_id: string;
  subject: string | null;
  body: string | null;
  tone: string | null;
  model_used: string | null;
  created_at: string;
}

// ─── Sent Email ───────────────────────────────────────────────────────────────

export interface SentEmail {
  id: string;
  user_id: string;
  lead_id: string | null;
  campaign_id: string | null;
  sequence_id: string | null;
  to_email: string | null;
  subject: string | null;
  body: string | null;
  sent_at: string;
  opened_at: string | null;
  clicked_at: string | null;
  replied_at: string | null;
  status: 'sent' | 'opened' | 'clicked' | 'replied' | 'bounced' | 'failed';
  bounce_reason: string | null;
  followup_count: number;
  next_followup_at: string | null;
  followup_stopped: boolean;
  smtp_message_id: string | null;
  tracking_pixel_id: string | null;
  smtp_account_id: string | null;
  created_at: string;
}

// ─── Email Reply ──────────────────────────────────────────────────────────────

export interface EmailReply {
  id: string;
  user_id: string;
  sent_email_id: string;
  lead_id: string;
  from_email: string;
  subject: string | null;
  body: string;
  received_at: string;
  is_positive: boolean | null;
  sentiment: 'positive' | 'neutral' | 'negative' | 'interested' | 'not_interested' | null;
  ai_response_generated: boolean;
  ai_response_sent: boolean;
  created_at: string;
}

// ─── AI Reply ─────────────────────────────────────────────────────────────────

export interface AIReply {
  id: string;
  user_id: string;
  reply_id: string;
  lead_id: string;
  subject: string | null;
  body: string;
  tone: string | null;
  model_used: string | null;
  sent_at: string | null;
  status: 'draft' | 'approved' | 'sent' | 'rejected';
  created_at: string;
}

// ─── AI Provider ──────────────────────────────────────────────────────────────

export interface AIProvider {
  id: string;
  user_id: string;
  provider: string;
  api_key: string | null;
  is_active: boolean;
  active_model: string | null;
  is_connected: boolean;
  created_at: string;
  updated_at: string;
}

export interface AIProviderConfig {
  name: string;
  key: string;
  models: string[];
  logo: string;
}

// ─── SMTP Account ─────────────────────────────────────────────────────────────

export interface SMTPAccount {
  id: string;
  user_id: string;
  email: string;
  host: string;
  port: number;
  user_name: string;
  password: string;
  provider: string;
  daily_limit: number;
  sent_today: number;
  last_reset: string;
  status: 'active' | 'paused' | 'error';
  warmup_enabled?: boolean;
  warmup_count?: number;
  health_score?: number;
  last_error?: string | null;
  total_sent?: number;
  total_bounced?: number;
  created_at: string;
  updated_at: string;
}

// ─── Email Campaign ───────────────────────────────────────────────────────────

export interface EmailCampaign {
  id: string;
  user_id: string;
  name: string;
  description?: string | null;
  template_subject: string;
  template_body: string;
  tone: string;
  purpose: string;
  status: 'draft' | 'active' | 'paused' | 'completed';
  total_recipients: number;
  sent_count: number;
  opened_count: number;
  clicked_count: number;
  replied_count: number;
  bounced_count: number;
  failed_count: number;
  niche?: string | null;
  scheduled_at?: string | null;
  completed_at?: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Email Sequence ───────────────────────────────────────────────────────────

export interface EmailSequence {
  id: string;
  campaign_id: string;
  sequence_number: number;
  delay_days: number;
  subject_template: string | null;
  body_template: string | null;
  tone: string | null;
  created_at: string;
}

// ─── Follow-up Settings ───────────────────────────────────────────────────────

export interface FollowupSettings {
  id: string;
  user_id: string;
  auto_followup_enabled: boolean;
  default_delay_days: number;
  max_followups: number;
  stop_on_reply: boolean;
  followup_tone: string | null;
  your_company: string | null;
  your_service: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Notification ─────────────────────────────────────────────────────────────

export interface Notification {
  id: string;
  user_id: string;
  type: 'reply' | 'bounce' | 'smtp_error' | 'campaign_complete' | 'scrape_done' | 'failed_email' | 'info';
  title: string;
  message: string;
  data: Record<string, any>;
  is_read: boolean;
  created_at: string;
}

// ─── CSV Import ───────────────────────────────────────────────────────────────

export interface CSVImport {
  id: string;
  user_id: string;
  filename: string;
  total_rows: number;
  imported_rows: number;
  failed_rows: number;
  duplicate_rows: number;
  status: 'processing' | 'completed' | 'failed';
  error_log: Array<{ row: number; error: string; data?: any }>;
  created_at: string;
  completed_at: string | null;
}

// ─── Analytics ────────────────────────────────────────────────────────────────

export interface AnalyticsSummary {
  total_sent: number;
  total_opened: number;
  total_clicked: number;
  total_replied: number;
  total_bounced: number;
  total_failed: number;
  open_rate: number;
  reply_rate: number;
  bounce_rate: number;
}

export interface AnalyticsEvent {
  id: string;
  user_id: string;
  event_type: 'email_opened' | 'email_clicked' | 'email_bounced' | 'email_replied';
  sent_email_id: string | null;
  lead_id: string | null;
  campaign_id: string | null;
  metadata: Record<string, any>;
  created_at: string;
}

// ─── Email Template ───────────────────────────────────────────────────────────

export interface EmailTemplate {
  id: string;
  user_id: string;
  name: string;
  subject: string;
  body: string;
  tone: string;
  niche: string | null;
  variables: string[];
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

// ─── Lead Category ────────────────────────────────────────────────────────────

export interface LeadCategory {
  id: string;
  user_id: string;
  name: string;
  color: string;
  created_at: string;
}

// ─── Inbox Config ─────────────────────────────────────────────────────────────

export interface EmailInboxConfig {
  id: string;
  user_id: string;
  email_address: string;
  provider: 'gmail' | 'outlook' | 'imap';
  access_token: string | null;
  refresh_token: string | null;
  imap_host: string | null;
  imap_port: number | null;
  imap_username: string | null;
  imap_password: string | null;
  last_checked_at: string | null;
  is_active: boolean;
  auto_reply_enabled: boolean;
  created_at: string;
  updated_at: string;
}

// ─── Module Navigation ────────────────────────────────────────────────────────

export type ActiveModule =
  | 'scraper'
  | 'pipeline'
  | 'email-writer'
  | 'crm'
  | 'ai-settings'
  | 'smtp-manager'
  | 'follow-up'
  | 'campaigns';

// ─── Tone Types ───────────────────────────────────────────────────────────────

export type ToneType = 'Direct' | 'Aggressive' | 'Surgical';

// ─── Bounce Types ─────────────────────────────────────────────────────────────

export type BounceType =
  | 'mailbox_not_found'
  | 'invalid_domain'
  | 'smtp_rejection'
  | 'spam_block'
  | 'temporary_failure'
  | 'unknown';

export function classifyBounce(errorMessage: string): BounceType {
  const msg = errorMessage.toLowerCase();
  if (msg.includes('user unknown') || msg.includes('no such user') || msg.includes('mailbox not found')) {
    return 'mailbox_not_found';
  }
  if (msg.includes('domain') || msg.includes('dns') || msg.includes('mx')) {
    return 'invalid_domain';
  }
  if (msg.includes('spam') || msg.includes('blocked') || msg.includes('blacklist')) {
    return 'spam_block';
  }
  if (msg.includes('temporary') || msg.includes('try again') || msg.includes('421') || msg.includes('450')) {
    return 'temporary_failure';
  }
  if (msg.includes('reject') || msg.includes('refused') || msg.includes('550') || msg.includes('551')) {
    return 'smtp_rejection';
  }
  return 'unknown';
}
