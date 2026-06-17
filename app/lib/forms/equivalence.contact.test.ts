import { describe, expect, test } from 'bun:test';
import { Result, Schema } from 'effect';

import { defaultContactForm } from '~/lib/content/pages/defaults';
import { parseSchema } from '~/lib/effect/form-schema';
import { isTranslationKey } from '~/lib/effect/form-schema.test-helper';
import { root } from '~/lib/localization/translations';

import { decodeForm, definitionToSchema } from './decode';

/**
 * Branch 6.3 — the contact equivalence harness (ADR 0007, settled #6).
 *
 * Contact is the FIRST form to migrate onto the structural engine, so it carries
 * the de-risking harness the riskiest migration (registration, 6.5) reuses: the
 * hand-tuned contact schema is kept here as an ORACLE while the engine's
 * data-driven `defaultContactForm` definition runs the same corpus, and the two
 * are asserted equivalent over a FULL failure matrix (valid + every invalid
 * variant) — `(a)` identical decoded output, `(b)` identical emitted
 * `TranslationKey` sets per field path.
 *
 * The oracle is the verbatim transcription of the pre-migration `contact.tsx`
 * schema (the `method` discriminator as a `Literals` field + the per-method
 * struct-level requirement filter). It lives ONLY in this harness now — the route
 * carries no hand-written schema (`subtract-before-you-add`); the oracle is the
 * behavioural spec the engine is proven against, and is deleted once every form
 * migration is green (6.6).
 *
 * ONE intentional key-level delta is pinned, not hidden: the oracle's `name`
 * INVALID-TYPE case (a duplicate-name array) emits `contact.form.name.error`,
 * while the engine's `requiredText` emits its single `requiredMessage`
 * (`contact.form.name.required`) for the empty / absent / invalid-type cases
 * alike (the closed `FieldKind` set carries one required key per text field, by
 * design — `make-impossible-states-unrepresentable`). Both keys resolve to the
 * SAME rendered string in both locales ("Please enter your name" / "Veuillez
 * entrer votre nom"), so the user sees no difference; the harness asserts
 * rendered-string parity across the whole matrix and pins this one key alias
 * explicitly so it can never widen silently.
 */

// ---------------------------------------------------------------------------
// The oracle — verbatim from the pre-migration contact.tsx schema
// ---------------------------------------------------------------------------

const EMAIL_REGEXP = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const Name = Schema.String.annotate({ message: 'contact.form.name.error' })
  .check(Schema.isMinLength(1, { message: 'contact.form.name.required' }))
  .annotateKey({ messageMissingKey: 'contact.form.name.required' });
const Message = Schema.String.annotate({
  message: 'contact.form.message.required',
})
  .check(Schema.isMinLength(1, { message: 'contact.form.message.required' }))
  .annotateKey({ messageMissingKey: 'contact.form.message.required' });
const Email = Schema.String.check(
  Schema.isMinLength(1, { message: 'contact.form.email.required' }),
  Schema.isPattern(EMAIL_REGEXP, { message: 'contact.form.email.error' }),
);
const Phone = Schema.String.check(
  Schema.isMinLength(1, { message: 'contact.form.phone.required' }),
);
const Method = Schema.Literals(['email', 'phone', 'both'])
  .annotate({ message: 'contact.form.contact-method.required' })
  .annotateKey({ messageMissingKey: 'contact.form.contact-method.required' });

const oracle = Schema.Struct({
  method: Method,
  name: Name,
  message: Message,
  email: Schema.optional(Email).annotate({
    message: 'contact.form.email.error',
  }),
  phone: Schema.optional(Phone).annotate({
    message: 'contact.form.phone.required',
  }),
}).check(
  Schema.makeFilter((value) => {
    const issues: Array<{ path: ReadonlyArray<PropertyKey>; issue: string }> =
      [];
    if (
      (value.method === 'email' || value.method === 'both') &&
      value.email === undefined
    ) {
      issues.push({ path: ['email'], issue: 'contact.form.email.required' });
    }
    if (
      (value.method === 'phone' || value.method === 'both') &&
      value.phone === undefined
    ) {
      issues.push({ path: ['phone'], issue: 'contact.form.phone.required' });
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
// abort-first error differ between the oracle (`method` first) and the engine
// (`name` first) on an all-fields-missing payload — a difference the user never
// sees, since the client blocks submission showing the identical full set. The
// server path is still asserted for decoded success output below.
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

const engineCodec = definitionToSchema(defaultContactForm);

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

/** The decoded SUCCESS value, or a `Failure` marker, for cross-engine compare. */
const decodedOf = (
  result: Result.Result<unknown, unknown>,
): { ok: true; value: unknown } | { ok: false } =>
  Result.isSuccess(result)
    ? { ok: true, value: result.success }
    : { ok: false };

// ---------------------------------------------------------------------------
// The corpus — valid + every invalid variant
// ---------------------------------------------------------------------------

const valid = (overrides: Record<string, unknown> = {}) => ({
  method: 'email',
  name: 'Ada',
  email: 'ada@example.com',
  message: 'hello',
  ...overrides,
});

const corpus: Array<{ label: string; payload: unknown }> = [
  // Valid submissions, one per method.
  { label: 'valid email-method', payload: valid() },
  {
    label: 'valid phone-method',
    payload: { method: 'phone', name: 'Ada', phone: '5', message: 'hi' },
  },
  {
    label: 'valid both-method',
    payload: valid({ method: 'both', phone: '5' }),
  },
  // Everything missing.
  { label: 'empty payload', payload: {} },
  // Each required field absent independently (the key omitted — the form-data
  // shape a never-touched field POSTs; a present `undefined` is the invalid-type
  // alias case, exercised separately by `nameArrayCase`).
  {
    label: 'name missing',
    payload: { method: 'email', email: 'ada@example.com', message: 'hello' },
  },
  {
    label: 'message missing',
    payload: { method: 'email', name: 'Ada', email: 'ada@example.com' },
  },
  {
    label: 'method missing',
    payload: { name: 'Ada', email: 'ada@example.com', message: 'hello' },
  },
  // Off-list method.
  { label: 'method off-list', payload: valid({ method: 'bogus' }) },
  // Each required field empty.
  { label: 'name empty', payload: valid({ name: '' }) },
  { label: 'message empty', payload: valid({ message: '' }) },
  // Bad email.
  { label: 'email malformed', payload: valid({ email: 'not-an-email' }) },
  { label: 'email empty (present)', payload: valid({ email: '' }) },
  // Cross-field: gated targets absent.
  {
    label: 'method=email, email absent',
    payload: { method: 'email', name: 'Ada', message: 'hi' },
  },
  {
    label: 'method=phone, phone absent',
    payload: { method: 'phone', name: 'Ada', message: 'hi' },
  },
  {
    label: 'method=both, email+phone absent',
    payload: { method: 'both', name: 'Ada', message: 'hi' },
  },
  // Each `both`-gated requirement violated INDEPENDENTLY: only the absent side's
  // `requiredWhenEquals` rule fires (the other gated field is present), pinning the
  // two cross-field rules in isolation under the `both` discriminator.
  {
    label: 'method=both, only email absent (phone present)',
    payload: { method: 'both', name: 'Ada', phone: '5', message: 'hi' },
  },
  {
    label: 'method=both, only phone absent (email present)',
    payload: {
      method: 'both',
      name: 'Ada',
      email: 'ada@example.com',
      message: 'hi',
    },
  },
  // Discriminator INVALID-TYPE: `method` as an array (distinct from `method
  // off-list`, a valid-string-wrong-value path) — the `literal` field's invalid
  // -type boundary, mirroring the per-field invalid-type arrays below.
  { label: 'method array', payload: valid({ method: ['email', 'phone'] }) },
  // Invalid-type (duplicate-name array) per field.
  { label: 'email array', payload: valid({ method: 'both', email: ['a', 'b'], phone: '5' }) },
  { label: 'message array', payload: valid({ message: ['a', 'b'] }) },
  { label: 'phone array', payload: valid({ method: 'both', phone: ['a', 'b'] }) },
];

// The one field+case where the oracle and engine emit DIFFERENT keys that render
// IDENTICALLY (documented above): `name` invalid-type → oracle `.error`, engine
// `.required`.
const nameArrayCase = {
  label: 'name array',
  payload: valid({ name: ['a', 'b'] }),
};

describe('contact equivalence harness (oracle vs engine)', () => {
  test.each(corpus)(
    '$label — identical decoded output',
    ({ payload }) => {
      const o = decodedOf(parseSchema(oracle, payload));
      const e = decodedOf(decodeForm(defaultContactForm, payload));
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
    for (const { payload } of [...corpus, nameArrayCase]) {
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

  // The single intentional delta: `name` invalid-type emits a DIFFERENT key that
  // renders IDENTICALLY. Pinned so it cannot widen to any other field/case.
  test('the one documented key alias: name invalid-type renders identically', () => {
    const o = oracleIssues(nameArrayCase.payload);
    const e = engineIssues(nameArrayCase.payload);
    // The oracle emits `name.error`, the engine `name.required` — on `name` only.
    expect(o).toEqual([{ name: 'name', key: 'contact.form.name.error' }]);
    expect(e).toEqual([{ name: 'name', key: 'contact.form.name.required' }]);
    // … yet render identically in both locales (the user sees no difference).
    expect(renderIssues(e, 'en')).toEqual(renderIssues(o, 'en'));
    expect(renderIssues(e, 'fr')).toEqual(renderIssues(o, 'fr'));
  });
});
