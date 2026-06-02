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
```

Core runtime variables:

```text
NODE_ENV=production
HOST=127.0.0.1
PORT=4322
TRUST_PROXY=true
LOG_LEVEL=info
DATABASE_PATH=./data/ferry-services.sqlite3
OPENWEATHERMAP_APPID=
GOOGLE_MAPS_API_KEY=
AIS_STREAM_API_KEY=
RAIL_DATA_API_KEY=
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.4-nano-2026-03-17
OPENAI_TIMEOUT_MS=10000
TRAVELLINE_FTP_ADDRESS=
TRAVELLINE_FTP_USERNAME=
TRAVELLINE_FTP_PASSWORD=
```

Optional Sentry reporting:

```text
SERVER_SENTRY_DSN=
SCRAPER_SENTRY_DSN=
WEATHER_FETCHER_SENTRY_DSN=
VESSEL_FETCHER_SENTRY_DSN=
RAIL_DEPARTURE_FETCHER_SENTRY_DSN=
TIMETABLE_DOCUMENT_SCRAPER_SENTRY_DSN=
TRANSXCHANGE_INGESTER_SENTRY_DSN=
OFFLINE_SNAPSHOT_GENERATOR_SENTRY_DSN=
SENTRY_TRACES_SAMPLE_RATE=0.1
```

Direct APNs push requires:

```text
APNS_TEAM_ID=
APNS_KEY_ID=
APNS_BUNDLE_ID=
APNS_PRIVATE_KEY_PATH=
APNS_PRODUCTION=true
```

Direct FCM HTTP v1 push requires:

```text
FCM_PROJECT_ID=
GOOGLE_APPLICATION_CREDENTIALS=
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

Manual deploy:

```bash
APP_ROOT=/home/stefan/ferry-services-server-v3 IMAGE_TAG=latest scripts/deploy-docker.sh
```

Production database backup:

```bash
APP_ROOT=/home/stefan/ferry-services-server-v3 scripts/backup-prod-db.sh
```

Production database restore:

```bash
APP_ROOT=/home/stefan/ferry-services-server-v3 scripts/restore-prod-db.sh data/backups/ferry-services-2026-05-16T18-00-00Z.sqlite3
```
