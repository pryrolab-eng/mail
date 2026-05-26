-- Allow authenticated owners to create/read/update their own agent artifacts.
-- Service role still bypasses RLS for local worker/API automation.

DROP POLICY IF EXISTS "Users view own agent runs" ON public.agent_runs;
DROP POLICY IF EXISTS "Users manage own agent runs" ON public.agent_runs;
CREATE POLICY "Users manage own agent runs"
  ON public.agent_runs FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users view own lead evidence" ON public.lead_evidence;
DROP POLICY IF EXISTS "Users manage own lead evidence" ON public.lead_evidence;
CREATE POLICY "Users manage own lead evidence"
  ON public.lead_evidence FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users view own contact points" ON public.contact_points;
DROP POLICY IF EXISTS "Users manage own contact points" ON public.contact_points;
CREATE POLICY "Users manage own contact points"
  ON public.contact_points FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
