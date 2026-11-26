# general-quiz-backend

API for KNO. — the daily general-knowledge quiz. The web app lives in [general-quiz](https://github.com/gurkanmaral/general-quiz).

Node 22 · Hono · Socket.IO · Better Auth (email code + Google) · Drizzle on Postgres.

## Run locally

```bash
docker compose up --build     # Postgres (localhost:5433) + API with hot reload (http://localhost:8787)
```

On every start the API applies migrations and loads `content/` (quizzes, daily schedule, awards). Edits to `src/` and `content/` reload the server; after changing `package.json`, run `docker compose up --build` again. CLI commands run inside the container, e.g. `docker compose exec api npm run kno -- reports`.

Tests and type checks run on the host against the compose database:

```bash
cp .env.example .env          # set DATABASE_URL / DATABASE_URL_TEST to port 5433
npm install
npm test
```

In development the email confirmation code is always `490909` and no mail is sent. Production refuses a test code.

## Layout

- `src/modules/*` — one module per domain (accounts, daily, quizzes, awards, friends, lobbies, content), each with its own Postgres schema.
- `src/contracts` — zod request/response schemas. The web app keeps an identical copy (along with `src/shared/knoStreak.ts` and `knoSchedule*.ts`); its CI fails when the two drift, so copy every change across.
- `src/shared` — streak and daily-rotation rules.
- `content/` — quizzes and daily schedule as JSON; `npm run kno -- import` loads them.

## Scripts

`npm test` (needs Postgres, see `.env.example`) · `npm run typecheck` · `npm run build` · `docker build .`
