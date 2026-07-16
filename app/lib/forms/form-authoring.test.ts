import { describe, expect, test } from 'bun:test';
import { Result } from 'effect';

import { defaultRegistrationForm } from './defaults';
import { applyCommand, localConferenceInstant } from './form-authoring';

describe('Form authoring commands', () => {
  test('adds a typed field without exposing FormDefinition JSON', () => {
    const result = applyCommand(defaultRegistrationForm, {
      _tag: 'setField',
      location: { area: 'common', groups: [] },
      field: {
        _tag: 'requiredText',
        name: 'emergencyContact',
        label: { en: 'Emergency contact', fr: "Contact d'urgence" },
        requiredMessage: 'registration.form.name.required',
      },
    });
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.fields.at(-1)).toMatchObject({
        _tag: 'requiredText',
        name: 'emergencyContact',
      });
    }
  });

  test('edits fields inside a variant and preserves its other branch', () => {
    const result = applyCommand(defaultRegistrationForm, {
      _tag: 'setField',
      location: { area: 'variant', variant: 'exhibitor', groups: [] },
      field: {
        _tag: 'url',
        name: 'portfolio',
        label: { en: 'Portfolio', fr: 'Portfolio' },
        requiredMessage: 'registration.form.website.required',
        invalidMessage: 'registration.form.website.required',
      },
    });
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(
        result.success.variant?.variants
          .find((variant) => variant.value === 'exhibitor')
          ?.fields.at(-1),
      ).toMatchObject({ name: 'portfolio' });
      expect(
        result.success.variant?.variants.find(
          (variant) => variant.value === 'attendee',
        )?.fields.length,
      ).toBeGreaterThan(0);
    }
  });

  test('normalizes Conference-local authoring instants to exact UTC', () => {
    expect(
      localConferenceInstant('2026-08-01T00:00', 'America/Toronto'),
    ).toEqual(Result.succeed('2026-08-01T04:00:00.000Z'));
  });

  test('publishes structured commerce with local timing windows', () => {
    const text = (value: string) => ({ en: value, fr: value });
    const party = {
      billingLabel: text('Payment'),
      requiredMessage: 'registration.form.type.required',
      perRegistrant: text('Each registrant pays'),
    };
    const result = applyCommand(defaultRegistrationForm, {
      _tag: 'setCommerce',
      commerce: {
        timeZone: 'America/Toronto',
        base: 5000,
        registrationClosesAtLocal: '2026-08-10T00:00',
        pricingRules: [],
        windows: [
          {
            id: 'earlywindow1234567890',
            startsAtLocal: '2026-07-01T00:00',
            endsAtLocal: '2026-08-01T00:00',
            delta: -1000,
          },
        ],
        party,
      },
    });
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.pricing?.registrationClosesAt).toBeDefined();
      expect(Number(result.success.pricing?.windows?.[0]?.delta)).toBe(-1000);
    }
  });
});
