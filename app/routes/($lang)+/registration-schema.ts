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
 */
const StringToBoolean = Schema.Literals(['true', 'false', 'on']).pipe(
  Schema.decodeTo(Schema.Boolean, {
    decode: SchemaGetter.transform((value) => value !== 'false'),
    encode: SchemaGetter.transform((value) => (value ? 'true' : 'false')),
  }),
);

/** Optional volunteer flag: absent (unchecked) is valid; present decodes. */
const OptionalFlag = Schema.optionalKey(StringToBoolean);

const Email = (message: TranslationKey) =>
  Schema.String.check(
    // Match the former zod `.email()`: a basic, permissive email shape.
    Schema.isPattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, { message }),
  );

const Url = (message: TranslationKey) =>
  Schema.String.check(
    // Match the former zod `.url()`: require a parseable absolute URL.
    Schema.makeFilter(
      (value: string) => URL.canParse(value),
      { message },
    ),
  );

const Parent = Schema.Struct({
  name: Schema.String,
  email: Schema.String,
  phone: Schema.String,
});

const Extra = Schema.Struct({
  howDidYouHear: Schema.String,
  whyAreYouAttending: Schema.String,
  whatAreYouExcitedAbout: Schema.String,
  firstTimeAttending: StringToBoolean,
  church: Schema.optional(Schema.String),
  // Conform's `getFieldList`/`FieldName` require mutable array types; Effect
  // Schema arrays are `readonly` by default, so opt into a mutable `Type`.
  merch: Schema.mutable(
    Schema.Array(Schema.Literals(['t-shirt', 'hoodie', 'shirt', 'none'])),
  ),
  other: Schema.String,
  tos: StringToBoolean,
});

const Volunteer = Schema.Struct({
  songLeader: OptionalFlag,
  musician: OptionalFlag,
  instrument: Schema.optional(Schema.String),
  specialMusic: OptionalFlag,
  hospitality: OptionalFlag,
  registrationStation: OptionalFlag,
  usher: OptionalFlag,
  outreachLeader: OptionalFlag,
  smallGroupLeader: OptionalFlag,
  seminarRoomHost: OptionalFlag,
  cameraOperator: OptionalFlag,
  photographer: OptionalFlag,
  roamingMic: OptionalFlag,
});

const Attendee = Schema.Struct({
  type: Schema.Literal('attendee'),
  name: Schema.String,
  email: Email('registration.form.email.error'),
  phone: Schema.String,
  dateOfBirth: Schema.String,
  parent: Schema.optional(Parent),
  gender: Schema.Literals(['male', 'female']),
  meals: StringToBoolean,
  dietaryRestrictions: Schema.optional(Schema.String),
  outreach: Schema.mutable(
    Schema.Array(
      Schema.Literals([
        'laws-of-health',
        'homeless-carepacks',
        'back-to-school',
        'not-sure',
      ]),
    ),
  ),
  extra: Extra,
  volunteer: Volunteer,
});

const Exhibitor = Schema.Struct({
  type: Schema.Literal('exhibitor'),
  name: Schema.String,
  email: Email('registration.form.email.error'),
  phone: Schema.String,
  synopsis: Schema.String,
  website: Url('registration.form.website.required'),
  company: Schema.String,
});

export const RegistrationSchema = Schema.Struct({
  registrants: Schema.mutable(Schema.Array(Schema.Union([Attendee, Exhibitor]))),
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
