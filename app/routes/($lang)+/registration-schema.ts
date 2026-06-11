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

const Attendee = Schema.Struct({
  type: Schema.Literal('attendee'),
  name: RequiredString('registration.form.name.required'),
  email: Email(
    'registration.form.email.error',
    'registration.form.email.required',
  ),
  phone: RequiredString('registration.form.phone.required'),
  dateOfBirth: RequiredString('registration.form.date-of-birth.required'),
  parent: Schema.optional(Parent),
  gender: RequiredLiterals(
    ['male', 'female'],
    'registration.form.gender.required',
  ),
  meals: StringToBoolean('registration.form.meals.required').annotateKey({
    messageMissingKey: 'registration.form.meals.required',
  }),
  dietaryRestrictions: OptionalString(
    'registration.form.dietary-restrictions.required',
  ),
  outreach: Schema.mutable(
    Schema.Array(
      RequiredLiterals(
        ['laws-of-health', 'homeless-carepacks', 'back-to-school', 'not-sure'],
        'registration.form.outreach.required',
      ),
    ),
  ).annotateKey({ messageMissingKey: 'registration.form.outreach.required' }),
  extra: Extra,
  volunteer: Volunteer,
});

const Exhibitor = Schema.Struct({
  type: Schema.Literal('exhibitor'),
  name: RequiredString('registration.form.name.required'),
  email: Email(
    'registration.form.email.error',
    'registration.form.email.required',
  ),
  phone: RequiredString('registration.form.phone.required'),
  synopsis: RequiredString('registration.form.synopsis.required'),
  website: Url('registration.form.website.required'),
  company: RequiredString('registration.form.company.required'),
});

export const RegistrationSchema = Schema.Struct({
  // A `Union` whose members all fail reports one top-level union-mismatch
  // (Effect v4 behavior), so an empty registrant or an off-list `type`
  // discriminator can only attach to the `registrants[n]` node, never to the
  // inner `type` field. The node-level `message` re-labels that mismatch with a
  // real key; once a member's discriminator matches, the inner field
  // annotations attribute cleanly to their own paths. The array's
  // `messageMissingKey` covers an absent `registrants` field.
  registrants: Schema.mutable(
    Schema.Array(
      Schema.Union([Attendee, Exhibitor]).annotate({
        message: 'registration.form.type.required',
      }),
    ),
  ).annotateKey({ messageMissingKey: 'registration.form.type.required' }),
});

/** Standard Schema view consumed by `useForm` for client-side validation. */
export const RegistrationStandardSchema =
  Schema.toStandardSchemaV1(RegistrationSchema);

export type RegistrationForm = typeof RegistrationSchema.Type;

type DeepPartial<T> = T extends object
  ? { [P in keyof T]?: DeepPartial<T[P]> }
  : T;

export type Registrant = DeepPartial<RegistrationForm['registrants'][number]>;

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
