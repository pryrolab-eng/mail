"use client";

import { useEffect, useState } from "react";
import { createClient } from "../../supabase/client";
import { getLimits, type Plan, type PlanLimits } from "@/lib/plans";

interface Subscription {
  plan: Plan;
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
}

interface UseSubscriptionReturn {
  subscription: Subscription | null;
  limits: PlanLimits;
  loading: boolean;
  isPaid: boolean;
  canAccess: (feature: keyof PlanLimits) => boolean;
}

export function useSubscription(userId: string): UseSubscriptionReturn {
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    if (!userId) return;

    const fetchSub = async () => {
      const { data } = await supabase
        .from("subscriptions")
        .select("plan, status, current_period_end, cancel_at_period_end")
        .eq("user_id", userId)
        .single();

      setSubscription(data as Subscription | null);
      setLoading(false);
    };

    fetchSub();

    // Subscribe to realtime changes so the UI updates immediately after payment
    const channel = supabase
      .channel("subscription_changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "subscriptions",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          setSubscription(payload.new as Subscription);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  const plan = subscription?.plan ?? "free";
  const limits = getLimits(plan);
  const isPaid = plan !== "free" && subscription?.status === "active";

  const canAccess = (feature: keyof PlanLimits): boolean => {
    const val = limits[feature];
    if (typeof val === "boolean") return val;
    if (typeof val === "number") return val > 0;
    return false;
  };

  return { subscription, limits, loading, isPaid, canAccess };
}
