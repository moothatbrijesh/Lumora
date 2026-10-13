# Lumora

A supportive personal growth companion for people of every background and belief.
Built with Expo, React Native, TypeScript, and a Node.js API.

**Current milestone: Step 6 — AI chat integration implemented.** Registration,
login, profile, navigation, and account-specific chat history are implemented.
Chat uses **Gemini by default**, with OpenAI available through explicit backend
configuration, and supports retries and deletion. Automated checks use test
providers; **live Gemini validation requires your own API key and available quota**.
Journal, goals, mood, and progress remain placeholders. Deployment is pending.

## Start here

- [Step 6: configure Gemini and use chat](docs/STEP_06.md)
- [Step 5: main screens, navigation, and browser tests](docs/STEP_05.md)
- [Step 4: registration, login, and session testing](docs/STEP_04.md)
- [Step 3: start PostgreSQL, create tables, and test](docs/STEP_03.md)
- [Step 2: run the mobile app and backend](docs/STEP_02.md)
- [Project structure and learning roadmap](docs/GETTING_STARTED.md)
- [Original product vision](docs/PRODUCT_VISION.md)
- [Project brief](Project_Brief)

## Requirements

Use **Node.js 24 LTS** and the npm version included with it. If you use nvm, run
`nvm install` and `nvm use` from the repository root; `.nvmrc` selects Node 24.
Use Docker Desktop (or Docker Engine with Compose) for PostgreSQL.
AI chat requires a backend-only Gemini key (or an explicitly selected OpenAI key);
see Step 6. Gemini has a limited free tier for eligible accounts, regions, and
models. Check your project's tier and current [pricing](https://ai.google.dev/gemini-api/docs/pricing);
this setup does not require enabling billing. Other features and automated tests
can run without an API key.

Run the following from your local Lumora checkout. Keep each server terminal open.

### First: database setup

From the repository root:

```bash
docker compose up -d --wait db
cd backend
npm ci
cp -n .env.example .env
npm run db:migrate
npm run db:seed
npm run db:check
cd ..
```

On Windows, copy `.env.example` to `.env` using your editor. If `.env` already
exists, add the missing database settings from the example rather than replacing
it. See the Step 3 guide for details. Seeds are for local development only.

### Terminal 1: backend

```bash
cd backend
npm ci
npm run dev
```

The expected message is `Lumora API listening on port 3000`.

### Terminal 2: app

Open another terminal at the repository root:

```bash
cd mobile-app
npm ci
```

Copy `mobile-app/.env.example` to `mobile-app/.env`. On macOS/Linux or the cloud
terminal, while inside `mobile-app`, run:

```bash
cp -n .env.example .env
npm run web
```

On Windows PowerShell, use `Copy-Item .env.example .env` if `.env` does not already
exist, then run `npm.cmd run web`. Use `npm.cmd` for the other npm commands too.
Register or sign in, open **Profile**, and tap **Check connection**.
It should say **Lumora is connected and ready.** See the detailed guides for
phone setup and cloud-environment limitations.

### Check the code

From `backend/`:

```bash
npm run typecheck
npm test
npm run build
```

From `mobile-app/`:

```bash
npm run typecheck
npm run export
```

`export` bundles JavaScript/assets for Android, iOS, and web; it does not create
an installable app or submit anything to an app store.

## Available API

| Method | Path | Result |
| --- | --- | --- |
| GET | `/health` | `{"status":"ok","service":"lumora-api"}` |
| GET | `/ready` | HTTP 200 with `database: connected`, or HTTP 503 if unavailable |
| POST | `/auth/register` | Create an account and session |
| POST | `/auth/login` | Sign in and create a session |
| GET | `/auth/me` | Read your profile using a bearer token |
| POST | `/auth/logout` | Revoke the current session |

The health endpoint verifies the API process. Readiness verifies PostgreSQL and
all three migrations. Unknown routes return a JSON 404. The protected profile endpoint
uses the session owner; journal, goal, and mood endpoints are not exposed yet.

For database integration tests, run `docker compose --profile test up -d --wait`
from the root, then `npm run test:db` from `backend/`.

Chat endpoints and their request formats are documented in [Step 6](docs/STEP_06.md#api-endpoints).

## Secrets and source control

`.env` files are ignored by Git. `.env.example` files are safe templates.
`EXPO_PUBLIC_API_URL` is a public backend address; **everything prefixed with
EXPO_PUBLIC_ is included in the app and must never contain a secret**. Provider
keys belong only on the backend as `LUMORA_GEMINI_API_KEY` or
`LUMORA_OPENAI_API_KEY`. Set `LUMORA_AI_PROVIDER=gemini` for Gemini or `openai`
for OpenAI; leaving it unset selects Gemini. There is no automatic provider fallback.

Review [Gemini's unpaid-service data-use terms](https://ai.google.dev/gemini-api/terms)
before sharing personal information. Use fictional messages while testing. Switching
providers preserves conversations, and sending another message shares that
conversation's recent history with the newly selected provider.

Commit both `package-lock.json` files with source changes so `npm ci` installs
the same dependency versions. Do not commit `node_modules/` or generated `dist/`.

## Deployment plan

We plan to use Render for the backend and managed PostgreSQL, GitHub Actions
for automated checks, and Expo EAS for mobile builds. Deployment files and
instructions will be added when the application is ready for that step.

MIT license; see [LICENSE](LICENSE).
