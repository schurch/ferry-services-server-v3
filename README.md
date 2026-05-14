# ferry-services-server-v3

TypeScript backend for Scottish Ferry Services.

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

## Project Layout

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

## Local Setup

```bash
npm ci
cp .env.example .env
npm run build
npm run migrate
npm run dev
```

The development server listens on `HOST`/`PORT`, defaulting to `127.0.0.1:4321`.

Useful checks:

```bash
npm run typecheck
npm test
npm run build
```

`npm run typecheck` checks both production source and tests. Tests use isolated temporary SQLite databases seeded from `sqlite/migrations/001_initial.sql` and `sqlite/seed.sql`.

## Runtime Model

The API should run as a normal Node process behind a reverse proxy:

```bash
npm run start
```

API documentation should be available at:

```text
/openapi.json
/swagger
```

Scheduled work should run as separate one-shot commands:

```bash
npm run scrape
npm run fetch:weather
npm run fetch:vessels
npm run fetch:rail
npm run fetch:timetable-documents
npm run ingest:transxchange
npm run generate:offline-snapshot
```

Each job should do one pass of its work, log failures for individual records, and exit. Repetition stays in systemd timers rather than inside the Node process. This keeps each job restartable on its own and preserves separate journals per job.

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

Weather fetching requires `OPENWEATHERMAP_APPID`. Rail departure fetching requires `RAIL_DATA_API_KEY`.

TransXChange ingest requires `TRAVELLINE_FTP_ADDRESS`, `TRAVELLINE_FTP_USERNAME`, and `TRAVELLINE_FTP_PASSWORD` when no local directory or ZIP file is passed. It downloads and extracts `S.zip` temporarily under `data/transxchange-ingest`, stores the normalized TransXChange data, and removes the temporary ingest directory. To rerun without FTP, pass a ZIP file stored outside `data/transxchange-ingest`.

Offline snapshot generation writes `offline/snapshot.sqlite3` and `offline/snapshot.meta.json`. The API serves the SQLite file from `/api/offline/snapshot.sqlite3` with ETag and Last-Modified headers.

## Configuration

Copy `.env.example` to `.env` locally and set production values in `/home/stefanchurch/ferry-services-server-v3/.env` on the VPS. `dotenv` is loaded by every service from the working directory.

Core runtime variables:

```text
NODE_ENV=production
HOST=127.0.0.1
PORT=4321
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
APNS_PRIVATE_KEY_PATH=
APNS_PRODUCTION=true
```

Direct FCM HTTP v1 push requires:

```text
FCM_PROJECT_ID=
GOOGLE_APPLICATION_CREDENTIALS=
```

Sentry is optional. Each entry point can use its own DSN:

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

`SENTRY_TRACES_SAMPLE_RATE` is optional. When unset, Sentry uses a trace sample rate of `0.1`. Sentry environment is `production` only when `NODE_ENV=production`; all other values report as `development`.

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

Deployment uploads the artifact to `/tmp`, unpacks it directly into `/home/stefanchurch/ferry-services-server-v3`, applies migrations, and restarts the API. Production dependencies are installed and pruned in CI, then shipped in the artifact, so the VPS does not build or install packages.

The deployed app directory should contain the release files plus persistent local state:

```text
/home/stefanchurch/ferry-services-server-v3/
  dist/
  node_modules/
  public/
  sqlite/
  scripts/
  deploy/
  .env
  data/ferry-services.sqlite3
  offline/snapshot.sqlite3
  offline/snapshot.meta.json
```

Manual deploy from an already-built artifact:

```bash
APP_ROOT=/home/stefanchurch/ferry-services-server-v3 scripts/deploy-artifact.sh /tmp/ferry-services-server-v3.tar.gz
```

The GitHub Actions deploy job runs this automatically on pushes to `main`. It expects these repository secrets:

```text
DEPLOY_HOST
DEPLOY_USER
DEPLOY_SSH_KEY
DEPLOY_PORT # optional, defaults to 22
```

Systemd unit templates are stored under `deploy/systemd/`. They keep the API and each scheduled job separate, but reduce repeated setup by loading the shared app `.env` file and by providing a `ferry-services.target` that groups the whole application. Install or refresh them manually on the VPS when they change:

```bash
sudo cp deploy/systemd/* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ferry-services.target
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

It creates the database if needed, applies pending migrations, and loads reference seed data when the database is empty.

## Push Notifications

- iOS: send directly to APNs using token-based authentication.
- Android: send directly to FCM HTTP v1 using Google service account credentials.
- Store the app installation, device token, platform, push enabled flag, and delivery metadata locally.

## Web Dist

The API server serves `public/index.html` at `/` when the web build has been published into `public/`. Static assets under `public/` are served by the API process. API and documentation routes remain available under `/api`, `/openapi.json`, and `/swagger`.
