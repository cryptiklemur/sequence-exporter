FROM node:24-alpine AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
RUN pnpm run build

FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --prod --frozen-lockfile

FROM base AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=9464
RUN addgroup -g 1001 -S sequence && adduser -S sequence -u 1001 -G sequence
COPY --link --from=prod-deps --chown=1001:1001 /app/node_modules ./node_modules
COPY --link --from=build --chown=1001:1001 /app/dist ./dist
COPY --link --chown=1001:1001 package.json ./
USER sequence
EXPOSE 9464
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:9464/healthz || exit 1
ENTRYPOINT ["node", "dist/index.js"]
