# Fix Groq API Error - Step by Step

## What I Just Fixed

Enhanced error logging in `src/utils/ai-email-generator.ts` to show:
- Actual error messages from Groq API
- Status codes with helpful hints
- API key validation
- Model name being used

## Follow These Steps to Fix

### Step 1: Check Browser Console
Open your browser's Developer Tools (F12) and look at the Console tab. You should now see detailed logs like:

```
=== GROQ API CALL ===
Model: llama-3.3-70b-versatile
API Key present: true
API Key length: 56
API Key prefix: gsk_abc123
====================
```

If you see an error, it will show:
```
=== GROQ API ERROR ===
Status: 401 (or 404, 429, etc.)
Error Text: [actual error message]
```

### Step 2: Common Error Codes & Solutions

#### 401 Unauthorized
**Problem:** Invalid or missing API key
**Solution:**
1. Go to https://console.groq.com/keys
2. Create a new API key (or copy existing one)
3. Run the SQL in `CHECK_AND_FIX_GROQ.sql` with your key

#### 404 Not Found
**Problem:** Invalid model name
**Solution:**
Use one of these valid models:
- `llama-3.3-70b-versatile` ✅ (RECOMMENDED)
- `llama-3.1-70b-versatile`
- `llama-3.1-8b-instant`
- `mixtral-8x7b-32768`

Update in Supabase:
```sql
UPDATE ai_settings 
SET active_model = 'llama-3.3-70b-versatile'
WHERE provider = 'groq';
```

#### 429 Too Many Requests
**Problem:** Rate limit exceeded
**Solution:**
- Wait 1-2 minutes
- Check your Groq console for rate limits
- Consider upgrading your Groq plan

#### Empty Error Object `{}`
**Problem:** Error not being captured properly (what you're seeing now)
**Solution:** The new logging will show the actual error. Refresh your app and try again.

### Step 3: Verify Your Setup

Run this SQL in Supabase to check your configuration:

```sql
-- Get your user ID
SELECT id, email FROM auth.users;

-- Check your Groq settings
SELECT 
  user_id,
  provider,
  active_model,
  is_active,
  LEFT(api_key, 10) || '...' as api_key_preview,
  LENGTH(api_key) as api_key_length
FROM ai_settings
WHERE provider = 'groq';
```

**What to look for:**
- ✅ `api_key_length` should be around 56 characters
- ✅ `api_key_preview` should start with `gsk_`
- ✅ `active_model` should be `llama-3.3-70b-versatile`
- ✅ `is_active` should be `true`

### Step 4: Fix Your Configuration

Open `CHECK_AND_FIX_GROQ.sql` and:

1. Replace `YOUR_USER_ID` with your actual user ID (from Step 3)
2. Replace `YOUR_GROQ_API_KEY` with your actual Groq API key
3. Run the SQL in Supabase

### Step 5: Test Again

1. Refresh your application
2. Try generating an email
3. Check the browser console for the new detailed logs
4. If it still fails, the console will now show the EXACT error message

### Step 6: Use the Debug Page

Visit: `http://localhost:3000/debug-ai`

This page will:
- Show your current configuration
- Let you test the Groq API directly
- Display detailed error messages

Click the **"Test Groq API"** button to verify everything works.

## Quick Fix Commands

### Get Your User ID
```sql
SELECT id, email FROM auth.users;
```

### Update API Key
```sql
UPDATE ai_settings 
SET api_key = 'gsk_YOUR_ACTUAL_KEY_HERE'
WHERE provider = 'groq';
```

### Update Model
```sql
UPDATE ai_settings 
SET active_model = 'llama-3.3-70b-versatile'
WHERE provider = 'groq';
```

### Create New Entry (if none exists)
```sql
INSERT INTO ai_settings (user_id, provider, api_key, active_model, is_active)
VALUES (
  'YOUR_USER_ID'::uuid,
  'groq',
  'gsk_YOUR_ACTUAL_KEY_HERE',
  'llama-3.3-70b-versatile',
  true
)
ON CONFLICT (user_id, provider) DO UPDATE
SET api_key = EXCLUDED.api_key, active_model = EXCLUDED.active_model, is_active = true;
```

## Still Not Working?

1. **Check Groq Console:** https://console.groq.com
   - Verify your API key is active
   - Check if you have credits/quota remaining
   - Look for any account issues

2. **Check Browser Console:** Look for the new detailed error logs
   - They will show the exact error message from Groq
   - Status codes will have helpful hints

3. **Try the Debug Page:** `/debug-ai`
   - Test the API directly
   - See detailed error information

4. **Verify API Key Format:**
   - Should start with `gsk_`
   - Should be about 56 characters long
   - No extra spaces or quotes

## Next Steps

After fixing, the error logs will show you exactly what's wrong. The enhanced logging will display:
- ✅ The actual error message from Groq
- ✅ Status codes with helpful hints
- ✅ API key validation info
- ✅ Model name being used

Try generating an email again and check the browser console!
