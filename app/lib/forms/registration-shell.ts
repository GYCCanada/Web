import { Schema, SchemaGetter } from 'effect';

import { type DecodedForm, definitionToSchema, email, requiredString } from './decode';
import type { FormDefinition } from './definition';
import { type BillingMode, type PartySection } from './party';
import { MessageKey } from './tokens';

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
 * SCOPE (C7.5): the full mode union — the `group` arm, the `perRegistrant` arm,
 * and the no-`party` legacy arm. C7 landed the `group` arm + the union-ready
 * machinery; this commit widens `buildModeUnion` into a real `Schema.Union` over
 * the authored arms (`derive-dont-sync` off the `billingMode.options` allow-list),
 * adds `requireRegistrantEmails` (the `perRegistrant` re-imposition, 2b row (i)),
 * and earns the present-off-list smuggle reject (a `_tag` not in the authored
 * allow-list matches NO arm ⇒ hard-reject). A single authored mode still collapses
 * to one arm with its discriminant defaulted; an absent mode on a multi-mode form
 * decodes to the FIRST authored arm (the union tries members in allow-list order).
 *
 * Modelling principles (`~/.brain/principles`):
 *   - `make-impossible-states-unrepresentable`: the DECODED party is a
 *     `_tag`-discriminated value — the `group` arm carries exactly one nominated
 *     `payer` (name + required email); the `perRegistrant` arm carries none.
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
 * one nominated `payer`; the `perRegistrant` arm carries none (each registrant
 * self-pays); a no-`party` legacy form is the bare `{ registrants }` shell. The
 * route branches on this single discriminant for cardinality + receipt routing
 * (Decision 2b.6): `group` ⇒ one order/intent for the party sum keyed off the
 * payer; `perRegistrant` ⇒ N orders/intents, each keyed off that registrant.
 */
export type RegistrationShellDecoded =
  | { readonly registrants: ReadonlyArray<DecodedForm> }
  | {
      readonly party: { readonly _tag: 'group'; readonly payer: Payer };
      readonly registrants: ReadonlyArray<DecodedForm>;
    }
  | {
      readonly party: { readonly _tag: 'perRegistrant' };
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
 * The `perRegistrant` re-imposition (registrar plan 2b row (i) / the "crux" 2b.4) —
 * the ONE closed enclosing-scope law: everyone self-pays ⇒ everyone needs a
 * receipt-capable email, so EVERY registrant email is required (no blank-drop, the
 * `group`-only normalization is never applied here). The engine sees the registrant
 * `email` as merely optional-at-key (C7a); this same-scope sibling filter re-imposes
 * presence at the shell, exactly where party-level facts live — never the engine's
 * cross-scope activation limit.
 *
 * Reports at `['registrants', i, 'email']` (the conform field name the live form
 * renders) with the registrant email field's OWN authored `requiredMessage`
 * (`derive-dont-sync`: the message a present-blank email already emits in the
 * engine, read off the definition's `email`-kind field, never a re-declared key).
 */
const requireRegistrantEmails = (requiredMessage: MessageKey) =>
  Schema.makeFilter(
    (shell: { readonly registrants: ReadonlyArray<Record<string, unknown>> }) => {
      for (let index = 0; index < shell.registrants.length; index += 1) {
        const value = shell.registrants[index]?.['email'];
        if (value === undefined || value === '') {
          return { path: ['registrants', index, 'email'], issue: requiredMessage };
        }
      }
      return undefined;
    },
    { title: 'registrationShell.requireRegistrantEmails' },
  );

/**
 * The registrant email field's authored `requiredMessage` — the key
 * `requireRegistrantEmails` reports a missing `perRegistrant` email with
 * (`derive-dont-sync`). Read off the definition's top-level `email`-kind field
 * (registration's `email` field, `defaults.ts`); a definition with no such field
 * has no `perRegistrant` mode authored anyway (the registration form is the only
 * party-offering form), so the fallback is unreachable in practice and exists only
 * to keep the lookup total.
 */
const registrantEmailRequiredMessage = (
  definition: FormDefinition,
): MessageKey => {
  for (const field of definition.fields) {
    if (field._tag === 'email' && field.name === 'email') {
      return field.requiredMessage;
    }
  }
  return MessageKey.make('registration.form.email.required');
};

/**
 * Pre-fill the chosen-mode discriminant on the RAW shell input (registrar plan
 * 2b.4 — "the absent-mode default is applied to the DISCRIMINANT inside
 * buildModeUnion"). The union dispatches PURELY on `party._tag`, so the absent-mode
 * default must be resolved BEFORE dispatch — not as a per-arm `optionalKey` fill,
 * which would let a payload that fails the first arm STRUCTURALLY (e.g. a `group`
 * with a blank payer email) silently fall through to a second arm. So an absent /
 * `undefined` `party._tag` is filled to the first authored mode here, on the raw
 * record, and each arm then carries a REQUIRED `Schema.Literal(mode)` discriminant:
 *   - an absent mode lands on the FIRST authored arm (the fill) and is validated by
 *     ONLY that arm's structure (`group` ⇒ payer required; no fallthrough);
 *   - a PRESENT off-list `_tag` is left untouched, matches NO arm's literal ⇒ the
 *     union hard-rejects (the smuggle attack — e.g. `perRegistrant` on a group-only
 *     form, or a bogus mode on a two-mode form).
 */
const fillDefaultMode = (
  defaultMode: BillingMode,
  input: Record<string, unknown>,
): Record<string, unknown> => {
  const party = input['party'];
  if (party === null || typeof party !== 'object' || Array.isArray(party)) {
    return input;
  }
  const partyRecord = party as Record<string, unknown>;
  if (partyRecord['_tag'] !== undefined) return input;
  return { ...input, party: { ...partyRecord, _tag: defaultMode } };
};

/**
 * Build the discriminated mode union over the AUTHORED arms (registrar plan 2b.4) —
 * the allow-list IS the set of arms (`derive-dont-sync` off `billingMode.options`).
 * The raw input's discriminant is pre-filled to the first authored mode
 * ({@link fillDefaultMode}), then the arms are tried in allow-list order, each
 * pinned to its own required `_tag` literal so `anyOf` can only match the arm whose
 * literal equals the (now-present) tag — a discriminated dispatch, no structural
 * fallthrough. A single authored mode collapses to that one arm (still wrapped in
 * the pre-fill so an absent `_tag` decodes).
 */
const buildModeUnion = (
  defaultMode: BillingMode,
  arms: ReadonlyArray<Schema.Top>,
): Schema.Top => {
  const union = arms.length === 1 ? arms[0]! : Schema.Union(arms);
  return Schema.Unknown.pipe(
    Schema.decodeTo(union, {
      decode: SchemaGetter.transform((input: unknown) =>
        input !== null && typeof input === 'object' && !Array.isArray(input)
          ? fillDefaultMode(defaultMode, input as Record<string, unknown>)
          : input,
      ),
      encode: SchemaGetter.passthrough({ strict: false }),
    }),
  );
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
  // dropped to absent (2b.3). The `_tag` is a REQUIRED literal — the union
  // dispatches on it after {@link fillDefaultMode} resolved an absent mode. `payer`
  // is present whenever `group` is offered (the FormDefinition biconditional), so
  // this codec is only reached on a group-offering form.
  const groupShell = Schema.Struct({
    party: Schema.Struct({
      // A REQUIRED tag literal — the union dispatches on it after
      // {@link fillDefaultMode} resolved an absent mode. `Schema.tag` is a
      // decode-time `Literal('group')` (its constructor default never fires on
      // decode); the absent-mode fill is the pre-transform, not this field.
      _tag: Schema.tag('group'),
      payer: payerCodec(party.payer as NonNullable<PartySection['payer']>),
    }),
    registrants: groupRegistrants(registrant),
  }).check(nonEmptyParty as never);

  // The `perRegistrant` arm: NO payer (unrepresentable — each registrant
  // self-pays), and EVERY registrant email re-imposed (2b row (i)) — the blank
  // emails are NOT dropped here, the engine codec runs verbatim and the shell
  // filter requires presence on top.
  //
  // `payer: optionalKey(Never)` makes "payer absent in perRegistrant" the ONLY
  // representable shape (plan Decision 2b.2(b), :134). Without the explicit
  // `Never` key, `Schema.Struct` silently STRIPS an unknown `payer` — a smuggled
  // `{ _tag: 'perRegistrant', payer: {…} }` would decode and drop the payer,
  // re-opening the impossible state the tagged union exists to foreclose. `Never`
  // hard-fails decode the instant a `payer` key is PRESENT; absence stays valid.
  const perRegistrantShell = Schema.Struct({
    party: Schema.Struct({
      _tag: Schema.tag('perRegistrant'),
      payer: Schema.optionalKey(Schema.Never),
    }),
    registrants: Schema.mutable(Schema.Array(registrant)),
  })
    .check(nonEmptyParty as never)
    .check(
      requireRegistrantEmails(
        registrantEmailRequiredMessage(definition),
      ) as never,
    );

  // Union ONLY the authored arms, in allow-list order (the absent-mode default
  // lands on the first authored arm). A single authored mode collapses to one arm.
  const armByMode: Record<BillingMode, Schema.Top> = {
    group: groupShell,
    perRegistrant: perRegistrantShell,
  };
  return asShell(
    buildModeUnion(
      defaultMode,
      allowed.map((mode) => armByMode[mode]),
    ),
  );
};
