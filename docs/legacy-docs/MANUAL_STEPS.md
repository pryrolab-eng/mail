# Fix SMTP Accounts Table - Manual Steps

## The Problem
Your app is trying to access `public.smtp_accounts` table but it doesn't exist in your Supabase database.

## Solution - Follow These Exact Steps:

### Step 1: Open Supabase SQL Editor
1. Go to: https://supabase.com/dashboard/project/qjsnwefgzmmpsuzjfniu
2. Click **"SQL Editor"** in the left sidebar
3. Click **"New query"** button

### Step 2: Copy and Paste This SQL
Copy the ENTIRE content from `RUN_THIS_IN_SUPABASE.sql` file (it's already open in your editor)

### Step 3: Run the SQL
1. Paste the SQL into the editor
2. Click the **"Run"** button (or press Ctrl+Enter)
3. Wait for the success message (should take 2-5 seconds)

### Step 4: Reload Schema Cache
After running the SQL successfully:
1. Go to **Settings** > **API** in your Supabase dashboard
2. Scroll down to find **"Reload schema cache"** button
3. Click it and wait for confirmation

### Step 5: Verify It Worked
Run this command in your terminal:
```powershell
./test-smtp-table.ps1
```

You should see: ✅ SUCCESS! smtp_accounts table exists and is accessible

### Step 6: Restart Your Dev Server
```powershell
# Stop your current dev server (Ctrl+C)
# Then restart it
npm run dev
```

## Alternative: If SQL Editor Doesn't Work

If the SQL Editor gives you errors, try this:

1. Go to **Database** > **Tables** in Supabase dashboard
2. Click **"Create a new table"**
3. Use these settings:
   - Name: `smtp_accounts`
   - Enable RLS: ✅ Yes
   - Columns: (see RUN_THIS_IN_SUPABASE.sql for column definitions)

But the SQL Editor method is much easier and recommended.

## Common Issues

**"Permission denied"**: Make sure you're the owner of the Supabase project

**"Table already exists"**: Good! Just reload the schema cache (Step 4)

**"Syntax error"**: Make sure you copied the ENTIRE SQL file, including all the DROP statements at the beginning
