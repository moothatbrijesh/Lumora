# Step 5 — Navigate Lumora

This documents the Step 5 checkpoint. [Step 6](STEP_06.md) replaces the Chat
placeholder with the OpenAI integration.

The signed-in app now has a consistent design and seven screens. These files are
already created; no source-code copying is needed.

## What works now

After registration or login, five tabs appear along the bottom:

| Tab | What you can do now |
| --- | --- |
| Home | See your name, an encouragement, and shortcuts to Mood, Journal, and Progress |
| Chat | View the planned AI companion screen and a reflection prompt |
| Journal | View the journal introduction and a writing prompt |
| Goals | View the goal-tracking introduction |
| Profile | View your account, check your session/connection, and sign out |

On Home, **Check in with yourself** opens Mood and **See your journey** opens
Progress. Use the screen's Back button to return to Home. On Android, native
navigation also supports the system Back button; a physical-device check is still
needed before release.

Chat, journal writing, goal editing, mood recording, progress calculations, and
settings editing are marked **Coming soon**. These screens deliberately have no
fake Send or Save buttons, fabricated conversation, or invented progress numbers.
The Home quote is a static reminder, not a daily quote service yet.

## Why we added navigation

Tabs make the frequently used areas easy to reach. Mood and Progress open as
separate screens, keeping the bottom bar readable on a small phone. A shared
design keeps colors, spacing, buttons, and cards consistent.

Authentication now lives above navigation. Signing out or detecting an expired
session removes the signed-in navigator entirely. The next account starts on
its own Home screen; the previous user's navigation state is not reused.

## Files and their roles

| File | Purpose |
| --- | --- |
| `mobile-app/App.tsx` | Chooses loading, sign-in, or signed-in navigation |
| `mobile-app/src/auth/AuthProvider.tsx` | Shared session state, restore, sign-in, session check, and sign-out |
| `mobile-app/src/AuthPanel.tsx` | Registration/login form, using the shared auth provider |
| `mobile-app/src/navigation.tsx` | Typed React Navigation tabs and Mood/Progress stack |
| `mobile-app/src/screens/MainScreens.tsx` | Home, Chat, Journal, Goals, Mood, Progress, and Profile |
| `mobile-app/src/theme.ts` | Shared colors and styles |
| `mobile-app/src/components.tsx` | Reusable screen, card, brand, and button components |
| `tests/browser/navigation.cjs` | Automated real-browser navigation and authentication smoke test |
| `tests/browser/package.json` | Separate dependencies and command for browser tests |

There is no new database migration or backend feature in Step 5.

## Start the app

From your repository root (cloud path: `/workspace/Lumora`):

```bash
docker compose up -d --wait db
cd backend
npm ci
npm run db:migrate
npm run dev
```

Keep the backend terminal open. In another terminal at the repository root:

```bash
cd mobile-app
npm ci
npm run web
```

Use `npm start` for Expo Go on your phone. See Step 2 for the correct API address.
Keep your existing `.env` files; for a first checkout, copy the examples following
Steps 2–3. In the cloud, set `export npm_config_cache=/workspace/.npm-cache` before
installing dependencies if needed. Cloud localhost is not reachable from your
phone; a local clone is the simplest way to try Expo Go.

Restart Expo after installing the new navigation dependencies. If an old server
is still running, stop it with Ctrl+C rather than starting duplicate servers.

## Check the milestone

1. Register or sign in. Home should show your own name.
2. Tap each of the five tabs. The selected tab should be highlighted.
3. From Home, open Mood and Progress, then use Back.
4. Open Profile. Check my session should confirm that it is active.
5. Check connection should say **Lumora is connected and ready.** This now checks
   `/ready`, including the database, instead of Step 2's process-only check.
6. Sign out. The tabs should disappear and the sign-in form should return.
7. Sign in as another test user. You should see that user's name and email.

The browser deliberately forgets sign-in on refresh. Native SecureStore behavior
is unchanged from Step 4 and still needs testing on an actual phone.

## Automated checks

From `mobile-app/`:

```bash
npm run typecheck
npm run export -- --max-workers 2
```

To run the browser test, first start the backend on port 3000 and Expo web on
port 8081. Use only a local development database configured in `backend/.env`.
Then, from the repository root:

```bash
cd tests/browser
npm ci
npx playwright install chromium
npm test
```

In this cloud, Chromium is already installed. Instead of downloading it, run:

```bash
LUMORA_BROWSER_EXECUTABLE=/usr/bin/chromium npm test
```

The test creates uniquely named fictional accounts and deletes only those
accounts at the end. It verifies tabs, detail screens, Back, session checks,
connection checks, logout/retry, expiry, account switching, and browser refresh.
It also checks layouts at small-phone, phone, and desktop widths. It does not
replace native-device testing. Do not point it at a production database.

Backend regression checks remain in `backend/`: `npm test` and `npm run test:db`
(after starting the Compose test database as described in Step 4).

## Saving milestones to GitHub

We can save tested milestones throughout development instead of waiting for the
whole app. A **commit** records a local checkpoint; a **push** uploads it to GitHub.
A **branch** keeps work separate from `main`. A **pull request** lets you inspect
and merge that branch when ready. Pushing does not deploy the app or publish it
to an app store.

This checkpoint is intended for `codex/lumora-step-5`, including the foundation
from Steps 1–4. The task's completion message reports whether the push and pull
request actually succeeded. GitHub Actions automation and deployment remain
future milestones; the workflows folder currently contains only a placeholder.

## Next checkpoint

Step 6 connects the Chat screen to OpenAI through the backend. We will set up the
API key securely when it is needed; do not paste it into chat or mobile code.
