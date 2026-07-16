# CMS-owned Registration channel and relational Orders

**Status:** accepted
**Date:** 2026-07-16
**Supersedes:** ADR 0007's RegFox-only channel decision. Extends ADR 0010's immutable Form
versions and relational Submission persistence.

## Context

The site already publishes immutable Form definition versions and commits grouped
Submissions atomically. A first-party registrar adds operational state that cannot safely be
inferred from a Conference's optional external URL or from a process environment flag:
which channel accepts new registrations, which immutable Form version is live, whether an
open channel is draining, and whether outstanding payment responsibilities permit a final
transition.

Registration definitions also carry executable commerce semantics: field activation,
party membership, billing modes, price rules, and exact pricing windows. Duplicating those
predicates across the CMS, browser, request action, and payment worker would make preview
and charged amounts diverge. Persisting payment state on Submission payloads would likewise
mix an immutable record of answers with a retryable external workflow.

The production application and PostgreSQL run together in the custom-server Docker image.
Using a second database or object-store actor cache for Orders would create two authorities
and prevent atomic creation of Submissions, payment responsibilities, and durable work.

## Decision

### One CMS-owned Registration channel

Each Conference has one relational Registration channel aggregate, edited through the CMS.
Its state is one of:

- **closed** — no Registration channel is available;
- **external** — the CMS-authored external registrar URL is public;
- **preview** — administrators may render, validate, and quote a pinned first-party Form,
  but preview creates no Submission, Registration, Order, Checkout Session, or charge;
- **open** — public first-party Registration intake is enabled against the pinned immutable
  Form definition version; or
- **draining** — no new intake is accepted while existing Orders, Stripe events, refunds,
  and durable workflows finish.

The state itself is the feature flag. There is no independent environment mode, enabled
boolean, or implicit fallback based on the presence of an external URL. `external` carries
an external HTTPS URL; `preview`, `open`, and `draining` carry the exact Registration Form
version and Conference IANA time zone. Transitioning from `open` requires `draining`.
Transitioning from `draining` to `closed` or `external` is rejected while any Order is
non-terminal. Draining never changes the public channel to an external registrar
automatically.

Opening is fail-closed. The CMS may enter `open` only when the pinned compiled Form is ready,
pricing and registration deadlines are valid, and the application has complete Stripe and
workflow configuration. Webhook reconciliation and durable Order processing remain
available for historical work even when the current channel is no longer first-party.

### One compiled Form commerce model

Publishing decodes and compiles a Form definition once into a `CompiledForm`. It owns:

- server decoding and cross-field validation;
- active-field evaluation and the render model;
- Registrant and Payer projection;
- billing-mode eligibility;
- adaptive pricing and quote construction; and
- authoring/readiness diagnostics.

The CMS editor, preview, public renderer, Registration command, and tests consume those
facets rather than reimplementing rules. Browser price previews are advisory; the server
freezes one instant and compiles the authoritative quote. Pricing cutoffs are authored in
the Conference IANA time zone, normalized to UTC exact instants, and evaluated as half-open
intervals.

Published definitions remain immutable. Structured drafts are edited through typed CMS
commands and published with compare-and-swap revision checks. The CMS progressively exposes
fields, variants, activation, party, billing, pricing, and windows; raw definition JSON is
not the authoring interface. Compiler diagnostics are the sole readiness result.

### One deep Registration checkout boundary

`RegistrationCheckout` owns the complete intake transaction. It locks the Registration
channel, proves it is `open`, loads the pinned Form version, freezes the pricing instant,
decodes the submitted party, creates the Registration and Registrants, freezes the quote,
creates the required Orders, and enqueues durable checkout work in the same PostgreSQL
transaction. An explicit caller idempotency key makes the whole command replay-safe.

The published Form may offer **group** billing, **per-registrant** billing, or both. Group
billing creates one Order for the entire Registration and may nominate a Payer who is not a
Registrant. Per-registrant billing creates one independent Order and payment link per
Registrant. A group becomes confirmed atomically; per-registrant confirmations are
independent.

After commit, the browser lands on a durable Registration status page. The page reports that
checkout is being prepared until the worker records the Stripe Checkout Session, then
redirects to Stripe. Per-registrant mode reports that independent links are being prepared
for delivery. Quotes expire no more than 24 hours after pricing and never after the
Registration deadline; a later attempt reprices instead of extending the old quote.

### PostgreSQL Orders and Effect Encore workflow

PostgreSQL is the authority for Orders and their relationship to Registrations and
Registrants. An Order stores its frozen quote, amount, currency, receipt email, billing mode,
expiry, Stripe identifiers, idempotency key, and explicit state. State transitions are
validated domain operations and constrained relationally. Payment state is derived by joins;
it is not copied onto Submissions.

Effect Encore uses the application's existing PostgreSQL `SqlClient` for durable messages,
leases, retries, and process-scoped workers. Order creation and enqueue must share the intake
transaction. If the library storage boundary cannot participate in the caller's SQL
transaction, a relational application outbox bridges the boundary; a dual write is not
accepted.

Stripe Checkout is used for every Order, including zero-dollar Orders. Stripe no-cost orders
therefore remain in the bookkeeping and fulfillment stream even when Stripe collects no
payment method and creates no PaymentIntent. Checkout creation uses a stable Stripe
idempotency key, and signed webhook handling is the fulfillment authority.

Refunds in the initial policy are operator-initiated and full only. A full refund cancels the
Registrants linked to that Order. If a completed Stripe payment arrives after local expiry
processing, captured money wins: the Order and linked Registrants become confirmed and the
race is flagged for operator review. The system neither ignores captured money nor refunds
it automatically.

## Rejected alternatives

- **Environment-backed registrar modes.** They make operational state invisible to the CMS,
  can disagree between processes, and cannot transactionally enforce drain completion.
- **Independent URL and enabled fields.** Their combinations admit two live channels or an
  enabled channel without a usable destination.
- **Mutable current Form reads at checkout.** They can validate or price a payload against a
  different definition than the one administrators opened.
- **Raw JSON as the Form editor.** It exposes storage representation, provides late feedback,
  and encourages duplicated client-side readiness rules.
- **Sequential Submission, Order, and enqueue writes.** A crash can charge an incomplete
  Registration or lose the only request to create checkout.
- **A SQLite or object-store Order authority.** It prevents atomicity with the existing
  PostgreSQL Form and Submission records.
- **Skipping Stripe for zero-dollar Orders.** It creates a second fulfillment and bookkeeping
  path for the same Registration lifecycle.
- **Automatic refund of expiry races.** Local scheduling delay is not authority to reverse a
  completed attendee payment.

## Consequences

- CMS state alone answers which Registration channel is public and whether first-party
  intake is permitted.
- Opening and draining are relational, auditable transitions with no configuration split
  brain.
- Preview, validation, rendering, readiness, and charged price share one compiled definition.
- Registration intake is atomic and replay-safe across Submissions, Orders, and durable work.
- PostgreSQL backup, migration, and observability now include Registration and Order state.
- Stripe webhook delivery and Effect Encore workers are required operational dependencies
  whenever non-terminal Orders exist, regardless of the current public channel.
