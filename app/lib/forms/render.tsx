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

import type {
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

/**
 * The cross-field-conditional gate on a field's VISIBILITY (registration-launch
 * Branch 6, BLOCKER 1). A `requiredWhenEquals` rule whose `target` is a top-level
 * `optional: true` field models the contact/volunteer `method`-gated `email` /
 * `phone`: the field exists in the payload only WHEN its `when` field's live value
 * is one of `equals`, and the decoder accepts the key's ABSENCE (`optional: true`)
 * the rest of the time. The hand-tuned forms rendered exactly this — `method ===
 * 'email' || method === 'both' ? <email> : null` (`contact.tsx:240/253`) — so an
 * inactive field was absent from the POST and its `optional: true` codec accepted
 * the absence. The generic renderer must reproduce that conditional VISIBILITY, or
 * the always-rendered field POSTs a present blank (`phone=''`) that its codec then
 * rejects as `requiredMessage` — the regression this gate fixes.
 *
 * `derive-dont-sync`: the gate is DERIVED from the definition's `requiredWhenEquals`
 * rules (the same rules that re-impose PRESENCE server-side), never a hand-wired
 * `method` switch — editing the rule's `equals` set changes both the visibility and
 * the validation in lockstep. The live `when` value is read via `useFormData`
 * (matching the `useFormData(... ?? default)` idiom the hand-tuned forms used),
 * falling back to the field's own default so the server renders the same branch the
 * client will.
 */
function RuleGatedField({
  rule,
  formId,
  children,
}: {
  rule: Extract<CrossFieldRule, { _tag: 'requiredWhenEquals' }>;
  formId: string;
  children: React.ReactNode;
}) {
  const meta = useField<string>(rule.when);
  const fallback =
    typeof meta.defaultValue === 'string' ? meta.defaultValue : undefined;
  const live = useFormData(formId, (formData) => formData.get(rule.when), {
    fallback,
  });
  const value = typeof live === 'string' ? live : fallback;
  const active =
    typeof value === 'string' && rule.equals.includes(value as never);
  return active ? <>{children}</> : null;
}

/**
 * Render one field — a leaf control, or a `nestedGroup`'s heading + its inner
 * fields under dotted `group.field` submit-names (so `parseSubmission` nests them
 * into `{ group: { field: … } }`, the shape the decoder's nested `Schema.Struct`
 * expects).
 *
 * `gateRules` is the index of `requiredWhenEquals` rules keyed by `target` name
 * (built once in {@link FormFields}); a top-level field that is a rule's target is
 * wrapped in a {@link RuleGatedField} so its visibility tracks the `when` field —
 * the contact/volunteer `method`-gated `email`/`phone`. Fields inside a
 * `nestedGroup` carry no top-level gate (the registration groups gate structurally
 * via the variant), so the recursion does not propagate `gateRules` inward.
 */
function FieldControl({
  field,
  prefix,
  locale,
  formId,
  gateRules,
}: {
  field: FieldKind;
  prefix: string;
  locale: Locale;
  formId: string;
  gateRules?: ReadonlyMap<
    string,
    Extract<CrossFieldRule, { _tag: 'requiredWhenEquals' }>
  >;
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
  const rule = gateRules?.get(field.name);
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

  // Index the `requiredWhenEquals` rules by their `target` so a gated top-level
  // field (the `method`-gated `email`/`phone`) renders only when its `when` value
  // is one of `equals` — reproducing the hand-tuned forms' conditional visibility
  // so an inactive field is ABSENT from the POST, not a present blank its codec
  // would reject (`derive-dont-sync`: the gate IS the rule).
  const gateRules = React.useMemo(() => {
    const map = new Map<
      string,
      Extract<CrossFieldRule, { _tag: 'requiredWhenEquals' }>
    >();
    for (const rule of definition.rules ?? []) {
      if (rule._tag === 'requiredWhenEquals') map.set(rule.target, rule);
    }
    return map;
  }, [definition.rules]);

  return (
    <>
      {definition.fields.map((field) => (
        <FieldControl
          key={field.name}
          field={field}
          prefix=""
          locale={locale}
          formId={formId}
          gateRules={gateRules}
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
