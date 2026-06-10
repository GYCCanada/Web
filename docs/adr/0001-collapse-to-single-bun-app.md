# 1. Collapse to a single Bun + React Router v7 app; delete the PayloadCMS scaffold

Date: 2026-06-09

## Status

Accepted

## Context

The repository was an Nx + pnpm monorepo with two apps:

- `apps/web` — the public conference site (Remix v2 + Vite 5 + React 18-canary).
- `apps/cms` — a PayloadCMS v2 + MongoDB + Express scaffold.

The `apps/cms` app defined a single `Users` collection, no content collections, and the
web app made **zero** calls to it. Conference content lives entirely as hardcoded
TypeScript in `apps/web/app/lib/conference.server.ts`. The "CMS" was aspirational: the
real content store was, and is, a typed data file edited and redeployed by hand.

We are reviving the site for the 2026 "Speak" conference after a one-year hiatus, and we
want to adopt the Bun-powered server + Railway pattern used by the sibling repos `me` and
`paulo-suzanne`. Both are **single applications** — not monorepos, no Nx, no MongoDB —
running React Router v7 on `Bun.serve` and deploying to Railway via Nixpacks
auto-detection of `bun.lock`.

A future content-management capability is wanted, but it will be **home-grown and
database-backed** (SQLite/Postgres on Railway, in the bun-native style of
`paulo-suzanne`'s admin: HMAC auth + storage + RR7 routes), built as a **separate phase
after** this revival. It shares nothing with the Payload v2 + MongoDB scaffold.

## Decision

Delete `apps/cms` and the entire monorepo apparatus (Nx, `pnpm-workspace.yaml`, the
`apps/*` split, MongoDB, Payload). Collapse `apps/web` up to the repository root, yielding
a **single React Router v7 + Bun application** that mirrors the structure of `me` and
`paulo-suzanne`.

Because the Payload scaffold has no consumers (no callers to migrate), this is a direct
deletion, not a migration.

## Consequences

- The repo structure matches the reference repos, so their server/Railway patterns drop in
  cleanly.
- A whole dependency tree disappears: Payload v2, Mongoose, MongoDB, Express (CMS),
  Nx, and the workspace tooling. We avoid an otherwise-mandatory Payload v2 → v3 rewrite of
  an app nobody uses.
- The future custom CMS starts from a clean slate (its own design pass, its own datastore)
  rather than inheriting a dead scaffold.
- Until that CMS exists, conference content continues to be authored as typed TS data and
  shipped by redeploy — unchanged from today, and adequate for an annual conference site.
- Irreversible-ish: resurrecting the Payload app later would mean recovering it from git
  history. Accepted, because the future direction (DB-backed, home-grown) does not use it.
