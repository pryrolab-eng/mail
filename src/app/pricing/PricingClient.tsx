"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Zap, ArrowRight, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import type { PricingPlan } from "@/lib/plans";

interface PricingClientProps {
  plans: PricingPlan[];
  currentPlan: string;
  isLoggedIn: boolean;
  billingStatus?: string;
}

export default function PricingClient({
  plans,
  currentPlan,
  isLoggedIn,
  billingStatus,
}: PricingClientProps) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);

  const handleUpgrade = async (plan: PricingPlan) => {
    if (!isLoggedIn) {
      router.push("/sign-up");
      return;
    }

    if (plan.id === "free") {
      toast.info("You're already on the free plan.");
      return;
    }

    if (plan.id === currentPlan) {
      // Open billing portal to manage existing subscription
      setLoading("portal");
      try {
        const res = await fetch("/api/stripe/portal", { method: "POST" });
        const data = await res.json();
        if (data.url) {
          window.location.href = data.url;
        } else {
          toast.error(data.error ?? "Could not open billing portal");
        }
      } finally {
        setLoading(null);
      }
      return;
    }

    if (!plan.priceId) {
      toast.error("This plan is not yet available. Contact support.");
      return;
    }

    setLoading(plan.id);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priceId: plan.priceId, plan: plan.id }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        toast.error(data.error ?? "Could not start checkout");
      }
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Nav */}
      <nav className="border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
            <Zap size={16} className="text-white" />
          </div>
          <span className="font-bold text-gray-900">OUTREACH</span>
        </Link>
        <div className="flex items-center gap-3">
          {isLoggedIn ? (
            <Link
              href="/dashboard"
              className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors"
            >
              Dashboard
            </Link>
          ) : (
            <>
              <Link href="/sign-in" className="text-sm text-gray-600 hover:text-gray-900">
                Sign in
              </Link>
              <Link
                href="/sign-up"
                className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors"
              >
                Get started
              </Link>
            </>
          )}
        </div>
      </nav>

      {/* Banner for billing status */}
      {billingStatus === "success" && (
        <div className="bg-green-50 border-b border-green-200 px-6 py-3 flex items-center justify-center gap-2">
          <Check size={16} className="text-green-600" />
          <span className="text-sm text-green-800 font-medium">
            Subscription activated! Your plan is now live.
          </span>
          <Link href="/dashboard" className="text-sm text-green-700 underline ml-2">
            Go to dashboard →
          </Link>
        </div>
      )}
      {billingStatus === "cancelled" && (
        <div className="bg-yellow-50 border-b border-yellow-200 px-6 py-3 flex items-center justify-center gap-2">
          <X size={16} className="text-yellow-600" />
          <span className="text-sm text-yellow-800">Checkout cancelled. No charge was made.</span>
        </div>
      )}

      {/* Hero */}
      <div className="text-center pt-16 pb-12 px-4">
        <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-4">
          Simple, transparent pricing
        </h1>
        <p className="text-lg text-gray-600 max-w-xl mx-auto">
          Start free. Scale as you grow. No hidden fees, no surprises.
        </p>
      </div>

      {/* Plans grid */}
      <div className="max-w-6xl mx-auto px-4 pb-24 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {plans.map((plan) => {
          const isCurrent = plan.id === currentPlan;
          const isHighlighted = plan.highlight;

          return (
            <div
              key={plan.id}
              className={`relative rounded-2xl border p-6 flex flex-col ${
                isHighlighted
                  ? "border-blue-500 shadow-lg shadow-blue-100"
                  : "border-gray-200"
              }`}
            >
              {isHighlighted && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="bg-blue-600 text-white text-xs font-bold px-3 py-1 rounded-full">
                    MOST POPULAR
                  </span>
                </div>
              )}

              {isCurrent && (
                <div className="absolute -top-3 right-4">
                  <span className="bg-green-500 text-white text-xs font-bold px-3 py-1 rounded-full">
                    CURRENT PLAN
                  </span>
                </div>
              )}

              {/* Plan header */}
              <div className="mb-6">
                <h2 className="text-lg font-bold text-gray-900 mb-1">{plan.name}</h2>
                <p className="text-sm text-gray-500 mb-4">{plan.description}</p>
                <div className="flex items-end gap-1">
                  <span className="text-4xl font-bold text-gray-900">${plan.price}</span>
                  {plan.price > 0 && (
                    <span className="text-gray-500 mb-1">/month</span>
                  )}
                  {plan.price === 0 && (
                    <span className="text-gray-500 mb-1">forever</span>
                  )}
                </div>
              </div>

              {/* Features */}
              <ul className="space-y-3 flex-1 mb-6">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2">
                    <Check size={16} className="text-green-500 mt-0.5 flex-shrink-0" />
                    <span className="text-sm text-gray-700">{feature}</span>
                  </li>
                ))}
              </ul>

              {/* CTA */}
              <button
                onClick={() => handleUpgrade(plan)}
                disabled={loading !== null}
                className={`w-full py-3 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed ${
                  isHighlighted
                    ? "bg-blue-600 text-white hover:bg-blue-700"
                    : isCurrent
                    ? "bg-gray-100 text-gray-700 hover:bg-gray-200"
                    : "border border-gray-300 text-gray-700 hover:bg-gray-50"
                }`}
              >
                {loading === plan.id || (loading === "portal" && isCurrent) ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : null}
                {isCurrent
                  ? "Manage subscription"
                  : plan.id === "free"
                  ? isLoggedIn
                    ? "Current plan"
                    : "Get started free"
                  : isLoggedIn
                  ? `Upgrade to ${plan.name}`
                  : "Get started"}
                {!isCurrent && plan.id !== "free" && loading !== plan.id && (
                  <ArrowRight size={14} />
                )}
              </button>
            </div>
          );
        })}
      </div>

      {/* FAQ */}
      <div className="max-w-2xl mx-auto px-4 pb-24">
        <h2 className="text-2xl font-bold text-gray-900 text-center mb-8">
          Frequently asked questions
        </h2>
        <div className="space-y-6">
          {[
            {
              q: "Can I cancel anytime?",
              a: "Yes. Cancel from your billing portal at any time. You keep access until the end of your billing period.",
            },
            {
              q: "What happens when I hit my email limit?",
              a: "Emails are queued and you'll be notified. Upgrade your plan or wait for the next billing cycle.",
            },
            {
              q: "Do you store my SMTP passwords?",
              a: "SMTP credentials are stored encrypted in our database and never exposed to other users.",
            },
            {
              q: "Can I switch plans?",
              a: "Yes. Upgrades take effect immediately. Downgrades take effect at the end of your billing period.",
            },
          ].map(({ q, a }) => (
            <div key={q} className="border-b border-gray-200 pb-6">
              <h3 className="font-semibold text-gray-900 mb-2">{q}</h3>
              <p className="text-sm text-gray-600">{a}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
