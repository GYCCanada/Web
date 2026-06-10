# GYC Canada 2026 "SPEAK" Revival — Full Migration Plan

> This document is the complete plan for the multi-agent revival workflow. It is handed to
> Codex (via `okra counsel`) on **every per-commit review** so Codex has the full context:
> where we are in the sequence, what each phase must do, and what is deliberately deferred.
> Read this together with `CONTEXT.md` and `docs/adr/0001`–`0004`.

## Goal

Revive the GYC Canada conference site for the **2026 "SPEAK"** conference (Jeremiah 1:7,
Aug 5–9 2026, Ramada Plaza by Wyndham Calgary Downtown, Calgary AB; speakers TBD) after a
one-year hiatus (the 2025 Montreal conference was cancelled). Modernize the entire stack and
add this year's content, without redesigning the site.

## Settled architecture (see ADRs)

- **ADR 0001** — Collapse the Nx/pnpm monorepo to a **single Bun + React Router v7 app**;
  **delete** the dead PayloadCMS scaffold (`apps/cms`, Payload v2 + MongoDB, zero consumers).
- **ADR 0002** — Replace **React Aria** with **shadcn-on-base-ui** (full swap, delete
  react-aria); **Tailwind v3 → v4** CSS-first (`@theme`, `@tailwindcss/vite`); **preserve the
  visual identity** — re-theme only for 2026.
- **ADR 0003** — Adopt the **`paulo-suzanne` Effect server pattern**: `@effect/platform-bun`
  `BunHttpServer` + Effect runtime threaded through RR7 `RouterContextProvider`, services as
  `Context.Service`, `routeHandler`/`routeAction` wrappers. Tooling: **oxlint + tsgo + bun
  test** (`@effect/tsgo`, `@effect/language-service` plugin, `effect-tsgo patch` in prepare).
- **ADR 0004** — Railway via **Bun auto-detect** (delete `nixpacks.toml`); environment via
  **Effect `Config`** (`Config.redacted` for secrets), not zod/`process.env`.

## Reference repos (copy patterns, cite source file+lines)

- `/Users/cvr/Developer/personal/me` — Bun + RR7, Railway anchor, Tailwind v4, shadcn/base-ui,
  `react-dom/server` → `server.node` build alias.
- `/Users/cvr/Developer/personal/paulo-suzanne` — the Effect template: `@effect/platform-bun`
  server, `routeHandler`/`routeAction`, Vite middleware dev, `Config.redacted` env, oxlint +
  tsgo + bun test, exact dep version pins.

## Execution model

- Branch: **`revival/2026-speak`** off `main`. Per-phase **sub-commits**, each compiles and
  passes the gate. Push + open PR only at the end. CI is moved to bun (P6) so the push is green.
- **Gate** (real, from P2 onward):
  `bun run typecheck && bun run lint && bun run build && bun test`
  (`typecheck` = `react-router typegen && tsgo --noEmit`). P1's gate is the legacy
  `pnpm install && pnpm build` because the bun toolchain doesn't exist until P2.
- **After EVERY commit**, Codex reviews the commit (`okra counsel`); blocking corrections are
  applied and the commit is amended before the next phase builds on it.
- No-bail-out rule: fix at the root cause; never `any`/stub/comment-out/revert to silence.

## Phase sequence

| #   | Phase                                                                                       | Commit type | Gate       |
| --- | ------------------------------------------------------------------------------------------- | ----------- | ---------- |
| 0   | Setup — branch + commit design docs + pnpm baseline                                         | `docs`      | pnpm build |
| 1   | Foundation — delete apps/cms+Nx, collapse to single app (structural only, still pnpm/Remix) | `refactor`  | pnpm build |
| 2   | Stack — Remix→RR7, React 19, Vite 8, bun, Effect server + Config, oxlint+tsgo+bun test      | `feat`      | bun gate   |
| 3   | Tailwind v4 — CSS-first, port custom theme verbatim                                         | `refactor`  | bun gate   |
| 4   | Components — React Aria → shadcn/base-ui full swap, delete react-aria                       | `refactor`  | bun gate   |
| 5   | Content — 2026 SPEAK entry EN+FR, hero assets, /2026 route                                  | `feat`      | bun gate   |
| 6   | CI — GitHub Actions pnpm → bun                                                              | `ci`        | bun gate   |
| —   | Verify — gate + boot app + agent-browser visual/forms (EN+FR)                               | (none)      | full       |
| —   | Ship — push + open PR                                                                       | (none)      | —          |

### Phase details

**P1 Foundation.** Delete `apps/cms`; remove Nx (`nx.json`, run-many scripts),
`pnpm-workspace.yaml`, legacy `__Dockerfile`/`__docker-compose.yml`/`__.dockerignore`. Move
`apps/web/*` to repo root (structure mirrors `me`). Root `package.json` becomes the single
app's. **Toolchain unchanged in P1** — still pnpm/Remix; this phase is purely structural.

**P2 Stack.** Rename `@remix-run/*` → `react-router`/`@react-router/*`. `vite.config.ts` →
`reactRouter()` + `@tailwindcss/vite` + tsconfigPaths + the `react-dom/server.node` build
alias. Add `react-router.config.ts` (`ssr:true`, `appDirectory:'app'`). **Convert flat-routes
→ explicit `app/routes.ts`**, preserving the `($lang)+` optional-segment localization as a
`layout()`+nested `route()` tree (do not drop a route). `server.ts` at root = Effect
`BunHttpServer` pattern from `paulo-suzanne` (per-request runtime via `RouterContextProvider`,
`routeHandler`/`routeAction`, Vite middleware dev). Delete the Express `server.js` and
express/compression/morgan. `env.server.ts` → Effect `Config` (`Config.redacted` for
`MAIL_PASS`, `MAILCHIMP_API_KEY`); preserve dev-optional / prod-required. `mailer.server.ts` +
`mailchimp.server.ts` → Effect `Context.Service`s, **behavior preserved exactly** (prod-only
send; mailchimp `us10`; FNAME/LNAME split). `tsconfig.json`, `.oxlintrc.json`, scripts, dep
pins copied from `paulo-suzanne`. React 18-canary → 19. Generate `bun.lock`; run
`effect-tsgo patch`.

**P3 Tailwind v4.** Port the entire custom theme from `tailwind.config.js` into a v4 `@theme`
CSS block; **rendered look must not change**. Delete `tailwind.config.js`. Watch v4
breaking-change fallout (default ring/border color, `space-*`).

**P4 Components (highest risk).** Inventory every `app/ui/` primitive + call sites. Init
shadcn on base-ui matching `me/components.json`. Rebuild each primitive to match the **current
look and a11y behavior** React Aria provided; rewire all call sites; **delete react-aria**
once zero imports remain (grep to prove). No parallel primitive systems. Correctness proven in
Verify.

**P5 Content.** Add a complete 2026 entry (EN+FR) to `app/lib/conference.server.ts`:
`slug:'/2026'`, `title:'Speak'` / FR, gold/amber `theme` hex matching the dark SPEAK hero,
`bible:{book:'Jeremiah'/'Jérémie',chapter:1,verse:7}`, dates Aug 5–9 2026 (existing
`dayjs(...).utc().endOf('day').valueOf()` idiom), location Ramada Plaza Calgary AB / FR,
`tagline` = Jeremiah 1:7 text EN + accurate FR, **`speakers:[]`, `seminars:[]` (TBD)**,
**omit `registration`** (windows unset). Hero: copy
`/Users/cvr/Downloads/JTJmPJEC/hero-title-verse.png` → `public/2026/{en,fr}/hero-desktop.png`;
mobile reuses desktop for now. `getCurrentConference` auto-promotes 2026 (future-dated) as the
Current Conference — verify it resolves. Add a `/2026` route mirroring `/2025`.

**P6 CI.** Rewrite `.github/workflows` from pnpm/Node to bun (`oven-sh/setup-bun@v2`,
`bun install --frozen-lockfile` → typecheck → lint → build → test). Keep push-to-main + PR
triggers.

## Deliberately DEFERRED (not bugs — do not flag as missing)

- **Speakers / seminars for 2026** — empty by design (TBD), exactly as 2025 was.
- **2026 registration windows** — omitted; pricing not set.
- **Portrait mobile hero crop** — owed; mobile temporarily reuses the landscape desktop image.
- **The custom DB-backed CMS** — a separate future phase, not part of this revival. Content
  stays as typed TS data; "editing content" = editing the data file + redeploy.
- **Site redesign** — out of scope; identity is preserved, only 2026 re-theming changes.

## What Codex should focus on per commit

Correctness bugs; regressions vs prior behavior; faithfulness to the ADRs — **especially**
(a) visual-identity preservation through the Tailwind v4 port and the React Aria → base-ui
swap, (b) exact behavior preservation of the mail/mailchimp services and env required/optional
semantics, (c) no dropped routes in the flat-routes → `routes.ts` conversion, (d) no
`any`/stub/parallel-primitive shortcuts. Ground every claim in file paths + line numbers.
Do **not** flag the deferred items above as defects.
