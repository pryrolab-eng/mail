"use client";

import { ActiveModule } from "@/types/platform";
import { Radio, Mail, Settings, Layout, Zap, Server, Send } from "lucide-react";
import Image from "next/image";

interface SidebarProps {
  activeModule: ActiveModule;
  onModuleChange: (module: ActiveModule) => void;
}

const navItems = [
  { id: "scraper" as ActiveModule, label: "Scraper", icon: Radio },
  { id: "email-writer" as ActiveModule, label: "Email Writer", icon: Mail },
  { id: "crm" as ActiveModule, label: "CRM", icon: Layout },
  { id: "follow-up" as ActiveModule, label: "Follow-Up", icon: Send },
  { id: "smtp-manager" as ActiveModule, label: "SMTP Manager", icon: Server },
  { id: "ai-settings" as ActiveModule, label: "AI Settings", icon: Settings },
];

export default function PlatformSidebar({ activeModule, onModuleChange }: SidebarProps) {
  return (
    <aside
      className="w-[200px] flex-shrink-0 flex flex-col bg-white border-r border-gray-200 h-full"
    >
      {/* Logo */}
      <div className="flex items-end gap-3 px-4 py-5 border-b border-gray-200">
        <span className="font-bold text-3xl" style={{ color: "#007FDE", fontFamily: "Arial, sans-serif" }}>
          pryro
        </span>
        <span className="font-semibold text-sm text-gray-700 pb-1">
          mail
        </span>
      </div>

      {/* Nav Items */}
      <nav className="flex flex-col gap-1 p-2 flex-1 mt-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeModule === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onModuleChange(item.id)}
              className={`
                flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors duration-200 w-full text-left
                ${isActive
                  ? "text-white bg-blue-600"
                  : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
                }
              `}
            >
              <Icon size={18} className="flex-shrink-0" />
              <span className="text-sm font-medium">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Bottom status */}
      <div className="p-3 border-t border-gray-200">
        <div className="flex items-center gap-2 px-2 py-1.5">
          <div className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
          <span className="text-xs text-gray-500">CONNECTED</span>
        </div>
      </div>
    </aside>
  );
}
