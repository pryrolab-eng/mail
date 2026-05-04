/**
 * Plan definitions — single source of truth for feature limits.
 * Used by API routes, UI gating, and the pricing page.
 */

export type Plan = "free" | "starter" | "pro" | "agency";

export interface PlanLimits {
  leads: number;           // max leads in CRM
  emailsPerMonth: number;  // max emails sent per month
  smtpAccounts: number;    // max SMTP accounts
  aiProviders: number;     // max AI providers
  inboxMonitoring: boolean;
  followUpSequences: boolean;
  bulkEmail: boolean;
  apiAccess: boolean;
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: {
    leads: 50,
    emailsPerMonth: 100,
    smtpAccounts: 1,
    aiProviders: 1,
    inboxMonitoring: false,
    followUpSequences: false,
    bulkEmail: false,
    apiAccess: false,
  },
  starter: {
    leads: 500,
    emailsPerMonth: 1_000,
    smtpAccounts: 3,
    aiProviders: 2,
    inboxMonitoring: true,
    followUpSequences: true,
    bulkEmail: true,
    apiAccess: false,
  },
  pro: {
    leads: 5_000,
    emailsPerMonth: 10_000,
    smtpAccounts: 10,
    aiProviders: 3,
    inboxMonitoring: true,
    followUpSequences: true,
    bulkEmail: true,
    apiAccess: true,
  },
  agency: {
    leads: 999_999,
    emailsPerMonth: 999_999,
    smtpAccounts: 60,
    aiProviders: 3,
    inboxMonitoring: true,
    followUpSequences: true,
    bulkEmail: true,
    apiAccess: true,
  },
};

export interface PricingPlan {
  id: Plan;
  name: string;
  price: number;        // USD per month
  priceId: string;      // Stripe Price ID (set in env)
  description: string;
  highlight?: boolean;
  features: string[];
}

export const PRICING_PLANS: PricingPlan[] = [
  {
    id: "free",
    name: "Free",
    price: 0,
    priceId: "",
    description: "Try the platform with no commitment.",
    features: [
      "50 leads",
      "100 emails / month",
      "1 SMTP account",
      "1 AI provider",
      "Basic CRM",
    ],
  },
  {
    id: "starter",
    name: "Starter",
    price: 29,
    priceId: process.env.NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID ?? "",
    description: "For solo operators getting started with outreach.",
    features: [
      "500 leads",
      "1,000 emails / month",
      "3 SMTP accounts",
      "2 AI providers",
      "Inbox monitoring",
      "Follow-up sequences",
      "Bulk email",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    price: 79,
    priceId: process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID ?? "",
    description: "For teams running serious outreach campaigns.",
    highlight: true,
    features: [
      "5,000 leads",
      "10,000 emails / month",
      "10 SMTP accounts",
      "All 3 AI providers",
      "Inbox monitoring",
      "Follow-up sequences",
      "Bulk email",
      "API access",
    ],
  },
  {
    id: "agency",
    name: "Agency",
    price: 199,
    priceId: process.env.NEXT_PUBLIC_STRIPE_AGENCY_PRICE_ID ?? "",
    description: "Unlimited scale for agencies managing multiple clients.",
    features: [
      "Unlimited leads",
      "Unlimited emails",
      "60 SMTP accounts",
      "All 3 AI providers",
      "Inbox monitoring",
      "Follow-up sequences",
      "Bulk email",
      "API access",
      "Priority support",
    ],
  },
];

/** Returns the plan limits for a given plan string (safe fallback to free) */
export function getLimits(plan: string): PlanLimits {
  return PLAN_LIMITS[(plan as Plan) ?? "free"] ?? PLAN_LIMITS.free;
}

/** Returns true if the plan has access to a specific feature */
export function canAccess(plan: string, feature: keyof PlanLimits): boolean {
  const limits = getLimits(plan);
  const val = limits[feature];
  if (typeof val === "boolean") return val;
  if (typeof val === "number") return val > 0;
  return false;
}
