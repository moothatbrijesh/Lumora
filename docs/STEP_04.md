> Step 5 moves session checks and sign-out to the Profile tab. See
> [Step 5](STEP_05.md) for the current screen layout.

# Step 4 — Registration and login

Lumora can now create accounts, sign users in, show their own basic profile,
and sign them out. All files are already in the repository. No Firebase account,
email provider, or OpenAI key is needed: this milestone uses our Node.js backend
and PostgreSQL for authentication.

## How it works

1. You enter a name, email, and password in the app.
2. The backend validates the input and stores a **salted password hash**. A hash
   is a one-way password check; the original password is never saved.
3. The backend creates a random **session token**, which acts like a temporary
   sign-in pass. The database stores only a hash of that token.
4. The app sends the token when requesting your profile. The backend identifies
   the user from the session, never from a user ID supplied by the app.
5. Sign-out removes that session from the database. Sessions also expire after
   seven days; signing out on one device does not sign out other devices.

Phones use Expo SecureStore for the session token. The browser keeps it only in
memory, so refreshing or closing the page requires signing in again. Losing the
browser's in-memory token does not revoke the database session: use Sign out to
revoke it explicitly, otherwise it expires after seven days. Passwords are never
saved in device storage or browser storage.

## Files created or changed

| Path | Purpose |
| --- | --- |
| `database/migrations/002_auth_sessions.sql` | Session table linked to users, with expiry and token hashes |
| `backend/src/passwords.ts` | Salted scrypt password hashing and constant-time verification |
| `backend/src/auth.ts` | Registration, login, profile, logout, and attempt limits |
| `backend/src/app.ts` | JSON body limits, HTTP security headers, allowed browser origins, generic error responses |
| `backend/src/server.ts` | Connects authentication routes to PostgreSQL |
| `backend/src/database.ts` | Readiness now requires both data and authentication migrations |
| `backend/tests/auth.integration.ts` | Tests authentication against a real disposable PostgreSQL database |
| `backend/tests/database.integration.ts` | Updated to verify both migrations |
| `backend/.env.example` | Adds CORS_ORIGINS for browser access |
| `mobile-app/src/api.ts` | API requests, timeouts, and readable errors |
| `mobile-app/src/session.ts` | Native secure session storage and memory-only web behavior |
| `mobile-app/src/AuthPanel.tsx` | Registration, sign-in, signed-in profile, and sign-out UI |
| `mobile-app/App.tsx` | Adds the account panel and keyboard-aware scrolling |
| `mobile-app/app.json` | SecureStore plugin for future native builds |

Dependency declarations and lockfiles were updated for the new libraries. The
original applied migration was left unchanged, so existing data is preserved.

## 1. Start the database and update the backend

Open a terminal in the repository root. In this cloud workspace:

```bash
cd /workspace/Lumora
export npm_config_cache=/workspace/.npm-cache
docker compose up -d --wait db
cd backend
npm ci
npm run db:migrate
npm run db:check
```

On your own computer, use your local checkout path and omit the cloud cache
export. If this is your first setup, copy `backend/.env.example` to
`backend/.env` before running migrations, as described in Step 3. Keep any existing
`.env` values; do not overwrite them.

The migration should report `Applied: 002_auth_sessions.sql`, or that migrations
are up to date. It adds session storage without replacing existing accounts,
journals, goals, or moods.

Stop the previous backend with Ctrl+C, then start it from `backend/`:

```bash
npm run dev
```

The server must restart when `.env` changes. The default CORS_ORIGINS already
allows the local Expo browser app on port 8081. If you intentionally use another
browser origin, add its exact scheme, host, and port to the comma-separated
CORS_ORIGINS value in `backend/.env`. Do not add a wildcard. Native mobile apps do
not use browser CORS headers.

## 2. Restart the app

In a second terminal, open the repository root:

```bash
cd mobile-app
npm ci
npm run web
```

If a previous Expo process is still running, stop it with Ctrl+C first. Use
`npm start` for Expo Go on a phone, following Step 2's device address instructions.
The cloud server is not reachable through your phone's local Wi-Fi address.

## 3. Try the account flow

1. Under **Begin your journey**, enter a name and email.
2. Enter a password of **12–128 characters**, then repeat it in Confirm password.
   A long memorable phrase is suitable. Passwords are not trimmed or truncated.
3. Tap **Create account**. The app should show **Welcome, [your name].**
4. Tap **Check my session**. You should see **Your session is active.**
5. Tap **Sign out**, then sign in again using the same email and password.

Use a fictional address such as `your-name@example.invalid` for local testing;
there is no email verification yet. The seeded `demo@example.invalid` account
has no password and cannot sign in. Create your own test account instead.

You can also try a wrong password, mismatched confirmation, and duplicate email.
These should show helpful errors without revealing another user's private data.
If sign-out cannot reach the server, it keeps the account screen open and asks
you to retry, so it does not falsely claim the remote session was revoked.

On a phone, reopening the app attempts to restore the secure session and checks
it with the server. A network failure offers Retry connection without deleting
the saved session; an expired session asks you to sign in again. On the browser,
a page refresh intentionally returns to the account form.

## 4. Run the automated checks

From the repository root:

```bash
docker compose --profile test up -d --wait
cd backend
npm test
npm run test:db
npm run typecheck
npm run build
```

- Four basic HTTP checks run with `npm test`.
- Twelve authentication checks plus seven database checks run with `npm run test:db`.
  The runner reports 21 results because it also counts two parent tests.
- Integration tests use random schemas in the separate test database. They do
  not delete or reset your normal development data.

From `mobile-app/`:

```bash
npm run typecheck
npm run export -- --max-workers 2
```

Cloud validation also exercised the UI in Chromium at phone width: registration,
confirmation mismatch, session check, browser refresh, wrong password, login,
failed sign-out and retry, and expiry of a real database session. Native bundles
were built, but SecureStore persistence has not yet been tested on a physical
phone or simulator. That still needs a device check before release.

## API reference

| Method | Path | Input / result |
| --- | --- | --- |
| POST | `/auth/register` | JSON `displayName`, `email`, `password`; returns user, token, expiry (201) |
| POST | `/auth/login` | JSON `email`, `password`; returns user, token, expiry (200) |
| GET | `/auth/me` | Requires `Authorization: Bearer <token>`; returns only the signed-in user |
| POST | `/auth/logout` | Requires bearer token; revokes it and returns 204; safe to retry |
| GET | `/health` | API process health |
| GET | `/ready` | Database connection and both migrations |

A public user response includes only `id`, `email`, and `displayName`. Tokens and
passwords must not be pasted into chat, logged, or committed. Use the app for
beginner testing instead of typing passwords into terminal commands that might
save them in shell history.

## Limits and next steps

This is a working local authentication milestone, not a public-release claim.
Registration and login share a limit of 20 attempts per IP per 15 minutes.
After HTTP 429, wait for the window to pass. This limiter is in memory: restarting
the server resets it. Deployment must add correctly scoped proxy trust and a
shared limiter if running multiple server instances. Registration errors still
allow an observer to infer whether an email is already registered; stronger
anti-enumeration requires a verified-email flow.

Email verification, password reset, password changes, account deletion UI,
all-device session revocation, and two-factor authentication are not implemented
yet. Expired sessions are rejected immediately and cleaned up for that user at
login; deployment should also schedule expired-session cleanup. Public deployment
requires HTTPS and production database credentials. The HTTP instructions here
are only for local development.

The journal, goals, moods, and AI screens still come later. This step exposes only
one protected resource: your basic profile. Every future personal-data endpoint
must enforce session ownership separately.

Stop at this checkpoint. Step 5 will build the mobile navigation and main screens.
