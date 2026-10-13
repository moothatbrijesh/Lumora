# Step 6 — Connect AI chat to Gemini

Lumora supports Google Gemini and OpenAI. **Gemini is the default provider.** You
choose one provider in the backend configuration; Lumora never switches to another
provider automatically. No files need to be created manually except your ignored
local `.env` configuration.

Gemini offers a limited developer free tier for eligible accounts, regions, and
models. A free Google AI Studio website account alone does not establish that your
API project has free quota. Check your project's tier, model availability, and
current [API pricing](https://ai.google.dev/gemini-api/docs/pricing) before testing.
This guide does not require enabling billing.

Automated checks use test providers. A successful live check with your own Gemini
key is still needed to confirm access from your computer.

## How it works and why

The app sends your message to the authenticated Lumora backend. The backend checks
that you own the conversation, sends a limited recent history to the selected AI
provider, and saves the completed question and answer in PostgreSQL. Keeping the
provider connection on the backend prevents the API key from being included in
the downloadable mobile app.

Chat supports new conversations, saved history, loading feedback, retrying a failed
send, and deleting a conversation with confirmation. Lumora's instructions ask for
supportive, inclusive guidance and appropriate professional-help boundaries.
Journal, goals, mood, dashboard, and settings editing remain future milestones.

Switching providers preserves your saved conversations. **The next message sends
recent messages from that conversation to the newly selected provider.** Start a
new conversation if you do not want to send the existing history to Gemini.

## 1. Create a Gemini key for a free-tier project

1. Open [Google AI Studio API keys](https://aistudio.google.com/apikey) and sign in.
2. Create an API key for a Google project you control. If prompted, create a project.
3. Check the project's tier and available model quota in AI Studio. Use an eligible
   **Free tier** project for this setup; you do not need to enable billing.
4. Copy the key privately for the next step. Do not paste it into chat or a screenshot.

Review the [Gemini API terms](https://ai.google.dev/gemini-api/terms), particularly
unpaid-service data use, before sending personal information. Free-tier content may
be used to improve Google's products, with terms that vary by region and service.
**Use fictional, non-sensitive messages while testing.** A real key is necessary
for live replies; there is no built-in simulated production answer.

## 2. Update your existing Windows setup

These instructions assume Docker Desktop is running, your PostgreSQL service is
healthy, and Lumora is already installed in your personal `Projects` folder.
Follow [Step 3](STEP_03.md) first if the database is not set up.

Use the PowerShell window running the backend. Press **Ctrl+C** to stop it. Run
these commands **one at a time, in order**. Stop and share the error if one fails.

Open the backend folder:

```powershell
Set-Location "$env:USERPROFILE\Projects\Lumora\backend"
```

Download the Gemini integration on your current `codex/lumora-step-5` branch:

```powershell
git pull --ff-only
```

The branch name also contains Step 6. Pulling does not replace your ignored `.env`
file. This Gemini change needs no new packages and no new database migration. If
updating from before the original Step 6, use the database setup section below.

If your work network uses certificates already trusted by Windows, enable Node's
use of the Windows certificate store in this PowerShell session:

```powershell
$env:NODE_USE_SYSTEM_CA = "1"
```

This retains HTTPS certificate verification. Apply the setting again in a new
PowerShell window when necessary.

Open the backend configuration:

```powershell
notepad .env
```

Add or update these three lines, inserting your own key after
`LUMORA_GEMINI_API_KEY=`:

```dotenv
LUMORA_AI_PROVIDER=gemini
LUMORA_GEMINI_API_KEY=
LUMORA_GEMINI_MODEL=gemini-flash-latest
```

The default model is `gemini-flash-latest`, a moving alias. Google can change the
model behind it; confirm its current availability and free-tier quota in your
project. `LUMORA_GEMINI_MODEL` can select another compatible available text model.

Save with **Ctrl+S** and close Notepad. Keep your existing database settings. If a
variable already exists, edit its line instead of adding a duplicate. An existing
`LUMORA_OPENAI_API_KEY` is not used while `LUMORA_AI_PROVIDER=gemini`.

Never put a key in `mobile-app/`, an `EXPO_PUBLIC_` variable, source code, or GitHub.
`backend/.env` is ignored by Git. Keys configured in a cloud development environment
do not automatically reach this Windows computer, or the other way around.

On macOS/Linux, use the same three variables in `backend/.env` and run the commands
below with `npm` instead of `npm.cmd`. In a cloud environment, configure
`LUMORA_GEMINI_API_KEY` as a backend environment secret, set the provider and model,
and allow access to `generativelanguage.googleapis.com` if outbound access is
restricted. Never paste the key into chat.

The cloud draft includes the Gemini secret requirement, provider/model suggestions,
startup instructions, and access to `generativelanguage.googleapis.com`. For cloud
use, review and save those settings, then publish the environment. Saving a draft
alone does not apply it or configure your Windows `.env` file.

## 3. Check Gemini, then restart the backend

In your backend PowerShell window, run:

```powershell
npm.cmd run ai:check
```

This sends one generic test prompt to the selected provider. It consumes API quota
and can incur charges if the project has paid billing enabled. It prints a safe
success/failure message without your key or the reply. It is separate from the
automated tests, which make no real provider calls.

On success, the output identifies a verified Gemini connection and a complete,
non-empty reply. Then start the backend:

```powershell
npm.cmd run dev
```

Leave this window open. If the check fails, stop at that step and use the diagnostic
table below. Repeated retries use quota; they do not fix a missing project entitlement.

## 4. Open Chat and try one conversation

Keep Docker Desktop, the backend, and the Expo app running. In the browser, reload
Lumora, sign in, and open **Chat**. If the setup notice is still visible, tap
**Check chat again**. You can type a draft even before setup is complete. Sending
becomes available once the backend reports a configured key; a successful
`ai:check` confirms that the provider also accepts it.

Start a new conversation and send a fictional test such as “Help me plan a study
routine for a fictional student.” A loading message should become a real reply.
Switch to a new conversation and back to check saved history. Delete a disposable
conversation to check the confirmation.

If Expo is not running, open a second PowerShell window and run these separately:

```powershell
Set-Location "$env:USERPROFILE\Projects\Lumora\mobile-app"
```

```powershell
$env:NODE_USE_SYSTEM_CA = "1"
```

```powershell
npm.cmd run web
```

Open the web address printed by Expo. On your own computer, `npm.cmd start` starts
Expo for a phone; follow Step 2 for the API address. Cloud localhost is not
accessible from your phone.

Without a configured key, Chat explains that setup is needed and keeps sending
disabled; saved history remains readable. **New conversation** opens an empty
conversation view and focuses the message box. It does not create a database
record until the first message. Send or explicitly clear an existing draft before
switching conversations.

## Troubleshooting the live check

The diagnostic category identifies the next step without exposing provider error
bodies, request content, or your key. Status codes alone do not prove available
free quota or billing credit.

| Category | Next step |
| --- | --- |
| `authentication` | Check that the selected provider's key is correct and still active |
| `permission` | Check the project's API access, key restrictions, regional eligibility, and network gateway |
| `quota` | Check that project's model quota and tier; for paid use, also check billing limits |
| `rate_limit` | Check usage and limits; wait for the relevant limit to reset before retrying |
| `model_access` / `invalid_request` | Check that the configured model is available to your project and supported by this integration |
| `tls` | Check trusted certificates and the system clock; use the Windows certificate setting above when appropriate |
| `connection` / `timeout` | Check proxy, DNS, and firewall access to the selected provider's API host |
| `provider` | Check the provider's service status and retry later |
| `configuration` | Check the provider/model names and proxy configuration |
| `response` / `unknown` | Share the safe category message for further diagnosis; never share a key |

For Gemini, the API host is `generativelanguage.googleapis.com`; for OpenAI it is
`api.openai.com`. A missing-key message names the required variable. Changing
`backend/.env` requires restarting the backend. If a certificate error persists,
ask your IT team for the appropriate trusted certificate configuration rather than
disabling HTTPS verification.

If Gemini's free tier is not available for your project or model, do not enable
billing just to dismiss an error. Check current eligibility and model options
first. Lumora has no automatic fallback to your OpenAI key.

## Optional: explicitly select OpenAI instead

OpenAI remains supported. It requires separate API billing or credits; a ChatGPT
subscription does not include API requests. To choose it, set these backend values:

```dotenv
LUMORA_AI_PROVIDER=openai
LUMORA_OPENAI_API_KEY=
LUMORA_OPENAI_MODEL=gpt-4.1-mini
```

Enter a real key privately after `LUMORA_OPENAI_API_KEY=`, save, run `ai:check`, and
restart the backend. This check can incur an OpenAI API charge. Do not put a real
key in this guide or in a shell command. Removing `LUMORA_AI_PROVIDER` selects
Gemini by default, even if an OpenAI key is present.

## Database setup for a new checkout

From the repository root, on macOS/Linux or in the cloud:

```bash
docker compose up -d --wait db
cd backend
npm ci
npm run db:migrate
npm run db:check
```

On Windows, run each command separately and use `npm.cmd` in place of `npm`. Copy
`backend/.env.example` to `backend/.env` before migrating only if `.env` does not
already exist. Keep existing credentials and database volumes.

Migration `003_chat_requests.sql` adds stable message ordering and records completed
requests so retrying a saved reply does not create duplicate messages. Migrations
can be rerun safely. Gemini uses the same tables and adds no database migration.

## Files already created or changed

| File | Purpose |
| --- | --- |
| `backend/src/ai-types.ts` | Shared chat types, guidance, and provider error handling |
| `backend/src/ai-provider.ts` | Explicit provider selection and safe diagnostic formatting |
| `backend/src/gemini-chat.ts` | Gemini generateContent requests, bounded replies, and sanitized errors |
| `backend/src/openai-chat.ts`, `backend/src/openai-diagnostics.ts` | Optional OpenAI Responses API connection and diagnostic helpers |
| `backend/src/chat.ts` | Authenticated conversations, messages, ownership, limits, and retries |
| `backend/src/session-user.ts` | Shared session lookup for profile and chat |
| `backend/src/check-ai.ts` | Optional live check for the selected provider |
| `backend/src/app.ts`, `backend/src/server.ts` | Connect chat routes and configured provider |
| `backend/src/database.ts` | Readiness requires all three migrations |
| `backend/.env.example` | Safe configuration names, with no real key |
| `database/migrations/003_chat_requests.sql` | Ordered messages and completed-request records |
| `mobile-app/src/screens/ChatScreen.tsx` | Chat UI, provider disclosure, draft retention, history, and deletion |
| `mobile-app/src/api.ts`, `mobile-app/src/auth/AuthProvider.tsx` | Authenticated requests and expiry handling |
| `backend/tests/` | Provider contract, selection, diagnostics, database, and API tests |
| `backend/tests/chat-browser-server.ts`, `tests/browser/chat.cjs` | Test-only provider with real UI and database |

## API endpoints

Every endpoint below requires `Authorization: Bearer <session token>`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/chat/status` | Selected provider, key configuration, and maximum input length; not a live provider check |
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
  longer influence the answer. Gemini requests allow up to 4,096 output tokens,
  including any model thinking, while OpenAI replies allow up to 900 output tokens.
  Both integrations reject incomplete replies and replies longer than 8,000 characters.
- Creation and send requests share 30 attempts per account per ten minutes. The
  server permits two simultaneous provider requests per process. These limits
  are for the current single-server development setup, not a global spending cap
  or a guarantee of staying within a provider's free quota.
- Provider calls time out after 35 seconds; the mobile send waits up to 60 seconds.
  Automatic provider retries are disabled. A failed attempt can still consume
  quota or incur charges, particularly if a response is lost before database commit.
- Successful question/answer pairs save together. Failed sends retain the draft
  in the current screen. Unsent drafts and retry IDs do not survive app reload or
  sign-out. Check saved history before composing a replacement after a reload.
- Messages and selected history go to the configured provider. Gemini's free-tier
  data-use terms must be reviewed before sharing sensitive information. For OpenAI,
  `store: false` disables Responses API response storage; it does not promise zero
  provider retention. Lumora also stores conversations in PostgreSQL. Deletion
  removes the app's records, not independently retained backups or provider logs.
- Replies render as plain text. There is no streaming or external tool execution.
  Physical-device testing and production deployment remain pending. AI guidance
  is not a substitute for professional care or emergency services.

## Automated checks (no live AI requests)

From the repository root, on macOS/Linux or in the cloud:

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

On Windows, run these in order using `npm.cmd` instead of `npm`. Provider tests use
fake HTTP responses; database tests use isolated schemas in the separate test
database. Tests cover provider selection, response formats, diagnostics, ownership,
validation, context, ordered persistence, concurrent sends, rollback, expiry,
missing configuration, retries, and deletion. No real API keys are needed.

With the development backend on port 3000 and Expo web on 8081, from the root:

```bash
cd tests/browser
npm ci
npx playwright install chromium
npm test
npm run test:chat
```

On Windows, use `npm.cmd` and `npx.cmd`. In this cloud, Chromium is installed already;
replace the final three commands with:

```bash
LUMORA_BROWSER_EXECUTABLE=/usr/bin/chromium npm test
LUMORA_BROWSER_EXECUTABLE=/usr/bin/chromium npm run test:chat
```

The chat browser test starts a separate test-only server and checks draft retention,
failed-send retry, a lost response after saving, history, and deletion/cancellation.
Its replies explicitly say TEST FIXTURE. It does not prove live Gemini or OpenAI
access. Native exports are bundles, not installable app-store builds. Finish the
live Gemini check before proceeding to Step 7.
