# Pinned Docker image deployment to the custom server

**Status:** accepted
**Date:** 2026-07-16
**Supersedes:** the deployment decision in ADR 0004. ADR 0004's Effect Config decision
remains accepted.

## Context

ADR 0004 assumed Railway would build and run the application. Production instead runs on a
custom server using the repository's Docker image. CI builds and smoke-tests that image,
then publishes main-branch images to `ghcr.io/gyccanada/web` under a commit-derived tag and
an immutable digest.

The application depends on Bun-specific runtime behaviour: `server.ts` runs as TypeScript,
resolves the `~/*` alias from `tsconfig.json`, and starts a Bun HTTP server. Letting a
floating image tag choose the Bun version makes those deployment semantics change without a
repository change.

The repository now contains a multi-stage Dockerfile, but its `oven/bun:1.3-alpine` base
floats across every Bun 1.3 patch. The lockfile freezes packages, not the runtime executing
their install scripts, build, tests, and production server.

## Decision

CI builds and smoke-tests the checked-in multi-stage `Dockerfile`, then publishes the image
to GHCR. Every stage uses the same exact Bun patch release, pinned by immutable base-image
digest when the registry supplies one. Runtime updates are ordinary reviewed dependency
changes: update the pin deliberately, build the image, and run the full application gate
before deployment.

The image continues to:

- install from `bun.lock` with `--frozen-lockfile`;
- separate build dependencies from production dependencies;
- copy only the build output and runtime source needed by `server.ts`;
- run as the non-root `bun` user; and
- expose the application health check at `/healthz`.

The custom server pulls and runs a reviewed `ghcr.io/gyccanada/web@sha256:...` image digest,
not the mutable `latest` tag. The server remains responsible for container lifecycle,
environment variables, persistence mounts or external services, TLS, and the public endpoint.
Effect Config remains the sole application configuration boundary under ADR 0004.

## Rejected alternatives

- **Platform build auto-detection.** Production does not run on a managed application
  platform, and a platform-default runtime would not describe the custom server's contract.
- **A floating Bun minor tag.** `oven/bun:1.3-alpine` is convenient but makes a rebuild
  non-reproducible after a new patch is published.
- **Installing Bun into a Node base image.** This adds another installer and versioning
  path without improving the runtime contract.
- **Deploying `latest`.** It is convenient for operators but cannot identify or roll back to
  the exact image that passed CI.

## Consequences

- The deployment runtime becomes reviewable and reproducible from repository state.
- Bun upgrades require a deliberate pin change and full verification.
- The repository owns the build artifact; the custom server owns only its runtime operation.
- Rollback means selecting a previously published, already-smoke-tested image digest.
