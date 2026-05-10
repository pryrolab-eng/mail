"use client";

import { ActiveModule } from "@/types/platform";
import { Radio, Mail, Settings, Layout, Server, Send, BarChart2, Megaphone, FileText } from "lucide-react";

interface SidebarProps {
  activeModule: ActiveModule;
  onModuleChange: (module: ActiveModule) => void;
}

const navGroups = [
  {
    label: "Outreach",
    items: [
      { id: "scraper" as ActiveModule,       label: "Scraper",      icon: Radio,        badge: null },
      { id: "email-writer" as ActiveModule,  label: "Email Writer", icon: Mail,         badge: null },
      { id: "campaigns" as ActiveModule,     label: "Campaigns",    icon: Megaphone,    badge: null },
      { id: "follow-up" as ActiveModule,     label: "Follow-Up",    icon: Send,         badge: null },
    ],
  },
  {
    label: "Management",
    items: [
      { id: "crm" as ActiveModule,           label: "CRM",          icon: Layout,       badge: null },
      { id: "analytics" as ActiveModule,     label: "Analytics",    icon: BarChart2,    badge: null },
      { id: "templates" as ActiveModule,    label: "Templates",    icon: FileText,     badge: null },
    ],
  },
  {
    label: "Settings",
    items: [
      { id: "smtp-manager" as ActiveModule,  label: "SMTP Manager", icon: Server,       badge: null },
      { id: "ai-settings" as ActiveModule,   label: "AI Settings",  icon: Settings,     badge: null },
    ],
  },
];

export default function PlatformSidebar({ activeModule, onModuleChange }: SidebarProps) {
  return (
    <aside className="w-[200px] flex-shrink-0 flex flex-col bg-white border-r border-gray-200 h-full">
      {/* Logo */}
      <div className="flex items-end gap-2 px-4 py-5 border-b border-gray-200">
        <span className="font-black text-2xl tracking-tight" style={{ color: "#2563EB" }}>
          pryro
        </span>
        <span className="text-xs font-semibold text-gray-400 pb-0.5 tracking-widest uppercase">
          mail
        </span>
      </div>

      {/* Nav Groups */}
      <nav className="flex flex-col gap-4 p-3 flex-1 mt-1 overflow-y-auto">
        {navGroups.map(group => (
          <div key={group.label}>
            <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400 px-2 mb-1.5">
              {group.label}
            </p>
            <div className="flex flex-col gap-0.5">
              {group.items.map(item => {
                const Icon = item.icon;
                const isActive = activeModule === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => onModuleChange(item.id)}
                    className={`
                      flex items-center gap-2.5 px-3 py-2 rounded-lg transition-all duration-150 w-full text-left
                      ${isActive
                        ? "text-white bg-blue-600 shadow-sm"
                        : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
                      }
                    `}
                  >
                    <Icon size={15} className="flex-shrink-0" />
                    <span className="text-[13px] font-medium">{item.label}</span>
                    {item.badge && (
                      <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded-full bg-red-500 text-white font-bold">
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom status */}
      <div className="p-3 border-t border-gray-200">
        <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-green-50">
          <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse flex-shrink-0" />
          <span className="text-[10px] font-medium text-green-700">All systems live</span>
        </div>
      </div>
    </aside>
  );
}
