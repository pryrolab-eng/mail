import { redirect } from "next/navigation";
import { createClient } from "../../../supabase/server";
import { createServiceClient } from "../../../supabase/service";
import { PRICING_PLANS } from "@/lib/plans";
import PricingClient from "./PricingClient";

export const metadata = {
  title: "Pricing — OUTREACH",
  description: "Simple, transparent pricing for every stage of your outreach.",
};

export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<{ billing?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  let currentPlan = "free";
  if (user) {
    const service = createServiceClient();
    const { data: sub } = await service
      .from("subscriptions")
      .select("plan, status")
      .eq("user_id", user.id)
      .single();
    if (sub?.status === "active" || sub?.status === "trialing") {
      currentPlan = sub.plan;
    }
  }

  return (
    <PricingClient
      plans={PRICING_PLANS}
      currentPlan={currentPlan}
      isLoggedIn={!!user}
      billingStatus={params.billing}
    />
  );
}
