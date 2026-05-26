# Email Scraping Issues & Solutions

## 🔴 Current Problems

### 1. **Low Success Rate (Many Wrong Emails)**
You're getting many fallback emails like `info@companyname.com` because:

- **Websites without emails**: Many businesses (especially schools in Rwanda) don't publish emails on their websites
- **Contact forms only**: Businesses hide emails behind contact forms to avoid spam
- **JavaScript-heavy sites**: Some sites load emails dynamically, but the scraper times out before they appear
- **Cloudflare/bot protection**: Some sites block automated scrapers
- **No website at all**: Google Maps often doesn't have website URLs for local businesses

### 2. **Slow Performance (Takes Too Long)**
The scraper is slow because:

- **Sequential processing**: Currently processes 5 businesses at a time (CONCURRENCY = 5)
- **Multiple page visits per business**: 
  - Maps listing page
  - Individual place page
  - Website homepage
  - Contact page
  - About page
  - Google search for website (if no website on Maps)
- **Long timeouts**: 30s navigation timeout + 1.5s JS wait per page
- **Google search fallbacks**: When no website found, searches Google (adds 15s+ per business)
- **Email verification**: DNS MX record checks for every email (5s timeout each)

### 3. **Specific Issues in Code**

#### In `puppeteer-scraper.ts`:
```typescript
// ❌ PROBLEM: Only 3 pages checked per website
const MAX_PAGES = 3; // Homepage + contact + about

// ❌ PROBLEM: Long delays everywhere
await delay(1_500); // After every navigation
await delay(2_000); // After Maps place page load
await delay(1_000); // Between scrolls

// ❌ PROBLEM: Sequential batch processing
const CONCURRENCY = 5; // Only 5 at a time
for (let i = 0; i < businesses.length; i += CONCURRENCY) {
  await Promise.all(...); // Waits for entire batch before next
}

// ❌ PROBLEM: Expensive Google searches for every business without website
if (!website) {
  const foundWebsite = await findWebsiteViaGoogle(...); // 15s+ per business
}

// ❌ PROBLEM: Email verification slows everything down
const deliverable = await verifyEmailDomain(email); // 5s per email
```

#### In `multi-source-email-finder.ts`:
```typescript
// ❌ PROBLEM: Google search scraping is unreliable and slow
await new Promise(resolve => setTimeout(resolve, 1000)); // 1s delay per query

// ❌ PROBLEM: Multiple queries per company (4 queries × 1s = 4s minimum)
const queries = [
  `"${companyName}" email contact`,
  `"${companyName}" "contact us" email`,
  `site:${website} email`,
  `"${companyName}" "@" contact`,
];

// ❌ PROBLEM: Timeout is too long
timeout = 30000, // 30 seconds per company
```

---

## ✅ Solutions

### Solution 1: **Optimize Puppeteer Scraper Performance**

#### A. Increase Concurrency
```typescript
// Change from 5 to 10-15 concurrent browsers
const CONCURRENCY = 15; // Process 15 businesses simultaneously
```

#### B. Reduce Delays
```typescript
// Reduce delays significantly
await delay(500);  // Instead of 1500ms
await delay(1000); // Instead of 2000ms
```

#### C. Skip Expensive Operations
```typescript
// Skip Google website search for businesses without websites
// Skip email verification (it's slow and often fails for valid emails)
// Only check homepage + /contact page (skip /about, /contact-us variants)
```

#### D. Add Timeout Controls
```typescript
// Add overall timeout per business (max 20s total)
const BUSINESS_TIMEOUT = 20_000;
await Promise.race([
  processBusiness(biz, idx, pages),
  new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), BUSINESS_TIMEOUT))
]);
```

### Solution 2: **Improve Email Finding Strategy**

#### A. Better Fallback Email Generation
Instead of generic `info@companyname.com`, generate smarter fallbacks:

```typescript
// For Rwanda schools, use .rw domain
const domain = location.toLowerCase().includes('rwanda') 
  ? `${cleanName}.rw`
  : `${cleanName}.com`;

// Try multiple common patterns
const patterns = [
  `info@${domain}`,
  `contact@${domain}`,
  `admissions@${domain}`, // For schools
  `hello@${domain}`,
];
```

#### B. Use Alternative Data Sources
- **LinkedIn Company Pages**: Often have contact emails
- **Yellow Pages / Business Directories**: May have emails not on websites
- **Social Media**: Facebook pages sometimes show emails

### Solution 3: **Remove Slow Operations**

#### Remove These:
1. ❌ `verifyEmailDomain()` - Too slow, often fails for valid emails
2. ❌ `findWebsiteViaGoogle()` - Adds 15s+ per business
3. ❌ `searchGoogleForEmail()` - Unreliable, slow, often blocked
4. ❌ Multiple contact page variants - Just check `/contact` and homepage

### Solution 4: **Add Progress Tracking**

```typescript
// Show real-time progress
console.log(`[${idx + 1}/${total}] ${bizName} - ${Math.round((idx/total)*100)}% complete`);
```

### Solution 5: **Implement Caching**

```typescript
// Cache scraped websites to avoid re-scraping
const websiteCache = new Map<string, { email: string | null, timestamp: number }>();

// Check cache first
const cached = websiteCache.get(website);
if (cached && Date.now() - cached.timestamp < 7 * 24 * 60 * 60 * 1000) { // 7 days
  return cached.email;
}
```

---

## 🚀 Recommended Implementation Plan

### Phase 1: Quick Wins (Immediate - 30 min)
1. ✅ Increase CONCURRENCY from 5 to 15
2. ✅ Reduce all delays by 50%
3. ✅ Remove email verification (verifyEmailDomain)
4. ✅ Skip Google website search fallback

**Expected Result**: 3-5x faster scraping

### Phase 2: Better Email Quality (1 hour)
1. ✅ Improve fallback email generation (use .rw for Rwanda)
2. ✅ Add more email patterns (admissions@, contact@, hello@)
3. ✅ Better email scoring (prefer country-specific emails)
4. ✅ Only check homepage + /contact (skip other pages)

**Expected Result**: 20-30% more real emails

### Phase 3: Advanced Optimizations (2 hours)
1. ✅ Add per-business timeout (20s max)
2. ✅ Implement website caching
3. ✅ Add progress tracking
4. ✅ Parallel Google Maps scrolling + email extraction

**Expected Result**: 50% faster + better UX

---

## 📊 Expected Performance Improvements

### Current Performance:
- **Speed**: 100 leads in ~15-20 minutes
- **Success Rate**: ~30-40% real emails, 60-70% fallbacks
- **User Experience**: Long wait, no progress feedback

### After Optimizations:
- **Speed**: 100 leads in ~5-7 minutes (3x faster)
- **Success Rate**: ~50-60% real emails, 40-50% fallbacks (20% improvement)
- **User Experience**: Real-time progress, faster results

---

## 🔧 Code Changes Needed

### File: `src/utils/puppeteer-scraper.ts`

1. **Line 456**: Change `CONCURRENCY = 5` to `CONCURRENCY = 15`
2. **Line 290**: Change `await delay(1_500)` to `await delay(500)`
3. **Line 520**: Change `await delay(2_000)` to `await delay(1_000)`
4. **Lines 550-560**: Remove `findWebsiteViaGoogle()` call
5. **Lines 590-600**: Remove `verifyEmailDomain()` call
6. **Line 220**: Change `MAX_PAGES = 3` to `MAX_PAGES = 2`
7. **Lines 230-240**: Remove `/about`, `/about-us` from priority paths

### File: `src/utils/multi-source-email-finder.ts`

1. **Line 150**: Change timeout from 30000 to 15000
2. **Lines 80-100**: Remove Google search method (unreliable)
3. **Lines 200-220**: Remove LinkedIn search (requires auth)

---

## 🎯 Alternative Approach: Hybrid Strategy

Instead of trying to find real emails for everyone, use a **tiered approach**:

### Tier 1: Real Emails (High Priority)
- Businesses with websites that have visible emails
- Process these first, spend more time

### Tier 2: Smart Fallbacks (Medium Priority)
- Businesses with websites but no visible email
- Generate smart fallbacks based on domain

### Tier 3: Generic Fallbacks (Low Priority)
- Businesses without websites
- Generate generic emails, mark as "unverified"

This way:
- ✅ Users get results faster
- ✅ Real emails are prioritized
- ✅ Fallbacks are clearly labeled
- ✅ Users can manually verify fallbacks later

---

## 💡 Additional Recommendations

### 1. Add Email Validation Service
Use a service like:
- **Hunter.io** (free tier: 50 searches/month)
- **Clearbit** (free tier: 100 searches/month)
- **Snov.io** (free tier: 50 searches/month)

### 2. Implement Email Bounce Detection
- Track which emails bounce
- Remove invalid emails from database
- Improve fallback generation based on bounce patterns

### 3. Add Manual Verification Workflow
- Flag fallback emails as "needs verification"
- Allow users to manually update emails
- Learn from user corrections

### 4. Use AI for Email Pattern Recognition
- Train a model on successful email patterns
- Predict likely email formats for businesses
- Example: Schools often use `info@schoolname.rw` in Rwanda

---

## 🚨 Critical Issues to Fix First

1. **Remove email verification** - It's slowing everything down and often wrong
2. **Increase concurrency** - Process more businesses in parallel
3. **Skip Google searches** - They're slow and unreliable
4. **Reduce delays** - Current delays are too conservative

These 4 changes alone will make scraping **3-5x faster** with minimal code changes.
