export type LeadStatus = 'New' | 'Email Sent' | 'Replied' | 'Interested' | 'Closed' | 'Dead';

export interface Lead {
  id: string;
  user_id: string;
  company_name: string;
  email: string | null;
  niche: string | null;
  location: string | null;
  company_context: string | null;
  status: LeadStatus;
  notes: string | null;
  category: string | null;
  source: string | null;
  tags: string[] | null;
  created_at: string;
  updated_at: string;
}

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

export interface ScrapedLead {
  company_name: string;
  email: string;
  niche: string;
  location: string;
  company_context: string;
}

export type ActiveModule = 'scraper' | 'email-writer' | 'crm' | 'ai-settings' | 'smtp-manager' | 'follow-up';

export type ToneType = 'Direct' | 'Aggressive' | 'Surgical';

export interface AIProviderConfig {
  name: string;
  key: string;
  models: string[];
  logo: string;
}

export interface EmailCampaign {
  id: string;
  user_id: string;
  name: string;
  status: 'draft' | 'active' | 'paused' | 'completed';
  created_at: string;
  updated_at: string;
}

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

export interface SentEmail {
  id: string;
  user_id: string;
  lead_id: string;
  campaign_id: string | null;
  sequence_id: string | null;
  subject: string | null;
  body: string | null;
  sent_at: string;
  opened_at: string | null;
  replied_at: string | null;
  status: 'sent' | 'opened' | 'replied' | 'bounced';
}

export interface FollowupSettings {
  id: string;
  user_id: string;
  auto_followup_enabled: boolean;
  default_delay_days: number;
  max_followups: number;
  stop_on_reply: boolean;
  created_at: string;
  updated_at: string;
}

export interface LeadCategory {
  id: string;
  user_id: string;
  name: string;
  color: string;
  created_at: string;
}

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

export interface EmailAutomationRule {
  id: string;
  user_id: string;
  name: string;
  trigger_type: 'reply_received' | 'positive_reply' | 'negative_reply' | 'no_reply_after_days';
  trigger_condition: any;
  action_type: 'send_ai_reply' | 'update_crm_status' | 'create_task' | 'send_notification';
  action_config: any;
  is_active: boolean;
  priority: number;
  created_at: string;
  updated_at: string;
}
