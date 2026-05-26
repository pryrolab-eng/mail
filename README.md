# Outreach Mail Platform

Lead generation, AI-assisted email writing, and Gmail-based outreach — built with **Next.js**, **Supabase**, and optional **Docker Maps** scraping.

## Features

- **Lead scraper** — Google Maps (Docker gosom or Puppeteer), Bing, DuckDuckGo, and directory sources in parallel
- **Website email discovery** — Crawls contact pages, mailto links, and JS-heavy sites (browser fallback); enriches rows with no Maps website via search + Maps place links
- **AI email generation** — Uses your provider from **AI Settings** (OpenAI, Anthropic, Groq, Gemini, Mistral)
- **CRM pipeline** — Leads, campaigns, templates, follow-ups, inbox
- **Gmail SMTP** — Multiple accounts with daily limits and rotation

## Requirements

- **Node.js** 20+
- **Supabase** project (URL + anon + service keys)
- **Chrome/Chromium** — Used by Puppeteer for Maps fallback, website crawl, and optional search retry
- **Docker** (optional) — For [gosom/google-maps-scraper](https://github.com/gosom/google-maps-scraper) on port 8080

## Quick start

```bash
npm install
cp .env.example .env
# Fill in Supabase keys and any optional keys (see below)

npm run dev
```

Open [http://localhost:3000](http://localhost:3000) → sign up / sign in → **Dashboard**.

### Database

Apply Supabase migrations (or follow `SETUP_INSTRUCTIONS.md` if tables are missing):

```bash
npm run supabase:login
npm run supabase:link
npm run supabase:push
```

## Environment variables

Copy `.env.example` to `.env`. **Required:**

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public anon key |
| `SUPABASE_SERVICE_KEY` | Server-side service role key |

**Optional but useful:**

| Variable | Purpose |
|----------|---------|
| `GOOGLE_KNOWLEDGE_GRAPH_API_KEY` | Company context enrichment (free quota) |
| `GMAPS_SCRAPER_URL` | e.g. `http://localhost:8080` — Docker Maps scraper |
| `SEARCH_USE_PUPPETEER=ddg` | Free fix when DuckDuckGo HTML is blocked |
| AI keys | Configured in the app under **AI Settings** (not only `.env`) |

**Not required:** `BRAVE_SEARCH_API_KEY`, Google Places API, or other paid search keys. The scraper uses free Bing/DDG + browser retry by default.

### Optional Docker Maps

```bash
docker compose -f docker-compose.gmaps.yml up -d
```

```env
GMAPS_SCRAPER_URL=http://localhost:8080
GMAPS_SCRAPER_MAX_DEPTH=5
```

If Docker is offline, Maps automatically falls back to Puppeteer.

### Scraper behavior (summary)

| Source | Default |
|--------|---------|
| Maps | Docker gosom when reachable, else Puppeteer |
| Bing / DDG | HTTP, then headless browser if blocked |
| No website in CSV | Maps place link → search → domain guess |
| Site email | HTTP paths + contact/dealer pages; browser if empty HTML |

Full detail: **[HOW_SCRAPER_WORKS.md](./HOW_SCRAPER_WORKS.md)** (env vars, troubleshooting, email verification).

Useful scraper toggles (all default **on** unless set to `false`):

- `GMAPS_DOCKER_WEBSITE_EMAIL_VERIFY` — Compare gosom CSV email vs website crawl
- `GMAPS_DOCKER_NO_WEBSITE_ENRICH` — Find website when CSV has none
- `GMAPS_DOCKER_AI_EMAIL_PICK` — Resolve conflicting emails with AI Settings LLM
- `WEBSITE_FETCH_PUPPETEER` — Browser retry for JS sites (e.g. corporate contact pages)
- `GMAPS_MAPS_LINK_WEBSITE` — Read website from Google Maps `link` column

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run start` | Production server |
| `npm run worker` | Local free-v1 automation worker |
| `npm run worker:once` | Run one local automation worker pass |
| `npm run supabase:push` | Push migrations to linked project |

## Project layout

```
src/
  app/              # Next.js routes (auth, dashboard, API)
  components/       # UI including platform modules (Scraper, CRM, AI Settings)
  utils/            # Scraper, email, AI helpers
supabase/migrations/
docs/legacy-*       # Archived setup/fix notes and one-off SQL
docker-compose.gmaps.yml
```

## More documentation

| Doc | Topic |
|-----|--------|
| [HOW_SCRAPER_WORKS.md](./HOW_SCRAPER_WORKS.md) | Scraper sources, email quality, `.env` |
| [SETUP_INSTRUCTIONS.md](./SETUP_INSTRUCTIONS.md) | SMTP tables, Gmail app passwords |
| [QUICK_START.md](./QUICK_START.md) | Broader platform onboarding |
| [docs/legacy-docs/README_NEW_FEATURES.md](./docs/legacy-docs/README_NEW_FEATURES.md) | Archived campaigns, templates, follow-ups notes |

## Gmail SMTP

Use a **Gmail App Password** (16 characters), not your normal Gmail password. Enable 2FA, then create an app password under Google Account → Security → App passwords. Add accounts in the dashboard **SMTP** section.

## License

Private project.
