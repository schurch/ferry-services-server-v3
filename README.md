# ferry-services

Monorepo for the Scottish Ferry Services API, background jobs and web frontend.

## Project Layout

```text
ferry-services/
  apps/
    api/          Fastify API, background jobs, SQLite migrations, OpenAPI
    web/          React/Vite frontend
  scripts/        deployment and repository automation
  compose.yaml    production services
  Dockerfile      single production image for API, jobs and built web assets
```

The API remains the production entry point. The web app builds into static assets that are copied into `apps/api/public/` during the root build, then served by Fastify from the same container and origin as the API.

## Local Setup

```bash
npm ci
cp apps/api/.env.example .env
npm run build
npm run migrate
npm run dev:api
```

Run the frontend dev server separately when working on the web app:

```bash
npm run dev:web
```

Useful root checks:

```bash
npm run typecheck
npm test
npm run build
```

The root scripts run the relevant workspace scripts. API tests use isolated temporary SQLite databases seeded from `apps/api/sqlite/migrations/001_initial.sql` and `apps/api/sqlite/seed.sql`.

## Runtime Model

The production image contains:

- the compiled API and job code from `apps/api`
- the built frontend from `apps/web`
- production Node dependencies only

The API serves:

```text
/openapi.json
/swagger
/
```

Scheduled work runs as dedicated long-running Docker services that repeatedly invoke the API workspace jobs:

```bash
npm run scrape
npm run fetch:weather
npm run fetch:vessels
npm run fetch:rail
npm run fetch:timetable-documents
npm run ingest:transxchange
npm run generate:offline-snapshot
```

Weather fetching requires `OPENWEATHERMAP_APPID`. Rail departure fetching requires `RAIL_DATA_API_KEY`.

TransXChange ingest requires `TRAVELLINE_FTP_ADDRESS`, `TRAVELLINE_FTP_USERNAME`, and `TRAVELLINE_FTP_PASSWORD` when no local directory or ZIP file is passed. Offline snapshot generation writes `offline/snapshot.sqlite3` and `offline/snapshot.meta.json`; the API serves the SQLite file from `/api/offline/snapshot.sqlite3`.

## Configuration

For local API work, copy `apps/api/.env.example` to `.env` at the repository root.

Production keeps runtime state and secrets on the host:

```text
/home/stefanchurch/ferry-services-server-v3/
  .env
  data/
    ferry-services.sqlite3
  offline/
    snapshot.sqlite3
    snapshot.meta.json
  secrets/
    AuthKey_....p8
    google-service-account.json
```

Core runtime variables:

```text
NODE_ENV=production
HOST=127.0.0.1
PORT=4322
DATABASE_PATH=./data/ferry-services.sqlite3
OPENWEATHERMAP_APPID=
RAIL_DATA_API_KEY=
TRAVELLINE_FTP_ADDRESS=
TRAVELLINE_FTP_USERNAME=
TRAVELLINE_FTP_PASSWORD=
```

Direct APNs push requires:

```text
APNS_TEAM_ID=
APNS_KEY_ID=
APNS_BUNDLE_ID=
APNS_PRIVATE_KEY_PATH=secrets/AuthKey_LV4KJJD8W4.p8
APNS_PRODUCTION=true
```

Direct FCM HTTP v1 push requires:

```text
FCM_PROJECT_ID=
GOOGLE_APPLICATION_CREDENTIALS=secrets/google-service-account.json
```

For Docker deployments, also set:

```text
APP_UID=1000
APP_GID=1000
```

The API loads `.env` from the repository root in both local workspace runs and Docker. Compose mounts `data/`, `offline/` and `secrets/` from the repository root into `/app/apps/api/` inside each container. That keeps state easy to inspect on the host while preserving the API workspace's relative paths.

## Deployment

CI runs from the repo root:

```bash
npm ci
npm run typecheck
npm test
npm run build
```

On pushes to `main`, CI builds and publishes:

```text
stefanchurch/ferry-services:latest
stefanchurch/ferry-services:<git-sha>
```

Production pulls the prebuilt image with Docker Compose. The VPS does not run `npm install` or compile native dependencies.

Manual deploy:

```bash
APP_ROOT=/home/stefanchurch/ferry-services-server-v3 IMAGE_TAG=latest scripts/deploy-docker.sh
```

Production database backup:

```bash
APP_ROOT=/home/stefanchurch/ferry-services-server-v3 scripts/backup-prod-db.sh
```

That uses host `sqlite3` and SQLite's `.backup` command to write a hot backup to `data/backups/ferry-services-<timestamp>.sqlite3` by default. Pass a path argument to override the output file.

Production database restore:

```bash
APP_ROOT=/home/stefanchurch/ferry-services-server-v3 scripts/restore-prod-db.sh data/backups/ferry-services-2026-05-16T18-00-00Z.sqlite3
```

That stops the compose stack, snapshots the current live DB to a `*.pre-restore-<timestamp>.sqlite3` file next to it, restores the chosen backup, removes any stale SQLite WAL/SHM sidecars, and starts the stack again.

The GitHub Actions deploy job expects:

```text
DEPLOY_HOST
DEPLOY_USER
DEPLOY_SSH_KEY
DEPLOY_PORT # optional, defaults to 22
DOCKERHUB_USERNAME
DOCKERHUB_TOKEN
```

The stack contains:

- `api`
- `scraper`
- `weather-fetcher`
- `vessel-fetcher`
- `rail-fetcher`
- `timetable-document-fetcher`
- `transxchange-ingester`

## Shared Code Direction

The clean long-term shared boundary is the API contract, not the whole domain model. When the web app starts consuming generated clients, add a package such as `packages/api-client/` sourced from the API's OpenAPI output and let both apps depend on that package. Keep UI code, database code and job internals private to their apps.
