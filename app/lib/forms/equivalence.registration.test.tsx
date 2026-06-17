import { describe, expect, test } from 'bun:test';
import { Result, Schema } from 'effect';
import { renderToString } from 'react-dom/server';
import { createRoutesStub } from 'react-router';

import { defaultRegistrationForm } from '~/lib/content/pages/defaults';
import { parseSchema } from '~/lib/effect/form-schema';
import { isTranslationKey } from '~/lib/effect/form-schema.test-helper';
import { LocalizationProvider } from '~/lib/localization/provider';
import { root } from '~/lib/localization/translations';
import {
  makeDefaultRegistrant,
  RegistrationForm,
} from '~/routes/($lang)+/registration-form';
import { RegistrationSchema as OracleRegistrationSchema } from '~/routes/($lang)+/registration-schema.oracle';

import { definitionToSchema } from './decode';

/**
 * Branch 6.5 — the registration equivalence harness (ADR 0007, settled #6, plan
 * §"Riskiest commit"). Registration is the RISKIEST migration: a 2-way
 * discriminated union (attendee / exhibitor) with ~10 per-type presence
 * requirements, a `true`/`false`/`on` three-token boolean codec, nested groups,
 * and an error set where every failure path must emit a real `TranslationKey` (a
 * wrong/absent key renders blank). It is CLIENT-ONLY today (the route action is a
 * verified no-op), so this harness pins it three ways — (a) identical decoded
 * output, (b) identical emitted `TranslationKey` sets (same paths, same keys) on
 * the order-independent client collect-all path + EN+FR rendered-string parity,
 * (c) render-level field-name + default-value parity (below): the LIVE
 * `<RegistrationForm>` is `renderToString`-rendered and its emitted submit-names
 * are asserted against the definition graph (the real render path, not an inlined
 * copy), and the form's REAL `makeDefaultRegistrant` is imported (not a
 * hand-maintained duplicate — `derive-dont-sync`) and proven to seed every
 * definition field name.
 *
 * Unlike contact (6.3) / volunteer (6.4), whose oracles were inlined in the test,
 * the registration oracle is KEPT as a FILE (`registration-schema.oracle.ts`, the
 * verbatim pre-migration schema) and imported here — the plan's clean subtract
 * signal; the oracle is deleted once every migration is green (6.6).
 *
 * SCOPE: the engine's `defaultRegistrationForm` validates ONE registrant; the form
 * is `{ registrants: Registrant[] }` (a repeating array, NOT in the closed
 * `FieldKind` set). So the engine equivalent wraps the per-registrant codec in
 * `{ registrants: Array(...) }`, mirroring the oracle's shape and the live form's
 * derived schema (`registration-form.tsx`). Every assertion is a single registrant
 * in `registrants[0]`, with paths like `registrants[0].type`.
 *
 * ONE intentional, contained delta is pinned (not hidden): the WHOLLY-ABSENT
 * `extra` group anchor. The oracle hardcodes the absent-`extra` key at
 * `extra.tos` (`registration-schema.oracle.ts:274-279`); the engine's GENERIC
 * group-presence rule anchors at the group's FIRST presence-requirable inner field
 * (`extra.howDidYouHear`). Both emit the SAME real `TranslationKey` *kind* (a
 * required `extra.*` key) on an OUT-OF-FORM edge — an attendee never submits with
 * no `extra` object, because the form always renders the `extra` block (with
 * defaults) for an attendee, so the field whose key anchors the absent group is
 * never observed. The two cases carrying this edge (`bare attendee`, `extra
 * absent`) are routed to `absentExtraAnchorDelta` below and excluded from the
 * blanket key-set equivalence; every OTHER case has identical keys
 * (`noKeyDivergence`). See `docs/forms/registration-spec.md`.
 *
 * Otherwise no key divergence (unlike contact's `name.error` alias): the oracle's
 * `RequiredString` already emits its single key for the empty / absent /
 * invalid-type cases, exactly as the engine's `requiredText` does.
 */

// ---------------------------------------------------------------------------
// The engine equivalent — the per-registrant codec wrapped in { registrants }
// ---------------------------------------------------------------------------

// The `{ registrants }` wrapper is the FORM SHELL the registration route owns (the
// engine validates ONE registrant). The shell annotates a missing `registrants`
// key with the discriminator's required key, exactly as the oracle's
// `RegistrationSchema` does (`registration-schema.oracle.ts`) and the live
// `registration-form.tsx` derived schema does — so the empty-form case attributes
// to `type`, never the raw `Missing key`.
const engineRegistrant = definitionToSchema(defaultRegistrationForm);
const engineSchema = Schema.Struct({
  registrants: Schema.mutable(Schema.Array(engineRegistrant)).annotateKey({
    messageMissingKey: 'registration.form.type.required',
  }),
});

// ---------------------------------------------------------------------------
// Harness helpers
// ---------------------------------------------------------------------------

/** One validation issue: the conform field name it attaches to + its message key. */
type Issue = { name: string; key: string };

// The COMPLETE, order-independent error set a form surfaces — collected via the
// client Standard-Schema path (`toStandardSchemaV1`), which gathers EVERY issue
// (unlike Effect's default server decode, which aborts on the first failing struct
// field). This is exactly what `useForm`'s onSubmit validation renders, and is
// independent of the field DECLARATION ORDER that would otherwise make the single
// server-side abort-first error differ between the oracle and the engine — a
// difference the user never sees. The server decoded SUCCESS output is asserted
// separately below.
const issuesOf =
  <A, I>(schema: Schema.Codec<A, I, never, never>) =>
  (payload: unknown): Issue[] => {
    const result = Schema.toStandardSchemaV1(schema)['~standard'].validate(
      payload,
    ) as {
      issues?: ReadonlyArray<{
        message: string;
        path?: ReadonlyArray<PropertyKey | { key: PropertyKey }>;
      }>;
    };
    return (result.issues ?? [])
      .map((issue) => {
        const segments: Array<string | number> = [];
        for (const segment of issue.path ?? []) {
          const value =
            typeof segment === 'object' && segment !== null && 'key' in segment
              ? segment.key
              : segment;
          if (typeof value === 'string') {
            segments.push(value);
          } else if (typeof value === 'number') {
            // Conform names array elements with bracket notation
            // (`registrants[0]`), not a dotted `registrants.0`.
            segments[segments.length - 1] =
              `${segments[segments.length - 1]}[${value}]`;
          }
        }
        return { name: segments.join('.'), key: issue.message };
      })
      .sort((a, b) =>
        `${a.name}|${a.key}`.localeCompare(`${b.name}|${b.key}`),
      );
  };

const oracleIssues = issuesOf(
  OracleRegistrationSchema as Schema.Codec<unknown, unknown, never, never>,
);
const engineIssues = issuesOf(
  engineSchema as Schema.Codec<unknown, unknown, never, never>,
);

/** Render each issue's key to its locale string (the alias-tolerant comparison). */
const renderIssues = (issues: Issue[], locale: 'en' | 'fr'): Issue[] =>
  issues.map((issue) => ({
    name: issue.name,
    key: issue.key in root[locale] ? root[locale][issue.key as never] : issue.key,
  }));

/** The decoded SUCCESS value, or a `Failure` marker, for cross-engine compare. */
const decodedOf = (
  result: Result.Result<unknown, unknown>,
): { ok: true; value: unknown } | { ok: false } =>
  Result.isSuccess(result)
    ? { ok: true, value: result.success }
    : { ok: false };

const decodeEngine = (payload: unknown) =>
  Schema.decodeUnknownResult(engineSchema)(payload);

// ---------------------------------------------------------------------------
// The corpus — valid + every invalid variant (one registrant at registrants[0])
// ---------------------------------------------------------------------------

/** A minimal valid attendee payload as the form submits it (all strings). */
const attendee = (overrides: Record<string, unknown> = {}) => ({
  type: 'attendee',
  name: 'Ada',
  email: 'ada@example.com',
  phone: '555-0100',
  dateOfBirth: '2000-01-01',
  gender: 'female',
  meals: 'true',
  outreach: ['laws-of-health'],
  extra: {
    howDidYouHear: 'friend',
    whyAreYouAttending: 'growth',
    whatAreYouExcitedAbout: 'seminars',
    firstTimeAttending: 'false',
    merch: ['t-shirt'],
    other: '',
    tos: 'true',
  },
  volunteer: {
    songLeader: 'on',
  },
  ...overrides,
});

const exhibitor = (overrides: Record<string, unknown> = {}) => ({
  type: 'exhibitor',
  name: 'Acme',
  email: 'sales@acme.com',
  phone: '555-0101',
  synopsis: 'We sell things',
  website: 'https://acme.com',
  company: 'Acme Inc',
  ...overrides,
});

/** Wrap a single registrant payload in the `{ registrants: [...] }` form shape. */
const reg = (registrant: unknown) => ({ registrants: [registrant] });

/**
 * A copy of `record` with `key` ABSENT (deleted), modelling how a browser form
 * OMITS an unsubmitted field — distinct from an explicit `undefined` value. The
 * distinction is load-bearing for a field whose schema carries only an
 * `annotateKey({ messageMissingKey })` and no node-level relabel (the `merch`
 * array): an absent key emits the real `messageMissingKey`, whereas a
 * present-`undefined` hits a raw `InvalidType` ("Expected array, got undefined")
 * that no translation key labels — an out-of-form payload the live form can never
 * produce. "Missing" in the corpus therefore means key-absent.
 */
const without = (record: Record<string, unknown>, key: string) => {
  const { [key]: _omitted, ...rest } = record;
  return rest;
};

const corpus: Array<{ label: string; payload: unknown }> = [
  // Valid submissions.
  { label: 'valid attendee', payload: reg(attendee()) },
  { label: 'valid exhibitor', payload: reg(exhibitor()) },
  {
    label: 'valid attendee with parent (minor) + volunteer flags',
    payload: reg(
      attendee({
        parent: { name: 'Mum', email: 'mum@x.co', phone: '5' },
        volunteer: { songLeader: 'on', musician: 'on', instrument: 'piano' },
        dietaryRestrictions: 'none',
        extra: {
          howDidYouHear: 'friend',
          whyAreYouAttending: 'growth',
          whatAreYouExcitedAbout: 'seminars',
          firstTimeAttending: 'true',
          church: 'First',
          merch: ['t-shirt', 'hoodie'],
          other: 'note',
          tos: 'on',
        },
      }),
    ),
  },
  // Whole registrants array / field missing.
  { label: 'registrants missing', payload: {} },
  { label: 'empty registrant', payload: reg({}) },
  // Discriminator: missing + off-list + invalid-type.
  {
    label: 'type missing',
    payload: reg({ name: 'Ada', email: 'a@b.co', phone: '5' }),
  },
  {
    label: 'type off-list',
    payload: reg({ type: 'bogus', name: 'Ada', email: 'a@b.co', phone: '5' }),
  },
  {
    label: 'type array (invalid-type)',
    payload: reg(attendee({ type: ['attendee', 'exhibitor'] })),
  },
  // Bare exhibitor — every per-type requirement fires. (Bare attendee carries the
  // wholly-absent `extra` group, whose anchor field is the one pinned delta, so it
  // lives in `absentExtraCorpus` below, not the blanket key-set corpus.)
  {
    label: 'bare exhibitor',
    payload: reg({ type: 'exhibitor', name: 'Acme', email: 'a@b.co', phone: '5' }),
  },
  // Shared fields: empty / absent / invalid-type.
  { label: 'name empty', payload: reg(attendee({ name: '' })) },
  { label: 'name missing', payload: reg(attendee({ name: undefined })) },
  { label: 'name array', payload: reg(attendee({ name: ['a', 'b'] })) },
  { label: 'phone empty', payload: reg(attendee({ phone: '' })) },
  { label: 'phone missing', payload: reg(without(attendee(), 'phone')) },
  { label: 'phone array', payload: reg(attendee({ phone: ['a', 'b'] })) },
  { label: 'email empty', payload: reg(attendee({ email: '' })) },
  { label: 'email missing', payload: reg(without(attendee(), 'email')) },
  { label: 'email malformed', payload: reg(attendee({ email: 'not-an-email' })) },
  { label: 'email array', payload: reg(attendee({ email: ['a', 'b'] })) },
  // Attendee literal / boolean / array fields.
  { label: 'gender off-list', payload: reg(attendee({ gender: 'other' })) },
  { label: 'gender missing', payload: reg(attendee({ gender: undefined })) },
  { label: 'meals off-token', payload: reg(attendee({ meals: 'maybe' })) },
  { label: 'meals missing', payload: reg(attendee({ meals: undefined })) },
  { label: 'meals on', payload: reg(attendee({ meals: 'on' })) },
  { label: 'meals false', payload: reg(attendee({ meals: 'false' })) },
  { label: 'outreach off-list', payload: reg(attendee({ outreach: ['bogus'] })) },
  { label: 'outreach missing', payload: reg(attendee({ outreach: undefined })) },
  { label: 'dateOfBirth missing', payload: reg(attendee({ dateOfBirth: undefined })) },
  { label: 'dateOfBirth empty', payload: reg(attendee({ dateOfBirth: '' })) },
  // Nested extra group: present-but-invalid sub-fields. (Wholly-absent `extra` is
  // the pinned anchor delta — see `absentExtraCorpus`.)
  {
    label: 'extra.tos absent',
    payload: reg(
      attendee({ extra: { ...attendee().extra, tos: undefined } }),
    ),
  },
  {
    label: 'extra.tos off-token',
    payload: reg(attendee({ extra: { ...attendee().extra, tos: 'maybe' } })),
  },
  {
    label: 'extra.howDidYouHear empty',
    payload: reg(
      attendee({ extra: { ...attendee().extra, howDidYouHear: '' } }),
    ),
  },
  {
    label: 'extra.whyAreYouAttending missing',
    payload: reg(
      attendee({ extra: without(attendee().extra, 'whyAreYouAttending') }),
    ),
  },
  {
    label: 'extra.whatAreYouExcitedAbout missing',
    payload: reg(
      attendee({ extra: without(attendee().extra, 'whatAreYouExcitedAbout') }),
    ),
  },
  {
    label: 'extra.firstTimeAttending missing',
    payload: reg(
      attendee({ extra: without(attendee().extra, 'firstTimeAttending') }),
    ),
  },
  {
    label: 'extra.firstTimeAttending on',
    payload: reg(
      attendee({ extra: { ...attendee().extra, firstTimeAttending: 'on' } }),
    ),
  },
  {
    label: 'extra.firstTimeAttending off-token',
    payload: reg(
      attendee({
        extra: { ...attendee().extra, firstTimeAttending: 'maybe' },
      }),
    ),
  },
  {
    label: 'extra.merch missing',
    payload: reg(attendee({ extra: without(attendee().extra, 'merch') })),
  },
  {
    label: 'extra.merch off-list',
    payload: reg(attendee({ extra: { ...attendee().extra, merch: ['bogus'] } })),
  },
  // extra.other carries the key-must-be-present, empty-allowed contract (oracle
  // `OptionalText`, engine `optionalText` `requirePresent: true`): an absent
  // `other` inside a PRESENT `extra` emits `registration.form.other.required`
  // (this is the case BLOCKING #1's regression masked — the engine wrongly
  // accepted it before `requirePresent`); a present non-string is invalid; an
  // empty string is valid (covered by `valid attendee`, whose `other: ''`).
  {
    label: 'extra.other absent (present extra)',
    payload: reg(attendee({ extra: without(attendee().extra, 'other') })),
  },
  {
    label: 'extra.other array (invalid-type)',
    payload: reg(
      attendee({ extra: { ...attendee().extra, other: ['a', 'b'] } }),
    ),
  },
  // Optional groups present-but-invalid.
  {
    label: 'parent present, inner required empty',
    payload: reg(
      attendee({ parent: { name: '', email: '', phone: '' } }),
    ),
  },
  {
    label: 'volunteer present, flag off-token',
    payload: reg(attendee({ volunteer: { songLeader: 'maybe' } })),
  },
  // Volunteer optional flags across the absent / on / true / false boolean-token
  // matrix (the plan's "volunteer optional-flag absent/on/true/false"). Each token
  // is a VALID submission (absent = unchecked, `on`/`true` = checked-true,
  // `false` = checked-false) — the oracle's `OptionalFlag` (`optionalKey` +
  // `StringToBoolean`) and the engine's `optional: true checkboxBoolean` must
  // decode all four identically.
  {
    label: 'volunteer flag absent (whole group present, flag omitted)',
    payload: reg(attendee({ volunteer: { musician: 'on' } })),
  },
  {
    label: 'volunteer flag on',
    payload: reg(attendee({ volunteer: { songLeader: 'on' } })),
  },
  {
    label: 'volunteer flag true',
    payload: reg(attendee({ volunteer: { songLeader: 'true' } })),
  },
  {
    label: 'volunteer flag false',
    payload: reg(attendee({ volunteer: { songLeader: 'false' } })),
  },
  {
    label: 'volunteer group absent entirely',
    payload: reg(attendee({ volunteer: undefined })),
  },
  // Genuinely-optional text fields (oracle `OptionalString` =
  // `Schema.optional(String)`, engine `optionalText` WITHOUT `requirePresent`):
  // both an ABSENT key AND an explicit `undefined` are VALID (emit nothing) — the
  // counterpart to `extra.other`'s key-must-be-present contract, proving the two
  // `optionalText` behaviours do NOT collapse (BLOCKING #1). The explicit-`undefined`
  // case additionally pins that the engine uses `Schema.optional` (accepts
  // `undefined`), not `Schema.optionalKey` (rejects it) — the divergence the
  // genuinely-optional fields exposed.
  {
    label: 'dietaryRestrictions explicit undefined (valid)',
    payload: reg(attendee({ dietaryRestrictions: undefined })),
  },
  {
    label: 'dietaryRestrictions absent (valid)',
    payload: reg(without(attendee(), 'dietaryRestrictions')),
  },
  {
    label: 'extra.church absent (valid)',
    payload: reg(attendee({ extra: without(attendee().extra, 'church') })),
  },
  {
    label: 'volunteer.instrument absent (valid)',
    payload: reg(attendee({ volunteer: { songLeader: 'on' } })),
  },
  // Exhibitor fields.
  { label: 'exhibitor synopsis missing', payload: reg(exhibitor({ synopsis: undefined })) },
  { label: 'exhibitor website missing', payload: reg(exhibitor({ website: undefined })) },
  { label: 'exhibitor website unparseable', payload: reg(exhibitor({ website: 'not a url' })) },
  { label: 'exhibitor company missing', payload: reg(exhibitor({ company: undefined })) },
];

// The two cases carrying a WHOLLY-ABSENT `extra` group — the one pinned anchor
// delta (oracle anchors at `extra.tos`, engine at `extra.howDidYouHear`). Decoded
// output is still identical (both fail); only the absent-group anchor field
// differs, and both anchor a real required `extra.*` key on an out-of-form edge.
const absentExtraCorpus: Array<{ label: string; payload: unknown }> = [
  {
    label: 'bare attendee',
    payload: reg({ type: 'attendee', name: 'Ada', email: 'a@b.co', phone: '5' }),
  },
  { label: 'extra absent', payload: reg(attendee({ extra: undefined })) },
];

describe('registration equivalence harness (oracle vs engine)', () => {
  // Decoded output is identical across BOTH corpora (the absent-extra cases decode
  // to a failure in both engines — the anchor delta is an error-PATH detail, not a
  // decoded-value one).
  test.each([...corpus, ...absentExtraCorpus])(
    '$label — identical decoded output',
    ({ payload }) => {
      const o = decodedOf(parseSchema(OracleRegistrationSchema, payload));
      const e = decodedOf(decodeEngine(payload));
      expect(e).toEqual(o);
    },
  );

  test.each(corpus)(
    '$label — identical emitted TranslationKey sets (name + key, order-independent)',
    ({ payload }) => {
      expect(engineIssues(payload)).toEqual(oracleIssues(payload));
    },
  );

  test.each(corpus)(
    '$label — identical RENDERED error strings (EN + FR)',
    ({ payload }) => {
      expect(renderIssues(engineIssues(payload), 'en')).toEqual(
        renderIssues(oracleIssues(payload), 'en'),
      );
      expect(renderIssues(engineIssues(payload), 'fr')).toEqual(
        renderIssues(oracleIssues(payload), 'fr'),
      );
    },
  );

  test('every emitted key (both engines) is a real translation key', () => {
    for (const { payload } of [...corpus, ...absentExtraCorpus]) {
      for (const issues of [oracleIssues(payload), engineIssues(payload)]) {
        for (const { key } of issues) {
          expect({ key, isKey: isTranslationKey(key) }).toEqual({
            key,
            isKey: true,
          });
        }
      }
    }
  });

  // No intentional key divergence on the main corpus: oracle and engine emit the
  // SAME keys (not merely the same rendered strings). Pinned so a future engine
  // change cannot silently introduce an alias the way contact's `name` did.
  test('noKeyDivergence: oracle and engine emit identical keys across the main corpus', () => {
    for (const { payload } of corpus) {
      expect(engineIssues(payload)).toEqual(oracleIssues(payload));
    }
  });

  // The ONE pinned anchor delta, contained to the wholly-absent `extra` group on
  // an attendee (an out-of-form edge — the form always renders `extra` with
  // defaults for an attendee). The oracle anchors the absent group at `extra.tos`;
  // the engine's generic rule anchors at the group's first presence-requirable
  // field, `extra.howDidYouHear`. Both anchor a real required `extra.*` key in the
  // SAME LOCALE STRING family; the delta can never widen beyond this group.
  test('absentExtraAnchorDelta: oracle anchors extra.tos, engine extra.howDidYouHear', () => {
    for (const { payload } of absentExtraCorpus) {
      const o = oracleIssues(payload);
      const e = engineIssues(payload);
      // The oracle's absent-extra issue is exactly `extra.tos`.
      const oracleExtra = o.filter((i) => i.name.includes('.extra.'));
      const engineExtra = e.filter((i) => i.name.includes('.extra.'));
      expect(oracleExtra).toEqual([
        {
          name: 'registrants[0].extra.tos',
          key: 'registration.form.tos.required',
        },
      ]);
      expect(engineExtra).toEqual([
        {
          name: 'registrants[0].extra.howDidYouHear',
          key: 'registration.form.how-did-you-hear.required',
        },
      ]);
      // The delta is contained to the `extra` anchor: every NON-extra issue is
      // identical between oracle and engine.
      const stripExtra = (issues: Issue[]) =>
        issues.filter((i) => !i.name.includes('.extra.'));
      expect(stripExtra(e)).toEqual(stripExtra(o));
    }
  });
});

// ---------------------------------------------------------------------------
// Render-level field-name + default-value parity (plan 6.5 point (c))
// ---------------------------------------------------------------------------

type GroupishField = {
  readonly _tag: string;
  readonly name: string;
  readonly optional?: boolean;
  readonly fields?: ReadonlyArray<unknown>;
};

/**
 * Collect every field name a list declares, by group path.
 *
 * `descendOptional` chooses how `optional: true` groups (the minors-only
 * `parent`, the opt-in `volunteer`) are treated:
 *   - `false` (RENDER view): an optional group is NOT descended into — the live
 *     form renders its inner controls only when the group is shown, so at the
 *     top-level render only the group NAME could appear. A non-optional group
 *     (`extra`, always rendered for an attendee) IS descended so each inner
 *     control's submit-name is pinned.
 *   - `true` (DEFAULT-VALUE view): every group is descended, including the optional
 *     ones — the form's `makeDefaultRegistrant` seeds a key for EVERY field name
 *     (including `volunteer.cameraOperator`, `volunteer.photographer`), so the
 *     default object must carry each. This is the `derive-dont-sync` check: the
 *     conform `name={volunteer.cameraOperator.name}` accessors the form renders are
 *     keyed off this default, so a default that omits a name (or a name the default
 *     omits) is the drift this test forbids.
 */
const collectNames = (
  fields: ReadonlyArray<GroupishField>,
  descendOptional: boolean,
  prefix = '',
): string[] =>
  fields.flatMap((field) =>
    field._tag === 'nestedGroup' &&
    field.fields &&
    (descendOptional || field.optional !== true)
      ? collectNames(
          field.fields as ReadonlyArray<GroupishField>,
          descendOptional,
          `${prefix}${field.name}.`,
        )
      : [`${prefix}${field.name}`],
  );

/**
 * Render the live `<RegistrationForm>` to an HTML string (the real render path —
 * `react-router`'s `Form` + conform `useForm` + the bespoke shell), and return the
 * de-duplicated set of `name="…"` submit-attributes it emits.
 *
 * SSR renders the discriminator + common fields + the EXHIBITOR branch (the
 * server snapshot of `useFormData`'s live `type` read is empty, so the
 * `type === 'attendee' ? … : …` shell takes the exhibitor branch). This is the
 * slice of the render path a one-shot SSR can exercise; it pins that the rendered
 * exhibitor submit-names match the definition graph with NO missing and NO extra
 * name — exactly the class of bug a hand-copied default could not catch (a control
 * with the wrong `name`, or a control with no `name` at all).
 */
const renderedNames = (): Set<string> => {
  const Stub = createRoutesStub([
    {
      id: 'root',
      path: ':lang?',
      Component: () => (
        <LocalizationProvider translation={root.en}>
          <RegistrationForm year={2026} />
        </LocalizationProvider>
      ),
    },
  ]);
  const html = renderToString(
    <Stub initialEntries={['/']} hydrationData={{ loaderData: { root: {} } }} />,
  );
  return new Set(
    [...html.matchAll(/name="([^"]+)"/g)].map((match) => match[1] ?? ''),
  );
};

describe('registration render-level field-name + default-value parity', () => {
  // (c) RENDER parity (plan 6.5 point (c)): the LIVE form is rendered and its
  // emitted submit-names are asserted against the definition's graph — not an
  // inlined hand-copied object. This is the only path registration exercises in
  // prod (settled #9), so the rendered names ARE the validated graph or the form
  // silently drops/mis-keys a field (as the pre-existing `photographer`/
  // `cameraOperator` mix-up did — a control with the wrong name + a control with no
  // name, invisible to a default-keys-only check).
  test('the rendered exhibitor branch submit-names match the definition exactly', () => {
    const names = renderedNames();
    const exhibitorBranch = defaultRegistrationForm.variant?.variants.find(
      (v) => v.value === 'exhibitor',
    );
    // The names SSR emits for one registrant: the array field itself, the
    // discriminator, the common fields, and the exhibitor branch fields — each
    // prefixed `registrants[0].` by conform.
    const expected = new Set([
      'registrants[0]',
      `registrants[0].${defaultRegistrationForm.variant?.discriminator}`,
      ...collectNames(defaultRegistrationForm.fields, false).map(
        (name) => `registrants[0].${name}`,
      ),
      ...collectNames(exhibitorBranch?.fields ?? [], false).map(
        (name) => `registrants[0].${name}`,
      ),
    ]);
    expect([...names].sort()).toEqual([...expected].sort());
  });

  // (c) DEFAULT-VALUE parity, derived (`derive-dont-sync`): the form's REAL
  // `makeDefaultRegistrant` (imported, not a copy) must carry a key for every
  // definition field name the form renders a `name=` for. The form keys its
  // `name={volunteer.X.name}` / `name={fields.X.name}` accessors off this default,
  // so a missing key here is a missing/orphaned rendered name there.
  //
  // An `optional: true` group the default leaves ABSENT (`parent: undefined` — the
  // minors-only group, materialized only once a minor is shown) is legitimately not
  // descended: its inner controls don't render until the group is present. A
  // `volunteer` group the default DOES materialize MUST carry every inner name —
  // asserted by `volunteerNamesSeeded` below; here we require presence for every
  // name down to the first absent optional-group boundary.
  test('every rendered attendee field name resolves to a default-value key', () => {
    const defaultRegistrant = makeDefaultRegistrant() as Record<string, unknown>;
    const attendeeBranch = defaultRegistrationForm.variant?.variants.find(
      (v) => v.value === 'attendee',
    );
    expect(attendeeBranch).toBeDefined();
    const names = collectNames(
      [...defaultRegistrationForm.fields, ...(attendeeBranch?.fields ?? [])],
      true,
    );
    for (const name of names) {
      const segments = name.split('.');
      let cursor: unknown = defaultRegistrant;
      for (const segment of segments) {
        // An absent optional group (default `undefined`) stops the descent — its
        // inner names need no default key until the group materializes.
        if (cursor === undefined) break;
        expect({
          name,
          present:
            cursor !== null &&
            typeof cursor === 'object' &&
            segment in (cursor as Record<string, unknown>),
        }).toEqual({ name, present: true });
        cursor = (cursor as Record<string, unknown>)[segment];
      }
    }
  });

  // The `volunteer` group the default materializes MUST seed every inner name the
  // definition declares — the specific regression the pre-existing
  // `cameraOperator`/`photographer` render bug exposed (a definition name with no
  // matching rendered `name=`). Derived from the definition, no hand-copied list.
  test('volunteerNamesSeeded: every volunteer definition name is a default key', () => {
    const defaultRegistrant = makeDefaultRegistrant() as Record<string, unknown>;
    const volunteerGroup = defaultRegistrationForm.variant?.variants
      .find((v) => v.value === 'attendee')
      ?.fields.find(
        (f) => f._tag === 'nestedGroup' && f.name === ('volunteer' as never),
      );
    expect(volunteerGroup?._tag).toBe('nestedGroup');
    const innerFields =
      volunteerGroup?._tag === 'nestedGroup' ? volunteerGroup.fields : [];
    const seeded = defaultRegistrant['volunteer'] as Record<string, unknown>;
    for (const inner of innerFields) {
      expect({ name: inner.name, seeded: inner.name in seeded }).toEqual({
        name: inner.name,
        seeded: true,
      });
    }
  });

  // The default carries NO key the definition doesn't declare — a stale key in the
  // default (a removed field) would render an orphan name. Pin the symmetry.
  test('the default registrant declares no key absent from the definition graph', () => {
    const defaultRegistrant = makeDefaultRegistrant() as Record<string, unknown>;
    const attendeeBranch = defaultRegistrationForm.variant?.variants.find(
      (v) => v.value === 'attendee',
    );
    const graphNames = new Set(
      collectNames(
        [...defaultRegistrationForm.fields, ...(attendeeBranch?.fields ?? [])],
        true,
      ),
    );
    const collectDefaultLeaves = (
      object: Record<string, unknown>,
      prefix = '',
    ): string[] =>
      Object.entries(object).flatMap(([key, value]) =>
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value)
          ? collectDefaultLeaves(value as Record<string, unknown>, `${prefix}${key}.`)
          : [`${prefix}${key}`],
      );
    // `parent` defaults to `undefined` (a leaf in the default), but the definition
    // descends it into `parent.name`/`…email`/`…phone`; so a default leaf is "known"
    // if it is a definition name OR a PREFIX of one (an un-materialized optional
    // group). Any default leaf that is neither is an orphan the form would render
    // with no validated counterpart.
    const isKnown = (leaf: string) =>
      graphNames.has(leaf) ||
      [...graphNames].some((name) => name.startsWith(`${leaf}.`));
    for (const leaf of collectDefaultLeaves(defaultRegistrant)) {
      expect({ leaf, known: isKnown(leaf) }).toEqual({ leaf, known: true });
    }
  });

  test('the exhibitor branch names are exactly synopsis/website/company', () => {
    const exhibitorBranch = defaultRegistrationForm.variant?.variants.find(
      (v) => v.value === 'exhibitor',
    );
    expect(collectNames(exhibitorBranch?.fields ?? [], false).sort()).toEqual(
      ['company', 'synopsis', 'website'].sort(),
    );
  });
});
