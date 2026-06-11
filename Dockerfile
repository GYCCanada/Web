# syntax=docker/dockerfile:1
# Alpine + Bun image for the GYC Canada site.
#
# The runtime image carries three things beside production node_modules:
#   - build/        the react-router client + server bundles (`bun run build`)
#   - server.ts     the Bun HTTP entry (Bun runs TypeScript natively)
#   - app/          server.ts imports app/lib TS (env, runtime, services) at
#                   runtime, outside the server bundle
#
# Production boot REQUIRES MAIL_* + MAILCHIMP_* env vars (fail-fast env Layer,
# ADR 0004); bucket (BUCKET_*) and admin (ADMIN_PASSWORD/COOKIE_SECRET) env are
# optional — without them the site serves bundled content and /admin 404s.

# ---- deps: full install for the vite/react-router build ----
FROM oven/bun:1.3-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
# --ignore-scripts skips `prepare` (effect-tsgo patch) — typecheck-only tooling.
# It also skips the npm `bun` package's binary download (auto-installed as
# effect-bun-test's peer dep); `bun run` puts node_modules/.bin first on PATH,
# so remove the broken shim to fall back to the image's own bun.
RUN bun install --frozen-lockfile --ignore-scripts \
 && rm -rf node_modules/bun node_modules/.bin/bun node_modules/.bin/bunx

# ---- build: client + server bundles ----
FROM deps AS build
COPY . .
RUN bun run build

# ---- prod-deps: production node_modules only ----
FROM oven/bun:1.3-alpine AS prod-deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production --ignore-scripts

# ---- runtime ----
FROM oven/bun:1.3-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/build ./build
# tsconfig.json: Bun resolves the `~/*` path alias from it at runtime
COPY package.json tsconfig.json server.ts ./
COPY app ./app

USER bun
EXPOSE 3000

# Single-quoted so /bin/sh does not expand the JS (shell-form CMD runs via sh).
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD bun -e 'const r = await fetch("http://127.0.0.1:" + (process.env.PORT || 3000) + "/healthz"); if (!r.ok) process.exit(1)'

CMD ["bun", "server.ts"]
