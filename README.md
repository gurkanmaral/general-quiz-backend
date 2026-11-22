# general-quiz-backend

API for KNO. — the daily general-knowledge quiz. The web app lives in [general-quiz](https://github.com/gurkanmaral/general-quiz).

Node 22 · Hono · Socket.IO · Better Auth (email code + Google) · Drizzle on Postgres.

## Run locally

```bash
docker run -d --name kno-postgres -p 5433:5432 -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16
docker exec kno-postgres createdb -U postgres kno && docker exec kno-postgres createdb -U postgres kno_test
cp .env.example .env          # set DATABASE_URL to port 5433
npm install
npm run kno -- import         # load content/ (quizzes, daily schedule, awards)
npm run dev                   # http://localhost:8787
```

In development the email confirmation code is always `490909` and no mail is sent. Production refuses a test code.

## Layout

- `src/modules/*` — one module per domain (accounts, daily, quizzes, awards, friends, lobbies, content), each with its own Postgres schema.
- `src/contracts` — zod request/response schemas (the web app keeps its own copy).
- `src/shared` — streak and daily-rotation rules.
- `content/` — quizzes and daily schedule as JSON; `npm run kno -- import` loads them.

## Scripts

`npm test` (needs Postgres, see `.env.example`) · `npm run typecheck` · `npm run build` · `docker build .`
