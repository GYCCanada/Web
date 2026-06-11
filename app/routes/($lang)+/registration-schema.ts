import { Schema, SchemaGetter } from 'effect';

import type { TranslationKey } from '~/lib/localization/translations';

/**
 * Registration form schema — the Effect Schema port of the former zod
 * `RegistrationSchema` (one per `{2024,2025,2026}/form` route, now shared).
 *
 * It is a **form-data codec**: every leaf decodes from the string (or absent)
 * value the browser actually submits. The registration `action` is a no-op
 * (product decision pending, see the plan's non-goals), so this schema only
 * powers client-side validation via {@link RegistrationStandardSchema}; it is
 * never run server-side. Messages are translation keys so `FieldErrors`
 * (`translate(error as TranslationKey)`) renders them — consistent with the
 * contact/volunteer/newsletter sibling forms.
 *
 * Every decode failure must emit a real `TranslationKey`: `FieldErrors` renders
 * each message through `translate()`, so a default English Schema message (or a
 * key absent from `translations.ts`) renders blank. The annotation idiom, per
 * the contact/volunteer siblings:
 * - `.check(Schema.isMinLength(1, { message }))` covers the empty-string case;
 * - a node-level `.annotate({ message })` covers the invalid-type case (a
 *   duplicate field name POSTs an array, surfacing an `InvalidType` issue);
 * - `.annotateKey({ messageMissingKey })` covers the absent-field case.
 * Where a field has no dedicated `.error` key, the invalid-type case reuses its
 * `.required` key — safe copy on screen rather than a blank render.
 *
 * Boolean modeling (no `Schema.BooleanFromString` in effect beta.60):
 * - radio/checkbox booleans render `value="true"` / `value="false"`
 *   (`meals`, `extra.firstTimeAttending`, `extra.tos`);
 * - the volunteer single-checkboxes render no explicit `value`, so the browser
 *   submits the default checkbox value `"on"` when checked and omits the field
 *   when unchecked.
 * {@link StringToBoolean} decodes all three submitted tokens (`"true"`/`"on"`
 *   → `true`, `"false"` → `false`); volunteer flags wrap it in `optionalKey`
 *   so an unchecked (absent) box is valid.
 */

/**
 * Form-value → boolean codec. Encodes back to the canonical `"true"`/`"false"`
 * tokens. Accepts `"on"` on decode (the default value an attribute-less
 * checkbox submits) so the volunteer single-checkboxes round-trip.
 *
 * The `message` re-labels every failure path with a real `TranslationKey`: it
 * annotates the underlying `Literals` (an off-list token, e.g. an array from a
 * duplicate field) and the decoded node, so neither emits a default English
 * Schema message. Pair with `.annotateKey({ messageMissingKey: message })` at
 * the struct field to cover the absent-required case.
 */
const StringToBoolean = (message: TranslationKey) =>
  Schema.Literals(['true', 'false', 'on'])
    .annotate({ message })
    .pipe(
      Schema.decodeTo(Schema.Boolean, {
        decode: SchemaGetter.transform((value) => value !== 'false'),
        encode: SchemaGetter.transform((value) => (value ? 'true' : 'false')),
      }),
    )
    .annotate({ message });

/**
 * Optional volunteer flag: absent (unchecked) is valid; a present value decodes.
 * The only failure path is an invalid present value (e.g. an array), so the
 * `message` labels the inner codec; no `messageMissingKey` (absent is valid).
 */
const OptionalFlag = (message: TranslationKey) =>
  Schema.optionalKey(StringToBoolean(message));

/** Required free-text string: empty, absent, and non-string all map to `message`. */
const RequiredString = (message: TranslationKey) =>
  Schema.String.annotate({ message })
    .check(Schema.isMinLength(1, { message }))
    .annotateKey({ messageMissingKey: message });

/**
 * Present-but-empty-allowed free-text string (e.g. the "other notes" field):
 * the old zod schema accepted an empty submission, so no `isMinLength` check —
 * only the invalid-type (node) and absent (key) cases carry a translation key.
 */
const OptionalText = (message: TranslationKey) =>
  Schema.String.annotate({ message }).annotateKey({
    messageMissingKey: message,
  });

/** Optional string: absent is valid; a present non-string maps to `message`. */
const OptionalString = (message: TranslationKey) =>
  Schema.optional(Schema.String.annotate({ message }));

/** Required literal union: an off-list value or non-string maps to `message`. */
const RequiredLiterals = <const L extends ReadonlyArray<string>>(
  literals: L,
  message: TranslationKey,
) =>
  Schema.Literals(literals)
    .annotate({ message })
    .annotateKey({ messageMissingKey: message });

const Email = (message: TranslationKey, missing: TranslationKey) =>
  Schema.String.annotate({ message })
    .check(
      Schema.isMinLength(1, { message: missing }),
      // Match the former zod `.email()`: a basic, permissive email shape.
      Schema.isPattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, { message }),
    )
    .annotateKey({ messageMissingKey: missing });

const Url = (message: TranslationKey) =>
  Schema.String.annotate({ message })
    .check(
      Schema.isMinLength(1, { message }),
      // Match the former zod `.url()`: require a parseable absolute URL.
      Schema.makeFilter((value: string) => URL.canParse(value), { message }),
    )
    .annotateKey({ messageMissingKey: message });

const Parent = Schema.Struct({
  name: RequiredString('registration.form.parent.required'),
  email: RequiredString('registration.form.parent-email.required'),
  phone: RequiredString('registration.form.parent-phone.required'),
});

const Extra = Schema.Struct({
  howDidYouHear: RequiredString('registration.form.how-did-you-hear.required'),
  whyAreYouAttending: RequiredString(
    'registration.form.why-are-you-attending.required',
  ),
  whatAreYouExcitedAbout: RequiredString(
    'registration.form.what-are-you-excited-about.required',
  ),
  firstTimeAttending: StringToBoolean(
    'registration.form.first-time-attending.required',
  ).annotateKey({
    messageMissingKey: 'registration.form.first-time-attending.required',
  }),
  church: OptionalString('registration.form.church.required'),
  // Conform's `getFieldList`/`FieldName` require mutable array types; Effect
  // Schema arrays are `readonly` by default, so opt into a mutable `Type`.
  merch: Schema.mutable(
    Schema.Array(
      RequiredLiterals(
        ['t-shirt', 'hoodie', 'shirt', 'none'],
        'registration.form.merch.required',
      ),
    ),
  ).annotateKey({ messageMissingKey: 'registration.form.merch.required' }),
  other: OptionalText('registration.form.other.required'),
  tos: StringToBoolean('registration.form.tos.required').annotateKey({
    messageMissingKey: 'registration.form.tos.required',
  }),
});

const Volunteer = Schema.Struct({
  songLeader: OptionalFlag('registration.form.volunteer.required'),
  musician: OptionalFlag('registration.form.volunteer.required'),
  instrument: OptionalString('registration.form.instrument.required'),
  specialMusic: OptionalFlag('registration.form.volunteer.required'),
  hospitality: OptionalFlag('registration.form.volunteer.required'),
  registrationStation: OptionalFlag('registration.form.volunteer.required'),
  usher: OptionalFlag('registration.form.volunteer.required'),
  outreachLeader: OptionalFlag('registration.form.volunteer.required'),
  smallGroupLeader: OptionalFlag('registration.form.volunteer.required'),
  seminarRoomHost: OptionalFlag('registration.form.volunteer.required'),
  cameraOperator: OptionalFlag('registration.form.volunteer.required'),
  photographer: OptionalFlag('registration.form.volunteer.required'),
  roamingMic: OptionalFlag('registration.form.volunteer.required'),
});

// The registrant discriminator. Modeled as a single `Literals` field rather
// than the per-member `Schema.Literal`s inside a `Schema.Union` it replaced: a
// union whose members all fail reports one top-level union-mismatch message
// (Effect v4 behavior) attached to the `registrants[n]` node, so a missing or
// off-list `type` could only surface a key at the array element, never at the
// `type` field the UI's RadioGroup renders — the error was a real key that
// never displayed. As a struct field with `message` (off-list value) +
// `messageMissingKey` (absent) annotations, a missing/invalid `type`
// attributes cleanly to `registrants[n].type`. This mirrors the
// contact.tsx/volunteer.tsx precedent (fab3d97) that solved the identical
// problem on those forms' `method` discriminator.
const Type = RequiredLiterals(
  ['attendee', 'exhibitor'],
  'registration.form.type.required',
);

const Outreach = Schema.mutable(
  Schema.Array(
    RequiredLiterals(
      ['laws-of-health', 'homeless-carepacks', 'back-to-school', 'not-sure'],
      'registration.form.outreach.required',
    ),
  ),
).annotateKey({ messageMissingKey: 'registration.form.outreach.required' });

const Meals = StringToBoolean('registration.form.meals.required').annotateKey({
  messageMissingKey: 'registration.form.meals.required',
});

/**
 * Single per-registrant struct, replacing the former `Schema.Union([Attendee,
 * Exhibitor])`. The shared fields (`type`, `name`, `email`, `phone`) are always
 * required; the variant-specific fields are `optional` so the off-variant never
 * demands them at the struct level. Per-type requirements are enforced by the
 * struct-level {@link Schema.makeFilter} below, which attaches each issue to its
 * own field path (e.g. attendee-only `gender`, or the nested `extra.tos`) with
 * the same translation key the field carried as a union member. A present
 * variant field still validates its own format/literal/url checks; the filter
 * only adds the per-type presence requirement.
 */
const Registrant = Schema.Struct({
  type: Type,
  name: RequiredString('registration.form.name.required'),
  email: Email(
    'registration.form.email.error',
    'registration.form.email.required',
  ),
  phone: RequiredString('registration.form.phone.required'),
  // Attendee-only fields. Optional at the struct level so exhibitors don't
  // demand them; the filter requires them (at their own paths) when
  // `type === 'attendee'`. A present value still runs its own checks.
  dateOfBirth: Schema.optional(
    RequiredString('registration.form.date-of-birth.required'),
  ),
  parent: Schema.optional(Parent),
  gender: Schema.optional(
    RequiredLiterals(['male', 'female'], 'registration.form.gender.required'),
  ),
  meals: Schema.optional(Meals),
  dietaryRestrictions: OptionalString(
    'registration.form.dietary-restrictions.required',
  ),
  outreach: Schema.optional(Outreach),
  extra: Schema.optional(Extra),
  volunteer: Schema.optional(Volunteer),
  // Exhibitor-only fields. Optional at the struct level so attendees don't
  // demand them; the filter requires them (at their own paths) when
  // `type === 'exhibitor'`.
  synopsis: Schema.optional(RequiredString('registration.form.synopsis.required')),
  website: Schema.optional(Url('registration.form.website.required')),
  company: Schema.optional(RequiredString('registration.form.company.required')),
}).check(
  Schema.makeFilter((value) => {
    const issues: Array<{ path: ReadonlyArray<PropertyKey>; issue: string }> =
      [];
    if (value.type === 'attendee') {
      if (value.dateOfBirth === undefined) {
        issues.push({
          path: ['dateOfBirth'],
          issue: 'registration.form.date-of-birth.required',
        });
      }
      if (value.gender === undefined) {
        issues.push({
          path: ['gender'],
          issue: 'registration.form.gender.required',
        });
      }
      if (value.meals === undefined) {
        issues.push({
          path: ['meals'],
          issue: 'registration.form.meals.required',
        });
      }
      if (value.outreach === undefined) {
        issues.push({
          path: ['outreach'],
          issue: 'registration.form.outreach.required',
        });
      }
      // The nested attendee groups are always rendered (with defaults) when a
      // registrant is an attendee, so a wholly-absent group is an out-of-form
      // path. When present, the inner required-field annotations fire at their
      // own nested paths; when absent, surface a real key at the group path
      // rather than the raw `Missing key` the bare optional/required struct
      // would emit.
      if (value.extra === undefined) {
        issues.push({
          path: ['extra', 'tos'],
          issue: 'registration.form.tos.required',
        });
      }
    } else if (value.type === 'exhibitor') {
      if (value.synopsis === undefined) {
        issues.push({
          path: ['synopsis'],
          issue: 'registration.form.synopsis.required',
        });
      }
      if (value.website === undefined) {
        issues.push({
          path: ['website'],
          issue: 'registration.form.website.required',
        });
      }
      if (value.company === undefined) {
        issues.push({
          path: ['company'],
          issue: 'registration.form.company.required',
        });
      }
    }
    return issues.length === 0 ? undefined : issues;
  }),
);

export const RegistrationSchema = Schema.Struct({
  // The array's `messageMissingKey` covers an absent `registrants` field; each
  // element is the discriminated {@link Registrant} struct, whose `type`
  // discriminator now attributes a missing/invalid value to `registrants[n].type`.
  registrants: Schema.mutable(Schema.Array(Registrant)).annotateKey({
    messageMissingKey: 'registration.form.type.required',
  }),
});

/** Standard Schema view consumed by `useForm` for client-side validation. */
export const RegistrationStandardSchema =
  Schema.toStandardSchemaV1(RegistrationSchema);

export type RegistrationForm = typeof RegistrationSchema.Type;

type DeepPartial<T> = T extends object
  ? { [P in keyof T]?: DeepPartial<T[P]> }
  : T;

/**
 * The form's initial/appended registrant value. Derived from the schema's
 * **encoded** (form-input) shape rather than the decoded `.Type`: the default
 * holds the raw string/absent values the browser submits (e.g. `meals: ''`,
 * `extra.firstTimeAttending: undefined`), not decoded booleans, and is what
 * conform's `defaultValue` consumes. Basing it on the decoded `.Type` would
 * type the boolean fields as `boolean`, which `useForm`'s input-shaped
 * `defaultValue` rejects.
 */
export type Registrant = DeepPartial<
  (typeof RegistrationSchema.Encoded)['registrants'][number]
>;

/** Empty attendee used as the form's initial / appended registrant value. */
export const makeDefaultRegistrant = (): Registrant => ({
  name: '',
  email: '',
  phone: '',
  dateOfBirth: '',
  parent: undefined,
  gender: undefined,
  dietaryRestrictions: undefined,
  meals: undefined,
  extra: {
    firstTimeAttending: undefined,
    howDidYouHear: '',
    whyAreYouAttending: '',
    whatAreYouExcitedAbout: '',
    church: undefined,
    merch: [],
    other: '',
    tos: undefined,
  },
  outreach: [],
  volunteer: {
    songLeader: undefined,
    musician: undefined,
    instrument: undefined,
    specialMusic: undefined,
    hospitality: undefined,
    registrationStation: undefined,
    usher: undefined,
    outreachLeader: undefined,
    smallGroupLeader: undefined,
    seminarRoomHost: undefined,
    cameraOperator: undefined,
    photographer: undefined,
    roamingMic: undefined,
  },
});
