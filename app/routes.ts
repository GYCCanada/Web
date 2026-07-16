import {
  index,
  layout,
  route,
  type RouteConfig,
} from '@react-router/dev/routes';

/**
 * Explicit route table (ADR 0003: routes.ts over flat-routes).
 *
 * The localization scheme is an optional leading `:lang?` segment
 * (`/about` = English default, `/fr/about` = French). The former
 * flat-routes `($lang)+` optional-segment group is preserved here as a
 * single pathless-prefix layout route (`:lang?`) whose element
 * (`_layout.tsx`) renders the Nav/Footer chrome and an `<Outlet />`.
 * Every page nests beneath it, so each page is reachable both with and
 * without the `/fr` (or `/en`) prefix — identical to the flat-routes tree.
 *
 * The `/admin` CMS editor (CMS plan sub-commit C4+) lives OUTSIDE the
 * localized tree: it is a single English-only authenticated surface, guarded by
 * its own `admin/_layout.tsx` (HMAC cookie session), and disabled (404) when no
 * `ADMIN_PASSWORD` is configured.
 */
export default [
  route(':lang?', 'routes/($lang)+/_layout.tsx', [
    index('routes/($lang)+/_index.tsx'),
    route('2024', 'routes/($lang)+/2024/_index.tsx'),
    route('2024/form', 'routes/($lang)+/2024/form/route.tsx'),
    route('2025', 'routes/($lang)+/2025/_index.tsx'),
    route('2025/form', 'routes/($lang)+/2025/form/route.tsx'),
    route('2026', 'routes/($lang)+/2026/_index.tsx'),
    route('2026/form', 'routes/($lang)+/2026/form/route.tsx'),
    route('about', 'routes/($lang)+/about.tsx'),
    route('archive', 'routes/($lang)+/archive+/_index.tsx'),
    route('archive/2023', 'routes/($lang)+/archive+/2023.tsx'),
    route('contact', 'routes/($lang)+/contact.tsx'),
    route('faq', 'routes/($lang)+/faq.tsx'),
    route('give', 'routes/($lang)+/give.tsx'),
    route('team', 'routes/($lang)+/team/_index.tsx'),
    route('volunteer', 'routes/($lang)+/volunteer.tsx'),
  ]),
  // `/admin/login` + `/admin/logout` sit OUTSIDE the guard layout so the
  // layout's auth check never runs on the login page (which would redirect an
  // unauthenticated visitor straight back to it — an infinite loop). Only the
  // `/admin` index nests under the guard.
  route('admin/login', 'routes/admin/login.tsx'),
  route('admin/logout', 'routes/admin/logout.tsx'),
  // The Stripe webhook (registrar plan C8) is a top-level, non-localized POST
  // route OUTSIDE both the `:lang?` tree and the `/admin` guard layout: no
  // middleware/loader runs ahead of it, so `request.text()` reads the RAW bytes
  // Stripe signed (HMAC verification fails on any reserialized body).
  route('api/stripe/webhook', 'routes/api.stripe-webhook.ts'),
  // The manual deadline-sweep trigger (order-workflow G9) is a POST-only
  // resource route OUTSIDE the `/admin` guard layout (a sibling of the webhook):
  // it does its OWN cookie check + `Env.database` gate, so it never renders and
  // never inherits the layout loader. An operator / external cron POSTs it to
  // run one sweep pass on demand.
  route('admin/orders/sweep', 'routes/admin/orders.sweep.ts'),
  layout('routes/admin/_layout.tsx', [
    route('admin', 'routes/admin/_index.tsx'),
    route('admin/content', 'routes/admin/content.tsx'),
    route('admin/pages/:page', 'routes/admin/pages.$page.tsx'),
    route('admin/forms/:form', 'routes/admin/forms.$form.tsx'),
  ]),
] satisfies RouteConfig;
