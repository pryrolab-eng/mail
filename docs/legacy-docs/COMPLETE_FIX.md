## Complete Fix for AI Provider Issue

### The Problem
1. The `ai_providers` table exists in Supabase
2. An AI provider record exists for user `91416b57-9f98-4612-b88a-8ac157f31a73`
3. But the app shows "schema cache" error and can't find the table

### Root Cause
The Supabase client in your app can't see the `ai_providers` table because it wasn't properly registered in the schema.

### Solution

#### Step 1: Clear Next.js Cache (DONE ✅)
The .next folder has been cleared.

#### Step 2: Restart Your Dev Server
```bash
# Stop the current server (Ctrl+C)
# Then restart:
npm run dev
# or
bun dev
```

#### Step 3: Verify the AI Provider Exists
Run this in Supabase SQL Editor:
```sql
SELECT * FROM public.ai_providers 
WHERE user_id = '91416b57-9f98-4612-b88a-8ac157f31a73'::uuid;
```

If you see a result, the AI provider exists. ✅

#### Step 4: Log Out and Log Back In
1. In your app, click Logout
2. Log back in with pryrolab@gmail.com
3. Visit http://localhost:3000/debug-ai
4. You should see user ID: `91416b57-9f98-4612-b88a-8ac157f31a73`
5. You should see AI Provider: groq

#### Step 5: Test Email Generation
Try generating an email. It should work now!

### If It Still Doesn't Work

The "schema cache" error means Supabase client can't see the table. This happens when:
- The table was created manually (not via migrations)
- The Supabase project needs a schema refresh

**Nuclear Option:**
Run this in Supabase SQL Editor to force a schema refresh:
```sql
NOTIFY pgrst, 'reload schema';
```

Then restart your dev server again.

### Alternative: Use Service Role Key (Temporary)

If nothing else works, temporarily bypass RLS by using the service role key in your AI generator:

Edit `src/utils/ai-email-generator.ts` and change:
```typescript
const supabase = createClient();
```

To:
```typescript
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
const supabase = createSupabaseClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY! // Use service role key
);
```

This bypasses RLS and will work immediately (but is less secure for production).
