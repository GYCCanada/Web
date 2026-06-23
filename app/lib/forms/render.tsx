import * as React from 'react';

import { useField, useFormData } from '~/lib/conform';
import type { Text } from '~/lib/content/schema';
import { useLocale } from '~/lib/localization/context';
import type { Locale } from '~/lib/localization/localization';
import { Checkbox, CheckboxGroup, Checkboxes } from '~/ui/checkbox';
import { FieldErrors } from '~/ui/field-error';
import { HoneypotField } from '~/ui/honeypot-field';
import { Label } from '~/ui/label';
import { Radio, RadioGroup, Radios } from '~/ui/radio';
import { TextField } from '~/ui/text-field';

import { activationIndex, isActiveByName } from './activation';
import type { ActivationScope } from './activation';
import type {
  ActiveWhen,
  CrossFieldRule,
  FieldKind,
  FormDefinition,
  FormVariantSet,
} from './definition';

/**
 * The generic form renderer (ADR 0007, CONTEXT §Form definition; registration-
 * launch Branch 6.2). Turns a `FormDefinition` into rendered form controls,
 * absorbing the method-discriminator + cross-field-conditional UI duplicated
 * verbatim across `contact.tsx` / `volunteer.tsx` and the per-kind control markup
 * triplicated across the three forms. Branches 6.3–6.5 migrate the routes onto
 * `<FormFields />`; this sub-commit lands the renderer + its tests.
 *
 * One field kind ⇒ one control, by construction over the CLOSED `FieldKind` set
 * (`make-impossible-states-unrepresentable`): a `FormDefinition` cannot carry a
 * field this renderer has no case for, so the `switch` is total with no default
 * fallthrough. Bilingual `label` / `placeholder` `Text` is projected to the active
 * `useLocale()` here — the only place a definition's copy becomes locale-specific
 * markup (`boundary-discipline`). The submit-`name` each control carries is the
 * field's `FieldName`, already proven a safe identifier at the `FormDefinition`
 * boundary, so the renderer interpolates it (and the dotted `group.field` path for
 * a `nestedGroup`) with no further escaping.
 *
 * The discriminated `variant` renders its discriminator as a `RadioGroup` and the
 * selected branch's fields conditionally, gating on the live submitted value via
 * `useFormData` — the same client-driven conditional the hand-tuned forms run for
 * `method` (`contact.tsx:199-264`). Variant fields for the unselected branch are
 * not rendered, matching the decoder's variant-presence model (a field is required
 * only WHERE it appears).
 */

/** Project a bilingual `Text` to the active locale's string. */
const project = (text: Text, locale: Locale): string => text[locale];

/** Render one leaf field's control. `name` is the (possibly group-prefixed) submit-name. */
function LeafField({
  field,
  name,
  locale,
}: {
  field: Exclude<FieldKind, { _tag: 'nestedGroup' }>;
  name: string;
  locale: Locale;
}) {
  const label = project(field.label, locale);
  const placeholder =
    'placeholder' in field && field.placeholder
      ? project(field.placeholder, locale)
      : undefined;

  switch (field._tag) {
    case 'requiredText':
    case 'optionalText':
      return (
        <TextField name={name}>
          <Label>{label}</Label>
          {field.multiline ? (
            <TextField.TextArea rows={5} placeholder={placeholder} />
          ) : (
            <TextField.Input placeholder={placeholder} />
          )}
          <FieldErrors />
        </TextField>
      );
    case 'email':
      return (
        <TextField name={name}>
          <Label>{label}</Label>
          <TextField.Input type="email" placeholder={placeholder} />
          <FieldErrors />
        </TextField>
      );
    case 'url':
      return (
        <TextField name={name}>
          <Label>{label}</Label>
          <TextField.Input type="url" placeholder={placeholder} />
          <FieldErrors />
        </TextField>
      );
    case 'number':
      return (
        <TextField name={name}>
          <Label>{label}</Label>
          <TextField.Input
            type="number"
            inputMode="numeric"
            min={field.min ?? 0}
            max={field.max}
            placeholder={placeholder}
          />
          <FieldErrors />
        </TextField>
      );
    case 'literal':
      return (
        <RadioGroup name={name}>
          <Label>{label}</Label>
          <Radios>
            {field.options.map((option) => (
              <Radio key={option.value} value={option.value}>
                {project(option.label, locale)}
              </Radio>
            ))}
          </Radios>
          <FieldErrors />
        </RadioGroup>
      );
    case 'checkboxBoolean':
      return (
        <TextField name={name}>
          <Checkbox name={name} value="true">
            {label}
          </Checkbox>
          <FieldErrors />
        </TextField>
      );
    case 'arrayOfLiteral':
      return (
        <CheckboxGroup name={name}>
          <Label>{label}</Label>
          <Checkboxes>
            {field.options.map((option) => (
              <Checkbox key={option.value} name={name} value={option.value}>
                {project(option.label, locale)}
              </Checkbox>
            ))}
          </Checkboxes>
          <FieldErrors />
        </CheckboxGroup>
      );
  }
}

/** The `activeWhenEquals` rule narrowed from the closed `CrossFieldRule` union. */
type ActivationRule = Extract<CrossFieldRule, { _tag: 'activeWhenEquals' }>;

/**
 * Build the single-entry {@link ActivationScope} the shared {@link isActiveByName}
 * reads, projecting one predicate's live `when` value out of the form's `FormData`
 * into the SAME shape the server-side DECODED scope carries (so client visibility
 * and server activation agree — `derive-dont-sync`):
 *   - `literalEquals`    — a `literal` radio decodes to one option STRING, so read
 *     `formData.get(when)`;
 *   - `arrayIncludesAny` — an `arrayOfLiteral` decodes to an array of strings, so
 *     read `formData.getAll(when)`;
 *   - `checkboxChecked`  — a `checkboxBoolean` decodes to a real `boolean`; the
 *     control posts `value="true"` only WHEN checked (absent otherwise), so map a
 *     present `'true'` to `true`.
 */
const scopeFromFormData = (
  predicate: ActiveWhen,
  formData: FormData | URLSearchParams,
): ActivationScope => {
  switch (predicate._tag) {
    case 'literalEquals': {
      const value = formData.get(predicate.when);
      return { [predicate.when]: typeof value === 'string' ? value : undefined };
    }
    case 'arrayIncludesAny':
      return {
        [predicate.when]: formData
          .getAll(predicate.when)
          .filter((entry): entry is string => typeof entry === 'string'),
      };
    case 'checkboxChecked':
      return { [predicate.when]: formData.get(predicate.when) === 'true' };
  }
};

/**
 * The SSR / initial-render fallback scope, shaped per predicate kind from the
 * `when` field's conform default so the server renders the SAME branch the client
 * will once `useFormData` connects. The default's raw shape mirrors the rendered
 * control: a `literal` defaults to a single `defaultValue` string, an
 * `arrayOfLiteral` to its `defaultOptions` collection (the array form, the same
 * `<Checkboxes>` reads — `defaultValue` alone holds only the first member), and a
 * `checkboxBoolean` to its `value="true"` string (or a boolean) when pre-checked —
 * each normalized into the decoded scope shape {@link scopeFromFormData} produces.
 */
const fallbackScope = (
  predicate: ActiveWhen,
  meta: { readonly defaultValue?: unknown; readonly defaultOptions: string[] },
): ActivationScope => {
  switch (predicate._tag) {
    case 'literalEquals':
      return {
        [predicate.when]:
          typeof meta.defaultValue === 'string' ? meta.defaultValue : undefined,
      };
    case 'arrayIncludesAny':
      return { [predicate.when]: meta.defaultOptions };
    case 'checkboxChecked':
      return {
        [predicate.when]:
          meta.defaultValue === true || meta.defaultValue === 'true',
      };
  }
};

/**
 * The cross-field-conditional gate on a field's VISIBILITY (registrar plan
 * Decision 5). An `activeWhenEquals` rule whose `target` is an `optional: true`
 * field models the contact/volunteer `method`-gated `email` / `phone`: the field
 * is ACTIVE — rendered, presence-required, price-eligible — only WHEN its
 * `predicate` holds over a sibling's live value, and the decoder accepts the key's
 * ABSENCE (`optional: true`) the rest of the time. The hand-tuned forms rendered
 * exactly this — `method === 'email' || method === 'both' ? <email> : null`
 * (`contact.tsx:240/253`) — so an inactive field was absent from the POST and its
 * `optional: true` codec accepted the absence. The generic renderer reproduces that
 * conditional VISIBILITY, or the always-rendered field POSTs a present blank
 * (`phone=''`) that its codec then rejects as `requiredMessage`.
 *
 * `derive-dont-sync`: visibility is DERIVED from the field's `activeWhenEquals`
 * rule through the ONE shared {@link isActiveByName} evaluator — the SAME law the
 * decoder's presence filter and `price()` read — never a hand-wired `method` switch
 * or a re-implemented predicate. After registrar Decision 5, `requiredWhenEquals` is
 * presence-only and no longer gates visibility; `activeWhenEquals` owns it. The live
 * `when` value is read via `useFormData` (matching the `useFormData(... ?? default)`
 * idiom the hand-tuned forms used), seeded by the field's own default so the server
 * renders the same branch the client will.
 */
function RuleGatedField({
  rule,
  formId,
  children,
}: {
  rule: ActivationRule;
  formId: string;
  children: React.ReactNode;
}) {
  const meta = useField<string | string[]>(rule.predicate.when);
  const scope = useFormData(
    formId,
    (formData) => scopeFromFormData(rule.predicate, formData),
    { fallback: fallbackScope(rule.predicate, meta) },
  );
  const active = isActiveByName(
    rule.target,
    new Map([[rule.target, rule]]),
    scope,
  );
  return active ? <>{children}</> : null;
}

/**
 * Render one field — a leaf control, or a `nestedGroup`'s heading + its inner
 * fields under dotted `group.field` submit-names (so `parseSubmission` nests them
 * into `{ group: { field: … } }`, the shape the decoder's nested `Schema.Struct`
 * expects).
 *
 * `activationGates` is the index of `activeWhenEquals` rules keyed by `target` name
 * (built once in {@link FormFields}); a top-level field that is a rule's target is
 * wrapped in a {@link RuleGatedField} so its visibility tracks the predicate's
 * `when` field — the contact/volunteer `method`-gated `email`/`phone`. Fields
 * inside a `nestedGroup` carry no top-level gate (the registration groups gate
 * structurally via the variant), so the recursion does not propagate
 * `activationGates` inward.
 */
function FieldControl({
  field,
  prefix,
  locale,
  formId,
  activationGates,
}: {
  field: FieldKind;
  prefix: string;
  locale: Locale;
  formId: string;
  activationGates?: ReadonlyMap<string, ActivationRule>;
}) {
  if (field._tag === 'nestedGroup') {
    return (
      <fieldset className="flex flex-col gap-4">
        <legend>{project(field.label, locale)}</legend>
        {field.fields.map((inner) => (
          <FieldControl
            key={inner.name}
            field={inner}
            prefix={`${prefix}${field.name}.`}
            locale={locale}
            formId={formId}
          />
        ))}
      </fieldset>
    );
  }
  const control = (
    <LeafField field={field} name={`${prefix}${field.name}`} locale={locale} />
  );
  const rule = activationGates?.get(field.name);
  return rule ? (
    <RuleGatedField rule={rule} formId={formId}>
      {control}
    </RuleGatedField>
  ) : (
    control
  );
}

/** Render a discriminated variant: the discriminator radios + the selected branch's fields. */
function VariantSection({
  variant,
  locale,
  formId,
}: {
  variant: FormVariantSet;
  locale: Locale;
  formId: string;
}) {
  // The conform `/future` field metadata exposes no live `.value`, so read the
  // submitted discriminator from the live `FormData`, falling back to the field's
  // default (its `defaultValue` / repopulated `lastResult`) so the server renders
  // the same branch the client will — matching the `useFormData(... ?? default)`
  // idiom the hand-tuned `method` forms use. A discriminator with no default
  // (registration's `type`) renders no branch until the user selects one, exactly
  // as the registration form does today.
  const meta = useField<string>(variant.discriminator);
  const fallback =
    typeof meta.defaultValue === 'string' ? meta.defaultValue : undefined;
  const live = useFormData(
    formId,
    (formData) => formData.get(variant.discriminator),
    { fallback },
  );
  const selected = typeof live === 'string' ? live : fallback;
  const branch = variant.variants.find((v) => v.value === selected);

  return (
    <>
      <RadioGroup name={variant.discriminator}>
        <Radios>
          {variant.options.map((option) => (
            <Radio key={option.value} value={option.value}>
              {project(option.label, locale)}
            </Radio>
          ))}
        </Radios>
        <FieldErrors />
      </RadioGroup>
      {branch
        ? branch.fields.map((field) => (
            <FieldControl
              key={field.name}
              field={field}
              prefix=""
              locale={locale}
              formId={formId}
            />
          ))
        : null}
    </>
  );
}

/**
 * Render the field graph of a `FormDefinition`: the common `fields`, then the
 * discriminated `variant` (if any). The honeypot is rendered alongside (every
 * form carries one). The submit `<Button>` and the enclosing `<Form>` /
 * `FormProvider` stay the route's concern — `<FormFields />` is the field graph,
 * not the whole form shell.
 */
export function FormFields({
  definition,
  formId,
}: {
  definition: FormDefinition;
  formId: string;
}) {
  const locale = useLocale();

  // Index the `activeWhenEquals` rules by their `target` (via the ONE shared
  // `activationIndex`, the same index the decoder + `price()` build — `derive-
  // dont-sync`) so a gated top-level field (the `method`-gated `email`/`phone`)
  // renders only when its predicate holds — reproducing the hand-tuned forms'
  // conditional visibility so an inactive field is ABSENT from the POST, not a
  // present blank its codec would reject. After registrar Decision 5,
  // `requiredWhenEquals` is presence-only and no longer drives visibility.
  const activationGates = React.useMemo(
    () => activationIndex(definition),
    [definition],
  );

  return (
    <>
      {definition.fields.map((field) => (
        <FieldControl
          key={field.name}
          field={field}
          prefix=""
          locale={locale}
          formId={formId}
          activationGates={activationGates}
        />
      ))}
      {definition.variant ? (
        <VariantSection
          variant={definition.variant}
          locale={locale}
          formId={formId}
        />
      ) : null}
      <HoneypotField />
    </>
  );
}
