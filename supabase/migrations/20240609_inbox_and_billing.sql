-- ============================================================
-- Inbox monitoring RLS + Stripe subscriptions
-- ============================================================

-- ── RLS on email_inbox_config (was missing) ─────────────────
ALTER TABLE public.email_inbox_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own inbox configs"
  ON public.email_inbox_config FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own inbox configs"
  ON public.email_inbox_config FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own inbox configs"
  ON public.email_inbox_config FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own inbox configs"
  ON public.email_inbox_config FOR DELETE
  USING (auth.uid() = user_id);

-- updated_at trigger for inbox config
CREATE OR REPLACE FUNCTION update_inbox_config_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_inbox_config_updated_at ON public.email_inbox_config;
CREATE TRIGGER trigger_inbox_config_updated_at
  BEFORE UPDATE ON public.email_inbox_config
  FOR EACH ROW EXECUTE FUNCTION update_inbox_config_updated_at();

-- ── Stripe subscriptions table ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id   TEXT UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  plan                 TEXT NOT NULL DEFAULT 'free',   -- free | starter | pro | agency
  status               TEXT NOT NULL DEFAULT 'active', -- active | past_due | canceled | trialing
  current_period_start TIMESTAMPTZ,
  current_period_end   TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN DEFAULT false,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id
  ON public.subscriptions(user_id);

CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer
  ON public.subscriptions(stripe_customer_id);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own subscription"
  ON public.subscriptions FOR SELECT
  USING (auth.uid() = user_id);

-- Service role can do everything (used by webhook)
CREATE POLICY "Service role full access to subscriptions"
  ON public.subscriptions FOR ALL
  USING (true)
  WITH CHECK (true);

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_subscriptions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_subscriptions_updated_at ON public.subscriptions;
CREATE TRIGGER trigger_subscriptions_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_subscriptions_updated_at();

-- Realtime for subscription status changes
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'subscriptions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.subscriptions;
  END IF;
END $$;

-- ── Seed free plan for existing users ────────────────────────
INSERT INTO public.subscriptions (user_id, plan, status)
SELECT id, 'free', 'active'
FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

-- ── Function: auto-create free subscription on sign-up ───────
CREATE OR REPLACE FUNCTION handle_new_user_subscription()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.subscriptions (user_id, plan, status)
  VALUES (NEW.id, 'free', 'active')
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created_subscription ON auth.users;
CREATE TRIGGER on_auth_user_created_subscription
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user_subscription();
