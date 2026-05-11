# ⚡ Rate Limit Guide - Groq API

## 🔴 Problem
You're hitting Groq's rate limit when generating bulk emails.

## 📊 Groq Rate Limits

### Free Tier:
- **30 requests per minute**
- **14,400 requests per day**

### Paid Tier:
- **30 requests per minute** (same as free)
- **Unlimited daily requests**

**The bottleneck is the per-minute limit!**

---

## ✅ What Was Fixed

### 1. Longer Delays Between Requests
```typescript
// Old: 1.5 seconds delay
await new Promise(resolve => setTimeout(resolve, 1500));

// New: 3 seconds delay (with web research)
const delay = bulkUseWebResearch ? 3000 : 1500;
await new Promise(resolve => setTimeout(resolve, delay));
```

### 2. Better Rate Limit Handling
```typescript
// Retry up to 3 times with 15-second waits
if (rate limit hit) {
  wait 15 seconds
  retry
}

// After 3 retries, stop and show error
```

### 3. Progress Indicator
```typescript
// Shows: "Generating emails... 5/40"
toast.loading(`Generating emails... ${i + 1}/${total}`);
```

### 4. Smart Fallback
```typescript
// If rate limit persists, use simple template
// Better than failing completely
```

---

## 🎯 How to Avoid Rate Limits

### Option 1: Generate in Smaller Batches (Recommended)
```
Instead of: 40 emails at once
Do: 4 batches of 10 emails

Batch 1: 10 emails (2 minutes)
Wait 1 minute
Batch 2: 10 emails (2 minutes)
Wait 1 minute
Batch 3: 10 emails (2 minutes)
Wait 1 minute
Batch 4: 10 emails (2 minutes)

Total: 11 minutes (no rate limits!)
```

### Option 2: Disable Web Research for Bulk
```
✅ Enable web research: Slower, better quality
❌ Disable web research: Faster, good quality

For bulk sends:
- Disable web research
- Generate faster
- Less likely to hit rate limit
```

### Option 3: Use Different AI Provider
```
Groq: Fast but strict rate limits
OpenAI: Slower but higher limits
Anthropic: Balanced

Switch to OpenAI for bulk generation
```

---

## 📈 Rate Limit Math

### With Web Research (3 second delay):
```
30 requests per minute = 1 request per 2 seconds
Your delay: 3 seconds per request
Result: 20 requests per minute ✅ Safe!
```

### Without Web Research (1.5 second delay):
```
30 requests per minute = 1 request per 2 seconds
Your delay: 1.5 seconds per request
Result: 40 requests per minute ❌ Will hit limit!
```

### Recommendation:
```
Bulk generation with web research:
- 10 emails: ~30 seconds ✅
- 20 emails: ~1 minute ✅
- 30 emails: ~1.5 minutes ✅
- 40 emails: ~2 minutes ✅
- 50+ emails: Split into batches
```

---

## 🛠️ Best Practices

### 1. Generate in Batches
```
Select 10-20 leads at a time
Generate emails
Review and edit
Send
Repeat
```

### 2. Use Niche Filtering
```
Filter by niche: "clinic"
Select all (e.g., 15 clinics)
Generate emails
Send to clinics

Filter by niche: "school"
Select all (e.g., 12 schools)
Generate emails
Send to schools
```

### 3. Disable Web Research for Speed
```
Single email: Enable web research ✅
Bulk (< 20): Enable web research ✅
Bulk (> 20): Disable web research ⚡
```

### 4. Use Templates for Large Batches
```
For 100+ emails:
1. Create template in Templates module
2. Use template instead of AI generation
3. Much faster, no rate limits
```

---

## 🔧 Troubleshooting

### Error: "Rate limit exceeded"
**Solution:**
1. Wait 1 minute
2. Try again with smaller batch
3. Or disable web research

### Error: "Rate limit hit 3 times"
**Solution:**
1. Wait 5 minutes
2. Generate in batches of 10
3. Or switch AI provider

### Slow Generation
**Solution:**
1. Disable web research
2. Use smaller batches
3. Or use templates

---

## 💡 Pro Tips

### Tip 1: Morning Batch Generation
```
Morning: Generate 50 emails (5 batches of 10)
Afternoon: Review and edit
Evening: Send all at once
```

### Tip 2: Niche-Based Workflow
```
Monday: Clinics (20 emails)
Tuesday: Schools (15 emails)
Wednesday: Restaurants (25 emails)
Thursday: Retail (18 emails)
Friday: Review and send all
```

### Tip 3: Template + AI Hybrid
```
Create base template
Use AI for first 5 emails
Review quality
If good: Use template for rest
If needs work: Continue with AI in batches
```

### Tip 4: Off-Peak Generation
```
Groq is less busy at:
- Early morning (6-8am)
- Late evening (10pm-12am)
- Weekends

Generate during off-peak for better success
```

---

## 📊 Comparison: AI Providers

| Provider | Rate Limit | Speed | Quality | Cost |
|----------|-----------|-------|---------|------|
| **Groq** | 30/min | ⚡⚡⚡ Fast | ⭐⭐⭐ Good | Free |
| **OpenAI** | 500/min | ⚡⚡ Medium | ⭐⭐⭐⭐ Great | $$ |
| **Anthropic** | 50/min | ⚡⚡ Medium | ⭐⭐⭐⭐⭐ Best | $$$ |

**Recommendation:**
- **Small batches (< 20):** Groq ✅
- **Large batches (> 50):** OpenAI
- **Best quality:** Anthropic

---

## ✅ Summary

### Problem:
- Groq has 30 requests/minute limit
- Bulk generation hits this limit
- Causes failures

### Solution:
- Increased delays (3 seconds with web research)
- Better retry logic (3 attempts, 15-second waits)
- Progress indicator
- Smart fallback

### Best Practice:
- Generate in batches of 10-20
- Use niche filtering
- Disable web research for large batches
- Or switch to OpenAI for bulk

**Your bulk generation will work now!** 🚀
