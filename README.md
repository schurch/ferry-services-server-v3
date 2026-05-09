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
- Keep background work as explicit CLI jobs rather than adding a queue system.
- Build in CI, not on the VPS.
- Remove AWS SNS from push notifications and call Apple/Google directly.

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
    schema.sql    baseline schema once ported
    seed.sql      development seed data once ported
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

Scheduled work should run as separate commands, triggered by cron or systemd timers:

```bash
node dist/jobs/scraper.js
node dist/jobs/weather-fetcher.js
node dist/jobs/vessel-fetcher.js
node dist/jobs/transxchange-ingester.js
node dist/jobs/rail-departure-fetcher.js
node dist/jobs/offline-snapshot-generator.js
```

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
package.json
package-lock.json
sqlite/
public/
scripts/
```

The VPS should only unpack and run the artifact:

```bash
npm ci --omit=dev
npm run migrate
systemctl restart ferry-services
```

SQLite data should live outside release directories:

```text
/opt/ferry-services/
  releases/
  current -> releases/<version>
  data/ferry-services.sqlite3
  env/production.env
```

## Push Notifications

v3 should not use AWS SNS.

- iOS: send directly to APNs using token-based authentication.
- Android: send directly to FCM HTTP v1 using Google service account credentials.
- Store the app installation, device token, platform, push enabled flag, and delivery metadata locally.

## Porting Order

1. Bootstrap Fastify, config, SQLite, migrations, and health check.
2. Port read-only API contract: `/api/services`, `/api/services/:serviceID`, `/api/vessels`, `/api/timetable-documents`.
3. Port installations and direct push registration/delivery.
4. Port offline SQLite snapshot generation.
5. Port background fetchers and TransXChange ingest.
6. Add CI artifact packaging and VPS deployment scripts.
