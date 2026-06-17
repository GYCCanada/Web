import { describe, expect, test } from 'bun:test';
import { Effect, Result, Schema } from 'effect';

import { defaultVolunteerForm } from '~/lib/content/pages/defaults';
import { parseSchema } from '~/lib/effect/form-schema';
import { isTranslationKey } from '~/lib/effect/form-schema.test-helper';
import { root } from '~/lib/localization/translations';

import { decodeForm, definitionToSchema } from './decode';

/**
 * Branch 6.4 — the volunteer equivalence harness (ADR 0007, settled #6).
 *
 * Volunteer is the SECOND form to migrate onto the structural engine, on the same
 * de-risking harness contact (6.3) introduced and registration (6.5) will reuse:
 * the hand-tuned volunteer schema is kept here as an ORACLE while the engine's
 * data-driven `defaultVolunteerForm` definition runs the same corpus, and the two
 * are asserted equivalent over a FULL failure matrix (valid + every invalid
 * variant) — `(a)` identical decoded output, `(b)` identical emitted
 * `TranslationKey` sets per field path, `(c)` identical EN+FR rendered strings.
 *
 * The oracle is the verbatim transcription of the pre-migration `volunteer.tsx`
 * schema (the `method` discriminator as a `Literals` field, the per-method
 * struct-level requirement filter, the always-required `age`/`location`/
 * `background`/`why` text fields, and the vestigial `positions` array). It lives
 * ONLY in this harness now — the route carries no hand-written schema
 * (`subtract-before-you-add`); the oracle is the behavioural spec the engine is
 * proven against, and is deleted once every form migration is green (6.6).
 *
 * TWO intentional, pinned deltas:
 *
 *   1. `email` FORMAT validation (a deliberate correctness tightening, NOT a
 *      render-identical alias): the pre-migration `volunteer.tsx` `Email` checked
 *      only `isMinLength(1)` — it accepted a malformed address like
 *      `"not-an-email"` as valid, a pre-existing drift from `contact.tsx`, whose
 *      `Email` DID validate the `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` shape. The
 *      structural engine's `email` kind validates format uniformly (one decoder,
 *      `derive-dont-sync`), so volunteer now REJECTS a malformed email with
 *      `volunteer.form.email.error` — exactly contact's behaviour. The engine is
 *      a strict SUPERSET of the oracle on the email field: every payload the
 *      oracle accepts with a well-formed email the engine also accepts
 *      identically, and the only payloads where they differ are ones with a
 *      visibly-malformed email value, which the engine correctly rejects
 *      (`make-impossible-states-unrepresentable`: a malformed value in an email
 *      field is not representable as valid). This is the kind of consolidation
 *      ADR 0007's structural engine exists to make — it is pinned EXPLICITLY by
 *      `emailFormatTightening` below so it can never widen to any other field or
 *      path, and the malformed/empty-email corpus cases are routed to that pin
 *      rather than asserted blanket-equivalent.
 *   2. `positions`: the oracle decodes an ABSENT `positions` to `[]` (a
 *      `withDecodingDefault`); the engine has NO `positions` field (its options
 *      are dynamic loader data, never a closed `OptionList`, so the never-
 *      rendered, never-submitted multi-checkbox does not fit the closed
 *      `FieldKind` set — `subtract-before-you-add`). The only observable
 *      consequence is the decoded default key, normalized away below and pinned
 *      by `decodedDeltaIsPositionsOnly`; the migrated route's `notify` keeps the
 *      always-empty `Positions:` notification line byte-identical.
 *
 * The always-required text fields (`name`/`age`/`location`/`background`/`why`)
 * emit their single `.required` key for the empty / absent / invalid-type cases
 * alike in BOTH oracle and engine — no divergence there (unlike contact's `name`,
 * whose oracle carried a separate `.error` key).
 */

// ---------------------------------------------------------------------------
// The oracle — verbatim from the pre-migration volunteer.tsx schema
// ---------------------------------------------------------------------------

const Name = Schema.String.annotate({ message: 'volunteer.form.name.required' })
  .check(Schema.isMinLength(1, { message: 'volunteer.form.name.required' }))
  .annotateKey({ messageMissingKey: 'volunteer.form.name.required' });
const Email = Schema.String.annotate({
  message: 'volunteer.form.email.error',
}).check(Schema.isMinLength(1, { message: 'volunteer.form.email.required' }));
const Phone = Schema.String.check(
  Schema.isMinLength(1, { message: 'volunteer.form.phone.required' }),
);
const Age = Schema.String.annotate({ message: 'volunteer.form.age.required' })
  .check(Schema.isMinLength(1, { message: 'volunteer.form.age.required' }))
  .annotateKey({ messageMissingKey: 'volunteer.form.age.required' });
const Location = Schema.String.annotate({
  message: 'volunteer.form.location.required',
})
  .check(Schema.isMinLength(1, { message: 'volunteer.form.location.required' }))
  .annotateKey({ messageMissingKey: 'volunteer.form.location.required' });
const Background = Schema.String.annotate({
  message: 'volunteer.form.background.required',
})
  .check(
    Schema.isMinLength(1, { message: 'volunteer.form.background.required' }),
  )
  .annotateKey({ messageMissingKey: 'volunteer.form.background.required' });
const Why = Schema.String.annotate({ message: 'volunteer.form.why.required' })
  .check(Schema.isMinLength(1, { message: 'volunteer.form.why.required' }))
  .annotateKey({ messageMissingKey: 'volunteer.form.why.required' });
const Positions = Schema.optionalKey(Schema.Array(Schema.String)).pipe(
  Schema.withDecodingDefault(Effect.succeed([] as string[])),
);
const Method = Schema.Literals(['email', 'phone', 'both'])
  .annotate({ message: 'volunteer.form.method.required' })
  .annotateKey({ messageMissingKey: 'volunteer.form.method.required' });

const oracle = Schema.Struct({
  name: Name,
  method: Method,
  age: Age,
  location: Location,
  background: Background,
  why: Why,
  positions: Positions,
  email: Schema.optional(Email).annotate({
    message: 'volunteer.form.email.error',
  }),
  phone: Schema.optional(Phone).annotate({
    message: 'volunteer.form.phone.required',
  }),
}).check(
  Schema.makeFilter((value) => {
    const issues: Array<{ path: ReadonlyArray<PropertyKey>; issue: string }> =
      [];
    if (
      (value.method === 'email' || value.method === 'both') &&
      value.email === undefined
    ) {
      issues.push({ path: ['email'], issue: 'volunteer.form.email.required' });
    }
    if (
      (value.method === 'phone' || value.method === 'both') &&
      value.phone === undefined
    ) {
      issues.push({ path: ['phone'], issue: 'volunteer.form.phone.required' });
    }
    return issues.length === 0 ? undefined : issues;
  }),
);

// ---------------------------------------------------------------------------
// Harness helpers
// ---------------------------------------------------------------------------

/** One validation issue: the conform field name it attaches to + its message key. */
type Issue = { name: string; key: string };

// The COMPLETE, order-independent error set a form surfaces — collected via the
// client Standard-Schema path (`toStandardSchemaV1`), which gathers EVERY issue
// (unlike Effect's default server decode, which aborts on the first failing struct
// field). This is the meaningful behavioural equivalence: it is exactly what
// `useForm`'s onSubmit validation renders to the user, and it is independent of the
// field DECLARATION ORDER that would otherwise make the single server-side
// abort-first error differ between the oracle and the engine on an all-fields-
// missing payload — a difference the user never sees, since the client blocks
// submission showing the identical full set. The server path is still asserted for
// decoded success output below.
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
          if (typeof value === 'string' || typeof value === 'number') {
            segments.push(value);
          }
        }
        return { name: segments.join('.'), key: issue.message };
      })
      .sort((a, b) =>
        `${a.name}|${a.key}`.localeCompare(`${b.name}|${b.key}`),
      );
  };

const engineCodec = definitionToSchema(defaultVolunteerForm);

const oracleIssues = issuesOf(oracle);
const engineIssues = issuesOf(
  engineCodec as Schema.Codec<unknown, unknown, never, never>,
);

/** Render each issue's key to its locale string (the alias-tolerant comparison). */
const renderIssues = (issues: Issue[], locale: 'en' | 'fr'): Issue[] =>
  issues.map((issue) => ({
    name: issue.name,
    key: issue.key in root[locale] ? root[locale][issue.key as never] : issue.key,
  }));

/**
 * The decoded SUCCESS value, or a `Failure` marker, for cross-engine compare —
 * with the vestigial `positions` key normalized away (the one pinned decoded
 * delta: the oracle emits `positions: []`, the engine omits it). The normalized
 * comparison proves every OTHER decoded field is byte-identical;
 * `decodedDeltaIsPositionsOnly` pins that the delta is exactly `positions`.
 */
const decodedOf = (
  result: Result.Result<unknown, unknown>,
): { ok: true; value: unknown } | { ok: false } => {
  if (!Result.isSuccess(result)) return { ok: false };
  const value = result.success;
  if (value && typeof value === 'object') {
    const { positions: _positions, ...rest } = value as Record<string, unknown>;
    return { ok: true, value: rest };
  }
  return { ok: true, value };
};

// ---------------------------------------------------------------------------
// The corpus — valid + every invalid variant
// ---------------------------------------------------------------------------

const valid = (overrides: Record<string, unknown> = {}) => ({
  method: 'email',
  name: 'Ada',
  email: 'ada@example.com',
  age: '30',
  location: 'Toronto',
  background: 'engineer',
  why: 'to help',
  ...overrides,
});

const corpus: Array<{ label: string; payload: unknown }> = [
  // Valid submissions, one per method.
  { label: 'valid email-method', payload: valid() },
  {
    label: 'valid phone-method',
    payload: {
      method: 'phone',
      name: 'Ada',
      phone: '5',
      age: '30',
      location: 'Toronto',
      background: 'engineer',
      why: 'to help',
    },
  },
  {
    label: 'valid both-method',
    payload: valid({ method: 'both', phone: '5' }),
  },
  // Everything missing.
  { label: 'empty payload', payload: {} },
  // Each required field absent independently (the key omitted — the form-data
  // shape a never-touched field POSTs).
  {
    label: 'name missing',
    payload: valid({ name: undefined }),
  },
  { label: 'age missing', payload: valid({ age: undefined }) },
  { label: 'location missing', payload: valid({ location: undefined }) },
  { label: 'background missing', payload: valid({ background: undefined }) },
  { label: 'why missing', payload: valid({ why: undefined }) },
  {
    label: 'method missing',
    payload: valid({ method: undefined }),
  },
  // Off-list method.
  { label: 'method off-list', payload: valid({ method: 'bogus' }) },
  // Each required field empty.
  { label: 'name empty', payload: valid({ name: '' }) },
  { label: 'age empty', payload: valid({ age: '' }) },
  { label: 'location empty', payload: valid({ location: '' }) },
  { label: 'background empty', payload: valid({ background: '' }) },
  { label: 'why empty', payload: valid({ why: '' }) },
  // Bad email (well-formed-but-wrong is the format pin below; here the empty
  // case is shared — both engines emit `.required`, plus the engine's pattern
  // check, asserted in `emailFormatTightening`). Phone has no format check in
  // either engine, so its empty case stays in the blanket corpus.
  { label: 'phone empty (present)', payload: valid({ method: 'phone', phone: '' }) },
  // Cross-field: gated targets absent.
  {
    label: 'method=email, email absent',
    payload: valid({ method: 'email', email: undefined }),
  },
  {
    label: 'method=phone, phone absent',
    payload: valid({ method: 'phone', email: undefined }),
  },
  {
    label: 'method=both, email+phone absent',
    payload: valid({ method: 'both', email: undefined }),
  },
  // Each `both`-gated requirement violated INDEPENDENTLY.
  {
    label: 'method=both, only email absent (phone present)',
    payload: valid({ method: 'both', email: undefined, phone: '5' }),
  },
  {
    label: 'method=both, only phone absent (email present)',
    payload: valid({ method: 'both' }),
  },
  // Discriminator INVALID-TYPE: `method` as an array (distinct from off-list).
  { label: 'method array', payload: valid({ method: ['email', 'phone'] }) },
  // Invalid-type (duplicate-name array) per field.
  { label: 'name array', payload: valid({ name: ['a', 'b'] }) },
  { label: 'age array', payload: valid({ age: ['a', 'b'] }) },
  { label: 'location array', payload: valid({ location: ['a', 'b'] }) },
  { label: 'background array', payload: valid({ background: ['a', 'b'] }) },
  { label: 'why array', payload: valid({ why: ['a', 'b'] }) },
  {
    label: 'email array',
    payload: valid({ method: 'both', email: ['a', 'b'], phone: '5' }),
  },
  {
    label: 'phone array',
    payload: valid({ method: 'both', phone: ['a', 'b'] }),
  },
];

describe('volunteer equivalence harness (oracle vs engine)', () => {
  test.each(corpus)(
    '$label — identical decoded output (positions delta normalized)',
    ({ payload }) => {
      const o = decodedOf(parseSchema(oracle, payload));
      const e = decodedOf(decodeForm(defaultVolunteerForm, payload));
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
    for (const { payload } of corpus) {
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

  // The single pinned decoded delta: the oracle's valid decode carries a
  // vestigial `positions: []`; the engine omits it entirely. Pinned so the delta
  // can never widen beyond `positions` on any field.
  test('decodedDeltaIsPositionsOnly: the only decoded difference is positions', () => {
    const o = parseSchema(oracle, valid());
    const e = decodeForm(defaultVolunteerForm, valid());
    expect(Result.isSuccess(o)).toBe(true);
    expect(Result.isSuccess(e)).toBe(true);
    if (!Result.isSuccess(o) || !Result.isSuccess(e)) return;
    // The oracle has `positions`, the engine does not.
    expect('positions' in (o.success as Record<string, unknown>)).toBe(true);
    expect((o.success as Record<string, unknown>)['positions']).toEqual([]);
    expect('positions' in (e.success as Record<string, unknown>)).toBe(false);
    // Strip `positions` from the oracle → byte-identical to the engine's decode.
    const { positions: _positions, ...oracleWithoutPositions } =
      o.success as Record<string, unknown>;
    expect(e.success).toEqual(oracleWithoutPositions);
  });

  // The deliberate `email` format tightening (delta #1): the engine validates the
  // email shape the pre-migration oracle did not. Pinned so it can never widen to
  // another field/path — the engine is a strict superset on `email` only.
  test('emailFormatTightening: engine rejects a malformed email the oracle accepted', () => {
    const malformed = valid({ email: 'not-an-email' });
    // Oracle accepts it (only `isMinLength(1)`) — the pre-existing volunteer drift.
    expect(Result.isSuccess(parseSchema(oracle, malformed))).toBe(true);
    // Engine rejects it on the email field with the real `.error` key — exactly
    // contact's behaviour now applies to volunteer (one decoder).
    expect(Result.isSuccess(decodeForm(defaultVolunteerForm, malformed))).toBe(
      false,
    );
    expect(engineIssues(malformed)).toEqual([
      { name: 'email', key: 'volunteer.form.email.error' },
    ]);
    // The tightening fires ONLY on the email field; every other field is valid,
    // so no other key appears.
    for (const { name } of engineIssues(malformed)) {
      expect(name).toBe('email');
    }
  });

  // The shared empty-present-email case: the oracle emits only `.required`; the
  // engine emits `.required` (minLength) AND `.error` (the pattern check on the
  // empty string) — the same format-tightening, contained to `email`.
  test('emailFormatTightening: empty present email — engine adds the format key', () => {
    const emptyEmail = valid({ email: '' });
    expect(oracleIssues(emptyEmail)).toEqual([
      { name: 'email', key: 'volunteer.form.email.required' },
    ]);
    expect(engineIssues(emptyEmail)).toEqual([
      { name: 'email', key: 'volunteer.form.email.error' },
      { name: 'email', key: 'volunteer.form.email.required' },
    ]);
  });
});
