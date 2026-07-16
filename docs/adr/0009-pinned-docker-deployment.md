# Pinned Docker deployment on Railway

**Status:** accepted
**Date:** 2026-07-16
**Supersedes:** the deployment decision in ADR 0004. ADR 0004's Effect Config decision
remains accepted.

## Context

ADR 0004 assumed Railway would infer a Bun build from `bun.lock`. Railway's current Bun
guidance instead requires a checked-in Dockerfile because Railpack does not automatically
detect Bun applications. The application also depends on Bun-specific runtime behaviour:
`server.ts` runs as TypeScript, resolves the `~/*` alias from `tsconfig.json`, and starts a
Bun HTTP server. Letting a platform-selected runtime or a floating image tag choose the Bun
version makes those deployment semantics change without a repository change.

The repository now contains a multi-stage Dockerfile, but its `oven/bun:1.3-alpine` base
floats across every Bun 1.3 patch. The lockfile freezes packages, not the runtime executing
their install scripts, build, tests, and production server.

## Decision

Railway builds and runs the checked-in multi-stage `Dockerfile`. Every stage uses the same
exact Bun patch release, pinned by immutable image digest when the registry supplies one.
Runtime updates are ordinary reviewed dependency changes: update the pin deliberately,
build the image, and run the full application gate before deployment.

The image continues to:

- install from `bun.lock` with `--frozen-lockfile`;
- separate build dependencies from production dependencies;
- copy only the build output and runtime source needed by `server.ts`;
- run as the non-root `bun` user; and
- expose the application health check at `/healthz`.

Railway remains responsible for deployment orchestration, environment variables, and the
public service endpoint. Effect Config remains the sole application configuration boundary
under ADR 0004.

## Rejected alternatives

- **Railpack or Nixpacks auto-detection.** It does not currently establish the Bun runtime
  contract this application needs, and a platform-default runtime can drift independently
  of the repository.
- **A floating Bun minor tag.** `oven/bun:1.3-alpine` is convenient but makes a rebuild
  non-reproducible after a new patch is published.
- **Installing Bun into a Node base image.** This adds another installer and versioning
  path without improving the runtime contract.

## Consequences

- The deployment runtime becomes reviewable and reproducible from repository state.
- Bun upgrades require a deliberate pin change and full verification.
- The repository owns Docker build maintenance instead of delegating it to Railway's
  changing auto-detection rules.
- A future move away from Railway can reuse the same image contract.
