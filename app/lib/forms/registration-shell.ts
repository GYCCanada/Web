import { Effect, Schema, SchemaGetter } from 'effect';

import { type DecodedForm, definitionToSchema, email, requiredString } from './decode';
import type { FormDefinition } from './definition';
import { type BillingMode, type PartySection } from './party';

/**
 * The route-owned, party-aware registration SHELL decoder (registrar plan
 * Decision 2b.4 — "THE CRUX"). The engine (`definitionToSchema`) owns ONE
 * registrant's field graph; the registration ROUTE owns the
 * `{ registrants: [...] }` envelope, and — once a form authors a `party` section
 * — the `party` block that rides alongside it. This module builds the codec for
 * that envelope FROM the form's `FormDefinition`, so a definition edit
 * (`forms/registration.json`) changes what the shell accepts with no code change
 * (`derive-dont-sync`). It REPLACES the inline `Schema.Struct({ registrants })`
 * the registration action decoded against before this commit.
 *
 * Why the shell, NOT the engine (Decision 2b.4): the party→registrant email law
 * and the chosen-mode discriminant are SAME-SCOPE sibling facts inside ONE struct
 * (`party` and `registrants` are siblings here), never the engine's cross-scope
 * `activeWhenEquals` case. Lifting them into the engine's riskiest module would
 * make a hundred unwanted cross-scope rules representable to serve the one wanted
 * one (`make-impossible-states-unrepresentable`); keeping them at the route's own
 * hand-authored boundary is exactly where party-level facts already live.
 *
 * SCOPE (C7): the `group` arm + the no-`party` legacy arm only. The
 * `perRegistrant` arm (the full `buildModeUnion`, `requireRegistrantEmails`, the
 * present-off-list smuggle reject) is added in C7.5, AFTER this server branch
 * exists — the C7a authored `party` offers GROUP-ONLY modes, so a group-only
 * allow-list is the only reachable shape this commit must decode. The mode-union
 * machinery is written union-ready (a single authored mode collapses to one arm),
 * so C7.5 widens rather than rewrites.
 *
 * Modelling principles (`~/.brain/principles`):
 *   - `make-impossible-states-unrepresentable`: the DECODED party is a
 *     `_tag`-discriminated value — the `group` arm carries exactly one nominated
 *     `payer` (name + required email); a `perRegistrant` arm (C7.5) carries none.
 *     A payer in `perRegistrant`, or a `group` with no payer, is unrepresentable.
 *   - `derive-dont-sync`: the payer's `name`/`email` codecs are the engine's own
 *     exported `requiredString`/`email` (one decode boundary, one email shape);
 *     the registrant codec is `definitionToSchema(definition)` verbatim.
 */

/** The nominated payer's DECODED value — present only in the `group` arm. */
export type Payer = { readonly name: string; readonly email: string };

/**
 * The DECODED registration shell (registrar plan Decision 2b.2) — a `_tag`-
 * discriminated value where impossible states die: the `group` arm carries exactly
 * one nominated `payer`; a `perRegistrant` arm (C7.5) carries none; a no-`party`
 * legacy form is the bare `{ registrants }` shell. The route branches on this
 * single discriminant for cardinality + receipt routing (Decision 2b.6).
 */
export type RegistrationShellDecoded =
  | { readonly registrants: ReadonlyArray<DecodedForm> }
  | {
      readonly party: { readonly _tag: 'group'; readonly payer: Payer };
      readonly registrants: ReadonlyArray<DecodedForm>;
    };

/**
 * The nominated payer codec — decoded ONLY in the `group` arm (a `perRegistrant`
 * party never reads it). `name` is a non-empty string and `email` a required,
 * permissive-shape address, both through the engine's own exported leaf codecs so
 * the payer is validated by the SAME rules a form `email`/`requiredText` field is.
 * The authored `party.payer` is `optionalKey`, but the `FormDefinition`
 * biconditional (`definition.ts` `partyPayerBiconditional`) guarantees it is
 * PRESENT whenever the form offers `group`, so the non-null assertion is sound at
 * this call site (the shell only builds the group arm when `group` is offered).
 */
const payerCodec = (payer: NonNullable<PartySection['payer']>) =>
  Schema.Struct({
    name: requiredString(payer.nameField.requiredMessage),
    email: email(
      payer.emailField.requiredMessage,
      payer.emailField.invalidMessage,
    ),
  });

/**
 * `registrants.length > 0` (retained from the prior plan, Decision 2b.4): a party
 * can never silently produce zero orders, and a `group`'s payer is never a phantom
 * paying for nobody. Reported at `['registrants']` with the registration form's
 * own "at least one registrant" key.
 */
const nonEmptyParty = Schema.makeFilter(
  (shell: { readonly registrants: ReadonlyArray<unknown> }) =>
    shell.registrants.length > 0
      ? undefined
      : {
          path: ['registrants'],
          issue: 'registration.form.type.required' as const,
        },
  { title: 'registrationShell.nonEmptyParty' },
);

/**
 * Drop a blank (`''`) registrant `email` BEFORE the per-registrant codec runs
 * (registrar plan 2b.3 — the load-bearing `group`-arm normalization). The
 * registration `email` field is authored `optional: true` (optional-AT-KEY,
 * non-empty-WHEN-present, C7a): an ABSENT email decodes valid, but a PRESENT blank
 * still rejects — and the live form RENDERS `email: ''`, which the browser POSTs
 * as a present blank. So in `group`, an un-filled non-leader email must be
 * normalized from present-blank to absent here, server-side, so it decodes valid.
 * This is the server-trusted boundary (NOT a brittle client `name`-omission).
 *
 * Operates element-wise over the raw registrants array: each non-null record with
 * a blank-string `email` has that key deleted; every other value passes through
 * untouched (a non-record element is left for the per-registrant codec to reject).
 * The payer email is NEVER touched (it is required) and `perRegistrant` never
 * drops (C7.5 re-imposes every registrant email).
 */
const dropBlankRegistrantEmails = (
  registrants: ReadonlyArray<unknown>,
): Array<Record<string, unknown>> =>
  registrants.map((registrant) => {
    if (
      registrant === null ||
      typeof registrant !== 'object' ||
      Array.isArray(registrant)
    ) {
      // A non-record element is left as-is for the per-registrant codec to
      // reject; the cast names the codec's Encoded element type so the transform
      // composes (the codec is the real type gate, not this normalization).
      return registrant as Record<string, unknown>;
    }
    const record = registrant as Record<string, unknown>;
    if (record['email'] !== '') return record;
    const { email: _blank, ...rest } = record;
    return rest;
  });

/**
 * The registrants array for the `group` arm: the per-registrant codec preceded by
 * the blank-email drop. Modelled as `Array(Unknown)` transformed into
 * `Array(registrant)` so the normalization runs on the RAW POSTed array before any
 * per-registrant decode — the only place an un-filled `email: ''` can become
 * absent without the per-registrant codec first rejecting it.
 */
const groupRegistrants = (registrant: Schema.Codec<Record<string, unknown>>) =>
  Schema.mutable(Schema.Array(Schema.Unknown)).pipe(
    Schema.decodeTo(Schema.mutable(Schema.Array(registrant)), {
      decode: SchemaGetter.transform(dropBlankRegistrantEmails),
      encode: SchemaGetter.passthrough({ strict: false }),
    }),
  );

/**
 * Build the discriminated mode union over the authored arms (registrar plan
 * 2b.4). C7 only ever passes the `group` arm (C7a authors group-only), so a
 * single-mode allow-list collapses to that ONE arm with the absent-mode
 * discriminant default applied; C7.5 passes both arms and this becomes a real
 * `Schema.Union` discriminated on `party._tag`. Spelling the discriminant as
 * `optionalKey(Literals(allowed)).pipe(withDecodingDefaultKey(...))` is what makes
 * an ABSENT mode fill to the lone/first authored mode at DECODE time (a constructor
 * default via `Schema.tag` would not fire on decode — `toast.server.ts:17-25`).
 */
const buildModeUnion = (
  allowed: ReadonlyArray<BillingMode>,
  arms: { readonly group: Schema.Top },
): Schema.Top => {
  // C7: group-only. The single authored arm IS the shell — its `_tag` discriminant
  // already defaults to the lone allowed mode. C7.5 widens `arms`/`allowed` and
  // returns a `Schema.Union(...)` discriminated on `_tag` here.
  void allowed;
  return arms.group;
};

/**
 * Compile a `FormDefinition` into the party-aware shell codec the registration
 * route decodes a submission against (registrar plan Decision 7 step 0). The
 * authored `party.billingMode.options` STRUCT keys ARE the mode allow-list
 * (absent key ⇒ mode not offered). A definition with no `party` (contact /
 * volunteer / a legacy `forms/registration.json` authored before the party
 * section) decodes against the TODAY `{ registrants }` shell, group-implicit — so
 * nothing about the existing forms changes.
 */
export const registrationShellSchema = (
  definition: FormDefinition,
): Schema.Codec<RegistrationShellDecoded, Record<string, unknown>> => {
  const party = definition.party;
  const registrant = definitionToSchema(definition);
  // The authored option-struct keys ARE the allow-list, e.g. ['group'] (C7a) or
  // ['group','perRegistrant'] (C7.5).
  const allowed = party
    ? (Object.keys(party.billingMode.options) as Array<BillingMode>)
    : [];

  // The decoded shell is a discriminated union the route branches on; the dynamic
  // struct/union build cannot carry that precise `Type` in its inferred schema
  // type, so the result is annotated to the typed codec (the same cast-at-the-seam
  // idiom `definitionToSchema` uses for its `DecodedForm` payload). The decoded
  // VALUE genuinely matches: the legacy arm decodes `{ registrants }`, the group
  // arm `{ party: { _tag: 'group', payer }, registrants }`.
  const asShell = (
    schema: Schema.Top,
  ): Schema.Codec<RegistrationShellDecoded, Record<string, unknown>> =>
    schema as unknown as Schema.Codec<
      RegistrationShellDecoded,
      Record<string, unknown>
    >;

  // No party section (legacy / contact / volunteer) ⇒ the today shell.
  const defaultMode = allowed[0];
  if (party === undefined || defaultMode === undefined) {
    return asShell(
      Schema.Struct({
        registrants: Schema.mutable(Schema.Array(registrant)),
      }).check(nonEmptyParty as never),
    );
  }

  // The `group` arm: a nominated payer + registrants whose blank emails are
  // dropped to absent (2b.3). The `_tag` discriminant defaults to the lone/first
  // allowed mode when absent; a present value is checked against the allow-list.
  const groupShell = Schema.Struct({
    party: Schema.Struct({
      _tag: Schema.optionalKey(Schema.Literals(allowed)).pipe(
        Schema.withDecodingDefaultKey(Effect.succeed(defaultMode)),
      ),
      // `payer` is present whenever `group` is offered (the FormDefinition
      // biconditional), so this codec is only reached on a group-offering form.
      payer: payerCodec(party.payer as NonNullable<PartySection['payer']>),
    }),
    registrants: groupRegistrants(registrant),
  }).check(nonEmptyParty as never);

  return asShell(buildModeUnion(allowed, { group: groupShell }));
};
