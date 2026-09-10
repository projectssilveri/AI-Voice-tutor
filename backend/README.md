# Backend

FastAPI. This is the only backend — auth, courses, modules, enrollments,
quizzes, certification exams, admin data, and the Gemini Live voice sessions
all live here. Next.js is frontend-only.

## Structure

Organised by domain, with a hard separation between layers:

```
app/
├─ main.py          app factory, CORS, global exception handlers
├─ deps.py          get_db, get_current_user, require_role
├─ core/            config (all env), security (argon2 + JWT), logging
├─ db/session.py    async engine, URL normalisation for hosted Postgres
├─ models/          SQLAlchemy ORM  (step 2)
├─ schemas/         Pydantic request/response models
├─ services/        business logic — attempt limits, progress, usage
└─ routers/         one module per domain
alembic/            migrations
```

**Business logic does not live in route handlers.** Routers validate, call a
service, and shape a response.

## Running

```bash
python -m uvicorn app.main:app --reload --port 8000
```
1
## Database

`DATABASE_URL` takes the connection string exactly as Neon or Supabase gives
it. `db/session.py` rewrites it: the scheme becomes `postgresql+asyncpg`, and
`sslmode` moves out of the query string into a TLS context — asyncpg rejects
`sslmode` as a connect argument, and without this the app fails on its first
query rather than at startup.

The initial migration runs `CREATE EXTENSION IF NOT EXISTS vector` itself. On a
locked-down instance that needs a superuser, run it once by hand instead:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

`GET /health` reports whether it is installed.

Migrations:

```bash
alembic upgrade head                                  # apply
alembic revision --autogenerate -m "add x"            # after editing models
alembic downgrade -1                                  # undo one
python scripts/verify_migration.py                    # full check, see below
```

## Schema

All thirteen tables from the original schema exist as of migration `0001_initial_schema`.
Models live in `app/models/`, one module per domain, all re-exported from
`app/models/__init__.py` so Alembic sees them.

Decisions worth knowing:

- **UUID primary keys.** Ids appear in URLs; sequential integers would leak how
  many students and courses exist and let anyone walk records.
- **`users.password_hash`** is the column name from the brief. The ORM
  attribute is `hashed_password`, which is what fastapi-users binds to — so
  step 4 needs no migration.
- **`quiz_attempts.module_id`**, not the brief's `quiz_id`. There is no
  `quizzes` table; `quiz_questions` is keyed by module, so a quiz is a module's
  question set. **Flagged for confirmation.**
- **`quiz_questions.correct_answer` is an index into `options`**, not the
  answer text, so grading cannot break when someone fixes a typo in an option.
- **Enums are VARCHAR + CHECK**, not Postgres ENUM types, so adding a role
  later is an ordinary migration rather than an `ALTER TYPE`.
- **`attempt_grants.granted_by` is `ON DELETE RESTRICT`.** Deleting an admin
  must not silently revoke attempts students were already given.
- **`module_progress` has a composite primary key** `(user_id, module_id)` —
  one row per student per module, guaranteed by the database.

### Verifying the schema

```bash
python scripts/verify_migration.py    # online: Postgres actually accepts it
```

`scripts/verify_migration.py` needs `DATABASE_URL`. It runs upgrade → downgrade
→ upgrade and asserts the result each time. It **refuses to run** if the target
database already contains application tables, so it cannot hit production by
accident. Point it at a scratch database.

## Rules that are easy to get wrong

- **Never expose `GEMINI_API_KEY` or `ANTHROPIC_API_KEY` to the browser.** The
  frontend gets an ephemeral token or goes through this service.
- **Certification attempts are consumed on submit**, pass or fail. Starting an
  exam and abandoning it costs nothing. See `routers/cert_exams.py`.
- **Quizzes are unlimited.** Never apply the certification cap to them.
- **Content reading is unlimited.** No read-limit logic on modules or PDFs.
- **Recompute `allowed_attempts` server-side on every request.** Never trust a
  count the frontend sends.
