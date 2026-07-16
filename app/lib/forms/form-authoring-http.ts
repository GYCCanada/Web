import { nanoid } from "nanoid";
import { Result, Schema } from "effect";

import {
  type Command,
  type CommerceDraft,
  type FieldDraft,
  type FieldLocation,
  type OptionDraft,
  type PricingRuleDraft,
  type RuleDraft,
} from "./form-authoring";
import type { FormId } from "./definition";

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
const decodeFieldTag = Schema.decodeUnknownResult(Schema.Literals(FIELD_TAGS));
const decodeArea = Schema.decodeUnknownResult(Schema.Literals(["common", "variant"]));

const value = (data: FormData, name: string): string => String(data.get(name) ?? "").trim();
const checked = (data: FormData, name: string): boolean => data.get(name) === "on";
const lines = (input: string): ReadonlyArray<string> =>
  input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
const commaValues = (input: string): ReadonlyArray<string> =>
  input
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");

const integer = (
  input: string,
  label: string,
  optional = false,
): Result.Result<number | undefined, ReadonlyArray<string>> => {
  if (optional && input === "") return Result.succeed(undefined);
  const parsed = Number(input);
  return Number.isInteger(parsed)
    ? Result.succeed(parsed)
    : Result.fail([`${label} must be an integer.`]);
};

const options = (
  input: string,
): Result.Result<ReadonlyArray<OptionDraft>, ReadonlyArray<string>> => {
  const parsed: OptionDraft[] = [];
  const issues: string[] = [];
  for (const [index, line] of lines(input).entries()) {
    const [optionValue, en, fr, ...extra] = line.split("|").map((part) => part.trim());
    if (!optionValue || !en || !fr || extra.length > 0) {
      issues.push(`Option line ${index + 1} must be value|English|French.`);
    } else {
      parsed.push({ value: optionValue, en, fr });
    }
  }
  return issues.length > 0 ? Result.fail(issues) : Result.succeed(parsed);
};

const location = (data: FormData): Result.Result<FieldLocation, ReadonlyArray<string>> => {
  const area = decodeArea(data.get("area"));
  if (Result.isFailure(area)) return Result.fail(["Field area is invalid."]);
  const groups = value(data, "groups")
    .split(">")
    .filter((group) => group !== "");
  const variant = value(data, "variant");
  return area.success === "variant" && variant === ""
    ? Result.fail(["A variant branch is required."])
    : Result.succeed({
        area: area.success,
        ...(area.success === "variant" ? { variant } : {}),
        groups,
      });
};

const fieldDraft = (data: FormData): Result.Result<FieldDraft, ReadonlyArray<string>> => {
  const tag = decodeFieldTag(data.get("fieldTag"));
  const parsedOptions = options(value(data, "options"));
  const min = integer(value(data, "min"), "Minimum", true);
  const max = integer(value(data, "max"), "Maximum", true);
  if (Result.isFailure(tag)) return Result.fail(["Field kind is invalid."]);
  if (Result.isFailure(parsedOptions)) return Result.fail(parsedOptions.failure);
  if (Result.isFailure(min)) return Result.fail(min.failure);
  if (Result.isFailure(max)) return Result.fail(max.failure);
  return Result.succeed({
    _tag: tag.success,
    name: value(data, "name"),
    label: { en: value(data, "labelEn"), fr: value(data, "labelFr") },
    placeholder: {
      en: value(data, "placeholderEn"),
      fr: value(data, "placeholderFr"),
    },
    ...(checked(data, "optional") ? { optional: true } : {}),
    ...(checked(data, "multiline") ? { multiline: true } : {}),
    ...(checked(data, "requirePresent") ? { requirePresent: true } : {}),
    ...(min.success === undefined ? {} : { min: min.success }),
    ...(max.success === undefined ? {} : { max: max.success }),
    requiredMessage: value(data, "requiredMessage"),
    invalidMessage: value(data, "invalidMessage"),
    presenceAnchor: value(data, "presenceAnchor"),
    options: parsedOptions.success,
  });
};

const rules = (input: string): Result.Result<ReadonlyArray<RuleDraft>, ReadonlyArray<string>> => {
  const parsed: RuleDraft[] = [];
  const issues: string[] = [];
  for (const [index, line] of lines(input).entries()) {
    const parts = line.split("|").map((part) => part.trim());
    if (parts[0] === "required" && parts.length === 5) {
      parsed.push({
        _tag: "requiredWhenEquals",
        when: parts[1] ?? "",
        values: commaValues(parts[2] ?? ""),
        target: parts[3] ?? "",
        message: parts[4] ?? "",
      });
    } else if (
      parts[0] === "active" &&
      parts.length === 5 &&
      (parts[1] === "literalEquals" ||
        parts[1] === "arrayIncludesAny" ||
        parts[1] === "checkboxChecked")
    ) {
      parsed.push({
        _tag: "activeWhenEquals",
        predicate: parts[1],
        when: parts[2] ?? "",
        values: commaValues(parts[3] ?? ""),
        target: parts[4] ?? "",
      });
    } else {
      issues.push(`Rule line ${index + 1} must match a documented structured rule format.`);
    }
  }
  return issues.length > 0 ? Result.fail(issues) : Result.succeed(parsed);
};

const pricingRules = (
  input: string,
): Result.Result<ReadonlyArray<PricingRuleDraft>, ReadonlyArray<string>> => {
  const parsed: PricingRuleDraft[] = [];
  const issues: string[] = [];
  for (const [index, line] of lines(input).entries()) {
    const parts = line.split("|").map((part) => part.trim());
    if ((parts[0] === "choice" || parts[0] === "multiChoice") && parts.length === 3) {
      const prices = commaValues(parts[2] ?? "").map((price) => {
        const separator = price.lastIndexOf(":");
        return {
          option: separator < 0 ? "" : price.slice(0, separator).trim(),
          amount: separator < 0 ? Number.NaN : Number(price.slice(separator + 1)),
        };
      });
      if (prices.some((price) => price.option === "" || !Number.isInteger(price.amount))) {
        issues.push(`Pricing line ${index + 1} has an invalid option:amount list.`);
      } else {
        parsed.push({ _tag: parts[0], field: parts[1] ?? "", prices });
      }
    } else if (parts[0] === "toggle" && parts.length === 3) {
      const amount = Number(parts[2]);
      if (!Number.isInteger(amount))
        issues.push(`Pricing line ${index + 1} amount must be an integer.`);
      else parsed.push({ _tag: "toggle", field: parts[1] ?? "", amount });
    } else if (parts[0] === "quantity" && (parts.length === 3 || parts.length === 4)) {
      const unit = Number(parts[2]);
      const max = parts[3] === undefined || parts[3] === "" ? undefined : Number(parts[3]);
      if (!Number.isInteger(unit) || (max !== undefined && !Number.isInteger(max))) {
        issues.push(`Pricing line ${index + 1} unit and max must be integers.`);
      } else {
        parsed.push({
          _tag: "quantity",
          field: parts[1] ?? "",
          unit,
          ...(max === undefined ? {} : { max }),
        });
      }
    } else {
      issues.push(`Pricing line ${index + 1} must match a documented structured pricing format.`);
    }
  }
  return issues.length > 0 ? Result.fail(issues) : Result.succeed(parsed);
};

const commerce = (data: FormData): Result.Result<CommerceDraft, ReadonlyArray<string>> => {
  const base = integer(value(data, "baseCents"), "Base price");
  const parsedRules = pricingRules(value(data, "pricingRules"));
  const parsedWindows: Array<CommerceDraft["windows"][number]> = [];
  const issues: string[] = [];
  for (const [index, line] of lines(value(data, "windows")).entries()) {
    const [id, startsAtLocal, endsAtLocal, deltaText, ...extra] = line
      .split("|")
      .map((part) => part.trim());
    const delta = Number(deltaText);
    if (!startsAtLocal || !endsAtLocal || !Number.isInteger(delta) || extra.length > 0) {
      issues.push(`Window line ${index + 1} must be id|start local|end local|delta.`);
    } else {
      parsedWindows.push({
        id: id || nanoid(),
        startsAtLocal,
        endsAtLocal,
        delta,
      });
    }
  }
  if (Result.isFailure(base)) issues.push(...base.failure);
  if (Result.isFailure(parsedRules)) issues.push(...parsedRules.failure);
  if (issues.length > 0) return Result.fail(issues);
  if (Result.isFailure(base) || Result.isFailure(parsedRules)) {
    return Result.fail(["Commerce values are invalid."]);
  }
  const group = checked(data, "billingGroup");
  const perRegistrant = checked(data, "billingPerRegistrant");
  if (!group && !perRegistrant) return Result.fail(["Enable at least one billing mode."]);
  return Result.succeed({
    timeZone: value(data, "timeZone"),
    base: base.success ?? 0,
    registrationClosesAtLocal: value(data, "registrationClosesAtLocal"),
    pricingRules: parsedRules.success,
    windows: parsedWindows,
    party: {
      intro: { en: value(data, "partyIntroEn"), fr: value(data, "partyIntroFr") },
      billingLabel: { en: value(data, "billingLabelEn"), fr: value(data, "billingLabelFr") },
      requiredMessage: value(data, "billingRequiredMessage"),
      ...(group
        ? { group: { en: value(data, "billingGroupEn"), fr: value(data, "billingGroupFr") } }
        : {}),
      ...(perRegistrant
        ? {
            perRegistrant: {
              en: value(data, "billingPerRegistrantEn"),
              fr: value(data, "billingPerRegistrantFr"),
            },
          }
        : {}),
      ...(group
        ? {
            payer: {
              label: { en: value(data, "payerLabelEn"), fr: value(data, "payerLabelFr") },
              nameLabel: { en: value(data, "payerNameEn"), fr: value(data, "payerNameFr") },
              nameRequiredMessage: value(data, "payerNameRequiredMessage"),
              emailLabel: { en: value(data, "payerEmailEn"), fr: value(data, "payerEmailFr") },
              emailRequiredMessage: value(data, "payerEmailRequiredMessage"),
              emailInvalidMessage: value(data, "payerEmailInvalidMessage"),
            },
          }
        : {}),
    },
  });
};

export const parseAuthoringCommand = (data: FormData, form: FormId): Result.Result<Command, ReadonlyArray<string>> => {
  const intent = data.get("intent");
  switch (intent) {
    case "setCopy":
      return Result.succeed({
        _tag: "setCopy",
        title: { en: value(data, "titleEn"), fr: value(data, "titleFr") },
        intro: { en: value(data, "introEn"), fr: value(data, "introFr") },
      });
    case "setField": {
      const parsedLocation = location(data);
      const field = fieldDraft(data);
      const parsedIndex = integer(value(data, "index"), "Field index", true);
      if (Result.isFailure(parsedLocation)) return Result.fail(parsedLocation.failure);
      if (Result.isFailure(field)) return Result.fail(field.failure);
      if (Result.isFailure(parsedIndex)) return Result.fail(parsedIndex.failure);
      return Result.succeed({
        _tag: "setField",
        location: parsedLocation.success,
        ...(parsedIndex.success === undefined ? {} : { index: parsedIndex.success }),
        field: field.success,
      });
    }
    case "removeField":
    case "moveField": {
      const parsedLocation = location(data);
      const parsedIndex = integer(value(data, "index"), "Field index");
      if (Result.isFailure(parsedLocation)) return Result.fail(parsedLocation.failure);
      if (Result.isFailure(parsedIndex) || parsedIndex.success === undefined) {
        return Result.fail(
          Result.isFailure(parsedIndex) ? parsedIndex.failure : ["Field index is required."],
        );
      }
      return intent === "removeField"
        ? Result.succeed({
            _tag: intent,
            location: parsedLocation.success,
            index: parsedIndex.success,
          })
        : Result.succeed({
            _tag: intent,
            location: parsedLocation.success,
            index: parsedIndex.success,
            direction: value(data, "direction") === "-1" ? -1 : 1,
          });
    }
    case "setVariant": {
      const parsed = options(value(data, "variantOptions"));
      return Result.isFailure(parsed)
        ? Result.fail(parsed.failure)
        : Result.succeed({
            _tag: intent,
            discriminator: value(data, "discriminator"),
            requiredMessage: value(data, "variantRequiredMessage"),
            options: parsed.success,
          });
    }
    case "removeVariant":
      return Result.succeed({ _tag: intent });
    case "setRules": {
      const parsed = rules(value(data, "rules"));
      return Result.isFailure(parsed)
        ? Result.fail(parsed.failure)
        : Result.succeed({ _tag: intent, rules: parsed.success });
    }
    case "setCommerce": {
      if (form !== "registration")
        return Result.fail(["Commerce is only available for Registration."]);
      const parsed = commerce(data);
      return Result.isFailure(parsed)
        ? Result.fail(parsed.failure)
        : Result.succeed({ _tag: intent, commerce: parsed.success });
    }
    default:
      return Result.fail(["Unknown Form authoring action."]);
  }
};
