import { describe, expect, test } from "bun:test";
import { Result } from "effect";

import { parseAuthoringCommand } from "./form-authoring-http";

const data = (values: Record<string, string>): FormData => {
  const form = new FormData();
  for (const [name, value] of Object.entries(values)) form.set(name, value);
  return form;
};

describe("Form authoring HTTP commands", () => {
  test("parses a structured field at a nested variant location", () => {
    const parsed = parseAuthoringCommand(
      data({
        intent: "setField",
        area: "variant",
        variant: "exhibitor",
        groups: "company",
        index: "2",
        fieldTag: "literal",
        name: "boothSize",
        labelEn: "Booth size",
        labelFr: "Taille du kiosque",
        requiredMessage: "registration.form.type.required",
        options: "small|Small|Petit\nlarge|Large|Grand",
      }),
      "registration",
    );

    expect(parsed).toEqual(
      Result.succeed({
        _tag: "setField",
        location: { area: "variant", variant: "exhibitor", groups: ["company"] },
        index: 2,
        field: {
          _tag: "literal",
          name: "boothSize",
          label: { en: "Booth size", fr: "Taille du kiosque" },
          placeholder: { en: "", fr: "" },
          requiredMessage: "registration.form.type.required",
          invalidMessage: "",
          presenceAnchor: "",
          options: [
            { value: "small", en: "Small", fr: "Petit" },
            { value: "large", en: "Large", fr: "Grand" },
          ],
        },
      }),
    );
  });

  test("parses structured required and activation rules", () => {
    const parsed = parseAuthoringCommand(
      data({
        intent: "setRules",
        rules:
          "required|method|email,both|email|contact.email.required\nactive|checkboxChecked|volunteer||volunteerDetails",
      }),
      "contact",
    );

    expect(parsed).toEqual(
      Result.succeed({
        _tag: "setRules",
        rules: [
          {
            _tag: "requiredWhenEquals",
            when: "method",
            values: ["email", "both"],
            target: "email",
            message: "contact.email.required",
          },
          {
            _tag: "activeWhenEquals",
            predicate: "checkboxChecked",
            when: "volunteer",
            values: [],
            target: "volunteerDetails",
          },
        ],
      }),
    );
  });

  test("parses structured commerce and Conference-local windows", () => {
    const parsed = parseAuthoringCommand(
      data({
        intent: "setCommerce",
        timeZone: "America/Toronto",
        baseCents: "5000",
        registrationClosesAtLocal: "2026-08-10T00:00",
        pricingRules: "choice|type|attendee:0,exhibitor:2500\nquantity|guests|1000|4",
        windows: "earlywindow1234567890|2026-07-01T00:00|2026-08-01T00:00|-1000",
        billingPerRegistrant: "on",
        billingLabelEn: "Payment",
        billingLabelFr: "Paiement",
        billingRequiredMessage: "registration.form.type.required",
        billingPerRegistrantEn: "Each registrant pays",
        billingPerRegistrantFr: "Chaque participant paie",
      }),
      "registration",
    );

    expect(Result.isSuccess(parsed)).toBe(true);
    if (Result.isSuccess(parsed) && parsed.success._tag === "setCommerce") {
      expect(parsed.success.commerce).toMatchObject({
        timeZone: "America/Toronto",
        base: 5000,
        registrationClosesAtLocal: "2026-08-10T00:00",
        windows: [
          {
            id: "earlywindow1234567890",
            startsAtLocal: "2026-07-01T00:00",
            endsAtLocal: "2026-08-01T00:00",
            delta: -1000,
          },
        ],
      });
      expect(parsed.success.commerce.pricingRules).toHaveLength(2);
    }
  });

  test("reports malformed structured rows with their line number", () => {
    const malformedOption = parseAuthoringCommand(
      data({
        intent: "setVariant",
        discriminator: "type",
        variantRequiredMessage: "registration.form.type.required",
        variantOptions: "attendee|Attendee",
      }),
      "registration",
    );
    const malformedWindow = parseAuthoringCommand(
      data({
        intent: "setCommerce",
        timeZone: "America/Toronto",
        baseCents: "5000",
        registrationClosesAtLocal: "2026-08-10T00:00",
        windows: "early|not-enough-columns",
        billingPerRegistrant: "on",
      }),
      "registration",
    );

    expect(Result.isFailure(malformedOption) ? malformedOption.failure : []).toContain(
      "Option line 1 must be value|English|French.",
    );
    expect(Result.isFailure(malformedWindow) ? malformedWindow.failure : []).toContain(
      "Window line 1 must be id|start local|end local|delta.",
    );
  });
});
