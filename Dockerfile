FROM node:22-bookworm-slim AS deps

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci


FROM deps AS build

WORKDIR /app

COPY apps/api ./apps/api
COPY apps/web ./apps/web
COPY scripts ./scripts

RUN npm run build


FROM deps AS deps-prod

WORKDIR /app

RUN npm prune --omit=dev \
  && npm cache clean --force


FROM node:22-bookworm-slim

WORKDIR /app/apps/api

ENV NODE_ENV=production

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates tzdata \
  && rm -rf /var/lib/apt/lists/*

COPY package.json /app/package.json
COPY apps/api/package.json /app/apps/api/package.json
COPY apps/web/package.json /app/apps/web/package.json
COPY --from=deps-prod /app/node_modules /app/node_modules
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/apps/api/sqlite ./sqlite
COPY --from=build /app/apps/api/public ./public

CMD ["npm", "run", "start"]
