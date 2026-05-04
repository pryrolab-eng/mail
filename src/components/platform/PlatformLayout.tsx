"use client";

import { useState } from "react";
import { ActiveModule, Lead, ScrapedLead } from "@/types/platform";
import PlatformSidebar from "./PlatformSidebar";
import TopBar from "./TopBar";
import ScraperModule from "./ScraperModule";
import EmailWriterModule from "./EmailWriterModule";
import CRMModule from "./CRMModule";
import AISettingsModule from "./AISettingsModule";
import SMTPManager from "./SMTPManager";
import FollowUpModule from "./FollowUpModule";
import { createClient } from "../../../supabase/client";
import { useRouter } from "next/navigation";

interface PlatformLayoutProps {
  userId: string;
  userEmail?: string;
}

export default function PlatformLayout({ userId, userEmail }: PlatformLayoutProps) {
  const [activeModule, setActiveModule] = useState<ActiveModule>("scraper");
  const [preloadedLead, setPreloadedLead] = useState<Lead | null>(null);
  const [crmRefreshKey, setCrmRefreshKey] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/sign-in");
  };

  const handleGenerateEmailFromScraper = (leads: ScrapedLead[]) => {
    if (leads.length > 0) {
      const lead = leads[0];
      setPreloadedLead({
        id: "temp-" + Date.now(),
        user_id: userId,
        company_name: lead.company_name,
        email: lead.email,
        niche: lead.niche,
        location: lead.location,
        company_context: lead.company_context,
        status: "New",
        notes: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }
    setActiveModule("email-writer");
  };

  const handleWriteEmailFromCRM = (lead: Lead) => {
    setPreloadedLead(lead);
    setActiveModule("email-writer");
  };

  const handleLeadsAdded = () => {
    setCrmRefreshKey((k) => k + 1);
  };

  const handleModuleChange = (module: ActiveModule) => {
    setActiveModule(module);
    setSidebarOpen(false);
  };

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-20 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div
        className={`
          fixed lg:relative z-30 lg:z-10 h-full transition-transform duration-300
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
        `}
      >
        <PlatformSidebar activeModule={activeModule} onModuleChange={handleModuleChange} userId={userId} />
      </div>

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0 relative z-10">
        <TopBar
          activeModule={activeModule}
          userEmail={userEmail}
          onLogout={handleLogout}
          onMenuToggle={() => setSidebarOpen(!sidebarOpen)}
        />

        <main className="flex-1 overflow-y-auto bg-white">
          {activeModule === "scraper" && (
            <ScraperModule
              userId={userId}
              onLeadsAdded={handleLeadsAdded}
              onGenerateEmails={handleGenerateEmailFromScraper}
            />
          )}
          {activeModule === "email-writer" && (
            <EmailWriterModule
              key={preloadedLead?.id}
              userId={userId}
              preloadedLead={preloadedLead}
            />
          )}
          {activeModule === "crm" && (
            <CRMModule
              key={crmRefreshKey}
              userId={userId}
              onWriteEmail={handleWriteEmailFromCRM}
            />
          )}
          {activeModule === "ai-settings" && (
            <AISettingsModule userId={userId} />
          )}
          {activeModule === "smtp-manager" && (
            <SMTPManager userId={userId} />
          )}
          {activeModule === "follow-up" && (
            <FollowUpModule userId={userId} />
          )}
        </main>
      </div>
    </div>
  );
}
