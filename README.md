# ferry-services

Scottish Ferries server, public web pages, API, background jobs, SQLite migrations and offline snapshot generation.

## Project Layout

```text
ferry-services/
  src/
    api/          Fastify server, JSON API routes and API DB access
    fetchers/     External data fetchers, each with colocated DB access and tests
    ingesters/    Batch data ingestion pipelines, each with colocated DB access and tests
    web/          HTML routes, pages and web-specific DB access
    push/         Push notification delivery and payloads
    offline-snapshot/
                  Offline SQLite snapshot generation
  public/         Static web assets served by Fastify
  sqlite/         SQLite migrations and seed data
  test/           Node test runner tests
  scripts/        deployment and database backup/restore helpers
  compose.yaml    production services
  Dockerfile      single production image for web, API and jobs
```

Fastify is the only runtime entry point. It serves server-rendered HTML pages and the JSON API from the same process.

## Local Setup

```bash
npm ci
cp .env.example .env
npm run build
npm run migrate
npm run dev
```

Useful checks:

```bash
npm run typecheck
npm test
npm run build
```

Tests use isolated temporary SQLite databases seeded from `sqlite/migrations/001_initial.sql` and `sqlite/seed.sql`.

## Runtime Model

The server serves:

```text
/                  public service list
/service/:id        public service detail
/service/:id/info   public disruption details
/privacy-policy     privacy policy
/api/...            JSON API for native apps and other clients
/openapi.json
/swagger
```

Scheduled work runs as dedicated long-running Docker services that repeatedly invoke the same package scripts:

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
Vessel fetching uses MarineTraffic polling by default; set `AIS_STREAM_API_KEY` to keep the same fetcher service connected to AISStream while it periodically polls MarineTraffic for fallback position coverage.

TransXChange ingest requires `TRAVELLINE_FTP_ADDRESS`, `TRAVELLINE_FTP_USERNAME`, and `TRAVELLINE_FTP_PASSWORD` when no local directory or ZIP file is passed. Offline snapshot generation writes `offline/snapshot.sqlite3` and `offline/snapshot.meta.json`; the API serves the SQLite file from `/api/offline/snapshot.sqlite3`.

CalMac information-change push notifications can optionally use a local Ollama model to shorten current changed facts. The integration is fail-open: unsafe output, timeouts and an unavailable model use the generic information-change message instead. Set `OLLAMA_URL=http://ollama:11434` in production to enable it. The model is unloaded after each request to release RAM between scrapes.

## Configuration

Runtime state and secrets live at the project root:

```text
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
OLLAMA_URL=
OLLAMA_MODEL=qwen3:1.7b
OLLAMA_TIMEOUT_MS=30000
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
Deployments also start Ollama and pull the configured `OLLAMA_MODEL` into a persistent Docker volume. The application only calls Ollama when `OLLAMA_URL` is configured.

Manual deploy:

```bash
APP_ROOT=/home/stefan/ferry-services-server-v3 IMAGE_TAG=latest scripts/deploy-docker.sh
```

Production database backup:

```bash
APP_ROOT=/home/stefan/ferry-services-server-v3 scripts/backup-prod-db.sh
```

That uses host `sqlite3` and SQLite's `.backup` command to write a hot backup to `data/backups/ferry-services-<timestamp>.sqlite3` by default. Pass a path argument to override the output file.

Production database restore:

```bash
APP_ROOT=/home/stefan/ferry-services-server-v3 scripts/restore-prod-db.sh data/backups/ferry-services-2026-05-16T18-00-00Z.sqlite3
```

That stops the compose stack, snapshots the current live DB to a `*.pre-restore-<timestamp>.sqlite3` file next to it, restores the chosen backup, removes any stale SQLite WAL/SHM sidecars, and starts the stack again.
