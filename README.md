# Voice Tutor LMS

A learning platform where the teaching happens **by voice**. Open a module and
an AI tutor starts a spoken micro-lecture on that exact topic — unprompted.
Interrupt it mid-sentence and it stops in under half a second, answers your
question from that module's own material, then carries on.

Not a chatbot bolted onto a course library. The tutor is grounded in one
module's content, knows what you have done, and behaves like a tutor rather
than an answer engine.


---

## Status

Build-order steps 1–11 are complete and exercised against the real APIs.
Step 12 (deploy) is the remaining one — see [Deployment](#deployment).

| | |
|---|---|
| API routes | 56 |
| Frontend pages | 26 |
| Database tables | 22 across 6 migrations |
| Barge-in latency | **0.42 s**, measured against the live Gemini API |

---

## The voice tutor

This is the part that matters, and the part that was built first and proven
before anything else depended on it.

```
student opens a module → clicks Agent
   ↓
backend loads THIS module's content + the student's progress
   ↓
opens a Gemini Live session, system instruction scoped to that module only
   ↓
sends a trigger turn → the tutor starts speaking, unprompted
   ↓
student talks over it at any point
   ↓
Gemini cancels its own generation server-side and sends `interrupted`
   ↓
client flushes queued audio immediately, answers the question, resumes
```

Measured on `gemini-3.1-flash-live-preview`, on the real tutoring endpoint:

- the tutor begins speaking about **2.4 s** after the trigger
- interrupting produces `serverContent.interrupted` **0.42 s** after the
  student starts talking
- **zero bytes** of tutor audio arrive after that signal — the cancellation is
  genuinely server-side, not the client muting a stream it is still receiving

Every turn is transcribed and stored, with the interrupted turn flagged, so
barge-in is visible in the data rather than something you take on trust.

---

## Features

### Learning
- **Voice tutor per module** — spoken micro-lecture, interruptible mid-sentence
- **Live transcript** beside the avatar, paced to the audio rather than racing
  ahead of it
- **Avatar driven by real amplitude** (Web Audio `AnalyserNode`), with distinct
  Idle / Speaking / Listening / Thinking / Interrupted states
- **PDF course material** — handouts students can read, unlimited
- **Quizzes** — multiple choice, deterministic grading, **unlimited retakes**,
  review showing the right answer only where you got it wrong
- **Assignments** — graded by matching the author's accepted answers, not by an
  LLM, so a mark is reproducible and appealable. Admins can override any mark,
  and the override is attributed
- **Certification exams** — capped at 3 attempts plus admin-granted extras,
  opening in their own tab and taking over the screen
- **Certificates** — PDF, rendered on request, carrying the certificate's UUID
- **Progress** — a long enough session with at least one finished tutor turn
  completes a module automatically

### Selling
- Courses sold **outright**, as a **full-stack bundle** (a subscription
  covering three or four courses used together — a language, a database and
  its framework), or as **All Access** over the whole catalogue. Bundle or
  all-access is derived by counting the courses a plan links, so the label
  cannot disagree with what the plan actually unlocks
- **Razorpay** integration: an order becomes paid only after its signature
  verifies server-side; the amount always comes from the course row, never the
  request
- Paywall enforced on enrolment, the voice session, quizzes, assignments and
  the certification exam — reading course material stays free

### Roles
One sign-in page; the dashboard changes by role.

| Role | Can do |
|---|---|
| **student** | courses, tutor, quizzes, assignments, exams, certificates |
| **teacher** | the above, plus writing quiz questions and assignments |
| **admin** | course & module authoring, PDF upload, submission review, contact inbox, users, AI usage, attempt grants |
| **super_admin** | everything, plus **pricing**, **publish/unpublish**, revenue, orders, and role changes |

`super_admin` satisfies every `admin` gate automatically — forgetting to list
both would lock the platform owner out of their own product.

### Admin & analytics
- Platform KPIs, enrolments and completion per course, a leaderboard
- AI usage: sessions per day, minutes, interruptions, most-used modules, and
  whether a given student has ever used the tutor
- Revenue, orders and conversion (super admin only)
- Contact-form inbox

---

## Stack

| Layer | Choice |
|---|---|
| Frontend | Next.js 15.5 (App Router) · React 19 · TypeScript strict · Tailwind v4 |
| Backend | Python 3.12 · FastAPI — **the only backend** |
| Database | PostgreSQL 17 + pgvector |
| Voice | Google Gemini Live API (`gemini-3.1-flash-live-preview`) |
| Auth | fastapi-users · argon2 · JWT in an httpOnly cookie |
| Payments | Razorpay |
| PDFs | reportlab (certificates) · pypdf (text extraction) |

Next.js has **no API routes**. Everything server-side lives in `backend/`.

```
frontend/   Next.js — UI only, talks to the backend over HTTP + WebSocket
backend/    FastAPI — auth, courses, quizzes, exams, payments, admin, voice
```

---

## Running it locally

**Prerequisites:** Python 3.12, Node 20+, Docker Desktop.

### 1. Database

```bash
docker compose up -d
```

Postgres 17 + pgvector on host port **55432**.

### 2. Backend

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env        # then fill in the values below
python -m alembic upgrade head
python -m scripts.seed      # 11 courses, 40 modules, 105 quiz questions, 8 plans, 3 accounts
python -m uvicorn app.main:app --reload --port 8000
```

Required in `backend/.env`:

| Variable | Needed for |
|---|---|
| `DATABASE_URL` | everything |
| `JWT_SECRET` | signing sessions — generate a long random string |
| `GEMINI_API_KEY` | the voice tutor ([get one](https://aistudio.google.com/apikey)) |
| `RAZORPAY_KEY_ID` / `_KEY_SECRET` / `_WEBHOOK_SECRET` | paid courses (optional — free courses work without) |

### 3. Frontend

```bash
cd frontend
npm install
cp .env.local.example .env.local
npm run dev
```

Open **http://localhost:3000**.

### Seeded accounts

| Role | Email | Password |
|---|---|---|
| Student | `learner@example.com` | `LearnerPass123!` |
| Admin | `admin@example.com` | `AdminPass123!` |
| Super admin | `owner@example.com` | `OwnerPass123!` |

### Gotchas

- **Don't run `npm run build` while `npm run dev` is running.** They share
  `.next` and it corrupts the dev server, producing a confusing
  `__webpack_modules__ is not a function` error on every page.
- Docker Desktop does not start with Windows unless you enable it, so
  `docker compose start` will fail after a reboot until it is running.

### Type-check & lint

```bash
cd frontend && npx tsc --noEmit && npx eslint src
```

---

## Deployment

### What constrains the choice

Read this before picking anything, because one requirement rules out most of
the obvious answers:

1. **The backend needs persistent WebSockets.** A voice session is a long-lived
   connection. This rules out Vercel Functions, Netlify Functions, and AWS
   Lambda for the backend. It also rules out any "scale to zero" plan whose
   cold start would drop a lecture mid-sentence.
2. **Postgres needs the pgvector extension.**
3. **PDFs are stored in the database** (the
   hosts below have ephemeral disks, so files written locally vanish on
   redeploy). That means uploads consume *database* storage, and a 0.5 GB free
   tier is roughly 25 PDFs at the 20 MB limit. If you expect heavy PDF use,
   move them to object storage — Cloudflare R2 gives 10 GB free and
   `services/materials.py` is the single place to change.
4. **Vercel's Hobby tier forbids commercial use.** This app takes payments, so
   Hobby is not a legitimate option — it needs Pro at $20/month, or a different
   host. This catches people out.

### Option A — Cheapest that actually works (~$0–5/month)

One small VM running everything: Postgres, FastAPI, and Next.js behind Caddy or
nginx.

| Piece | Where | Cost |
|---|---|---|
| Everything | **Oracle Cloud Always Free** (4 ARM cores, 24 GB RAM, 200 GB) | **$0** |
| or | **Hetzner CX22** (2 vCPU, 4 GB, 40 GB) | ~**€3.79/mo** |

Genuinely the cheapest, and the ARM free tier is more machine than this app
needs. The trade: you own the backups, the TLS renewal, and the upgrades.
Oracle's free capacity is also famously hard to get in popular regions.

Best if you are comfortable with a VM and want the bill near zero.

### Option B — Cheapest managed (~$7–12/month) — **recommended**

| Piece | Where | Cost |
|---|---|---|
| Frontend | **Cloudflare Pages** (free tier permits commercial use) | $0 |
| Backend | **Fly.io**, `shared-cpu-1x` 512 MB, always on | ~$3–5/mo |
| Database | **Neon** free (0.5 GB, pgvector supported) | $0 |
| | **or** Fly Postgres / Neon Launch if you outgrow it | ~$5–19/mo |

Fly is the right shape for this backend: real WebSocket support, no cold
starts if you keep one machine running, and priced by the second. Neon
supports pgvector on the free tier and suspends when idle, which is fine for
HTTP but is *why the backend must not be serverless too*.

Cloudflare Pages needs `@opennextjs/cloudflare` for a Next.js App Router
build — slightly more setup than Vercel, but free and commercially usable.

### Option C — Simplest, most expensive (~$27/month)

| Piece | Where | Cost |
|---|---|---|
| Frontend | **Vercel Pro** (Hobby is non-commercial) | $20/mo |
| Backend | **Render Starter** (always on, WebSockets) | $7/mo |
| Database | **Neon** free or Render Postgres | $0–7/mo |

Least friction, most money. Render's *free* tier spins down after inactivity,
which would drop voice sessions — Starter is the minimum that works.

### The cost that actually dominates

**Hosting is not your main bill — the Gemini Live API is.** It is charged per
minute of audio in and out, and a class of thirty students doing ten-minute
lessons is far more than $12 of hosting. Check current pricing at
[ai.google.dev/pricing](https://ai.google.dev/pricing) before committing to a
plan, and note the model is **preview** status: names, limits and prices can
change.

Two things worth building before you have real users:
- a **per-student concurrency limit** — nothing stops one student opening the
  same module in five tabs and running five billable sessions
- a **usage cap or alert** on the Google Cloud project

### Before you go live

- [ ] Set `ENVIRONMENT=production` — this is what makes the session cookie
      `Secure`, and it is the only thing keeping the token off plain HTTP
- [ ] Generate a fresh `JWT_SECRET`; never reuse the development one
- [ ] Point `CORS_ORIGINS` at the real frontend domain, not `localhost`
- [ ] Set `NEXT_PUBLIC_API_BASE_URL` and `NEXT_PUBLIC_WS_BASE_URL` to
      `https://` and **`wss://`**
- [ ] Run `alembic upgrade head` against the production database
- [ ] Do **not** run `scripts.seed` in production — it refuses if
      `ENVIRONMENT=production`, and it creates known passwords
- [ ] Configure the Razorpay **webhook secret** (a different secret from the
      key secret) and point the webhook at `/api/v1/payments/webhook`
- [ ] Publish Terms and Privacy Policy — signup currently states they do not
      exist yet rather than pretending otherwise
- [ ] Put a rate limiter in front of `/api/v1/public/contact`, which is the
      only route an unauthenticated stranger can write to. It belongs at the
      edge, where the real client address is visible

---

## Security posture

Audited by probing the running app rather than by reading the code:

- **No secret reaches the browser.** Every value in `backend/.env` was searched
  for across all client-reachable build artifacts — `GEMINI_API_KEY`,
  `JWT_SECRET` and `DATABASE_URL` appear nowhere but `.env` itself
- **Session is a JWT in an httpOnly cookie**, `SameSite=lax`, `Secure` in
  production. No token in `localStorage`, by design
- **Privilege escalation refused** — registering with `role: super_admin`,
  patching your own role, and self-promotion via the admin endpoint were all
  tested and all fail
- **Answer keys never ship** — not in the quiz, the exam paper, or assignments
- **Uploads are judged by magic bytes**, not the Content-Type the browser sent
- **Passwords** argon2-hashed, never logged. Every backend log statement
  identifies people by UUID, never by email or name; none logs a request body,
  a transcript, or an answer

---

## Licence

The Startup and TailAdmin templates that components were cherry-picked from are
MIT; their licences are retained in the repo.
