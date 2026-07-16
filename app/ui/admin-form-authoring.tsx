import { Form } from "react-router";

import type { FieldLocation } from "~/lib/forms/form-authoring";
import { FormDefinition, type FormId } from "~/lib/forms/definition";

const FORM_LABELS = {
  contact: "Contact",
  volunteer: "Volunteer",
  registration: "Registration",
} as const satisfies Record<FormId, string>;

const FIELD_TAGS = [
  "requiredText",
  "optionalText",
  "email",
  "url",
  "number",
  "literal",
  "checkboxBoolean",
  "arrayOfLiteral",
  "nestedGroup",
] as const;

export type AdminFormAuthoringDefinition = typeof FormDefinition.Encoded;
type DefinitionView = AdminFormAuthoringDefinition;
type FieldView = AdminFormAuthoringDefinition["fields"][number];
export type AdminFormAuthoringAction =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly error: string;
      readonly issues: readonly string[];
    };

export type AdminFormAuthoringProps = {
  readonly form: FormId;
  readonly version: string;
  readonly definition: AdminFormAuthoringDefinition;
  readonly timeZone: string;
  readonly status?: string | null;
  readonly actionData?: AdminFormAuthoringAction;
  readonly publishing: boolean;
};

const control = "block min-h-11 w-full rounded-md border border-neutral-300 px-3 py-2";
const hiddenLocation = (location: FieldLocation) => (
  <>
    <input type="hidden" name="area" value={location.area} />
    <input type="hidden" name="variant" value={location.variant ?? ""} />
    <input type="hidden" name="groups" value={location.groups.join(">")} />
  </>
);
const versionInput = (version: string) => (
  <input type="hidden" name="expectedCurrentVersion" value={version} />
);

const optionLines = (field: FieldView): string =>
  "options" in field
    ? field.options
        .map((option) => `${option.value}|${option.label.en}|${option.label.fr}`)
        .join("\n")
    : "";

function FieldForm({
  field,
  index,
  location,
  version,
  publishing,
}: {
  readonly field?: FieldView;
  readonly index?: number;
  readonly location: FieldLocation;
  readonly version: string;
  readonly publishing: boolean;
}) {
  const tag = field?._tag ?? "requiredText";
  const placeholder = field !== undefined && "placeholder" in field ? field.placeholder : undefined;
  return (
    <Form
      method="post"
      className="grid gap-3 rounded-md border border-neutral-200 bg-white p-4 lg:grid-cols-2"
    >
      {versionInput(version)}
      {hiddenLocation(location)}
      {index === undefined ? null : <input type="hidden" name="index" value={index} />}
      <label className="space-y-1 text-sm">
        <span>Kind</span>
        <select className={control} name="fieldTag" defaultValue={tag}>
          {FIELD_TAGS.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </label>
      <label className="space-y-1 text-sm">
        <span>Submit name</span>
        <input className={control} name="name" required defaultValue={field?.name ?? ""} />
      </label>
      <label className="space-y-1 text-sm">
        <span>Label (English)</span>
        <input className={control} name="labelEn" required defaultValue={field?.label.en ?? ""} />
      </label>
      <label className="space-y-1 text-sm">
        <span>Label (French)</span>
        <input className={control} name="labelFr" required defaultValue={field?.label.fr ?? ""} />
      </label>
      <label className="space-y-1 text-sm">
        <span>Placeholder (English)</span>
        <input className={control} name="placeholderEn" defaultValue={placeholder?.en ?? ""} />
      </label>
      <label className="space-y-1 text-sm">
        <span>Placeholder (French)</span>
        <input className={control} name="placeholderFr" defaultValue={placeholder?.fr ?? ""} />
      </label>
      <label className="space-y-1 text-sm">
        <span>Required message key</span>
        <input
          className={control}
          name="requiredMessage"
          defaultValue={
            field !== undefined && "requiredMessage" in field ? field.requiredMessage : ""
          }
        />
      </label>
      <label className="space-y-1 text-sm">
        <span>Invalid message key</span>
        <input
          className={control}
          name="invalidMessage"
          defaultValue={
            field !== undefined && "invalidMessage" in field ? field.invalidMessage : ""
          }
        />
      </label>
      <label className="space-y-1 text-sm">
        <span>Minimum</span>
        <input
          className={control}
          name="min"
          type="number"
          step="1"
          defaultValue={field !== undefined && "min" in field ? field.min : undefined}
        />
      </label>
      <label className="space-y-1 text-sm">
        <span>Maximum</span>
        <input
          className={control}
          name="max"
          type="number"
          step="1"
          defaultValue={field !== undefined && "max" in field ? field.max : undefined}
        />
      </label>
      <label className="space-y-1 text-sm">
        <span>Nested-group presence anchor</span>
        <input
          className={control}
          name="presenceAnchor"
          defaultValue={
            field !== undefined && "presenceAnchor" in field ? field.presenceAnchor : ""
          }
        />
      </label>
      <label className="space-y-1 text-sm lg:col-span-2">
        <span>Options — one value|English|French per line</span>
        <textarea
          className={control}
          name="options"
          rows={4}
          defaultValue={field === undefined ? "" : optionLines(field)}
        />
      </label>
      <div className="flex flex-wrap gap-4 text-sm lg:col-span-2">
        <label>
          <input
            type="checkbox"
            name="optional"
            defaultChecked={field !== undefined && "optional" in field && field.optional === true}
          />{" "}
          Optional
        </label>
        <label>
          <input
            type="checkbox"
            name="multiline"
            defaultChecked={field !== undefined && "multiline" in field && field.multiline === true}
          />{" "}
          Multiline
        </label>
        <label>
          <input
            type="checkbox"
            name="requirePresent"
            defaultChecked={
              field !== undefined && "requirePresent" in field && field.requirePresent === true
            }
          />{" "}
          Require key presence
        </label>
      </div>
      <button
        className="min-h-11 rounded-md bg-neutral-900 px-4 text-sm font-medium text-white disabled:opacity-50 lg:col-span-2"
        type="submit"
        name="intent"
        value="setField"
        disabled={publishing}
      >
        {field === undefined ? "Add field" : "Publish field changes"}
      </button>
    </Form>
  );
}

function FieldActions({
  index,
  location,
  version,
  publishing,
}: {
  readonly index: number;
  readonly location: FieldLocation;
  readonly version: string;
  readonly publishing: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {([-1, 1] as const).map((direction) => (
        <Form method="post" key={direction}>
          {versionInput(version)}
          {hiddenLocation(location)}
          <input type="hidden" name="index" value={index} />
          <input type="hidden" name="direction" value={direction} />
          <button
            className="rounded border border-neutral-300 px-3 py-2 text-sm"
            name="intent"
            value="moveField"
            disabled={publishing}
          >
            {direction === -1 ? "Move up" : "Move down"}
          </button>
        </Form>
      ))}
      <Form method="post">
        {versionInput(version)}
        {hiddenLocation(location)}
        <input type="hidden" name="index" value={index} />
        <button
          className="rounded border border-rose-300 px-3 py-2 text-sm text-rose-800"
          name="intent"
          value="removeField"
          disabled={publishing}
        >
          Remove field
        </button>
      </Form>
    </div>
  );
}

function FieldList({
  fields,
  location,
  version,
  publishing,
}: {
  readonly fields: ReadonlyArray<FieldView>;
  readonly location: FieldLocation;
  readonly version: string;
  readonly publishing: boolean;
}) {
  return (
    <div className="space-y-4">
      {fields.map((field, index) => {
        const nestedLocation: FieldLocation = {
          ...location,
          groups: [...location.groups, field.name],
        };
        return (
          <section
            key={`${field.name}-${index}`}
            className="space-y-3 rounded-md bg-neutral-50 p-3"
          >
            <FieldForm
              field={field}
              index={index}
              location={location}
              version={version}
              publishing={publishing}
            />
            <FieldActions
              index={index}
              location={location}
              version={version}
              publishing={publishing}
            />
            {field._tag === "nestedGroup" ? (
              <div className="ml-4 space-y-3 border-l border-neutral-300 pl-4">
                <h4 className="font-medium">Fields inside {field.name}</h4>
                <FieldList
                  fields={field.fields}
                  location={nestedLocation}
                  version={version}
                  publishing={publishing}
                />
                <FieldForm location={nestedLocation} version={version} publishing={publishing} />
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

const formatOptions = (
  items: ReadonlyArray<{
    readonly value: string;
    readonly label: { readonly en: string; readonly fr: string };
  }>,
): string => items.map((item) => `${item.value}|${item.label.en}|${item.label.fr}`).join("\n");

const formatRules = (definition: DefinitionView): string =>
  (definition.rules ?? [])
    .map((rule) =>
      rule._tag === "requiredWhenEquals"
        ? `required|${rule.when}|${rule.equals.join(",")}|${rule.target}|${rule.message}`
        : `active|${rule.predicate._tag}|${rule.predicate.when}|${rule.predicate._tag === "literalEquals" ? rule.predicate.equals.join(",") : rule.predicate._tag === "arrayIncludesAny" ? rule.predicate.values.join(",") : ""}|${rule.target}`,
    )
    .join("\n");

const localInput = (instant: string | undefined, timeZone: string): string => {
  if (instant === undefined) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
};

const formatPricingRules = (definition: DefinitionView): string =>
  (definition.pricing?.rules ?? [])
    .map((rule) => {
      switch (rule._tag) {
        case "choice":
        case "multiChoice":
          return `${rule._tag}|${rule.field}|${rule.prices.map((price) => `${price.option}:${price.amount}`).join(",")}`;
        case "toggle":
          return `toggle|${rule.field}|${rule.amount}`;
        case "quantity":
          return `quantity|${rule.field}|${rule.unit}|${rule.max ?? ""}`;
      }
    })
    .join("\n");

const formatWindows = (definition: DefinitionView, timeZone: string): string =>
  (definition.pricing?.windows ?? [])
    .map(
      (window) =>
        `${window.id}|${localInput(window.startsAt, timeZone)}|${localInput(window.endsAt, timeZone)}|${window.delta}`,
    )
    .join("\n");

export function AdminFormAuthoring({
  form,
  version,
  definition,
  timeZone,
  status,
  actionData,
  publishing,
}: AdminFormAuthoringProps) {
  const party = definition.party;
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">{FORM_LABELS[form]} Form</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Edit typed Form content and publish a validated immutable version.
        </p>
        <p className="mt-2 inline-block rounded bg-neutral-100 px-2 py-1 font-mono text-xs">
          Current version: {version}
        </p>
      </header>
      {status ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          {status}
        </div>
      ) : null}
      {actionData && !actionData.ok ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          <strong>{actionData.error}</strong>
          <ul>
            {actionData.issues.map((issue, index) => (
              <li key={index}>• {issue}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Copy</h2>
        <Form method="post" className="grid gap-3 sm:grid-cols-2">
          {versionInput(version)}
          {(
            [
              ["titleEn", "Title (English)", definition.title.en],
              ["titleFr", "Title (French)", definition.title.fr],
              ["introEn", "Intro (English)", definition.intro?.en ?? ""],
              ["introFr", "Intro (French)", definition.intro?.fr ?? ""],
            ] as const
          ).map(([name, label, defaultValue]) => (
            <label key={name} className="space-y-1 text-sm">
              <span>{label}</span>
              <input
                className={control}
                name={name}
                required={name.startsWith("title")}
                defaultValue={defaultValue}
              />
            </label>
          ))}
          <button
            className="min-h-11 rounded bg-neutral-900 px-4 text-white sm:col-span-2"
            name="intent"
            value="setCopy"
            disabled={publishing}
          >
            Publish copy
          </button>
        </Form>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Common fields</h2>
        <FieldList
          fields={definition.fields}
          location={{ area: "common", groups: [] }}
          version={version}
          publishing={publishing}
        />
        <h3 className="font-medium">Add common field</h3>
        <FieldForm
          location={{ area: "common", groups: [] }}
          version={version}
          publishing={publishing}
        />
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Variants</h2>
        <Form method="post" className="grid gap-3 sm:grid-cols-2">
          {versionInput(version)}
          <label className="space-y-1 text-sm">
            <span>Discriminator field</span>
            <input
              className={control}
              name="discriminator"
              defaultValue={definition.variant?.discriminator ?? ""}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span>Required message key</span>
            <input
              className={control}
              name="variantRequiredMessage"
              defaultValue={definition.variant?.requiredMessage ?? ""}
            />
          </label>
          <label className="space-y-1 text-sm sm:col-span-2">
            <span>Branches — one value|English|French per line</span>
            <textarea
              className={control}
              name="variantOptions"
              rows={5}
              defaultValue={formatOptions(definition.variant?.options ?? [])}
            />
          </label>
          <button
            className="min-h-11 rounded bg-neutral-900 px-4 text-white sm:col-span-2"
            name="intent"
            value="setVariant"
            disabled={publishing}
          >
            Publish variants
          </button>
        </Form>
        {definition.variant ? (
          <>
            <Form method="post">
              {versionInput(version)}
              <button
                className="rounded border border-rose-300 px-3 py-2 text-rose-800"
                name="intent"
                value="removeVariant"
                disabled={publishing}
              >
                Remove variants
              </button>
            </Form>
            {definition.variant.variants.map((variant) => (
              <div key={variant.value} className="space-y-3 rounded border border-neutral-200 p-4">
                <h3 className="font-semibold">
                  {variant.label.en} ({variant.value})
                </h3>
                <FieldList
                  fields={variant.fields}
                  location={{ area: "variant", variant: variant.value, groups: [] }}
                  version={version}
                  publishing={publishing}
                />
                <FieldForm
                  location={{ area: "variant", variant: variant.value, groups: [] }}
                  version={version}
                  publishing={publishing}
                />
              </div>
            ))}
          </>
        ) : null}
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Cross-field rules</h2>
        <Form method="post" className="space-y-3">
          {versionInput(version)}
          <p className="text-xs text-neutral-600">
            required|when|value1,value2|target|message ·
            active|literalEquals|when|value1,value2|target ·
            active|arrayIncludesAny|when|value1,value2|target · active|checkboxChecked|when||target
          </p>
          <textarea
            className={control}
            name="rules"
            rows={8}
            defaultValue={formatRules(definition)}
          />
          <button
            className="min-h-11 rounded bg-neutral-900 px-4 text-white"
            name="intent"
            value="setRules"
            disabled={publishing}
          >
            Publish rules
          </button>
        </Form>
      </section>

      {form === "registration" ? (
        <section className="space-y-5 border-y border-neutral-200 py-6">
          <h2 className="text-lg font-semibold">Commerce and adaptive pricing</h2>
          <p className="text-sm text-neutral-700">
            Times are authored in {timeZone} and normalized to exact UTC instants on publication.
          </p>
          <Form method="post" className="grid gap-4 sm:grid-cols-2">
            {versionInput(version)}
            <input type="hidden" name="timeZone" value={timeZone} />
            <label className="space-y-1 text-sm">
              <span>Base price (Canadian cents)</span>
              <input
                className={control}
                name="baseCents"
                type="number"
                min="0"
                step="1"
                required
                defaultValue={definition.pricing?.base ?? 0}
              />
            </label>
            <label className="space-y-1 text-sm">
              <span>Registration closes ({timeZone})</span>
              <input
                className={control}
                name="registrationClosesAtLocal"
                type="datetime-local"
                required
                defaultValue={localInput(definition.pricing?.registrationClosesAt, timeZone)}
              />
            </label>
            <label className="space-y-1 text-sm sm:col-span-2">
              <span>Pricing rules</span>
              <span className="block text-xs text-neutral-600">
                choice|field|option:amount,... · multiChoice|field|option:amount,... ·
                toggle|field|amount · quantity|field|unit|max
              </span>
              <textarea
                className={control}
                name="pricingRules"
                rows={7}
                defaultValue={formatPricingRules(definition)}
              />
            </label>
            <label className="space-y-1 text-sm sm:col-span-2">
              <span>Timing windows — id|start local|end local|delta</span>
              <textarea
                className={control}
                name="windows"
                rows={7}
                defaultValue={formatWindows(definition, timeZone)}
              />
            </label>
            <fieldset className="space-y-3 sm:col-span-2">
              <legend className="font-semibold">Billing modes</legend>
              <label className="mr-5">
                <input
                  type="checkbox"
                  name="billingGroup"
                  defaultChecked={party?.billingMode.options.group !== undefined}
                />{" "}
                Group
              </label>
              <label>
                <input
                  type="checkbox"
                  name="billingPerRegistrant"
                  defaultChecked={party?.billingMode.options.perRegistrant !== undefined}
                />{" "}
                Per registrant
              </label>
            </fieldset>
            {(
              [
                ["partyIntroEn", "Party intro (English)", party?.intro?.en ?? ""],
                ["partyIntroFr", "Party intro (French)", party?.intro?.fr ?? ""],
                ["billingLabelEn", "Billing label (English)", party?.billingMode.label.en ?? ""],
                ["billingLabelFr", "Billing label (French)", party?.billingMode.label.fr ?? ""],
                [
                  "billingRequiredMessage",
                  "Billing required message",
                  party?.billingMode.requiredMessage ?? "registration.form.type.required",
                ],
                [
                  "billingGroupEn",
                  "Group option (English)",
                  party?.billingMode.options.group?.en ?? "",
                ],
                [
                  "billingGroupFr",
                  "Group option (French)",
                  party?.billingMode.options.group?.fr ?? "",
                ],
                [
                  "billingPerRegistrantEn",
                  "Per-registrant option (English)",
                  party?.billingMode.options.perRegistrant?.en ?? "",
                ],
                [
                  "billingPerRegistrantFr",
                  "Per-registrant option (French)",
                  party?.billingMode.options.perRegistrant?.fr ?? "",
                ],
                ["payerLabelEn", "Payer heading (English)", party?.payer?.label.en ?? ""],
                ["payerLabelFr", "Payer heading (French)", party?.payer?.label.fr ?? ""],
                [
                  "payerNameEn",
                  "Payer name label (English)",
                  party?.payer?.nameField.label.en ?? "",
                ],
                [
                  "payerNameFr",
                  "Payer name label (French)",
                  party?.payer?.nameField.label.fr ?? "",
                ],
                [
                  "payerNameRequiredMessage",
                  "Payer name required message",
                  party?.payer?.nameField.requiredMessage ?? "registration.form.name.required",
                ],
                [
                  "payerEmailEn",
                  "Payer email label (English)",
                  party?.payer?.emailField.label.en ?? "",
                ],
                [
                  "payerEmailFr",
                  "Payer email label (French)",
                  party?.payer?.emailField.label.fr ?? "",
                ],
                [
                  "payerEmailRequiredMessage",
                  "Payer email required message",
                  party?.payer?.emailField.requiredMessage ?? "registration.form.email.required",
                ],
                [
                  "payerEmailInvalidMessage",
                  "Payer email invalid message",
                  party?.payer?.emailField.invalidMessage ?? "registration.form.email.error",
                ],
              ] as const
            ).map(([name, label, defaultValue]) => (
              <label key={name} className="space-y-1 text-sm">
                <span>{label}</span>
                <input className={control} name={name} defaultValue={defaultValue} />
              </label>
            ))}
            <button
              className="min-h-11 rounded bg-red-700 px-4 text-white sm:col-span-2"
              name="intent"
              value="setCommerce"
              disabled={publishing}
            >
              Publish commerce
            </button>
          </Form>
        </section>
      ) : null}
    </div>
  );
}
