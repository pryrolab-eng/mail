# Groq API Error Troubleshooting Guide

## What I Fixed

1. **Enhanced error logging** in `src/utils/ai-email-generator.ts`
   - Now captures full error details from Groq API
   - Logs API key presence and length (for debugging)
   - Parses JSON error responses properly
   - Shows detailed error information in console

2. **Updated debug page** at `/debug-ai`
   - Fixed table name from `ai_providers` to `ai_settings`
   - Added "Test Groq API" button to verify API key
   - Shows detailed error messages if API call fails
   - Provides correct SQL to set up AI provider

## How to Diagnose the Issue

### Step 1: Visit the Debug Page
Navigate to: `http://localhost:3000/debug-ai`

This page will show:
- Your current user ID
- Your AI provider configuration
- Whether API key is present

### Step 2: Test the API
Click the **"Test Groq API"** button on the debug page.

This will:
- Fetch your AI provider settings
- Make a real API call to Groq
- Show you the exact error if it fails

### Step 3: Check Common Issues

#### Issue 1: Invalid API Key
**Symptoms:** 401 Unauthorized error
**Solution:** 
1. Get a new API key from https://console.groq.com/keys
2. Update in Supabase:
```sql
UPDATE ai_settings 
SET api_key = 'YOUR_NEW_GROQ_API_KEY'
WHERE user_id = 'YOUR_USER_ID';
```

#### Issue 2: Invalid Model Name
**Symptoms:** 404 Not Found or model not available error
**Solution:**
Valid Groq models (as of 2024):
- `llama-3.3-70b-versatile` (recommended)
- `llama-3.1-70b-versatile`
- `mixtral-8x7b-32768`
- `gemma2-9b-it`

Update model:
```sql
UPDATE ai_settings 
SET active_model = 'llama-3.3-70b-versatile'
WHERE user_id = 'YOUR_USER_ID';
```

#### Issue 3: Rate Limiting
**Symptoms:** 429 Too Many Requests
**Solution:** 
- Wait a few minutes
- Check your Groq console for rate limits
- Consider upgrading your Groq plan

#### Issue 4: No AI Provider Configured
**Symptoms:** "No active AI provider configured" error
**Solution:**
Run this SQL in Supabase (replace YOUR_USER_ID and YOUR_API_KEY):
```sql
INSERT INTO public.ai_settings (
  user_id, provider, api_key, active_model, is_active
) VALUES (
  'YOUR_USER_ID'::uuid,
  'groq',
  'YOUR_GROQ_API_KEY',
  'llama-3.3-70b-versatile',
  true
)
ON CONFLICT (user_id, provider) DO UPDATE
SET is_active = true, 
    api_key = EXCLUDED.api_key, 
    active_model = EXCLUDED.active_model;
```

## Next Steps

1. **Check browser console** - The enhanced logging will show detailed error info
2. **Visit `/debug-ai`** - Use the test button to verify your setup
3. **Check Groq console** - Visit https://console.groq.com to verify:
   - API key is valid
   - You haven't hit rate limits
   - Your account is active

## Getting Your User ID

If you need your user ID, run this in Supabase SQL Editor:
```sql
SELECT id, email FROM auth.users;
```

Or visit `/debug-ai` - it shows your user ID at the top.
