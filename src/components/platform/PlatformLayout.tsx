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
import AnalyticsDashboard from "./AnalyticsDashboard";
import { createClient } from "../../../supabase/client";
import { useRouter } from "next/navigation";

// Lazy-loaded modules (only rendered when active)
function LazyModule({ active, children }: { active: boolean; children: React.ReactNode }) {
  if (!active) return null;
  return <>{children}</>;
}

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
        status: "new",
        notes: null,
        category: null,
        source: "scraper",
        tags: null,
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
    // Clear preloaded lead when switching away from email writer
    if (module !== "email-writer") {
      setPreloadedLead(null);
    }
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
        <PlatformSidebar activeModule={activeModule} onModuleChange={handleModuleChange} />
      </div>

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0 relative z-10">
        <TopBar
          activeModule={activeModule}
          userEmail={userEmail}
          userId={userId}
          onLogout={handleLogout}
          onMenuToggle={() => setSidebarOpen(!sidebarOpen)}
        />

        <main className="flex-1 overflow-y-auto bg-white">
          {/* Always-mounted modules (keep state) */}
          <div className={activeModule === "scraper" ? "block h-full" : "hidden"}>
            <ScraperModule
              userId={userId}
              onLeadsAdded={handleLeadsAdded}
              onGenerateEmails={handleGenerateEmailFromScraper}
            />
          </div>

          <div className={activeModule === "crm" ? "block h-full" : "hidden"}>
            <CRMModule
              key={crmRefreshKey}
              userId={userId}
              onWriteEmail={handleWriteEmailFromCRM}
            />
          </div>

          {/* Lazy-mounted modules */}
          <LazyModule active={activeModule === "email-writer"}>
            <EmailWriterModule
              key={preloadedLead?.id || "email-writer"}
              userId={userId}
              preloadedLead={preloadedLead}
            />
          </LazyModule>

          <LazyModule active={activeModule === "analytics"}>
            <AnalyticsDashboard userId={userId} />
          </LazyModule>

          <LazyModule active={activeModule === "ai-settings"}>
            <AISettingsModule userId={userId} />
          </LazyModule>

          <LazyModule active={activeModule === "smtp-manager"}>
            <SMTPManager userId={userId} />
          </LazyModule>

          <LazyModule active={activeModule === "follow-up"}>
            <FollowUpModule userId={userId} />
          </LazyModule>

          <LazyModule active={activeModule === "campaigns"}>
            <CampaignsPlaceholder userId={userId} onNavigate={handleModuleChange} />
          </LazyModule>

          <LazyModule active={activeModule === "templates"}>
            <TemplatesPlaceholder userId={userId} />
          </LazyModule>
        </main>
      </div>
    </div>
  );
}

// ─── Placeholder modules (to be built out) ───────────────────────────────────

function CampaignsPlaceholder({ userId, onNavigate }: { userId: string; onNavigate: (m: ActiveModule) => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[400px] gap-4 p-8">
      <div className="w-16 h-16 rounded-2xl bg-blue-50 flex items-center justify-center">
        <span className="text-3xl">📣</span>
      </div>
      <div className="text-center">
        <h2 className="text-xl font-bold text-gray-900">Campaigns</h2>
        <p className="text-sm text-gray-500 mt-2 max-w-md">
          Create targeted email campaigns, schedule sends, and track performance.
          Use the <strong>Email Writer</strong> to generate and send bulk emails now.
        </p>
      </div>
      <button
        onClick={() => onNavigate("email-writer")}
        className="px-5 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors"
      >
        Go to Email Writer →
      </button>
    </div>
  );
}

function TemplatesPlaceholder({ userId }: { userId: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[400px] gap-4 p-8">
      <div className="w-16 h-16 rounded-2xl bg-purple-50 flex items-center justify-center">
        <span className="text-3xl">📝</span>
      </div>
      <div className="text-center">
        <h2 className="text-xl font-bold text-gray-900">Email Templates</h2>
        <p className="text-sm text-gray-500 mt-2 max-w-md">
          Save and reuse your best-performing email templates across campaigns.
          Templates are saved automatically when you generate emails in the Email Writer.
        </p>
      </div>
    </div>
  );
}
