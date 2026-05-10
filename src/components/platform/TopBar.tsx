"use client";

import { ActiveModule } from "@/types/platform";
import { Radio, Mail, Settings, Layout, LogOut, Server, Clock, Menu, BarChart2, FileText, Megaphone } from "lucide-react";
import { NotificationsBell } from "./NotificationsPanel";

interface TopBarProps {
  activeModule: ActiveModule;
  userEmail?: string;
  userId?: string;
  onLogout?: () => void;
  onMenuToggle?: () => void;
}

const moduleInfo: Record<ActiveModule, { label: string; desc: string; icon: React.ElementType }> = {
  scraper:       { label: "Email Scraper",    desc: "Find and scrape leads by niche & location",          icon: Radio },
  "email-writer":{ label: "AI Email Writer",  desc: "Generate personalized cold outreach emails",         icon: Mail },
  crm:           { label: "CRM Pipeline",     desc: "Manage and track your outreach pipeline",            icon: Layout },
  "smtp-manager":{ label: "SMTP Manager",     desc: "Manage your email sending accounts",                 icon: Server },
  "ai-settings": { label: "AI Settings",      desc: "Configure AI providers and active model",            icon: Settings },
  "follow-up":   { label: "Follow-Up System", desc: "Manage automated email follow-up sequences",         icon: Clock },
  analytics:     { label: "Analytics",        desc: "Real-time campaign performance and insights",        icon: BarChart2 },
  campaigns:     { label: "Campaigns",        desc: "Create and manage email campaigns",                  icon: Megaphone },
  templates:     { label: "Templates",        desc: "Manage reusable email templates",                    icon: FileText },
};

export default function TopBar({ activeModule, userEmail, userId, onLogout, onMenuToggle }: TopBarProps) {
  const info = moduleInfo[activeModule] || moduleInfo.scraper;
  const Icon = info.icon;

  return (
    <header
      className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-200 bg-white"
      style={{ position: "sticky", top: 0, zIndex: 40 }}
    >
      <div className="flex items-center gap-3">
        {/* Mobile hamburger */}
        <button
          onClick={onMenuToggle}
          className="lg:hidden p-2 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
          aria-label="Toggle menu"
        >
          <Menu size={20} />
        </button>

        <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center flex-shrink-0">
          <Icon size={16} className="text-blue-600" />
        </div>
        <div className="min-w-0">
          <h1 className="text-sm sm:text-base font-bold text-gray-900 truncate">
            {info.label}
          </h1>
          <p className="text-[10px] sm:text-xs text-gray-500 hidden sm:block truncate">
            {info.desc}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        {/* Live indicator */}
        <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-full bg-green-50 border border-green-200">
          <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
          <span className="text-[10px] font-medium text-green-700">LIVE</span>
        </div>

        {/* Notifications */}
        {userId && <NotificationsBell userId={userId} />}

        {/* User email */}
        {userEmail && (
          <span className="hidden md:block text-xs text-gray-500 truncate max-w-[160px] px-2 py-1 rounded-lg bg-gray-50 border border-gray-200">
            {userEmail}
          </span>
        )}

        {/* Sign out */}
        <button
          onClick={onLogout}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 transition-colors border border-red-100"
        >
          <LogOut size={14} />
          <span className="hidden sm:inline">Sign Out</span>
        </button>
      </div>
    </header>
  );
}
