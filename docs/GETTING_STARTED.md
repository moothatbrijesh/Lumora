# Build Lumora, one step at a time

Lumora now has an Expo app with registration/login, a Node.js API, and PostgreSQL. Follow
[Step 2](STEP_02.md) for the app, [Step 3](STEP_03.md) for the database,
and [Step 4](STEP_04.md) for accounts. The original product vision is in
`PRODUCT_VISION.md` and `Project_Brief`.

## Step 1 — Organize the project (complete)

Each part of the app has its own folder:

| Path | Purpose |
| --- | --- |
| `mobile-app/` | Expo and TypeScript mobile app: screens, navigation, and API client |
| `backend/` | Node.js API: authentication, validation, and server-side OpenAI calls |
| `database/` | PostgreSQL schema, migrations, and development sample data |
| `tests/` | Integration and end-to-end tests; component tests may also live beside code |
| `docs/` | Beginner setup, architecture, and deployment instructions |
| `.github/workflows/` | GitHub Actions automation for checks and deployment |
| `.gitignore` | Keeps dependencies, generated files, and local secrets out of Git |

Empty folders contain `.gitkeep`, a placeholder that lets Git save the folder.
We will remove the placeholders when we add real files.

To inspect this step in the cloud terminal:

```bash
cd /workspace/Lumora
git status --short
cat docs/GETTING_STARTED.md
```

On your own computer, first open a terminal inside your cloned Lumora folder;
the cloud-specific `/workspace/Lumora` path will not apply there.

## Our next steps

We will finish and check each step before starting the next.

1. **Project structure:** give every part of the project a clear home. Complete.
2. **Runnable foundation:** initialize Expo/TypeScript and the Node.js API; verify
   the mobile starter and API health endpoint. Implemented; see the Step 2 guide.
3. **Database:** add PostgreSQL, migrations, Docker for local development, and
   sample data so information can persist between sessions. Implemented; see the Step 3 guide.
4. **Registration and login:** accounts, expiring sessions, and a protected profile.
   Implemented; see the Step 4 guide. Other personal-data endpoints come later.
5. **Mobile design and navigation:** five tabs plus Mood and Progress screens.
   Implemented; see [Step 5](STEP_05.md).
6. **AI chat:** connect the backend to OpenAI with supportive, inclusive guidance,
   appropriate wellbeing boundaries, and clear error and loading states.
7. **Personal growth features:** add daily quotes, journal, goals, moods,
   dashboard, profile, and settings with user-specific storage.
8. **Quality checks:** add automated tests as features arrive, then validate the
   complete workflow and wire checks into GitHub Actions.
9. **Deployment:** add deployment configuration, publish the backend and database,
   and create an installable mobile build.

Each step will include the files changed, why they exist, commands to run, and
how to recognize success. Setup instructions in README.md will evolve alongside
working code.

## Deployment direction

Our default recommendation is **Render** for the Node.js backend and managed
PostgreSQL, and **Expo EAS** for mobile builds and distribution. Render can connect
to GitHub and deploy after GitHub Actions checks pass. Expo EAS builds the Android
and iOS apps; a backend hosting platform does not publish a mobile app for you.

We will generate deployment files after the application runs locally. Before
creating paid resources, we will check current pricing and confirm the choice.
Public app-store releases need developer accounts and store review; development
can begin using Expo Go without publishing to a store.

OpenAI requests will run only on the backend. Never place an OpenAI secret key
in the mobile app, GitHub source files, or chat. We will document secure secret
configuration when the integration needs it.
