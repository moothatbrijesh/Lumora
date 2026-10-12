> This records Step 3. Step 4 adds authentication and another migration; use
> [the Step 4 guide](STEP_04.md) for the current API and test counts.

# Step 3 — Give Lumora a database

The files in this guide are already created. This step stores fictional sample
records and checks the backend connection. Screens for editing personal data
and authentication come in later steps; no private-data API is exposed yet.

## What the new pieces mean

- **PostgreSQL** stores structured information in tables.
- **Docker Compose** runs PostgreSQL without installing it directly on your computer.
- A **migration** is a numbered database change. Running migrations creates the tables;
  a ledger records which changes have already run.
- A **seed** adds fictional examples so we can inspect and test the database.
- A **volume** keeps development data when the database container stops or is recreated.

## Files and locations

| Path | Why it exists |
| --- | --- |
| `compose.yaml` | PostgreSQL 17 development service and a separate test service |
| `database/migrations/001_initial.sql` | Tables, relationships, indexes, and validation constraints |
| `database/seeds/development.sql` | Fictional user, journal, goal, mood, and three original quotes |
| `backend/src/database.ts` | Connection pool and database readiness check |
| `backend/src/migrations.ts` | Transactional migration runner and seed loader |
| `backend/src/db-cli.ts` | Terminal commands to migrate, seed, and check |
| `backend/src/app.ts` | Adds GET `/ready` for database readiness |
| `backend/src/server.ts` | Connects the running API to the configured database |
| `backend/.env.example` | Local connection settings to copy to ignored `.env` |
| `backend/tests/database.integration.ts` | Tests against real PostgreSQL in an isolated test schema |

## 1. Start PostgreSQL

On your computer, install and open Docker Desktop from the official Docker
website. Linux users can also use Docker Engine with the Compose plugin.
This cloud workspace already has Docker available. Check it:

```bash
docker version
docker compose version
```

From the Lumora repository root (in this cloud: `/workspace/Lumora`):

```bash
docker compose up -d --wait db
```

`-d` leaves PostgreSQL running in the background. `--wait` waits for its health
check. The first run downloads the official PostgreSQL image. Port 5432 is bound
only to this computer's loopback interface. The phone connects to the API, never
directly to PostgreSQL.

## 2. Configure and create the tables

From the repository root:

```bash
cd backend
npm ci
cp -n .env.example .env
```

In this cloud, first run `export npm_config_cache=/workspace/.npm-cache` if npm
needs a writable cache. On Windows PowerShell, use `Copy-Item .env.example .env`
only when `.env` does not already exist. You can also copy the file with your editor.

If `backend/.env` already exists from Step 2, copy the missing DATABASE_URL,
TEST_DATABASE_URL, and ALLOW_DEMO_SEED lines from `.env.example` into it. Keep
existing settings. The example credentials are deliberately local-only; they
match `compose.yaml` and must never be used for a deployed database.

Run these commands from `backend/`:

```bash
npm run db:migrate
npm run db:seed
npm run db:check
```

Expected messages include `Applied: 001_initial.sql` (or `Database migrations
are up to date.`), `Development sample data is ready`, and `Database connection
and required migrations verified.` These commands are safe to repeat. Seeds leave
existing records and edits alone. Seeding requires ALLOW_DEMO_SEED=true and is
blocked when NODE_ENV=production.

Never edit a migration that has already been applied. Add the next numbered SQL
file for a schema change. The runner detects modified migration checksums and
rolls back failures. The canonical schema is in the migrations, not a second
schema file that could drift out of date.

## 3. Start or restart the backend

Stop the old backend using Ctrl+C in its terminal so it can load the new `.env`.
From `backend/`:

```bash
npm run dev
```

Leave it running. From another terminal:

```bash
curl http://localhost:3000/ready
```

Expected response:

```json
{"status":"ok","service":"lumora-api","database":"connected"}
```

`/health` still checks only that the API is alive, preserving Step 2's app button.
`/ready` checks the database connection and initial migration. It returns HTTP
503 with a generic response when either is unavailable, without exposing database
credentials. The starter screen does not yet display the sample records.

## 4. Inspect the sample data

From the repository root:

```bash
docker compose exec db psql -U lumora -d lumora
```

At the SQL prompt, paste:

```sql
\dt
SELECT display_name, email FROM users;
SELECT title FROM journal_entries;
SELECT title, status FROM goals;
SELECT score, note, recorded_on FROM mood_entries;
SELECT content FROM motivation_quotes;
\q
```

The demo account is `demo@example.invalid`, with no password and no ability to
log in. Its mood entry uses a fixed sample date; it is not a live daily record.
All sample text is fictional.

## 5. Run tests without touching development data

From the repository root:

```bash
docker compose --profile test up -d --wait
cd backend
npm test
npm run test:db
npm run typecheck
npm run build
```

`npm test` runs four HTTP tests without needing PostgreSQL. `npm run test:db`
runs seven integration checks inside one parent test (Node reports eight passing
tests). These verify migrations, seed repeatability, constraints, persistence
across connections, API readiness, and cascading deletion.

The test service uses port 5433 and database `lumora_test`, separate from the
normal development database. Each test run creates and removes only its own
random schema. Missing TEST_DATABASE_URL fails explicitly; it never silently
skips tests or falls back to DATABASE_URL. Use only a disposable test database.
The test service's data is intentionally temporary.

## 6. Stop and resume safely

From the repository root:

```bash
docker compose stop
```

To resume development:

```bash
docker compose up -d --wait db
```

The named development volume keeps saved data. Do not add `-v` to
`docker compose down` unless you intentionally want to delete that volume.
Volume survival across a new cloud machine or environment publication has not
been verified; it is not a backup. The migrations and seeds can recreate this
milestone's fictional data in a new environment.

## Troubleshooting

- **Docker daemon unavailable:** open Docker Desktop and wait until it is running.
- **Port 5432 occupied:** another PostgreSQL may already be running. Stop that
  local service if appropriate, or change the host-side port in Compose and the
  port in DATABASE_URL together. Do not delete a database to free a port.
- **Authentication failed:** ensure your local `.env` matches the existing
  database. Changing POSTGRES_PASSWORD in Compose does not change the password
  in an initialized volume. Do not delete a volume containing work to fix this.
- **Readiness is 503:** check `docker compose ps`, run `npm run db:migrate`,
  then `npm run db:check`, and restart the backend after changing `.env`.
- **Backend port is occupied:** stop the previous backend before starting another.
- **Database command failed:** inspect `docker compose logs db` and the migration
  SQL. Never paste a real connection URL or password into chat or a Git commit.

## Checkpoint

Step 3 is complete when `/ready` returns `database: connected`, sample records
are visible, and tests pass. Next is Step 4: registration and login. Foreign keys
connect records to users, but authenticated ownership checks still need to be
implemented before exposing personal-data endpoints.
