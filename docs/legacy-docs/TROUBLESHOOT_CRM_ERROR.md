# Troubleshooting "Failed to add to CRM" Error

## Quick Fix

Run this in Supabase SQL Editor:

```sql
-- Check what columns exist
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'leads' 
ORDER BY ordinal_position;
```

Then run the fix script: **`FIX_LEADS_TABLE.sql`**

---

## Common Causes

### 1. Missing Columns
The migrations added `category`, `source`, and `tags` columns, but they might not exist.

**Solution:** Run `FIX_LEADS_TABLE.sql`

### 2. Duplicate Column Definitions
Multiple migrations tried to add the same columns.

**Solution:** The fix script handles this with `IF NOT EXISTS`

### 3. Wrong Data Type
Tags should be `TEXT[]` (array), not `TEXT`.

**Solution:** Run `FIX_LEADS_TABLE.sql` to ensure correct types

### 4. RLS (Row Level Security) Policy
Your user might not have permission to insert.

**Check:**
```sql
SELECT * FROM pg_policies WHERE tablename = 'leads';
```

**Fix:**
```sql
-- Allow users to insert their own leads
CREATE POLICY "Users can insert own leads" ON public.leads
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);
```

---

## Step-by-Step Debugging

### Step 1: Check Browser Console
1. Open browser DevTools (F12)
2. Go to Console tab
3. Try adding to CRM again
4. Look for the actual error message

### Step 2: Check Supabase Logs
1. Go to Supabase Dashboard
2. Click "Logs" in sidebar
3. Look for recent errors
4. Note the error message

### Step 3: Test Direct Insert
Run this in Supabase SQL Editor (replace YOUR_USER_ID):

```sql
-- Get your user ID first
SELECT id FROM auth.users LIMIT 1;

-- Try inserting a test lead
INSERT INTO public.leads (
  user_id,
  company_name,
  email,
  niche,
  location,
  company_context,
  status,
  category,
  source,
  tags
) VALUES (
  'YOUR_USER_ID_HERE',
  'Test Company',
  'test@example.com',
  'Test Niche',
  'Test Location',
  'Test context',
  'New',
  'Test Category',
  'scraper',
  ARRAY['tag1', 'tag2']
);

-- If successful, clean up
DELETE FROM public.leads WHERE email = 'test@example.com';
```

If this fails, you'll see the exact error!

---

## Solutions by Error Message

### "column does not exist"
**Error:** `column "category" of relation "leads" does not exist`

**Solution:** Run `FIX_LEADS_TABLE.sql`

### "null value in column violates not-null constraint"
**Error:** `null value in column "X" violates not-null constraint`

**Solution:** Check which column is required and update the insert:
```typescript
// In ScraperModule.tsx, make sure all required fields have values
category: finalCategory || null,  // Allow null
tags: tags.length > 0 ? tags : null,  // Allow null
```

### "permission denied"
**Error:** `permission denied for table leads`

**Solution:** Check RLS policies:
```sql
-- View current policies
SELECT * FROM pg_policies WHERE tablename = 'leads';

-- Add insert policy if missing
CREATE POLICY "Users can insert own leads" ON public.leads
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);
```

### "duplicate key value"
**Error:** `duplicate key value violates unique constraint`

**Solution:** The email might already exist. Check:
```sql
SELECT * FROM leads WHERE email = 'the-email@example.com';
```

---

## After Fixing

1. **Refresh the page** (Ctrl+R or Cmd+R)
2. **Try scraping again**
3. **Click "Add to CRM"**
4. **Check browser console** for any new errors

---

## Still Not Working?

### Get Detailed Error Info

I've updated the ScraperModule to show the actual error message. Now when you click "Add to CRM", you should see a more specific error message in the toast notification.

### Check These:

1. ✅ All migrations ran successfully
2. ✅ `leads` table has `category`, `source`, `tags` columns
3. ✅ RLS policies allow insert
4. ✅ User is authenticated
5. ✅ Browser console shows detailed error

### Share This Info:

If still stuck, share:
- The exact error message from browser console
- The error from Supabase logs
- Result of the column check query
- Result of the test insert query

---

## Prevention

To avoid this in the future:

1. **Run migrations in order** (by date in filename)
2. **Check for conflicts** before running new migrations
3. **Use `IF NOT EXISTS`** when adding columns
4. **Test inserts** after schema changes
5. **Check browser console** for detailed errors
