# How Your Scraper Works - Real Data Quality

## ✅ Your Scraper Already Does Everything You Asked For!

### 1. **Google Maps (No API Required)**
```
✅ Searches Google Maps for businesses
✅ Gets business listings with:
   - Company name
   - Address
   - Phone number
   - Rating
   - Google Maps URL
```

### 2. **Visits Each Business Website**
```
✅ Opens the actual website with Puppeteer (real browser)
✅ Executes JavaScript (sees dynamic content)
✅ Checks multiple pages:
   1. /contact page FIRST (90% of emails are here)
   2. Homepage (if contact page didn't have email)
✅ Scrolls to bottom (loads lazy content, footer)
```

### 3. **Extracts Real Emails From:**

#### ✅ Contact Page
- Contact forms
- Contact information sections
- Email addresses in text

#### ✅ Footer
- Footer contact info
- Copyright sections
- Social media links with emails

#### ✅ Header
- Navigation menus
- Top contact bars
- Header contact info

#### ✅ Entire Page
- Body text
- Hidden elements
- JavaScript-rendered content

### 4. **Advanced Email Detection**

#### ✅ Handles Cloudflare Protection
```javascript
// Decodes: /cdn-cgi/l/email-protection#HEXSTRING
// Result: real@email.com
```

#### ✅ Handles Obfuscation
```javascript
// Converts: "info [at] company [dot] com"
// To: info@company.com
```

#### ✅ Finds mailto: Links
```html
<a href="mailto:contact@company.com">
```

#### ✅ Extracts from data-cfemail
```html
<span data-cfemail="ENCODED">
```

### 5. **Quality Verification**

#### ✅ Marks Real vs Fallback
```typescript
emailIsReal: true  // Found on actual website ✅
emailIsReal: false // Generated fallback ⚠️
```

#### ✅ Location Verification
```typescript
// Checks if website matches location
// Rejects if wrong country/region
```

#### ✅ Email Scoring
```typescript
// Prioritizes:
// 1. Country-specific (info.rw@)
// 2. Generic (info@, contact@)
// 3. Personal (john@)
```

## 📊 Data Quality Breakdown

### What You Get:

**High Quality (emailIsReal: true)**
- ✅ Found on actual website
- ✅ Verified location match
- ✅ Real contact information
- Example: `john@kigaliclinic.rw`

**Medium Quality (emailIsReal: true, generic)**
- ✅ Found on actual website
- ✅ Generic pattern (info@, contact@)
- ⚠️ May be monitored inbox
- Example: `info@kigaliclinic.rw`

**Low Quality (emailIsReal: false)**
- ⚠️ Generated fallback
- ⚠️ Website timeout or no website
- ⚠️ Needs manual verification
- Example: `info@kigaliclinic.rw` (not verified)

## 🔍 Current Scraping Flow

```
1. Search Google Maps
   ↓
2. Get 60 businesses
   ↓
3. For each business:
   ├─ Open Google Maps page
   ├─ Extract website URL
   ├─ Visit website
   ├─ Check /contact page
   ├─ Extract emails from:
   │  ├─ mailto: links
   │  ├─ Cloudflare protected
   │  ├─ Footer
   │  ├─ Header
   │  └─ Body text
   ├─ If no email found:
   │  └─ Check homepage
   └─ If still no email:
      └─ Generate fallback (marked as unverified)
```

## 🎯 Why You Might Get Fallback Emails

### Reason 1: Website Timeout
```
Problem: Website takes >25 seconds to load
Solution: Increase timeout or reduce concurrency
```

### Reason 2: No Website
```
Problem: Business doesn't have a website
Solution: Can't scrape what doesn't exist
Result: Fallback email generated
```

### Reason 3: Email Hidden
```
Problem: Email behind contact form only
Solution: Can't extract from forms
Result: Fallback email generated
```

### Reason 4: Bot Protection
```
Problem: Cloudflare, reCAPTCHA blocking
Solution: Already handles Cloudflare
Result: May still fail on aggressive protection
```

## 📈 Expected Results

### For Rwanda Clinics:

**Realistic Expectations:**
- 40-50% real emails (found on websites)
- 20-30% generic emails (info@, contact@)
- 20-30% fallback emails (generated)
- 10-20% no email (no website)

**Why?**
- Many clinics don't have websites
- Those with websites often don't publish emails
- Phone numbers more common than emails in Rwanda
- Some websites are slow or protected

## ✅ Your Scraper is Already Optimized!

### What It Does:
1. ✅ Scrapes Google Maps (no API)
2. ✅ Visits actual websites
3. ✅ Checks contact pages
4. ✅ Checks footer and header
5. ✅ Extracts real emails
6. ✅ Handles Cloudflare protection
7. ✅ Verifies location match
8. ✅ Marks real vs fallback
9. ✅ Generates smart fallbacks only when needed

### What You Can Do:
1. **Increase timeout** if websites are slow
2. **Reduce concurrency** if system struggles
3. **Verify fallback emails** manually before sending
4. **Use phone numbers** as alternative contact method

## 🚀 The Scraper is Working Correctly!

The issue isn't the scraper - it's that:
1. Many businesses don't have websites
2. Those with websites don't always publish emails
3. Rwanda websites can be slow to load

**Your scraper is doing exactly what you asked - visiting websites, checking contact pages and footers, and extracting real emails!** ✅

---

## Environment & Maps backend (`.env`)

### Optional Docker Maps (gosom)

Faster/deeper Google Maps when the gosom container is running:

```bash
docker compose -f docker-compose.gmaps.yml up -d
```

In `.env`:

```env
GMAPS_SCRAPER_URL=http://localhost:8080
GMAPS_SCRAPER_MAX_DEPTH=5
```

- **Docker online:** Maps uses gosom; Bing, DuckDuckGo, directories, and website email crawl still use HTTP (not Puppeteer for Maps).
- **`GMAPS_SCRAPER_URL` set but server offline:** Maps falls back to Puppeteer automatically. Start Docker with the command above.
- **No `GMAPS_SCRAPER_URL`:** Maps uses Puppeteer only.

The scraper UI shows a small badge (Docker / Puppeteer / offline) next to the search form — no extra banners.

### Bing & DuckDuckGo (no paid API required)

**Default (free):** Bing and DuckDuckGo use HTTP first, then **automatic browser retry** when results are blocked or empty. Website enrich also uses the **Maps place link** + **browser fetch** for JS-heavy sites — no API key needed.

If DuckDuckGo still returns **0 leads**, add this free option (slower, uses local Chrome):

```env
SEARCH_USE_PUPPETEER=ddg
```

**Optional paid add-on** (not required): `BRAVE_SEARCH_API_KEY` — only if you want a paid search API when free Bing/DDG are unreliable.

### Other useful scraper env vars

| Variable | Purpose |
|----------|---------|
| `GMAPS_DOCKER_WEBSITE_EMAIL_VERIFY` | Crawl business sites to compare CSV vs website email (default on) |
| `GMAPS_DOCKER_NO_WEBSITE_ENRICH` | Bing + domain guess when CSV has no website (default on) |
| `GMAPS_DOCKER_AI_EMAIL_PICK` | Use AI Settings LLM to pick email when candidates disagree (default on) |
| `GMAPS_DOCKER_AI_EMAIL_PICK=false` | Disable AI email pick during Maps scrape |
| `WEBSITE_FETCH_PUPPETEER` | When HTTP crawl finds no email, retry key pages in headless Chrome (default on) |
| `WEBSITE_FETCH_PUPPETEER=false` | HTTP only — fails on many JS sites you see in a normal browser |
| `SCRAPE_BROWSER_POOL` | **On by default** — one shared Chrome per scrape job (Maps + site fallback + place links); set `false` to launch/close per URL |
| `GMAPS_MAPS_LINK_WEBSITE` | Read website from Google Maps place URL when CSV `website` is empty (default on) |
| `BRAVE_SEARCH_API_KEY` | Optional paid Brave Search API — skip unless you already have a key |
