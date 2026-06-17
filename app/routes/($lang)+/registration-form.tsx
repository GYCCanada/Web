import type { SubmissionResult } from '@conform-to/react/future';
import { Schema } from 'effect';
import { Form } from 'react-router';
import dayjs from 'dayjs';

import { FormProvider, useForm, useFormData } from '~/lib/conform';
import { defaultRegistrationForm } from '~/lib/content/pages/defaults';
import { definitionToSchema } from '~/lib/forms/decode';
import { useTranslate } from '~/lib/localization/context';
import { Button } from '~/ui/button';
import { Checkbox, Checkboxes, CheckboxGroup } from '~/ui/checkbox';
import { FieldErrors } from '~/ui/field-error';
import { Label } from '~/ui/label';
import { Main } from '~/ui/main';
import { Radio, RadioGroup, Radios } from '~/ui/radio';
import { TextField } from '~/ui/text-field';

import type { RegistrationStandardSchema as OracleStandardSchema } from './registration-schema.oracle';

/**
 * Registration's client validation schema, DERIVED from the structural Form
 * engine's `defaultRegistrationForm` definition (`derive-dont-sync`,
 * registration-launch Branch 6.5). The engine definition validates ONE registrant
 * (the attendee/exhibitor discriminator + nested groups + boolean codecs — the
 * riskiest graph, proven byte-equivalent to the hand-tuned oracle by
 * `app/lib/forms/equivalence.registration.test.tsx`); this form keeps the
 * repeating-`registrants` SHELL (a repeating-array-of-variant-items is not in the
 * closed `FieldKind` set), so it wraps the per-registrant codec in
 * `{ registrants: Array(...) }`. Editing the stored `forms/registration.json` now
 * changes what the form accepts with no code change.
 *
 * The engine codec's OUTPUT is a generic `Record<string, unknown>` (the data-driven
 * decoder is field-name-agnostic), so conform's field metadata is re-typed at the
 * seam to the oracle standard schema's precise registrant shape — the SAME shape
 * the equivalence harness proves the engine decodes to. This is a TYPE-only
 * annotation over an unchanged engine RUNTIME (the `configureForms` "cast at the
 * seam" idiom this codebase already uses), NOT a re-declaration of the validation:
 * `OracleStandardSchema` contributes only its `.Type` here; every issue the form
 * shows is computed by the engine codec.
 */
const RegistrationSchema = Schema.Struct({
  registrants: Schema.mutable(
    Schema.Array(definitionToSchema(defaultRegistrationForm)),
  ).annotateKey({ messageMissingKey: 'registration.form.type.required' }),
});

const RegistrationStandardSchema = Schema.toStandardSchemaV1(
  RegistrationSchema,
) as unknown as typeof OracleStandardSchema;

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
  actionData,
}: {
  year: number;
  actionData?: SubmissionResult<string[]> | null;
}) {
  const translate = useTranslate();

  const { form, fields, intent } = useForm(RegistrationStandardSchema, {
    shouldValidate: 'onSubmit',
    shouldRevalidate: 'onInput',
    defaultValue: {
      registrants: [makeDefaultRegistrant()],
    },
    lastResult: actionData,
  });

  const registrants = fields.registrants.getFieldList();

  // `/future` field metadata exposes no live `.value`; read the current `type`
  // and `dateOfBirth` for each registrant from the live form data instead.
  const names = registrants.map((registrant) => {
    const set = registrant.getFieldset();
    return { type: set.type.name, dateOfBirth: set.dateOfBirth.name };
  });
  const liveValues = useFormData(
    form.id,
    (formData) =>
      names.map((n) => ({
        type: formData.get(n.type),
        dateOfBirth: formData.get(n.dateOfBirth),
      })),
    { fallback: [] as Array<{ type: string | null; dateOfBirth: string | null }> },
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
