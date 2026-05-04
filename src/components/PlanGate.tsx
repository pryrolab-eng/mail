"use client";

import Link from "next/link";
import { Lock, ArrowRight } from "lucide-react";
import type { PlanLimits } from "@/lib/plans";

interface PlanGateProps {
  /** The feature key to check */
  feature: keyof PlanLimits;
  /** Whether the user has access (pass canAccess(feature) from useSubscription) */
  hasAccess: boolean;
  /** What to show when access is granted */
  children: React.ReactNode;
  /** Optional custom message */
  message?: string;
  /** Required plan name for the upgrade prompt */
  requiredPlan?: string;
}

/**
 * Wraps a feature and shows an upgrade prompt if the user's plan
 * doesn't include it.
 */
export default function PlanGate({
  hasAccess,
  children,
  message,
  requiredPlan = "Starter",
}: PlanGateProps) {
  if (hasAccess) return <>{children}</>;

  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[300px] p-8 text-center">
      <div className="w-14 h-14 rounded-2xl bg-blue-50 border border-blue-200 flex items-center justify-center mb-4">
        <Lock size={24} className="text-blue-500" />
      </div>
      <h3 className="text-lg font-bold text-gray-900 mb-2">
        {requiredPlan} plan required
      </h3>
      <p className="text-sm text-gray-500 max-w-xs mb-6">
        {message ??
          `This feature is available on the ${requiredPlan} plan and above. Upgrade to unlock it.`}
      </p>
      <Link
        href="/pricing"
        className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors"
      >
        View plans
        <ArrowRight size={14} />
      </Link>
    </div>
  );
}
