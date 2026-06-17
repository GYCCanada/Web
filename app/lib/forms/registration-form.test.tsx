import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { createRoutesStub } from 'react-router';

import { defaultRegistrationForm } from '~/lib/content/pages/defaults';
import { LocalizationProvider } from '~/lib/localization/provider';
import { root } from '~/lib/localization/translations';
import {
  makeDefaultRegistrant,
  RegistrationForm,
} from '~/routes/($lang)+/registration-form';

/**
 * Registration render-level field-name + default-value parity (registration-launch
 * Branch 6, plan §"Riskiest commit" point (c)).
 *
 * What pinned the riskiest migration behaviour-preserving was the old-vs-new
 * EQUIVALENCE HARNESS (decoded-output + emitted-`TranslationKey` parity vs the
 * hand-tuned `registration-schema.oracle.ts`). That harness served its purpose once
 * green and was RETIRED with the oracle in 6.6 (ADR 0007: "the oracle is removed
 * once registration is fully migrated") — the engine's decode behaviour is now
 * covered directly by `decode.test.ts` / `definition.test.ts`.
 *
 * These render-parity tests OUTLIVE the oracle: they assert the LIVE
 * `<RegistrationForm>` (the bespoke `{ registrants: [...] }` shell, NOT the generic
 * `FormFields` renderer that `render.test.tsx` covers) emits submit-`name=`s that
 * match `defaultRegistrationForm`'s field graph exactly, and that the form's REAL
 * `makeDefaultRegistrant` seeds a key for every rendered field name
 * (`derive-dont-sync`). This is the only path registration exercises in prod
 * (settled #9: RegFox is the live channel; the on-site form's client validate +
 * render is what runs), so a control with the wrong `name` or no `name` — the class
 * of bug the pre-existing `cameraOperator`/`photographer` mix-up was — is what these
 * guard. See `docs/forms/registration-spec.md`.
 */

type GroupishField = {
  readonly _tag: string;
  readonly name: string;
  readonly optional?: boolean;
  readonly fields?: ReadonlyArray<unknown>;
};

/**
 * Collect every field name a list declares, by group path.
 *
 * `descendOptional` chooses how `optional: true` groups (the minors-only
 * `parent`, the opt-in `volunteer`) are treated:
 *   - `false` (RENDER view): an optional group is NOT descended into — the live
 *     form renders its inner controls only when the group is shown, so at the
 *     top-level render only the group NAME could appear. A non-optional group
 *     (`extra`, always rendered for an attendee) IS descended so each inner
 *     control's submit-name is pinned.
 *   - `true` (DEFAULT-VALUE view): every group is descended, including the optional
 *     ones — the form's `makeDefaultRegistrant` seeds a key for EVERY field name
 *     (including `volunteer.cameraOperator`, `volunteer.photographer`), so the
 *     default object must carry each. This is the `derive-dont-sync` check: the
 *     conform `name={volunteer.cameraOperator.name}` accessors the form renders are
 *     keyed off this default, so a default that omits a name (or a name the default
 *     omits) is the drift this test forbids.
 */
const collectNames = (
  fields: ReadonlyArray<GroupishField>,
  descendOptional: boolean,
  prefix = '',
): string[] =>
  fields.flatMap((field) =>
    field._tag === 'nestedGroup' &&
    field.fields &&
    (descendOptional || field.optional !== true)
      ? collectNames(
          field.fields as ReadonlyArray<GroupishField>,
          descendOptional,
          `${prefix}${field.name}.`,
        )
      : [`${prefix}${field.name}`],
  );

/**
 * Render the live `<RegistrationForm>` to an HTML string (the real render path —
 * `react-router`'s `Form` + conform `useForm` + the bespoke shell), and return the
 * de-duplicated set of `name="…"` submit-attributes it emits.
 *
 * SSR renders the discriminator + common fields + the EXHIBITOR branch (the
 * server snapshot of `useFormData`'s live `type` read is empty, so the
 * `type === 'attendee' ? … : …` shell takes the exhibitor branch). This is the
 * slice of the render path a one-shot SSR can exercise; it pins that the rendered
 * exhibitor submit-names match the definition graph with NO missing and NO extra
 * name — exactly the class of bug a hand-copied default could not catch (a control
 * with the wrong `name`, or a control with no `name` at all).
 */
const renderedNames = (): Set<string> => {
  const Stub = createRoutesStub([
    {
      id: 'root',
      path: ':lang?',
      Component: () => (
        <LocalizationProvider translation={root.en}>
          <RegistrationForm year={2026} />
        </LocalizationProvider>
      ),
    },
  ]);
  const html = renderToString(
    <Stub initialEntries={['/']} hydrationData={{ loaderData: { root: {} } }} />,
  );
  return new Set(
    [...html.matchAll(/name="([^"]+)"/g)].map((match) => match[1] ?? ''),
  );
};

describe('registration render-level field-name + default-value parity', () => {
  // RENDER parity: the LIVE form is rendered and its emitted submit-names are
  // asserted against the definition's graph — not an inlined hand-copied object.
  // This is the only path registration exercises in prod (settled #9), so the
  // rendered names ARE the validated graph or the form silently drops/mis-keys a
  // field (as the pre-existing `photographer`/`cameraOperator` mix-up did — a
  // control with the wrong name + a control with no name, invisible to a
  // default-keys-only check).
  test('the rendered exhibitor branch submit-names match the definition exactly', () => {
    const names = renderedNames();
    const exhibitorBranch = defaultRegistrationForm.variant?.variants.find(
      (v) => v.value === 'exhibitor',
    );
    // The names SSR emits for one registrant: the array field itself, the
    // discriminator, the common fields, and the exhibitor branch fields — each
    // prefixed `registrants[0].` by conform.
    const expected = new Set([
      'registrants[0]',
      `registrants[0].${defaultRegistrationForm.variant?.discriminator}`,
      ...collectNames(defaultRegistrationForm.fields, false).map(
        (name) => `registrants[0].${name}`,
      ),
      ...collectNames(exhibitorBranch?.fields ?? [], false).map(
        (name) => `registrants[0].${name}`,
      ),
    ]);
    expect([...names].sort()).toEqual([...expected].sort());
  });

  // DEFAULT-VALUE parity, derived (`derive-dont-sync`): the form's REAL
  // `makeDefaultRegistrant` (imported, not a copy) must carry a key for every
  // definition field name the form renders a `name=` for. The form keys its
  // `name={volunteer.X.name}` / `name={fields.X.name}` accessors off this default,
  // so a missing key here is a missing/orphaned rendered name there.
  //
  // An `optional: true` group the default leaves ABSENT (`parent: undefined` — the
  // minors-only group, materialized only once a minor is shown) is legitimately not
  // descended: its inner controls don't render until the group is present. A
  // `volunteer` group the default DOES materialize MUST carry every inner name —
  // asserted by `volunteerNamesSeeded` below; here we require presence for every
  // name down to the first absent optional-group boundary.
  test('every rendered attendee field name resolves to a default-value key', () => {
    const defaultRegistrant = makeDefaultRegistrant() as Record<string, unknown>;
    const attendeeBranch = defaultRegistrationForm.variant?.variants.find(
      (v) => v.value === 'attendee',
    );
    expect(attendeeBranch).toBeDefined();
    const names = collectNames(
      [...defaultRegistrationForm.fields, ...(attendeeBranch?.fields ?? [])],
      true,
    );
    for (const name of names) {
      const segments = name.split('.');
      let cursor: unknown = defaultRegistrant;
      for (const segment of segments) {
        // An absent optional group (default `undefined`) stops the descent — its
        // inner names need no default key until the group materializes.
        if (cursor === undefined) break;
        expect({
          name,
          present:
            cursor !== null &&
            typeof cursor === 'object' &&
            segment in (cursor as Record<string, unknown>),
        }).toEqual({ name, present: true });
        cursor = (cursor as Record<string, unknown>)[segment];
      }
    }
  });

  // The `volunteer` group the default materializes MUST seed every inner name the
  // definition declares — the specific regression the pre-existing
  // `cameraOperator`/`photographer` render bug exposed (a definition name with no
  // matching rendered `name=`). Derived from the definition, no hand-copied list.
  test('volunteerNamesSeeded: every volunteer definition name is a default key', () => {
    const defaultRegistrant = makeDefaultRegistrant() as Record<string, unknown>;
    const volunteerGroup = defaultRegistrationForm.variant?.variants
      .find((v) => v.value === 'attendee')
      ?.fields.find(
        (f) => f._tag === 'nestedGroup' && f.name === ('volunteer' as never),
      );
    expect(volunteerGroup?._tag).toBe('nestedGroup');
    const innerFields =
      volunteerGroup?._tag === 'nestedGroup' ? volunteerGroup.fields : [];
    const seeded = defaultRegistrant['volunteer'] as Record<string, unknown>;
    for (const inner of innerFields) {
      expect({ name: inner.name, seeded: inner.name in seeded }).toEqual({
        name: inner.name,
        seeded: true,
      });
    }
  });

  // The default carries NO key the definition doesn't declare — a stale key in the
  // default (a removed field) would render an orphan name. Pin the symmetry.
  test('the default registrant declares no key absent from the definition graph', () => {
    const defaultRegistrant = makeDefaultRegistrant() as Record<string, unknown>;
    const attendeeBranch = defaultRegistrationForm.variant?.variants.find(
      (v) => v.value === 'attendee',
    );
    const graphNames = new Set(
      collectNames(
        [...defaultRegistrationForm.fields, ...(attendeeBranch?.fields ?? [])],
        true,
      ),
    );
    const collectDefaultLeaves = (
      object: Record<string, unknown>,
      prefix = '',
    ): string[] =>
      Object.entries(object).flatMap(([key, value]) =>
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value)
          ? collectDefaultLeaves(value as Record<string, unknown>, `${prefix}${key}.`)
          : [`${prefix}${key}`],
      );
    // `parent` defaults to `undefined` (a leaf in the default), but the definition
    // descends it into `parent.name`/`…email`/`…phone`; so a default leaf is "known"
    // if it is a definition name OR a PREFIX of one (an un-materialized optional
    // group). Any default leaf that is neither is an orphan the form would render
    // with no validated counterpart.
    const isKnown = (leaf: string) =>
      graphNames.has(leaf) ||
      [...graphNames].some((name) => name.startsWith(`${leaf}.`));
    for (const leaf of collectDefaultLeaves(defaultRegistrant)) {
      expect({ leaf, known: isKnown(leaf) }).toEqual({ leaf, known: true });
    }
  });

  test('the exhibitor branch names are exactly synopsis/website/company', () => {
    const exhibitorBranch = defaultRegistrationForm.variant?.variants.find(
      (v) => v.value === 'exhibitor',
    );
    expect(collectNames(exhibitorBranch?.fields ?? [], false).sort()).toEqual(
      ['company', 'synopsis', 'website'].sort(),
    );
  });
});
