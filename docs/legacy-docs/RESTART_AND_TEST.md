# Fix: Stale Session Issue

## Problem
Your app session has a cached user ID that doesn't exist in the database.
- Cached session user: `eadd4fd6-f30e-49bb-99a8-7acedd1bf9ae` ❌
- Real database user: `91416b57-9f98-4612-b88a-8ac157f31a73` ✅
- AI provider exists for: `91416b57-9f98-4612-b88a-8ac157f31a73` ✅

## Solution

### Option 1: Clear Browser Session (Recommended)
1. In your app, click **Logout**
2. Clear browser cookies for localhost:3000
3. Log back in with **pryrolab@gmail.com**
4. Visit http://localhost:3000/debug-ai to verify
5. Try generating emails again

### Option 2: Use Incognito/Private Window
1. Open a new incognito/private browser window
2. Go to http://localhost:3000
3. Log in with **pryrolab@gmail.com**
4. Try generating emails

### Option 3: Restart Dev Server
1. Stop your dev server (Ctrl+C)
2. Clear Next.js cache: `rm -rf .next`
3. Restart: `npm run dev` or `bun dev`
4. Log out and log back in

## Verify It Works
After logging back in, visit http://localhost:3000/debug-ai

You should see:
- User ID: `91416b57-9f98-4612-b88a-8ac157f31a73`
- AI Provider: ✅ groq (llama-3.3-70b-versatile)

Then email generation will work!
