import type { SubmissionResult } from '@conform-to/react/future';
import * as React from 'react';
import { Schema } from 'effect';
import { Form } from 'react-router';
import dayjs from 'dayjs';

import { FormProvider, useForm, useFormData } from '~/lib/conform';
import { definitionToSchema } from '~/lib/forms/decode';
import { FormDefinition } from '~/lib/forms/definition';
import { useTranslate } from '~/lib/localization/context';
import { Button } from '~/ui/button';
import { Checkbox, Checkboxes, CheckboxGroup } from '~/ui/checkbox';
import { FieldErrors } from '~/ui/field-error';
import { Label } from '~/ui/label';
import { Main } from '~/ui/main';
import { Radio, RadioGroup, Radios } from '~/ui/radio';
import { TextField } from '~/ui/text-field';

/**
 * The registrant's FORM-INPUT (encoded) field-name contract — the static shape
 * conform's `getFieldset()` accessors are keyed off. This is the FORM's own
 * concern (the field names it renders `name=` for), NOT the validation: every
 * leaf is the raw `string`/absent value the browser submits (booleans are
 * `'true'`/`'false'`/`'on'` strings here, not decoded booleans), and there are no
 * checks or message keys — the runtime validation is supplied entirely by the
 * engine codec below (`definitionToSchema`). Mirrors the definition graph the
 * render-parity half of `registration-form.test.tsx` pins (it asserts the live
 * form's emitted submit-names equal `defaultRegistrationForm`'s field names), so a
 * field added/renamed in the definition without a matching accessor here is caught.
 *
 * `make-impossible-states-unrepresentable`: the accessor shape is a real Schema,
 * not a hand-written interface, so its field set is the typed contract the form's
 * `getFieldset()` reads route through.
 */
const RegistrantInput = Schema.Struct({
  type: Schema.optional(Schema.Literals(['attendee', 'exhibitor'])),
  name: Schema.optional(Schema.String),
  email: Schema.optional(Schema.String),
  phone: Schema.optional(Schema.String),
  dateOfBirth: Schema.optional(Schema.String),
  gender: Schema.optional(Schema.Literals(['male', 'female'])),
  meals: Schema.optional(Schema.String),
  dietaryRestrictions: Schema.optional(Schema.String),
  outreach: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  parent: Schema.optional(
    Schema.Struct({
      name: Schema.optional(Schema.String),
      email: Schema.optional(Schema.String),
      phone: Schema.optional(Schema.String),
    }),
  ),
  extra: Schema.optional(
    Schema.Struct({
      howDidYouHear: Schema.optional(Schema.String),
      whyAreYouAttending: Schema.optional(Schema.String),
      whatAreYouExcitedAbout: Schema.optional(Schema.String),
      firstTimeAttending: Schema.optional(Schema.String),
      church: Schema.optional(Schema.String),
      merch: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
      other: Schema.optional(Schema.String),
      tos: Schema.optional(Schema.String),
    }),
  ),
  volunteer: Schema.optional(
    Schema.Struct({
      songLeader: Schema.optional(Schema.String),
      musician: Schema.optional(Schema.String),
      instrument: Schema.optional(Schema.String),
      specialMusic: Schema.optional(Schema.String),
      hospitality: Schema.optional(Schema.String),
      registrationStation: Schema.optional(Schema.String),
      usher: Schema.optional(Schema.String),
      outreachLeader: Schema.optional(Schema.String),
      smallGroupLeader: Schema.optional(Schema.String),
      seminarRoomHost: Schema.optional(Schema.String),
      cameraOperator: Schema.optional(Schema.String),
      photographer: Schema.optional(Schema.String),
      roamingMic: Schema.optional(Schema.String),
    }),
  ),
  synopsis: Schema.optional(Schema.String),
  website: Schema.optional(Schema.String),
  company: Schema.optional(Schema.String),
});

/**
 * Registration's client validation schema, DERIVED from the structural Form
 * engine's stored `registration` `FormDefinition` (`derive-dont-sync`,
 * registration-launch Branch 6). The engine definition validates ONE registrant
 * (the attendee/exhibitor discriminator + nested groups + boolean codecs — the
 * riskiest graph, proven byte-equivalent to the former hand-tuned schema by the
 * registration equivalence harness before that oracle was retired in 6.6); this
 * form keeps the repeating-`registrants` SHELL (a repeating-array-of-variant-items
 * is not in the closed `FieldKind` set), so it wraps the per-registrant codec in
 * `{ registrants: Array(...) }`.
 *
 * The definition is read from `Content.getForm('registration')` in each
 * `{2024,2025,2026}/form` loader and passed in as the `definition` prop (BLOCKER 2:
 * registration is now CMS-backed like contact/volunteer — editing the stored
 * `forms/registration.json` changes what the form accepts and how it renders, with
 * no code change; ADR 0007/0008 consequence). The loader JSON crossed a boundary,
 * so the component re-decodes it through `FormDefinition` (`boundary-discipline`)
 * before building the client codec.
 *
 * The engine codec's OUTPUT is a generic `Record<string, unknown>` (the data-driven
 * decoder is field-name-agnostic), so conform's field metadata is re-typed at the
 * seam to {@link RegistrantInput} — the form's own field-name contract. This is a
 * TYPE-only annotation over an unchanged engine RUNTIME (the "cast at the seam"
 * idiom this codebase already uses), NOT a re-declaration of the validation: every
 * issue the form shows is computed by the engine codec.
 */
const RegistrationFormShape = Schema.Struct({
  registrants: Schema.mutable(Schema.Array(RegistrantInput)),
});

const makeRegistrationStandardSchema = (definition: FormDefinition) => {
  const registrationSchema = Schema.Struct({
    registrants: Schema.mutable(
      Schema.Array(definitionToSchema(definition)),
    ).annotateKey({ messageMissingKey: 'registration.form.type.required' }),
  });
  return Schema.toStandardSchemaV1(registrationSchema) as unknown as ReturnType<
    typeof Schema.toStandardSchemaV1<typeof RegistrationFormShape>
  >;
};

/**
 * The form's initial / appended registrant value — the raw string/absent
 * (form-input) values the browser submits, NOT decoded booleans, so conform's
 * `defaultValue` consumes it directly. Keyed exactly by the engine definition's
 * registrant field names (asserted in the equivalence harness's render-parity
 * half), so an "Add Registrant" appends a blank attendee.
 */
export const makeDefaultRegistrant = () => ({
  name: '',
  email: '',
  phone: '',
  dateOfBirth: '',
  parent: undefined as
    | { name?: string; email?: string; phone?: string }
    | undefined,
  gender: undefined as string | undefined,
  dietaryRestrictions: undefined as string | undefined,
  meals: undefined as string | undefined,
  extra: {
    firstTimeAttending: undefined as string | undefined,
    howDidYouHear: '',
    whyAreYouAttending: '',
    whatAreYouExcitedAbout: '',
    church: undefined as string | undefined,
    merch: [] as string[],
    other: '',
    tos: undefined as string | undefined,
  },
  outreach: [] as string[],
  volunteer: {
    songLeader: undefined as string | undefined,
    musician: undefined as string | undefined,
    instrument: undefined as string | undefined,
    specialMusic: undefined as string | undefined,
    hospitality: undefined as string | undefined,
    registrationStation: undefined as string | undefined,
    usher: undefined as string | undefined,
    outreachLeader: undefined as string | undefined,
    smallGroupLeader: undefined as string | undefined,
    seminarRoomHost: undefined as string | undefined,
    cameraOperator: undefined as string | undefined,
    photographer: undefined as string | undefined,
    roamingMic: undefined as string | undefined,
  },
});

/**
 * Shared registration form, parameterized by conference `year`. The three
 * `{2024,2025,2026}/form` route modules render `<RegistrationForm year={…} />`;
 * previously they were byte-identical 688-line files differing only by the
 * heading year. This is a plain module (not referenced in `routes.ts`), so it
 * is not itself a route.
 *
 * `actionData` is passed in by the route wrapper. The registration action is a
 * deliberate no-op, so `useActionData` is `undefined` today and `lastResult` is
 * effectively unused — it is kept wired (typed as conform's `SubmissionResult`)
 * so a future real action's result flows straight through.
 */
export function RegistrationForm({
  year,
  definition: encodedDefinition,
  initialRegistrants,
  actionData,
}: {
  year: number;
  definition: typeof FormDefinition.Encoded;
  /**
   * The form's seed registrants — defaults to one blank attendee shell
   * (`makeDefaultRegistrant()`). Overridable so a test (or a future
   * resume-a-draft flow) can seed a registrant whose `type` selects the SSR
   * branch the server renders: the branch is derived from each registrant's
   * default `type` (see `liveValues`' fallback below), so a seeded
   * `type: 'attendee'` makes the server render the attendee graph — the branch
   * the render-parity test pins (BLOCKER 4).
   */
  initialRegistrants?: ReadonlyArray<
    ReturnType<typeof makeDefaultRegistrant> & { type?: string }
  >;
  actionData?: SubmissionResult<string[]> | null;
}) {
  const translate = useTranslate();

  // The loader JSON crossed a boundary; re-decode it through `FormDefinition` so
  // the client codec is built from a branded definition (`boundary-discipline`),
  // exactly as `contact.tsx` does.
  const definition = React.useMemo(
    () => Schema.decodeUnknownSync(FormDefinition)(encodedDefinition),
    [encodedDefinition],
  );
  const registrationStandardSchema = React.useMemo(
    () => makeRegistrationStandardSchema(definition),
    [definition],
  );

  const seedRegistrants: ReadonlyArray<
    ReturnType<typeof makeDefaultRegistrant> & { type?: string }
  > = initialRegistrants ?? [makeDefaultRegistrant()];

  const { form, fields, intent } = useForm(registrationStandardSchema, {
    shouldValidate: 'onSubmit',
    shouldRevalidate: 'onInput',
    defaultValue: {
      registrants: [...seedRegistrants],
    },
    lastResult: actionData,
  });

  const registrants = fields.registrants.getFieldList();

  // `/future` field metadata exposes no live `.value`; read the current `type`
  // and `dateOfBirth` for each registrant from the live form data instead. The
  // `useFormData` SSR snapshot is the FALLBACK (conform's server store snapshot
  // returns it verbatim), so the fallback carries each registrant's DEFAULT
  // `type`/`dateOfBirth` — the server then renders the branch matching the seed
  // (the same `useFormData(... ?? default)` idiom the generic renderer's
  // `VariantSection` uses), instead of always falling to the empty/exhibitor
  // branch. On the client the live `formData.get(...)` takes over on first input.
  const names = registrants.map((registrant) => {
    const set = registrant.getFieldset();
    return { type: set.type.name, dateOfBirth: set.dateOfBirth.name };
  });
  const fallback = seedRegistrants.map((registrant) => ({
    type: typeof registrant.type === 'string' ? registrant.type : null,
    dateOfBirth:
      typeof registrant.dateOfBirth === 'string'
        ? registrant.dateOfBirth
        : null,
  }));
  const liveValues = useFormData(
    form.id,
    (formData) =>
      names.map((n) => ({
        type: formData.get(n.type),
        dateOfBirth: formData.get(n.dateOfBirth),
      })),
    { fallback },
  );

  return (
    <Main className="gap-10 px-3 py-12 text-2xl md:px-16">
      <h1>{translate('registration.form.title', { year })}</h1>
      <FormProvider context={form.context}>
        <Form
          method="POST"
          className="flex flex-col gap-4"
          {...form.props}
        >
          {registrants.map((registrant, index) => {
            const type = liveValues[index]?.type as 'attendee' | 'exhibitor';

            const fields = registrant.getFieldset();
            const dateOfBirth = liveValues[index]?.dateOfBirth;
            const age = dayjs().diff(dayjs(dateOfBirth), 'year');
            const isMinor = age < 18;
            const parent = fields.parent.getFieldset();
            const extras = fields.extra.getFieldset();
            const volunteer = fields.volunteer.getFieldset();

            return (
              <>
                <fieldset
                  key={registrant.key}
                  name={registrant.name}
                  className="flex flex-col gap-4"
                >
                  <RadioGroup name={fields.type.name}>
                    <Radios>
                      <Radio value="attendee">
                        {translate('registration.form.attendee')}
                      </Radio>
                      <Radio value="exhibitor">
                        {translate('registration.form.exhibitor')}
                      </Radio>
                    </Radios>
                    <FieldErrors />
                  </RadioGroup>
                  <TextField name={fields.name.name}>
                    <Label>{translate('registration.form.name.label')}</Label>
                    <TextField.Input
                      type="text"
                      placeholder={
                        translate(
                          'registration.form.name.placeholder',
                        ) as string
                      }
                    />
                    <FieldErrors />
                  </TextField>
                  <TextField name={fields.email.name}>
                    <Label>{translate('registration.form.email.label')}</Label>
                    <TextField.Input
                      type="text"
                      placeholder={
                        translate(
                          'registration.form.email.placeholder',
                        ) as string
                      }
                    />
                    <FieldErrors />
                  </TextField>
                  <TextField name={fields.phone.name}>
                    <Label>{translate('registration.form.phone.label')}</Label>
                    <TextField.Input
                      type="text"
                      placeholder={
                        translate(
                          'registration.form.phone.placeholder',
                        ) as string
                      }
                    />
                    <FieldErrors />
                  </TextField>

                  {type === 'attendee' ? (
                    <>
                      <RadioGroup name={fields.gender.name}>
                        <Label>
                          {translate('registration.form.gender.label')}
                        </Label>
                        <Radios>
                          <Radio value="male">
                            {translate('registration.form.gender.male')}
                          </Radio>
                          <Radio value="female">
                            {translate('registration.form.gender.female')}
                          </Radio>
                        </Radios>
                        <FieldErrors />
                      </RadioGroup>

                      <TextField name={fields.dateOfBirth.name}>
                        <Label>
                          {translate('registration.form.date-of-birth.label')}
                        </Label>
                        <TextField.Input
                          type="date"
                          placeholder={
                            translate(
                              'registration.form.date-of-birth.placeholder',
                            ) as string
                          }
                        />
                        <FieldErrors />
                      </TextField>

                      {isMinor && (
                        <fieldset>
                          <TextField name={parent.name.name}>
                            <Label>
                              {translate('registration.form.parent.label')}
                            </Label>
                            <TextField.Input
                              type="text"
                              placeholder={
                                translate(
                                  'registration.form.parent.placeholder',
                                ) as string
                              }
                            />
                            <FieldErrors />
                          </TextField>
                          <TextField name={parent.email.name}>
                            <Label>
                              {translate(
                                'registration.form.parent-email.label',
                              )}
                            </Label>
                            <TextField.Input
                              type="text"
                              placeholder={
                                translate(
                                  'registration.form.parent-email.placeholder',
                                ) as string
                              }
                            />
                            <FieldErrors />
                          </TextField>
                          <TextField name={parent.phone.name}>
                            <Label>
                              {translate(
                                'registration.form.parent-phone.label',
                              )}
                            </Label>
                            <TextField.Input
                              type="text"
                              placeholder={
                                translate(
                                  'registration.form.parent-phone.placeholder',
                                ) as string
                              }
                            />
                            <FieldErrors />
                          </TextField>
                        </fieldset>
                      )}

                      <h2>Meals</h2>

                      <RadioGroup name={fields.meals.name}>
                        <Label>
                          {translate('registration.form.meals.label')}
                        </Label>
                        <Radios>
                          <Radio value="true">
                            {translate('registration.form.meals.yes')}
                          </Radio>
                          <Radio value="false">
                            {translate('registration.form.meals.no')}
                          </Radio>
                        </Radios>
                        <FieldErrors />
                      </RadioGroup>

                      <TextField name={fields.dietaryRestrictions.name}>
                        <Label>
                          {translate(
                            'registration.form.dietary-restrictions.label',
                          )}
                        </Label>
                        <TextField.Input
                          type="text"
                          placeholder={
                            translate(
                              'registration.form.dietary-restrictions.placeholder',
                            ) as string
                          }
                        />
                        <FieldErrors />
                      </TextField>

                      <h2>Outreach</h2>
                      <CheckboxGroup
                        name={fields.outreach.name}
                        orientation="vertical"
                      >
                        <Label>
                          {translate('registration.form.outreach.label')}
                        </Label>
                        <Checkboxes>
                          <Checkbox value="laws-of-health">
                            {translate(
                              'registration.form.outreach.laws-of-health',
                            )}
                          </Checkbox>
                          <Checkbox value="homeless-carepacks">
                            {translate(
                              'registration.form.outreach.homeless-carepacks',
                            )}
                          </Checkbox>
                          <Checkbox value="back-to-school">
                            {translate(
                              'registration.form.outreach.back-to-school',
                            )}
                          </Checkbox>
                          <Checkbox value="not-sure">
                            {translate('registration.form.outreach.not-sure')}
                          </Checkbox>
                        </Checkboxes>
                        <FieldErrors />
                      </CheckboxGroup>

                      <h2>Extra Information</h2>

                      <TextField name={extras.howDidYouHear.name}>
                        <Label>
                          {translate(
                            'registration.form.how-did-you-hear.label',
                          )}
                        </Label>
                        <TextField.Input
                          type="text"
                          placeholder={
                            translate(
                              'registration.form.how-did-you-hear.placeholder',
                            ) as string
                          }
                        />
                        <FieldErrors />
                      </TextField>

                      <TextField name={extras.whyAreYouAttending.name}>
                        <Label>
                          {translate(
                            'registration.form.why-are-you-attending.label',
                          )}
                        </Label>
                        <TextField.Input
                          type="text"
                          placeholder={
                            translate(
                              'registration.form.why-are-you-attending.placeholder',
                            ) as string
                          }
                        />
                        <FieldErrors />
                      </TextField>

                      <TextField name={extras.whatAreYouExcitedAbout.name}>
                        <Label>
                          {translate(
                            'registration.form.what-are-you-excited-about.label',
                          )}
                        </Label>
                        <TextField.Input
                          type="text"
                          placeholder={
                            translate(
                              'registration.form.what-are-you-excited-about.placeholder',
                            ) as string
                          }
                        />
                        <FieldErrors />
                      </TextField>

                      <RadioGroup name={extras.firstTimeAttending.name}>
                        <Label>
                          {translate(
                            'registration.form.first-time-attending.label',
                          )}
                        </Label>
                        <Radios>
                          <Radio value="true">
                            {translate(
                              'registration.form.first-time-attending.yes',
                            )}
                          </Radio>
                          <Radio value="false">
                            {translate(
                              'registration.form.first-time-attending.no',
                            )}
                          </Radio>
                        </Radios>
                        <FieldErrors />
                      </RadioGroup>

                      <TextField name={extras.church.name}>
                        <Label>
                          {translate('registration.form.church.label')}
                        </Label>
                        <TextField.Input
                          type="text"
                          placeholder={
                            translate(
                              'registration.form.church.placeholder',
                            ) as string
                          }
                        />
                        <FieldErrors />
                      </TextField>

                      <CheckboxGroup name={extras.merch.name}>
                        <Label>
                          {translate('registration.form.merch.label')}
                        </Label>
                        <Checkboxes>
                          <Checkbox value="t-shirt">
                            {translate('registration.form.merch.t-shirt')}
                          </Checkbox>
                          <Checkbox value="hoodie">
                            {translate('registration.form.merch.hoodie')}
                          </Checkbox>
                          <Checkbox value="shirt">
                            {translate('registration.form.merch.shirt')}
                          </Checkbox>
                          <Checkbox value="none">
                            {translate('registration.form.merch.none')}
                          </Checkbox>
                        </Checkboxes>
                        <FieldErrors />
                      </CheckboxGroup>

                      <TextField name={extras.other.name}>
                        <Label>
                          {translate('registration.form.other.label')}
                        </Label>
                        <TextField.Input
                          type="text"
                          placeholder={
                            translate(
                              'registration.form.other.placeholder',
                            ) as string
                          }
                        />
                        <FieldErrors />
                      </TextField>

                      <CheckboxGroup name={extras.tos.name}>
                        <Label>
                          {translate('registration.form.tos.label')}
                        </Label>
                        <Checkboxes>
                          <Checkbox value="true">
                            {translate('registration.form.tos.agree')}
                          </Checkbox>
                        </Checkboxes>
                        <FieldErrors />
                      </CheckboxGroup>

                      <h2>Volunteer</h2>

                      <Checkbox name={volunteer.songLeader.name}>
                        {translate('registration.form.song-leader.label')}
                      </Checkbox>
                      <Checkbox name={volunteer.musician.name}>
                        {translate('registration.form.musician.label')}
                      </Checkbox>
                      <TextField name={volunteer.instrument.name}>
                        <Label>
                          {translate('registration.form.instrument.label')}
                        </Label>
                        <TextField.Input
                          type="text"
                          placeholder={
                            translate(
                              'registration.form.instrument.placeholder',
                            ) as string
                          }
                        />
                        <FieldErrors />
                      </TextField>

                      <Checkbox name={volunteer.specialMusic.name}>
                        {translate('registration.form.special-music.label')}
                      </Checkbox>
                      <Checkbox name={volunteer.hospitality.name}>
                        {translate('registration.form.hospitality.label')}
                      </Checkbox>
                      <Checkbox name={volunteer.registrationStation.name}>
                        {translate(
                          'registration.form.registration-station.label',
                        )}
                      </Checkbox>
                      <Checkbox name={volunteer.usher.name}>
                        {translate('registration.form.usher.label')}
                      </Checkbox>

                      <Checkbox name={volunteer.outreachLeader.name}>
                        {translate('registration.form.outreach-leader.label')}
                      </Checkbox>
                      <Checkbox name={volunteer.smallGroupLeader.name}>
                        {translate(
                          'registration.form.small-group-leader.label',
                        )}
                      </Checkbox>
                      <Checkbox name={volunteer.seminarRoomHost.name}>
                        {translate('registration.form.seminar-room-host.label')}
                      </Checkbox>
                      <Checkbox name={volunteer.cameraOperator.name}>
                        {translate('registration.form.camera-operator.label')}
                      </Checkbox>
                      <Checkbox name={volunteer.photographer.name}>
                        {translate('registration.form.photographer.label')}
                      </Checkbox>
                      <Checkbox name={volunteer.roamingMic.name}>
                        {translate('registration.form.roaming-mic.label')}
                      </Checkbox>
                    </>
                  ) : (
                    <>
                      <TextField name={fields.company.name}>
                        <Label>
                          {translate('registration.form.company.label')}
                        </Label>
                        <TextField.Input
                          type="text"
                          placeholder={
                            translate(
                              'registration.form.company.placeholder',
                            ) as string
                          }
                        />
                        <FieldErrors />
                      </TextField>

                      <TextField name={fields.synopsis.name}>
                        <Label>
                          {translate('registration.form.synopsis.label')}
                        </Label>
                        <TextField.Input
                          type="text"
                          placeholder={
                            translate(
                              'registration.form.synopsis.placeholder',
                            ) as string
                          }
                        />
                        <FieldErrors />
                      </TextField>

                      <TextField name={fields.website.name}>
                        <Label>
                          {translate('registration.form.website.label')}
                        </Label>
                        <TextField.Input
                          type="text"
                          placeholder={
                            translate(
                              'registration.form.website.placeholder',
                            ) as string
                          }
                        />
                        <FieldErrors />
                      </TextField>
                    </>
                  )}
                </fieldset>
              </>
            );
          })}
          <div>
            <Button
              type="button"
              onClick={() => {
                intent.insert({ name: fields.registrants.name });
              }}
            >
              Add Registrant
            </Button>
          </div>
          <div>
            <Button type="submit">Submit</Button>
          </div>
        </Form>
      </FormProvider>
    </Main>
  );
}
