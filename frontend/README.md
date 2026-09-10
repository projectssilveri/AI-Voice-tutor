# Frontend

Next.js 15.5 (App Router) · React 19 · TypeScript strict · Tailwind v4.

This is the UI-only layer. All data fetching and server-side logic lives in the
`backend/` FastAPI service — there are **no Next.js API routes**.

## Structure

```
src/
├─ app/
│  ├─ (auth)/          sign-in, sign-up
│  ├─ (dashboard)/     student & admin pages
│  ├─ (marketing)/     public landing pages
│  └─ (org)/           organization portal
├─ components/         shared UI components
├─ context/            auth, sidebar context
├─ hooks/              data-fetching hooks
├─ lib/                API client, helpers
└─ types/              shared TypeScript types
```

## Running

```bash
npm install
cp .env.local.example .env.local
npm run dev
```

Open **http://localhost:3000**.

The backend must be running on port 8000 — see `../backend/README.md`.

## Environment

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | Backend base URL (default `http://localhost:8000`) |
| `NEXT_PUBLIC_WS_BASE_URL` | WebSocket base URL (default `ws://localhost:8000`) |

## Type-check & lint

```bash
npx tsc --noEmit
npx eslint src
```
