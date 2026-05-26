"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { ActiveModule, Lead, ScrapedLead } from "@/types/platform";
import PlatformSidebar from "./PlatformSidebar";
import TopBar from "./TopBar";
import ScraperModule from "./ScraperModule";
import EmailWriterModule from "./EmailWriterModule";
import CRMModule from "./CRMModule";
import PipelineModule from "./PipelineModule";
import AISettingsModule from "./AISettingsModule";
import SMTPManager from "./SMTPManager";
import FollowUpModule from "./FollowUpModule";
import CampaignsModule from "./CampaignsModule";
import SkillsModule from "./SkillsModule";
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
  const [pipelineRefreshKey, setPipelineRefreshKey] = useState(0);
  const [pipelineActionCount, setPipelineActionCount] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  const fetchPipelineActionCount = useCallback(async () => {
    const { count, error } = await supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .in("pipeline_stage", [
        "scraped",
        "verified",
        "enriched",
        "researched",
        "email_drafted",
        "approval_pending",
        "approved",
        "queued",
      ]);

    if (!error && count != null) {
      setPipelineActionCount(count);
    }
  }, [userId, supabase]);

  useEffect(() => {
    fetchPipelineActionCount();
  }, [fetchPipelineActionCount, pipelineRefreshKey]);

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
        niche: lead.niche ?? null,
        location: lead.location,
        company_context: lead.company_context ?? null,
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

  const handleLeadsAdded = (addedCount?: number) => {
    setCrmRefreshKey((k) => k + 1);
    setPipelineRefreshKey((k) => k + 1);
    fetchPipelineActionCount();

    if (addedCount != null && addedCount > 0) {
      toast.success(
        `${addedCount} lead${addedCount === 1 ? "" : "s"} saved — open Pipeline to continue`,
        {
          action: {
            label: "Open Pipeline",
            onClick: () => handleModuleChange("pipeline"),
          },
        }
      );
    }
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
        <PlatformSidebar
          activeModule={activeModule}
          onModuleChange={handleModuleChange}
          pipelineActionCount={pipelineActionCount}
        />
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
              onOpenAiSettings={() => setActiveModule("ai-settings")}
            />
          </div>

          <div className={activeModule === "pipeline" ? "block h-full" : "hidden"}>
            <PipelineModule
              key={pipelineRefreshKey}
              userId={userId}
              onPipelineChange={() => {
                fetchPipelineActionCount();
                setCrmRefreshKey((k) => k + 1);
              }}
            />
          </div>

          <div className={activeModule === "crm" ? "block h-full" : "hidden"}>
            <CRMModule
              key={crmRefreshKey}
              userId={userId}
              onWriteEmail={handleWriteEmailFromCRM}
            />
          </div>

          <LazyModule active={activeModule === "skills"}>
            <SkillsModule />
          </LazyModule>

          {/* Lazy-mounted modules */}
          <LazyModule active={activeModule === "email-writer"}>
            <EmailWriterModule
              key={preloadedLead?.id || "email-writer"}
              userId={userId}
              preloadedLead={preloadedLead}
            />
          </LazyModule>

          <div className={activeModule === "ai-settings" ? "block h-full" : "hidden"}>
            <AISettingsModule userId={userId} />
          </div>

          <LazyModule active={activeModule === "smtp-manager"}>
            <SMTPManager userId={userId} />
          </LazyModule>

          <LazyModule active={activeModule === "follow-up"}>
            <FollowUpModule userId={userId} />
          </LazyModule>

          <LazyModule active={activeModule === "campaigns"}>
            <CampaignsModule userId={userId} />
          </LazyModule>
        </main>
      </div>
    </div>
  );
}
