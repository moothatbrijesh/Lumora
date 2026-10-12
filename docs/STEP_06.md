# Step 6 — Connect AI chat to OpenAI

The code is implemented. Automated tests pass using clearly labelled test replies;
a live OpenAI reply still needs a securely configured API key and a successful
live check. No source files need to be created manually.

## How it works and why

The app sends your message to the authenticated Lumora backend. The backend checks
that you own the conversation, sends a limited recent history to OpenAI, and saves
the completed question and answer in PostgreSQL. Keeping OpenAI on the backend
protects your API key from being included in the downloadable mobile app.

Chat supports new conversations, saved history, loading feedback, retrying a failed
send, and deleting a conversation with confirmation. Lumora's instructions ask for
supportive, inclusive guidance and appropriate professional-help boundaries.
Journal, goals, mood, dashboard, and settings editing remain future milestones.

## 1. Configure the key securely

An OpenAI API account with available API credit/billing is required. A ChatGPT
subscription does not include API usage. Create a key in your OpenAI platform
account and configure a suitable project budget/usage alerts there.

In this cloud environment, open **environment settings**, enter the secret named
`LUMORA_OPENAI_API_KEY`, and save. The secret requirement and access to
`api.openai.com` have been saved for review. Review/save the updated environment
configuration and publish it through the product when ready; saving a draft alone
does not publish a new environment or prove that a key reached a running process.
Do not paste the key into this conversation.

For your own computer, use your editor to add `LUMORA_OPENAI_API_KEY` to the ignored
`backend/.env` file. Use `backend/.env.example` as the template without replacing
existing database settings. Never put the key in `mobile-app/`, an `EXPO_PUBLIC_`
variable, source code, screenshots, or GitHub commits.

The default model is `gpt-4.1-mini`. The optional backend variable
`LUMORA_OPENAI_MODEL` can select another compatible Responses API text model
available to your project. An unavailable model produces a friendly service error.

## 2. Install and update the database

From the repository root:

```bash
docker compose up -d --wait db
cd backend
npm ci
npm run db:migrate
npm run db:check
```

Migration `003_chat_requests.sql` adds stable message ordering and records completed
requests so retrying a saved reply does not create duplicate messages. Migrations
can be rerun safely. Keep your existing database volume.

## 3. Check OpenAI, then start the backend

While inside `backend/`, after securely supplying the key:

```bash
npm run ai:check
npm run dev
```

`ai:check` makes **one billable request** with a generic test prompt and prints a
success/failure message without printing the key or reply. It is separate from
automated tests to avoid unexpected charges. If it says the key is missing, check
the environment setting or your local `.env`. If the service is unavailable,
check project billing, key permissions, model access, and network connectivity.
Restart an existing backend after changing secret settings; stop its terminal
with Ctrl+C before running `npm run dev` again.

## 4. Open the app and try one conversation

In a second terminal, from the repository root:

```bash
cd mobile-app
npm ci
npm run web
```

On your own computer, `npm start` runs Expo for a phone; follow Step 2 for the API
address. Cloud localhost is not accessible from your phone.

Sign in, open **Chat**, and send a simple message such as “Help me choose one small
goal for today.” A loading message should become a real answer. Switch to a new
conversation and back to check history. Delete a disposable conversation to check
the confirmation. Without a key, Chat explains that setup is needed and keeps
sending disabled; existing history remains readable.

## Files already created or changed

| File | Purpose |
| --- | --- |
| `backend/src/openai-chat.ts` | Official OpenAI SDK, Responses API, guidance, timeout, and sanitized errors |
| `backend/src/chat.ts` | Authenticated conversations, messages, ownership, limits, and retries |
| `backend/src/session-user.ts` | Shared session lookup for profile and chat |
| `backend/src/check-ai.ts` | Optional live OpenAI check |
| `backend/src/app.ts`, `backend/src/server.ts` | Connect chat routes and configured provider |
| `backend/src/database.ts` | Readiness requires all three migrations |
| `backend/.env.example` | Safe configuration names, with no real key |
| `database/migrations/003_chat_requests.sql` | Ordered messages and completed-request records |
| `mobile-app/src/screens/ChatScreen.tsx` | Chat UI, draft retention, history, and deletion |
| `mobile-app/src/api.ts`, `mobile-app/src/auth/AuthProvider.tsx` | Authenticated requests and expiry handling |
| `mobile-app/src/navigation.tsx`, `mobile-app/src/screens/MainScreens.tsx` | Replace the Chat placeholder and update Home |
| `backend/tests/openai.test.ts`, `backend/tests/chat.integration.ts` | Provider contract and database/API tests |
| `backend/tests/chat-browser-server.ts`, `tests/browser/chat.cjs` | Test-only provider with real UI and database |
| Package manifests and lockfiles | Reproducible SDK, proxy, and mobile UUID dependencies |

## API endpoints

Every endpoint below requires `Authorization: Bearer <session token>`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/chat/status` | Key configuration and maximum input length; not a live provider check |
| GET | `/chat/conversations` | List your conversations |
| POST | `/chat/conversations` | Create an empty conversation |
| GET | `/chat/conversations/:id/messages` | Read your conversation's messages |
| POST | `/chat/conversations/:id/messages` | Send `{ "content": "...", "requestId": "a UUID" }` |
| DELETE | `/chat/conversations/:id` | Delete your conversation and its messages |

The mobile app generates and reuses the request UUID when retrying the same draft.
A saved request returns its original pair of messages; reusing that ID for different
content is rejected. Another account cannot read, send to, or delete your conversation.

## Limits, privacy, and current boundaries

- Maximum 4,000 input characters, 50 conversations per account, and 200 messages
  (100 question/answer pairs) per conversation.
- Each call uses at most 12 recent stored messages, capped at 24,000 JavaScript
  string characters, plus your new message. Older history is visible but may no
  longer influence the answer. Replies are capped at 900 output tokens.
- Creation and send requests share 30 attempts per account per ten minutes. The
  server permits two simultaneous provider requests per process. These limits
  are for the current single-server development setup, not a global spending cap.
- OpenAI calls time out after 35 seconds; the mobile send waits up to 60 seconds.
  Automatic SDK retries are disabled. A failed attempt can still incur provider
  charges, particularly if a response is lost before the database commit.
- Successful question/answer pairs save together. Failed sends retain the draft
  in the current screen. Unsent drafts and retry IDs do not survive app reload or
  sign-out. Check saved history before composing a replacement after a reload.
- Messages and selected history go to OpenAI. `store: false` disables Responses
  API response storage; it does not promise zero provider retention. Lumora stores
  conversations in its database. Deleting removes the app's conversation and
  associated records, not independently retained backups or provider logs.
- Replies render as plain text. There is no streaming or external tool execution.
  Physical-device testing and production deployment remain pending. AI guidance
  is not a substitute for professional care or emergency services.

## Automated checks (no OpenAI charges)

From the repository root:

```bash
docker compose --profile test up -d --wait
cd backend
npm run typecheck
npm test
npm run test:db
npm run build
cd ../mobile-app
npm run typecheck
npm run export -- --max-workers 2
```

The backend has 8 HTTP/SDK tests and 30 database/auth/chat checks (33 results
including their parent tests). The SDK uses a fake HTTP transport; database tests
use isolated schemas in the separate test database. Tests cover ownership,
validation, context, ordered persistence, concurrent sends, rollback, expiry,
missing configuration, retries, and deletion.

With the development backend on port 3000 and Expo web on 8081, from the root:

```bash
cd tests/browser
npm ci
npx playwright install chromium
npm test
npm run test:chat
```

In this cloud, Chromium is installed already; replace the final three commands with:

```bash
LUMORA_BROWSER_EXECUTABLE=/usr/bin/chromium npm test
LUMORA_BROWSER_EXECUTABLE=/usr/bin/chromium npm run test:chat
```

The chat browser test starts a separate test-only server and checks draft retention,
failed-send retry, a lost response after saving, history, and deletion/cancellation.
Its replies explicitly say TEST FIXTURE. It never proves live OpenAI access.

These checks passed for this milestone, including exports for Android, iOS, and
web. Native exports are bundles, not installable app-store builds. Live validation
is pending the API key. Finish that check before proceeding to Step 7.
