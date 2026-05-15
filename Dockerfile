FROM node:22-bookworm-slim AS deps-prod

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
  && npm cache clean --force


FROM node:22-bookworm-slim AS build

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.test.json ./
COPY src ./src
COPY public ./public
COPY sqlite ./sqlite

RUN npm run build


FROM node:22-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates tzdata \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY --from=deps-prod /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY --from=build /app/sqlite ./sqlite

CMD ["npm", "run", "start"]
