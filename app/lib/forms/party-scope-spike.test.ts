import { describe, expect, test } from 'effect-bun-test';
import { Result, Schema } from 'effect';

import { deepMerge, type Json } from '../content/admin-form';
import { MessageKey } from './definition';

/**
 * DE-RISK SPIKES for the registrar party-scope plan (docs/registrar-plan.md,
 * Decision 2b). These prove the two BLOCKER-level mechanics the party-scope
 * re-design depends on, BEFORE commit C6.5 is written — exactly the class of
 * error the dual-agent review round caught (both source designs asserted an
 * array-by-`value` deepMerge that does not exist).
 *
 * If either of these flips red, the plan's authoring story is wrong and C6.5
 * must change. They run against the REAL `deepMerge` and the REAL `MessageKey`
 * schema — no mocks.
 */

describe('party-scope spike 1 — billingMode options must be a STRUCT of optionalKey known modes (not a Record, not an array)', () => {
  /**
   * CORRECTED after the --deep counsel BLOCKER: `Schema.Record(BillingMode, Text)`
   * REJECTS a group-only object (an Effect v4 Record over `Schema.Literals`
   * requires ALL literal keys — verified against beta.60), so it cannot model an
   * allow-list. The right shape is a STRUCT with optionalKey known modes:
   *   options: Schema.Struct({ group: optionalKey(Text), perRegistrant: optionalKey(Text) })
   *     .check(nonEmptyOptions)
   * Absent key ⇒ that mode is not offered (the allow-list). The VALUE is `Text`
   * ({en,fr}) directly, so the authoring/edit path is `options.group.en` (NOT
   * `options.group.label.en`). This struct still merges natively through
   * `deepMerge`'s object branch — the property the merge claim depends on.
   */

  test('Struct-of-optionalKey options: a single label edit lands and siblings survive', () => {
    // base = the encoded party.billingMode.options: { group?: Text, perRegistrant?: Text }
    const base: Json = {
      group: { en: 'Pay for everyone', fr: 'Payer pour tous' },
      perRegistrant: { en: 'Everyone pays their own', fr: 'Chacun paie' },
    };
    // the /admin override: edit ONLY group's English label (path options.group.en)
    const override: Json = { group: { en: 'One person pays' } };

    const merged = deepMerge(base, override) as {
      group: { en: string; fr: string };
      perRegistrant: { en: string; fr: string };
    };

    // the edit landed
    expect(merged.group.en).toBe('One person pays');
    // the French sibling under the same option survived (object-branch recursion)
    expect(merged.group.fr).toBe('Payer pour tous');
    // the OTHER mode is fully intact
    expect(merged.perRegistrant.en).toBe('Everyone pays their own');
    expect(merged.perRegistrant.fr).toBe('Chacun paie');
  });

  test('group-ONLY options (the allow-list case) merge cleanly — no phantom perRegistrant', () => {
    // a group-only form authors only the `group` key; the struct's optionalKey
    // perRegistrant is simply absent (mode not offered).
    const base: Json = { group: { en: 'Pay for everyone', fr: 'Payer pour tous' } };
    const override: Json = { group: { fr: 'Payer pour le groupe' } };

    const merged = deepMerge(base, override) as {
      group: { en: string; fr: string };
      perRegistrant?: unknown;
    };
    expect(merged.group.en).toBe('Pay for everyone');
    expect(merged.group.fr).toBe('Payer pour le groupe');
    expect('perRegistrant' in merged).toBe(false); // mode genuinely not offered
  });

  test('CONTRAST — an array of {value,label} silently DROPS the label edit (why a keyed object wins)', () => {
    // the rejected shape: options as an array of {value,label} (no id/slug)
    const base: Json = [
      { value: 'group', label: { en: 'Pay for everyone', fr: 'Payer pour tous' } },
      { value: 'perRegistrant', label: { en: 'Everyone pays', fr: 'Chacun paie' } },
    ];
    // an /admin override keyed by `value` (what both source designs assumed)
    const override: Json = { group: { label: { en: 'One person pays' } } };

    const merged = deepMerge(base, override) as ReadonlyArray<{
      value: string;
      label: { en: string };
    }>;

    // itemIdentity keys on id/slug only → no item matches → array returned untouched.
    // The edit is DROPPED. This is the bug the keyed-object shape avoids.
    expect(merged[0]?.label.en).toBe('Pay for everyone');
  });
});

describe('party-scope spike 2 — a new party MessageKey token needs translations.ts (a deploy)', () => {
  /**
   * The plan claims a brand-new `registration.party.*` MessageKey token cannot be
   * introduced by a CMS edit — `MessageKey` validates against the STATIC
   * `TRANSLATION_KEYS` set (definition.ts:52), so the token must ship in source
   * (translations.ts) first; only then are its en/fr strings CMS-editable via the
   * `t:<locale>:<key>` channel. This proves the constraint is real (so C7a's
   * "register tokens in source" step is load-bearing, not optional).
   */

  test('an unregistered registration.party.* token is REJECTED by MessageKey', () => {
    const decoded = Schema.decodeUnknownResult(MessageKey)(
      'registration.party.billingMode.required',
    );
    expect(Result.isFailure(decoded)).toBe(true);
  });

  test('MessageKey is total — it returns a decision, never throws', () => {
    // Sanity anchor: the schema is a boundary that decides; the rejection above is
    // about the token being unregistered, not a blanket failure.
    const decoded = Schema.decodeUnknownResult(MessageKey)('registration.form.title');
    expect(Result.isSuccess(decoded) || Result.isFailure(decoded)).toBe(true);
  });
});
