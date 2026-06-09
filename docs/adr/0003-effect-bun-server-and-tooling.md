# 3. Effect v4 on Bun (paulo-suzanne pattern); oxlint + tsgo + bun test

Date: 2026-06-09

## Status

Accepted

## Context

The revived app runs as a single React Router v7 + Bun application (ADR 0001). Two sibling
repos demonstrate Bun server patterns on Railway:

- `me` — ~60-line plain `Bun.serve` + `createRequestHandler`, no Effect, ESLint + `tsc`.
- `paulo-suzanne` — `@effect/platform-bun` `BunHttpServer` with an Effect runtime threaded
  through React Router's router context, services as `Context.Service`, `Bun.S3Client`
  storage, oxlint + `tsgo` + `bun test`.

A future **database-backed custom CMS** is planned (ADR 0001 / CONTEXT.md). That phase
introduces a datastore, auth, and storage — exactly the service/error/runtime modelling
Effect is built for. Choosing the Effect server now means the CMS slots into an existing
Effect layer rather than forcing a second server migration later.

The canonical Effect-v4-on-Bun tooling (per the project-scaffolding skill, and as run in
`paulo-suzanne`) is: `@effect/tsgo` + `@typescript/native-preview` (patched via
`effect-tsgo patch` in `prepare`), the `@effect/language-service` plugin in a single
`tsconfig.json`, `oxlint`, and `bun test`.

## Decision

1. **Server: adopt the `paulo-suzanne` Effect pattern.** `server.ts` uses
   `@effect/platform-bun` `BunHttpServer` + `BunRuntime`, with `bun --hot ./server.ts` in
   dev (Vite in middleware mode) and `bun ./server.ts` in production. A per-request Effect
   runtime is exposed through React Router's `RouterContextProvider` so loaders/actions
   call services via `routeHandler` / `routeAction` wrappers instead of touching globals.

2. **Effect v4** (`effect@4.0.0-beta.x`), pinned via `overrides`, matching paulo-suzanne.

3. **Tooling: oxlint + tsgo + bun test**, mirroring paulo-suzanne's _actual_ configs
   (which are leaner than the skill's CLI template):

   - `tsconfig.json` with the `@effect/language-service` plugin, RR7-specific
     `rootDirs`/`include` for `.react-router/types`, `allowImportingTsExtensions`,
     `~/*` → `./app/*`, `types: ["bun", "vite/client"]`.
   - `typecheck` = `react-router typegen && tsgo --noEmit` (typegen MUST precede tsgo).
   - `.oxlintrc.json` for lint; `prepare` = `effect-tsgo patch`.
   - `bun test` for tests.

4. **The two existing server touchpoints become Effect services**: the Mailchimp
   newsletter subscription and the nodemailer contact email are modelled as
   `Context.Service`s consumed by their route actions — establishing the service pattern
   the CMS will extend.

## Consequences

- More upfront machinery than the `me` plain-`Bun.serve` pattern, justified by the planned
  CMS phase: the runtime/service/route-wrapper scaffolding is built once and reused.
- The team takes on Effect v4 (beta) as a hard dependency. Beta API churn is a known risk;
  pinning via `overrides` contains it.
- `tsgo` is type-check + `noEmit` only (no compile); bun runs source directly. CI and the
  local gate use `react-router typegen && tsgo --noEmit`.
- Diverges from `me` (the Railway anchor) on the _server internals_, but the
  Railway-by-auto-detect deployment model (`bun.lock` → Nixpacks) is identical, so
  deployment still "matches fairly well" as intended.
- Newsletter/email behaviour must be preserved through the rewrite into Effect services —
  requires verification, not just a typecheck.
