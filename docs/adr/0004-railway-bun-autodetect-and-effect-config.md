# 4. Railway via Bun auto-detect; environment via Effect Config

Date: 2026-06-09

## Status

Accepted

## Context

Deployment is on Railway. The current build is driven by a `nixpacks.toml` that forces the
node provider, installs corepack, and activates pnpm. The sibling repos `me` and
`paulo-suzanne` ship **no** Railway/Nixpacks config at all — Railway auto-detects `bun.lock`,
selects the Bun runtime, and runs `bun install` → `bun run build` → `bun run start`.

Environment variables are validated today by a Zod discriminated union over `process.env`
(dev fields optional, prod fields required): `MAIL_HOST/PORT/USER/PASS/FROM/TO`,
`MAILCHIMP_API_KEY`, `MAILCHIMP_LIST_ID`. Under the Effect tooling (ADR 0003), direct
`process.env` access is a lint/diagnostic **error** (`processEnv`, `processEnvInEffect`).

## Decision

1. **Delete `nixpacks.toml`.** Rely on Railway's Bun auto-detection from `bun.lock`. Build =
   `bun run build` (`react-router build`), start = `bun ./server.ts`. Env vars remain
   configured in the Railway dashboard. Matches `me`/`paulo-suzanne` exactly.

2. **Port env validation to Effect `Config`.** Replace the Zod-over-`process.env` module
   with an Effect `Config`-based service: `Config.string` for plain vars, `Config.redacted`
   for secrets (`MAIL_PASS`, `MAILCHIMP_API_KEY`). This is typed, lazy, validated, and
   satisfies the no-`process.env` rule. Matches paulo-suzanne's `Config.redacted(...)` usage.

## Consequences

- Zero deployment config to maintain; the build "just works" from `bun.lock`, matching the
  reference repos.
- No bun-version pin. If Railway's default bun ever drifts and breaks the build, a minimal
  `nixpacks.toml` pinning bun can be reintroduced — reversible.
- The dev/prod required-vs-optional distinction (Zod discriminated union) is re-expressed in
  Effect `Config` (e.g. `Config.option` / withDefault for dev). Behaviour must be preserved:
  prod still fails fast on missing mail/mailchimp secrets.
- All secret access flows through `Config.redacted`, so secrets are not accidentally logged.
