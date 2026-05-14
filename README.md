# ferry-services-server-v3

TypeScript port of the Ferry Services backend.

This repo is intentionally kept simple:

- Node.js 22+
- TypeScript
- Fastify for HTTP
- TypeBox for config and route schemas
- OpenAPI and Swagger UI
- SQLite via `better-sqlite3`
- direct APNs and FCM push delivery
- no Docker
- CI-built release artifacts deployed to the VPS

## Goals

- Preserve the existing mobile API contract while porting from v2 in small slices.
- Keep SQLite as the primary data store.
- Keep background work as one-shot CLI jobs rather than adding a queue system or in-process scheduler.
- Build in CI, not on the VPS.
- Call Apple/Google directly for push notifications.

## Non-Goals

- No Dockerfile or Compose setup.
- No ORM unless plain SQL becomes a clear maintenance problem.
- No distributed worker platform.
- No framework-first rewrite.

## Proposed Layout

```text
ferry-services-server-v3/
  src/
    api/          Fastify server, routes, OpenAPI/Swagger/static serving
    config/       typed environment/config loading
    db/           SQLite connection, migrations, query modules
    jobs/         scraper/fetcher/ingester/snapshot CLI entry points
    push/         APNs and FCM delivery
    types/        API and domain types
  sqlite/
    migrations/   forward-only SQL migrations
    seed.sql      reference seed data
  public/         static web/API docs assets if needed
  scripts/        deploy and maintenance scripts
```

## Runtime Model

The API should run as a normal Node process behind a reverse proxy:

```bash
node dist/api/server.js
```

API documentation should be available at:

```text
/openapi.json
/swagger
```

Scheduled work should run as separate one-shot commands, triggered by cron or systemd timers:

```bash
node dist/jobs/scraper.js
node dist/jobs/weather-fetcher.js
node dist/jobs/vessel-fetcher.js
node dist/jobs/transxchange-ingester.js
node dist/jobs/rail-departure-fetcher.js
node dist/jobs/offline-snapshot-generator.js
```

Each job should do one pass of its work, log failures for individual records, and exit. Repetition belongs outside the Node process; for example, run weather roughly every 15 minutes and vessel positions roughly every 5 minutes from systemd timers. This keeps deploys, restarts, and failures simple.

The fetchers are also available through npm scripts after a build:

```bash
npm run scrape
npm run fetch:weather
npm run fetch:vessels
npm run fetch:rail
npm run fetch:timetable-documents
npm run generate:offline-snapshot
npm run ingest:transxchange
npm run ingest:transxchange -- /path/to/extracted/S # local fixture/feed override
npm run ingest:transxchange -- ./S.zip # local downloaded ZIP override
```

Weather fetching requires `OPENWEATHERMAP_APPID`.
Rail departure fetching requires `RAIL_DATA_API_KEY`.
TransXChange ingest requires `TRAVELLINE_FTP_ADDRESS`, `TRAVELLINE_FTP_USERNAME`, and `TRAVELLINE_FTP_PASSWORD` when no local directory or ZIP file is passed. It downloads and extracts `S.zip` temporarily under `data/transxchange-ingest`, stores the normalized TransXChange data, and removes the temporary ingest directory. To rerun without FTP, pass a ZIP file stored outside `data/transxchange-ingest`.

Offline snapshot generation writes `offline/snapshot.sqlite3` and `offline/snapshot.meta.json`. The API serves the SQLite file from `/api/offline/snapshot.sqlite3` with ETag and Last-Modified headers.

Sentry is optional. The v3 services use the same project-specific DSN environment variables as v2 where possible:

```text
SERVER_SENTRY_DSN
SCRAPER_SENTRY_DSN
WEATHER_FETCHER_SENTRY_DSN
VESSEL_FETCHER_SENTRY_DSN
RAIL_DEPARTURE_FETCHER_SENTRY_DSN
TIMETABLE_DOCUMENT_SCRAPER_SENTRY_DSN
TRANSXCHANGE_INGESTER_SENTRY_DSN
OFFLINE_SNAPSHOT_GENERATOR_SENTRY_DSN
```

`SENTRY_TRACES_SAMPLE_RATE` is optional; the trace sample rate defaults to `0.1` when Sentry is enabled. Sentry environment is inferred from `NODE_ENV`: `production` when `NODE_ENV=production`, otherwise `development`. Frontend requests can be correlated when the frontend Sentry SDK sends the standard `sentry-trace` and `baggage` headers.

## Deployment Model

CI owns build and test:

```bash
npm ci
npm run typecheck
npm test
npm run build
```

CI should publish a release artifact containing runtime files only:

```text
dist/
node_modules/
package.json
package-lock.json
sqlite/
public/
deploy/
scripts/
```

Deployment uploads the artifact to `/tmp`, unpacks it directly into `/home/stefanchurch/ferry-services-server-v3`, applies migrations and restarts the API. Production dependencies are installed and pruned in CI, then shipped in the artifact, so the VPS does not build or install packages:

```bash
npm run migrate
systemctl restart ferry-services
```

The GitHub Actions deploy job runs this automatically on pushes to `main`. It expects these repository secrets:

```text
DEPLOY_HOST
DEPLOY_USER
DEPLOY_SSH_KEY
DEPLOY_PORT # optional, defaults to 22
```

Systemd unit templates are stored under `deploy/systemd/`. Install or refresh them manually on the VPS when they change:

```bash
sudo cp deploy/systemd/* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ferry-services.service
sudo systemctl enable --now ferry-services-scraper.timer
sudo systemctl enable --now ferry-services-weather-fetcher.timer
sudo systemctl enable --now ferry-services-vessel-fetcher.timer
sudo systemctl enable --now ferry-services-rail-departure-fetcher.timer
sudo systemctl enable --now ferry-services-timetable-document-fetcher.timer
sudo systemctl enable --now ferry-services-transxchange-ingester.timer
```

Timer behaviour:

- `ferry-services-scraper.timer`: every 15 minutes after the previous run finishes.
- `ferry-services-weather-fetcher.timer`: every 15 minutes after the previous run finishes.
- `ferry-services-vessel-fetcher.timer`: every 5 minutes after the previous run finishes.
- `ferry-services-rail-departure-fetcher.timer`: every 1 minute after the previous run finishes.
- `ferry-services-timetable-document-fetcher.timer`: every 6 hours after the previous run finishes.
- `ferry-services-transxchange-ingester.timer`: once per day at 02:00 Europe/London. A successful ingest then runs offline snapshot generation.

## Database

Use one database command for local setup and production deploys:

```bash
npm run migrate
```

It creates the database if needed, applies pending migrations, and loads reference seed data when the database is empty. The baseline uses v3 TransXChange tables without carrying the v2-specific `tx2_*` table prefix forward.

SQLite data should live outside the deployed app directory:

```text
/home/stefanchurch/ferry-services-server-v3/
  dist/
  node_modules/
  public/
  sqlite/
  scripts/
  .env
  data/ferry-services.sqlite3
```

## Push Notifications

- iOS: send directly to APNs using token-based authentication.
- Android: send directly to FCM HTTP v1 using Google service account credentials.
- Store the app installation, device token, platform, push enabled flag, and delivery metadata locally.

## Porting Order

1. Bootstrap Fastify, config, SQLite, and migrations.
2. Port read-only API contract: `/api/services`, `/api/services/:serviceID`, `/api/vessels`, `/api/timetable-documents`.
3. Port installations and direct push registration/delivery.
4. Port offline SQLite snapshot generation.
5. Port background fetchers and TransXChange ingest.
6. Add CI artifact packaging and VPS deployment scripts.

## Web Dist

The API server preserves the v2 root behavior by serving `public/index.html` at `/` when the web build has been published into `public/`. Static assets under `public/` are served by the API process. API and documentation routes remain available under `/api`, `/openapi.json`, and `/swagger`.
