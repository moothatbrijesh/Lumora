# Step 7 — Daily mood check-ins and optional faith preferences

This update adds two working features. You do not need to create these files
yourself: they are included in the GitHub branch `codex/lumora-step-5`.
The branch keeps its existing name so your checkout can continue receiving updates.

## What you can do

- From **Home → Check in with yourself**, choose a mood from Very low to Great
  and optionally add a note. Save once per day and update that day's entry later.
  View your latest 30 saved check-ins underneath the form.
- From **Profile → Faith and worldview**, optionally choose Hindu, Sikh, Muslim,
  Christian, Buddhist, Jewish, Jain, Spiritual, Another faith or worldview,
  No religion, or Prefer not to say.
- Turn on **Use my preference in chat**, then save, to let future AI replies
  draw on your selection. Choosing a faith alone does not turn this on.
  For No religion, enabled personalization requests secular guidance.

Faith is never required to register or use Lumora. The default is **Prefer not
to say**, with personalization **off**. You can change your choice, switch
personalization off, or save Prefer not to say to clear the stored selection.
Lumora is instructed to respect differences within every tradition, avoid
proselytizing and invented scripture, and keep advice practical and supportive.
AI responses can still be mistaken; this preference does not guarantee theological accuracy.

## 1. Get the update on Windows

Why: your computer needs the new screens and API code from GitHub.

Stop the running backend and Expo terminals with **Ctrl+C** first. Keep Docker
Desktop running. Open PowerShell and run these commands in order:

```powershell
Set-Location "$env:USERPROFILE\Projects\Lumora"
git branch --show-current
git pull --ff-only
```

The branch should be `codex/lumora-step-5`. If Git reports a conflict or a different
branch, stop here and share the error text. Do not discard your local changes.
The update does not replace your ignored `.env` files or Gemini key/model settings.

**Checkpoint:** Git finishes successfully. No new dependencies are needed for
this feature if the previous version was already installed.

## 2. Update the database and start the backend

Why: a migration adds the two preference fields to existing accounts. Existing
accounts start with personalization off; your moods and conversations are kept.
The original database already has the mood table, so it can be reused.

From the same PowerShell window:

```powershell
docker compose up -d --wait db
Set-Location "$env:USERPROFILE\Projects\Lumora\backend"
$env:NODE_USE_SYSTEM_CA = "1"
npm.cmd run db:migrate
npm.cmd run db:check
npm.cmd run dev
```

**Checkpoint:** migration `004_user_preferences.sql` is applied (or already
applied), the database check passes, and `Lumora API listening on port 3000`
appears. Leave this window open. Migrations can safely be run again.

## 3. Start the app

Why: restarting Expo loads the new screens. Open a second PowerShell window:

```powershell
Set-Location "$env:USERPROFILE\Projects\Lumora\mobile-app"
$env:NODE_USE_SYSTEM_CA = "1"
npm.cmd run web
```

Open the address Expo displays and sign in with your existing account. Browser
sign-in is held in memory, so refreshing the page requires signing in again.

**Checkpoint:** Home appears with **Check in with yourself**. Complete this
before moving to the feature checks below.

## 4. Try a mood check-in

1. Open **Check in with yourself**.
2. Select **Okay**, add a fictional note such as “Testing a daily reflection,”
   and tap **Save check-in**.
3. Check the saved confirmation and recent entry.
4. Change the mood to **Good** and tap **Update check-in**. There should still be
   one entry for today.
5. Go back, reopen the screen, and confirm the saved mood and note appear.

The date uses your device's time zone, with today's date calculated by the
server. If a screen stays open across midnight, Lumora asks you to reload the
current day before saving. It keeps your draft available instead of silently
filing it under another date. Notes can contain up to 2,000 characters in the app.
History shows entries you actually saved; missing days are not failures or zero scores.

## 5. Try optional faith personalization

1. Open **Profile → Faith and worldview**.
2. Choose a preference and leave the switch off. Tap **Save preferences**.
3. Reopen the screen to confirm the selection is saved and the switch is off.
4. Turn on **Use my preference in chat** and save.
5. Open **Chat**, start a new conversation, and ask a fictional question such as
   “Help me build a gentle morning routine.” This uses a real AI request and your
   project's quota when your backend has a working key.
6. Return to preferences, switch personalization off, and save to stop using
   the saved preference for future requests.

You may use the app and save preferences without an AI key. Generating replies
still needs the Gemini or OpenAI setup from [Step 6](STEP_06.md).

## What is stored and shared

- Moods and notes are stored in your Lumora database account. These endpoints
  only read and write the signed-in user's entries. They do not call an AI service,
  and saved moods/notes are not automatically added to chat.
- Your faith selection and opt-in switch are stored on your account. When the
  switch is off, the saved selection is not included in new AI requests.
- When enabled, the selected preference is sent to the configured AI provider
  alongside the conversation context for new replies. Saving preferences itself
  does not call the provider.
- Changing preferences affects the next newly generated reply, including in an
  existing conversation. Turning personalization off does **not** erase older
  chat messages, including faith information you previously shared. Start a new
  chat to avoid sending previous conversation context; delete a conversation to
  remove that history from Lumora. This does not delete provider-held data.
- Gemini's unpaid service has its own [data-use terms](https://ai.google.dev/gemini-api/terms).
  Use fictional information while testing. Choose what you are comfortable sharing.

## Files and their purpose

| File | Purpose |
| --- | --- |
| `backend/src/moods.ts` | Authenticated daily mood saving, validation, dates, and recent history |
| `backend/src/preferences.ts` | Authenticated faith/worldview settings |
| `database/migrations/004_user_preferences.sql` | Safe defaults and database constraints for preferences |
| `backend/src/database.ts` | Readiness requires the new migration |
| `backend/src/app.ts` | Connects the new endpoints to the API |
| `backend/src/chat.ts` | Loads the account's current opt-in before generating a reply |
| `backend/src/ai-types.ts` | Shared respectful guidance and optional preference context |
| `backend/src/gemini-chat.ts`, `backend/src/openai-chat.ts` | Pass guidance to the configured provider |
| `mobile-app/src/screens/MoodScreen.tsx` | Mood choices, note, save/update, and recent entries |
| `mobile-app/src/screens/PreferencesScreen.tsx` | Optional preference selection and separate chat opt-in |
| `mobile-app/src/screens/MainScreens.tsx`, `mobile-app/src/navigation.tsx` | Home/Profile links and screen navigation |
| `backend/tests/` | API, ownership, validation, date, and provider payload tests |
| `tests/browser/wellbeing.cjs` | Browser checks using fictional accounts and an isolated test backend |

## API reference

All endpoints below require the existing `Authorization: Bearer <session token>`
header. User IDs are taken from the authenticated session, never from the request.
Responses are marked `Cache-Control: no-store`.

| Method | Path | Request | Response |
| --- | --- | --- | --- |
| GET | `/moods?timeZone=Asia%2FKolkata` | IANA time zone in query | `{today, entry, entries}`; today's entry can be `null`; latest 30 saved entries |
| PUT | `/moods/today` | `{timeZone, recordedOn, score, note}` | `{entry}`; creates or updates today's entry |
| GET | `/preferences` | None | `{preferences: {faith, faithEnabled}}` |
| PUT | `/preferences` | `{faith, faithEnabled}` | `{preferences: {faith, faithEnabled}}` |

Mood entries contain `id`, `score`, `note`, `recordedOn`, and `createdAt`.
Scores are integers 1–5. The app and API accept up to 2,000 Unicode code points for
a note; a visible counter shows the length, and saving is disabled above the limit.
`recordedOn` must match the `YYYY-MM-DD` date returned
as `today`. A stale date gets HTTP 409; invalid fields get 400; missing or expired
sessions get 401. Retrying the same daily save does not create duplicate entries.
Concurrent edits to a day's mood use the last database write.

Faith values are `prefer_not_to_say`, `hindu`, `sikh`, `muslim`, `christian`,
`buddhist`, `jewish`, `jain`, `spiritual`, `other`, and `none`. `faithEnabled` must
be a boolean. `prefer_not_to_say` cannot be enabled. Arbitrary instructions in a
faith value are rejected; only the supported choices enter provider guidance.

## Automated checks

From the repository root:

```powershell
docker compose --profile test up -d --wait
Set-Location backend
npm.cmd run typecheck
npm.cmd test
npm.cmd run test:db
npm.cmd run build
Set-Location ..\mobile-app
npm.cmd run typecheck
npm.cmd run export
```

With the API and Expo web app running in their separate windows, open another
PowerShell window:

```powershell
Set-Location "$env:USERPROFILE\Projects\Lumora\tests\browser"
$env:NODE_USE_SYSTEM_CA = "1"
npm.cmd ci
npx.cmd playwright install chromium
npm.cmd test
npm.cmd run test:chat
npm.cmd run test:wellbeing
```

Integration and wellbeing browser tests create and remove their own random
schemas in the disposable `TEST_DATABASE_URL` database. The existing navigation
smoke test creates and removes only its own fictional development accounts.
Provider tests use test responses and make no paid AI calls. Expo export checks
Android, iOS, and web bundles; it does not install or test the app on a physical phone.

Journal, goal editing, progress charts, notification/appearance settings,
GitHub Actions, and deployment remain later milestones.
