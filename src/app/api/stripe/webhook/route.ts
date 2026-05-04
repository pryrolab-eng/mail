/**
 * POST /api/stripe/webhook
 *
 * Receives Stripe webhook events and keeps the subscriptions table
 * in sync with Stripe's state.
 *
 * Events handled:
 *  - checkout.session.completed       → activate subscription
 *  - customer.subscription.updated    → update plan / status
 *  - customer.subscription.deleted    → downgrade to free
 *  - invoice.payment_failed           → mark past_due
 */
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createServiceClient } from "../../../../../supabase/service";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-04-30.basil",
});

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

// Next.js 13+ App Router: disable body parsing so we can read raw bytes
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = await request.text();
  const sig = request.headers.get("stripe-signature");

  if (!sig) {
    return NextResponse.json({ error: "Missing stripe-signature header" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err) {
    console.error("[webhook] signature verification failed:", err);
    return NextResponse.json(
      { error: `Webhook signature verification failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 400 }
    );
  }

  const service = createServiceClient();

  try {
    switch (event.type) {
      // ── Checkout completed → subscription is now active ──────────────────
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode !== "subscription") break;

        const userId = session.metadata?.supabase_user_id;
        const plan = session.metadata?.plan ?? "starter";
        const subscriptionId = session.subscription as string;

        if (!userId) {
          console.error("[webhook] checkout.session.completed: missing supabase_user_id");
          break;
        }

        // Fetch full subscription from Stripe to get period dates
        const stripeSub = await stripe.subscriptions.retrieve(subscriptionId);

        await service.from("subscriptions").upsert(
          {
            user_id: userId,
            stripe_customer_id: session.customer as string,
            stripe_subscription_id: subscriptionId,
            plan,
            status: stripeSub.status,
            current_period_start: new Date(stripeSub.current_period_start * 1000).toISOString(),
            current_period_end: new Date(stripeSub.current_period_end * 1000).toISOString(),
            cancel_at_period_end: stripeSub.cancel_at_period_end,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" }
        );

        console.log(`[webhook] activated ${plan} for user ${userId}`);
        break;
      }

      // ── Subscription updated (upgrade, downgrade, renewal) ───────────────
      case "customer.subscription.updated": {
        const stripeSub = event.data.object as Stripe.Subscription;
        const userId = stripeSub.metadata?.supabase_user_id;

        if (!userId) {
          // Try to look up by stripe_subscription_id
          const { data: existing } = await service
            .from("subscriptions")
            .select("user_id")
            .eq("stripe_subscription_id", stripeSub.id)
            .single();

          if (!existing) {
            console.warn("[webhook] subscription.updated: cannot find user for", stripeSub.id);
            break;
          }
        }

        // Determine plan from price metadata or product name
        const priceId = stripeSub.items.data[0]?.price?.id;
        const plan = resolvePlanFromPriceId(priceId);

        const updateTarget = userId
          ? service.from("subscriptions").update({
              plan,
              status: stripeSub.status,
              current_period_start: new Date(stripeSub.current_period_start * 1000).toISOString(),
              current_period_end: new Date(stripeSub.current_period_end * 1000).toISOString(),
              cancel_at_period_end: stripeSub.cancel_at_period_end,
              updated_at: new Date().toISOString(),
            }).eq("user_id", userId)
          : service.from("subscriptions").update({
              plan,
              status: stripeSub.status,
              current_period_start: new Date(stripeSub.current_period_start * 1000).toISOString(),
              current_period_end: new Date(stripeSub.current_period_end * 1000).toISOString(),
              cancel_at_period_end: stripeSub.cancel_at_period_end,
              updated_at: new Date().toISOString(),
            }).eq("stripe_subscription_id", stripeSub.id);

        await updateTarget;
        console.log(`[webhook] updated subscription ${stripeSub.id} → ${plan} (${stripeSub.status})`);
        break;
      }

      // ── Subscription deleted / cancelled ─────────────────────────────────
      case "customer.subscription.deleted": {
        const stripeSub = event.data.object as Stripe.Subscription;

        await service
          .from("subscriptions")
          .update({
            plan: "free",
            status: "canceled",
            stripe_subscription_id: null,
            cancel_at_period_end: false,
            updated_at: new Date().toISOString(),
          })
          .eq("stripe_subscription_id", stripeSub.id);

        console.log(`[webhook] subscription ${stripeSub.id} cancelled → downgraded to free`);
        break;
      }

      // ── Payment failed ────────────────────────────────────────────────────
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const subscriptionId = (invoice as any).subscription as string | null;

        if (subscriptionId) {
          await service
            .from("subscriptions")
            .update({ status: "past_due", updated_at: new Date().toISOString() })
            .eq("stripe_subscription_id", subscriptionId);

          console.log(`[webhook] payment failed for subscription ${subscriptionId}`);
        }
        break;
      }

      default:
        // Ignore unhandled events
        break;
    }
  } catch (err) {
    console.error(`[webhook] error handling ${event.type}:`, err);
    // Return 200 so Stripe doesn't retry — we log the error
  }

  return NextResponse.json({ received: true });
}

/** Map Stripe price IDs to plan names using env vars */
function resolvePlanFromPriceId(priceId: string | undefined): string {
  if (!priceId) return "starter";
  if (priceId === process.env.STRIPE_STARTER_PRICE_ID) return "starter";
  if (priceId === process.env.STRIPE_PRO_PRICE_ID) return "pro";
  if (priceId === process.env.STRIPE_AGENCY_PRICE_ID) return "agency";
  return "starter"; // safe default for unknown price
}
