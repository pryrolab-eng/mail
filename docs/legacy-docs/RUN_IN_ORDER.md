# Fix Test Email - Run in This Order!

## ⚠️ IMPORTANT: Run these in ORDER!

### Step 1: Create the Table FIRST
Open `CREATE_SMTP_TABLE_NOW.sql` in Supabase SQL Editor and run it.

This creates the `smtp_accounts` table.

**Wait for success message before continuing!**

---

### Step 2: Get Your User ID
Run this query in Supabase SQL Editor:

```sql
SELECT id, email, created_at 
FROM auth.users 
ORDER BY created_at DESC 
LIMIT 5;
```

**Copy the `id` value** (the long UUID string)

---

### Step 3: Add Your SMTP Account
1. Open `ADD_SMTP_ACCOUNT_NOW.sql`
2. Replace `'YOUR-USER-ID-HERE'` with the ID you copied in Step 2
3. Replace `'your-email@gmail.com'` with your actual Gmail
4. Replace `'your-app-password-here'` with your Gmail App Password
5. Run the INSERT statement

---

### Step 4: Verify
Run this to check:

```sql
SELECT * FROM smtp_accounts;
```

You should see your SMTP account!

---

### Step 5: Test Email
1. Restart your Next.js dev server
2. Go to Email Writer
3. Generate emails
4. Click "Send Test"
5. It should work now!

---

## Gmail App Password

If you don't have a Gmail App Password yet:

1. Go to https://myaccount.google.com/security
2. Enable 2-Step Verification
3. Go to https://myaccount.google.com/apppasswords
4. Create app password for "Mail"
5. Copy the 16-character password (no spaces)
6. Use that in Step 3 above

**DO NOT use your regular Gmail password!**
