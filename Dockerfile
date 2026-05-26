ARG NPM_VERSION=11.14.1

FROM node:26-bookworm-slim AS deps

ARG NPM_VERSION

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g npm@${NPM_VERSION}

COPY package.json package-lock.json ./
RUN npm ci


FROM deps AS build

WORKDIR /app

COPY src ./src
COPY sqlite ./sqlite
COPY public ./public
COPY tsconfig.json ./

RUN npm run build


FROM deps AS deps-prod

WORKDIR /app

RUN npm prune --omit=dev \
  && npm cache clean --force


FROM node:26-bookworm-slim

ARG NPM_VERSION

WORKDIR /app

ENV NODE_ENV=production

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates tzdata unzip \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g npm@${NPM_VERSION}

COPY package.json ./
COPY --from=deps-prod /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/sqlite ./sqlite
COPY --from=build /app/public ./public

CMD ["npm", "run", "start"]
