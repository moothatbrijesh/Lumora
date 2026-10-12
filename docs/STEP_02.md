# Step 2 — Run Lumora’s foundation

## What this step does and why

The **mobile app** is what a person sees and taps. The **backend** is a separate
program that will securely access the database and OpenAI. We start with a
health endpoint: a small request that proves the two programs can communicate
before adding accounts or personal data.

All files for this step have already been created in this checkout. You do not
need to paste source code into new files.

## Files added

| File or folder | Purpose |
| --- | --- |
| `mobile-app/App.tsx` | Welcome screen and connection button, including loading and failure states |
| `mobile-app/index.ts` | Registers the app with Expo |
| `mobile-app/app.json` | App name and Expo platform settings |
| `mobile-app/assets/` | Expo starter icons, to replace with final branding later |
| `mobile-app/tsconfig.json` | Strict TypeScript checks |
| `mobile-app/package.json` | App dependencies and commands |
| `mobile-app/package-lock.json` | Exact dependency versions |
| `mobile-app/.env.example` | Example public backend address |
| `backend/src/app.ts` | Health route and JSON 404 responses |
| `backend/src/server.ts` | Reads the port, starts the server, and handles shutdown |
| `backend/tests/health.test.ts` | Tests real HTTP responses and browser access headers |
| `backend/tsconfig.json` | TypeScript compilation settings |
| `backend/package.json` | Backend dependencies and commands |
| `backend/package-lock.json` | Exact dependency versions |
| `backend/.env.example` | Optional port setting |
| `.nvmrc` | Node.js major version for local development |

## 1. Check Node.js

Use Node.js 24 LTS from the official Node.js website, or nvm if already installed.
Restart your terminal after installing Node.js, then run:

```bash
node --version
npm --version
```

Node should show `v24.x.x`. npm comes with Node. This cloud environment already
has Node 24 installed. In the cloud terminal, use this writable npm cache if you
need to install dependencies again:

```bash
export npm_config_cache=/workspace/.npm-cache
```

That export applies only to the current terminal. Your own computer normally
uses npm’s default cache and does not need this command.

## 2. Start the backend

Open a terminal in your Lumora checkout. In the cloud this is `/workspace/Lumora`;
on your computer it is wherever you cloned the repository.

```bash
cd backend
npm ci
npm run dev
```

`npm ci` installs the versions recorded in the lockfile. `npm run dev` starts
the server and restarts it when backend code changes. Leave this terminal open.
The default port is 3000; creating `backend/.env` is optional.

In another terminal, verify the response:

```bash
curl http://localhost:3000/health
```

Expected body:

```json
{"status":"ok","service":"lumora-api"}
```

If port 3000 is already occupied, stop your old Lumora server with Ctrl+C, or
copy `backend/.env.example` to `backend/.env`, change PORT, and use that same
port in the app’s API address.

## 3. Set the app’s backend address

Open a second server terminal at the repository root:

```bash
cd mobile-app
npm ci
cp -n .env.example .env
```

`cp -n` keeps an existing `.env` file. On Windows PowerShell, copy the example
using File Explorer, or run `Copy-Item .env.example .env` only if `.env` does not
already exist.

Edit `mobile-app/.env` according to where you will run the app:

| Device | EXPO_PUBLIC_API_URL value |
| --- | --- |
| Browser on your development computer | `http://localhost:3000` |
| iOS simulator on that Mac | `http://localhost:3000` |
| Android Studio emulator | `http://10.0.2.2:3000` |
| Physical phone on the same Wi-Fi | `http://YOUR_COMPUTER_WIFI_IP:3000` |

For a phone, replace `YOUR_COMPUTER_WIFI_IP` with the actual local IPv4 address
shown in your computer’s network settings. Example: `http://192.168.1.20:3000`.
The phone and computer must be on the same network, and the computer’s firewall
must allow local development traffic to the backend. `localhost` on a phone
means the phone itself, not your computer.

This setting is public configuration. Never put API keys in EXPO_PUBLIC_ variables.

## 4. Run and check the app

For the easiest first check, from `mobile-app/` run:

```bash
npm run web
```

On your own computer, Expo opens the browser. You should see Lumora’s welcome
screen. Click **Check connection** and look for:

> Connected! Lumora’s foundation is ready.

For a phone, install Expo Go from the official app store, then run:

```bash
npm start
```

Scan Expo’s QR code using Expo Go on Android or the camera on iOS. The Expo Go
version must support this project’s Expo SDK 57. If your device’s store version
does not support it yet, use the browser for this checkpoint; native development
builds can be prepared later. Android emulators require Android Studio; iOS
simulators require macOS and Xcode. Neither is needed for the browser check.

**Cloud limitation:** the server processes in this cloud workspace are not on
your phone’s Wi-Fi network. A local cloud HTTP check validates the code here,
but does not give your phone access to it. Use a local clone for Expo Go, or wait
for a publicly reachable backend in the deployment step. An Expo tunnel alone
does not expose the separate backend. No public preview is configured here.

After changing `.env`, stop Expo with Ctrl+C and restart it. If needed:

```bash
npm start -- --clear
```

If the app reports a setup problem, check that `.env` is in `mobile-app/`. If it
cannot connect, verify `/health` from the target device and check the address,
port, Wi-Fi, and firewall. If an old backend server is still running, stop that
process before starting another instance.

## 5. Run the checks

From `backend/`:

```bash
npm run typecheck
npm test
npm run build
```

Type checking catches mistakes in how values are used. The three API tests check
the health response, unknown routes, and browser access headers. The build emits
JavaScript into the ignored `dist/` directory. For a production-style local
start, stop the development server first, then run:

```bash
npm start
```

From `mobile-app/`:

```bash
npm run typecheck
npm run export -- --max-workers 2
```

Export checks that Metro can bundle the Android, iOS, and web code. This is not
an emulator test, a signed native build, or an app-store submission. Two workers
keep memory usage manageable on a small development machine.

## Stop here

This milestone is complete when the starter renders and the connection check
succeeds. No data is saved and no AI service is called yet. The next step is
PostgreSQL and local database setup. We will begin it only when you are ready.
