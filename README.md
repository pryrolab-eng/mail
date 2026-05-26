# Pryro Mail

Local-first lead research, AI-assisted outreach, and Gmail SMTP sending built with **Next.js**, **Supabase**, and a skill-based lead agent.

## Current V1

This project is now focused on a safe free-v1 automation flow:

- **Google-first lead agent**: discovers official domains and indexed pages, then fetches targeted pages directly.
- **Skill registry**: built-in agent skills live in `skills/` with `SKILL.md`, schemas, examples, and read-only UI inspection.
- **Evidence-first research**: stores typed `businessFacts`, contact points, source URLs, confidence, and skill traces.
- **AI drafting with Groq first**: email writing uses only ranked typed facts, never raw page text.
- **Assisted automation**: drafts go to approval before sending.
- **Gmail SMTP sending**: app-password accounts, caps, rotation, business-hour scheduling, and local worker processing.
- **Reply/follow-up foundation**: inbox/follow-up routes and IMAP dependency are present for reply-aware automation.

## Architecture

```txt
Dashboard UI
  -> Supabase DB/Auth
  -> automation_jobs queue
  -> local worker
  -> lead agent skills
  -> evidence/contact memory
  -> Groq draft generation
  -> approval queue
  -> Gmail SMTP send
```

Agent research flow:

```txt
searchWeb
  -> fetchTargetedPages
  -> extractBusinessFacts
  -> extractContacts
  -> verifyOwnership
  -> compileLLMContext
  -> reasonWithLLM
  -> decideAction
```

Email flow:

```txt
typed businessFacts
  -> writeEmail
  -> validate output
  -> repair once if needed
  -> reviewEmailSafety
  -> human approval
```

The important rule: **raw page text never goes into `writeEmail`**. Only typed, sourced, ranked facts are allowed.

## Skill System

Built-in skills are stored in:

```txt
skills/
  searchWeb/
  fetchTargetedPages/
  extractBusinessFacts/
  extractContacts/
  verifyOwnership/
  compileLLMContext/
  reasonWithLLM/
  decideAction/
  writeEmail/
  reviewEmailSafety/
```

Each skill folder contains:

```txt
SKILL.md
references/schema.json
references/examples.json
```

The trusted V1 implementation still runs through TypeScript functions in `src/utils`, but skill calls are traced with:

- `skillId`
- `input`
- `output`
- `ok`
- `confidence`
- `warnings`
- `durationMs`

Open **Dashboard -> Skills** to inspect installed skills, rules, schemas, examples, and recent traces.

## Requirements

- Node.js 20+
- Supabase project
- Supabase CLI
- Gmail accounts with app passwords
- Groq API key configured in **AI Settings**
- Local PC running the dev server and worker during automation

Optional:

- Docker Maps scraper (`docker-compose.gmaps.yml`) for legacy/extra discovery paths.
- Puppeteer browser fallback for blocked pages/search retries.

## Quick Start

```bash
npm install
cp .env.example .env
```

Fill `.env` with Supabase keys:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_KEY=
CRON_SECRET=
NEXT_PUBLIC_APP_URL=http://localhost:3003
```

Link and push database migrations:

```bash
npm run supabase:login
npm run supabase:link
npm run supabase:push
```

Run the app:

```bash
npm run dev
```

Run the local worker in a second terminal:

```bash
npm run worker
```

Open the app, sign in, then configure:

1. **AI Settings**: add Groq and choose an active model.
2. **SMTP Manager**: add Gmail SMTP app-password accounts.
3. **Scraper/Pipeline**: discover leads, re-research, generate drafts, approve, and send.
4. **Skills**: inspect skill rules and traces.

## Environment Variables

Required:

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser Supabase anon key |
| `SUPABASE_SERVICE_KEY` | Server/worker service role key |
| `CRON_SECRET` | Protects local worker automation routes |
| `NEXT_PUBLIC_APP_URL` | Local app URL used by the worker |

Useful optional values:

| Variable | Purpose |
| --- | --- |
| `AUTOMATION_WORKER_POLL_MS` | Worker polling interval, default `15000` |
| `SEARCH_PUPPETEER_FALLBACK` | Set `false` to disable search browser fallback |
| `SEARCH_USE_PUPPETEER` | Force browser search retry, e.g. `google` or `all` |
| `GMAPS_SCRAPER_URL` | Optional Docker Maps scraper URL |

AI provider API keys are managed in the app under **AI Settings**.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start Next.js development server |
| `npm run build` | Production build |
| `npm run start` | Start production server |
| `npm run worker` | Start local automation worker |
| `npm run worker:once` | Run one worker pass |
| `npm run supabase:push` | Push migrations to linked Supabase project |
| `npm run supabase:migration:list` | Show linked migration state |

## Database

Important V1 tables/migrations include:

- `automation_settings`
- `automation_jobs`
- `agent_settings`
- `agent_runs`
- `lead_evidence`
- `contact_points`
- `agent_skill_overrides`
- `smtp_accounts`
- `email_queue`
- `sent_emails`
- `email_replies`
- `suppression_list`

Run `npm run supabase:push` after pulling new migrations.

## Safety Defaults

- No low-confidence auto-send.
- No raw guessed email auto-send.
- No send outside configured business hours.
- Per-account and global caps are enforced by the worker/sending flow.
- Directory/social evidence can support review, but not unsafe auto-send.
- LLM output is parsed defensively and still goes through validation/safety review.
- Missing payment model is a warning, not a blocker; missing all usable business facts is a blocker.

## Project Layout

```txt
src/app/                  Next.js pages and API routes
src/components/platform/  Dashboard modules
src/utils/                Agent, skill registry, email, SMTP, worker helpers
skills/                   Built-in agent skill packages
scripts/                  Local automation worker and diagnostics
supabase/migrations/      Database schema changes
docs/                     Legacy docs and archived notes
```

## Useful Docs

| Doc | Topic |
| --- | --- |
| [HOW_SCRAPER_WORKS.md](./HOW_SCRAPER_WORKS.md) | Legacy scraper details and troubleshooting |
| [GMAIL_SMTP_README.md](./GMAIL_SMTP_README.md) | Gmail SMTP setup |
| [SETUP_INSTRUCTIONS.md](./SETUP_INSTRUCTIONS.md) | Older setup notes |
| [QUICK_START.md](./QUICK_START.md) | Broader app onboarding |

## Gmail SMTP

Use a **Gmail App Password**, not your normal Gmail password.

1. Enable 2FA on the Gmail account.
2. Create an app password in Google Account security settings.
3. Add the Gmail account in **SMTP Manager**.
4. Keep daily caps conservative for deliverability.

## Before Pushing

Recommended checks:

```bash
node .\node_modules\typescript\bin\tsc --noEmit --pretty false
node .\node_modules\next\dist\bin\next build
node --check scripts\automation-worker.mjs
```

## License

Private project.
