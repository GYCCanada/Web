# 2. Replace React Aria with shadcn-on-base-ui; Tailwind v4 CSS-first

Date: 2026-06-09

## Status

Accepted

## Context

The site's UI primitive layer (`app/ui/`) is built entirely on **React Aria Components**
(`react-aria`, `react-aria-components`). Styling uses **Tailwind v3** with a heavily
customised JS config (`tailwind.config.js`) and a CSS-variable theme.

We are aligning with the sibling repo `me`, which uses **Tailwind v4** (CSS-first, via the
`@tailwindcss/vite` plugin, no JS config) and **shadcn components on the base-ui
foundation** (`@base-ui/react`). Carrying both React Aria and base-ui would mean shipping
two overlapping accessibility/primitive systems — a parallel-API situation we avoid by
policy.

The revival modernises the _stack_ but is explicitly **not** a visual redesign. The 2026
"Speak" conference introduces new hero art and a new accent colour, but the site's layout
and design language stay as they are.

## Decision

1. **Tailwind v3 → v4, CSS-first.** Adopt the `@tailwindcss/vite` plugin and port the
   existing custom theme (colours, fonts, CSS variables) from `tailwind.config.js` into a
   v4 `@theme` block in CSS. No JS Tailwind config remains.

2. **Replace React Aria with shadcn-on-base-ui.** Rebuild every `app/ui/` primitive on
   shadcn + `@base-ui/react`, rewire all call sites, then remove `react-aria` and
   `react-aria-components` entirely. End state: a single primitive system matching `me`.

3. **Preserve the visual identity.** The component foundation changes underneath; the
   rendered look does not. Only per-year theming (hero images, accent colour, theme name)
   changes — and only to introduce 2026 "Speak". A redesign is out of scope.

## Consequences

- One primitive system, matching `me`; no parallel a11y machinery.
- The swap is broad (touches every page that uses a UI primitive) but largely mechanical,
  suited to pattern-driven delegation: establish the shadcn/base-ui equivalent for each
  primitive once, then apply across call sites.
- **Highest regression risk in the revival.** Because identity must be preserved while the
  foundation changes, this step requires explicit **visual verification** (run the app,
  compare pages) — a typecheck/lint pass is not sufficient to prove it.
- React Aria's behaviour (focus management, ARIA wiring) must be matched by the base-ui
  equivalents; any gaps surface as accessibility regressions and must be checked.
- Reversing would mean re-adopting React Aria. Accepted: base-ui + shadcn is the chosen,
  reference-aligned direction.
