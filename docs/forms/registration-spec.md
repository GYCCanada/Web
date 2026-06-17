# Registration form — equivalence spec

**Status:** authored alongside Branch 6.5 (registration-launch, ADR 0007).

This is the behavioural spec the structural Form engine's `defaultRegistrationForm`
`FormDefinition` is proven against, transcribed field-for-field from the pre-migration
hand-tuned `registration-schema.ts` (kept in-tree as `registration-schema.oracle.ts`
until 6.6). Every row here is an assertion in `app/lib/forms/equivalence.registration.test.ts`.

Registration is the **riskiest migration** (ADR 0007, plan §"Riskiest commit"): a 2-way
discriminated union (attendee / exhibitor) with ~10 per-type / cross-field presence
requirements, a `true`/`false`/`on` three-token boolean codec, and an error set where
every failure path must emit a real `TranslationKey` (a wrong/absent key renders blank in
`FieldErrors`). It is also **client-only today** — the registration route action is a
verified no-op (`2026/form/route.tsx:41-43` `yield* Effect.void`); the schema powers ONLY
client-side `RegistrationStandardSchema` validation. So the harness pins it three ways:

1. **Decoded-output equivalence** over the per-registrant decode (oracle `Registrant` vs
   engine `definitionToSchema(defaultRegistrationForm)`), valid + every invalid variant.
2. **Emitted-`TranslationKey`-set equivalence** (same field paths, same keys) over the
   client collect-all `toStandardSchemaV1` path, plus EN+FR rendered-string parity.
3. **Render-level field-name + default-value parity**: every field name the engine
   definition declares matches a field the registration form renders, and the form's
   `makeDefaultRegistrant()` keys are exactly the definition's field names — the only path
   registration actually exercises in prod (settled #9: RegFox carries the live channel;
   the on-site form is client-validate + render only until the first-party registrar).

## Scope boundary — what the engine owns vs the route shell

The registration form is `{ registrants: Registrant[] }` — a **repeating array** of
discriminated-union items, each with conditionally-rendered nested groups (`parent` only
for minors, `volunteer` opt-in) and boolean *radio* groups (`meals`, `firstTimeAttending`
render as yes/no radios, not single checkboxes). A repeating-array-of-variant-items is
**not** in the closed `FieldKind` set, and per the brief's non-goal the kind-set is closed
(not an arbitrary builder). So the boundary is:

- **The engine owns one `Registrant`'s validation graph** — the discriminator, the
  per-type required fields, the nested groups, the cross-field/boolean codecs. This is the
  risky part the harness pins. `defaultRegistrationForm` is the `FormDefinition` for ONE
  registrant.
- **The registration route owns the multi-registrant shell** — the `registrants` array
  (`getFieldList` / `intent.insert` "Add Registrant"), the per-registrant
  `registrants[n].` field prefix, the minor/parent client gating (the `dayjs` age math),
  the section headings, and the boolean-*radio* rendering of `meals` /
  `firstTimeAttending`. The route's **validation** is derived from the engine definition
  (`Schema.Array(definitionToSchema(def))` wrapped in `{ registrants }`), so editing the
  stored `forms/registration.json` changes what the form accepts with no code change
  (`derive-dont-sync`).

Render parity is therefore asserted at the **field-name + default-value** level (every
engine field name is a real registrant field; the defaults match), not by routing the
whole bespoke shell through `<FormFields>` (which renders a flat single instance).

## The registrant field graph

### Common fields (both variants)

| name | kind | required key | invalid/format key | notes |
|------|------|--------------|--------------------|-------|
| `type` | variant discriminator (literal `attendee`/`exhibitor`) | `registration.form.type.required` | — | absent/off-list → key at `type` |
| `name` | requiredText | `registration.form.name.required` | (reuses required) | empty/absent/array → required key |
| `email` | email | `registration.form.email.required` | `registration.form.email.error` | `isMinLength(1)` + `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` |
| `phone` | requiredText | `registration.form.phone.required` | (reuses required) | |

### Attendee-only fields (selected when `type === 'attendee'`)

| name | kind | required key | notes |
|------|------|--------------|-------|
| `gender` | literal `male`/`female` | `registration.form.gender.required` | required-when-attendee |
| `dateOfBirth` | requiredText | `registration.form.date-of-birth.required` | required-when-attendee |
| `parent` | nestedGroup, `optional: true` | — | minors-only; group optional, inner fields required-when-present |
| `parent.name` | requiredText | `registration.form.parent.required` | |
| `parent.email` | requiredText (NOT email-format — the oracle's `Parent.email` is a bare `RequiredString`) | `registration.form.parent-email.required` | |
| `parent.phone` | requiredText | `registration.form.parent-phone.required` | |
| `meals` | checkboxBoolean (rendered as a yes/no *radio* by the route) | `registration.form.meals.required` | required-when-attendee; `true`/`false`/`on` codec |
| `dietaryRestrictions` | optionalText (genuinely-optional; oracle `OptionalString` = `Schema.optional(String)`) | `registration.form.dietary-restrictions.required` | absent key OR explicit `undefined` valid; present-non-string → key |
| `outreach` | arrayOfLiteral (`laws-of-health`/`homeless-carepacks`/`back-to-school`/`not-sure`) | `registration.form.outreach.required` | required-when-attendee |
| `extra` | nestedGroup (always present when attendee) | — | absent → key at `extra.tos` (oracle anchor) |
| `extra.howDidYouHear` | requiredText | `registration.form.how-did-you-hear.required` | |
| `extra.whyAreYouAttending` | requiredText | `registration.form.why-are-you-attending.required` | |
| `extra.whatAreYouExcitedAbout` | requiredText | `registration.form.what-are-you-excited-about.required` | |
| `extra.firstTimeAttending` | checkboxBoolean (rendered as yes/no *radio* by the route) | `registration.form.first-time-attending.required` | `true`/`false`/`on` codec |
| `extra.church` | optionalText (genuinely-optional; oracle `OptionalString`) | `registration.form.church.required` | absent key valid |
| `extra.merch` | arrayOfLiteral (`t-shirt`/`hoodie`/`shirt`/`none`) | `registration.form.merch.required` | |
| `extra.other` | optionalText, `requirePresent: true` (oracle `OptionalText` = `String.annotateKey({ messageMissingKey })`, NOT optional) | `registration.form.other.required` | KEY-MUST-BE-PRESENT, empty string allowed: an ABSENT `other` inside a present `extra` emits the key (the always-rendered `extra` block POSTs an empty `other`); distinct from the genuinely-optional `church`/`dietaryRestrictions`/`instrument` |
| `extra.tos` | checkboxBoolean | `registration.form.tos.required` | single checkbox `value="true"` |
| `volunteer` | nestedGroup, `optional: true` | — | opt-in; inner flags all `optional: true` |
| `volunteer.*` (12 flags) | checkboxBoolean `optional: true` | `registration.form.volunteer.required` | attribute-less checkbox → submits `on` |
| `volunteer.instrument` | optionalText (genuinely-optional; oracle `OptionalString`) | `registration.form.instrument.required` | absent key valid |

### Exhibitor-only fields (selected when `type === 'exhibitor'`)

| name | kind | required key | format key |
|------|------|--------------|------------|
| `synopsis` | requiredText | `registration.form.synopsis.required` | — |
| `website` | url | `registration.form.website.required` | `registration.form.website.required` (oracle reuses the same key for empty + unparseable) |
| `company` | requiredText | `registration.form.company.required` | — |

## Per-type presence requirements (the discriminator filter, oracle `:239-302`)

When `type === 'attendee'` and absent, each emits its key at its own path:
`dateOfBirth`, `gender`, `meals`, `outreach`, and `extra` (anchored at `extra.tos`). The
groups `parent` / `volunteer` and the optional scalars `dietaryRestrictions` are **not**
required (optional). When `type === 'exhibitor'` and absent: `synopsis`, `website`,
`company`. Attendee-only requirements never leak onto an exhibitor and vice-versa.

## Three-token boolean codec (`StringToBoolean`, oracle `:50-59`)

`"true"` / `"on"` → `true`; `"false"` → `false`; any other token (or a duplicate-name
array) → the field's required key. Applies to `meals`, `extra.firstTimeAttending`,
`extra.tos`, and the 12 `volunteer.*` flags (the last `optional: true`).

## Intentional, pinned deltas (each contained to one field/case)

1. **`name` / `phone` / nested-text invalid-type key**: the engine's `requiredText` emits
   its single `requiredMessage` for the empty / absent / invalid-type (duplicate-name
   array) cases alike (one required key per text field — the closed-kind-set design,
   `make-impossible-states-unrepresentable`). The oracle's `RequiredString` already does
   the same (its node + key + minLength messages are the SAME key), so for registration
   there is in fact **no** key divergence here — unlike contact's `name` which carried a
   distinct `.error` node key. Pinned as a no-divergence assertion.
2. **Engine field-graph completeness**: the engine adds an `optional: true` flag to
   `nestedGroup` so `parent` / `volunteer` (the conditionally-rendered groups the oracle
   never requires) are present-validate / absent-ok, exactly matching the oracle's
   `Schema.optional(Parent)` / `Schema.optional(Volunteer)`. This is the one engine
   capability the registration harness surfaces (the "engine fixes the harness surfaced"
   pattern of 6.3/6.4); it changes no other form.
