import { describe, expect, test } from 'effect-bun-test';
import { Result, Schema } from 'effect';

import { defaultContent } from './defaults';
import { backfillListItemIds } from './id-backfill';
import { SiteContent } from './schema';

/**
 * The read-path id-backfill is the production read-safety hinge of ADR 0006:
 * adding a *required* `id` to every list item would make every already-published
 * `content/site.json` (which has no ids) FAIL decode on read — breaking the live
 * site on the deploy. `backfillListItemIds` runs between parse and decode and
 * assigns a fresh `nanoid` to any id-less item, so the legacy document decodes.
 * These tests pin that property, its idempotence, and that it never mints over
 * an existing id.
 */

type JsonRecord = Record<string, unknown>;

/** The encoded (plain-JSON) form of the bundled defaults — a real test base. */
const encodedDefaults = (): JsonRecord =>
  Schema.encodeUnknownSync(SiteContent)(defaultContent) as JsonRecord;

const decodes = (value: unknown): boolean =>
  Result.isSuccess(Schema.decodeUnknownResult(SiteContent)(value));

/** A deep clone the test can mutate without disturbing the shared default. */
const clone = (value: JsonRecord): JsonRecord =>
  JSON.parse(JSON.stringify(value)) as JsonRecord;

/** Strip every list-item `id` — the shape a document published BEFORE ids had. */
const stripIds = (encoded: JsonRecord): JsonRecord => {
  const doc = clone(encoded);
  for (const conference of (doc['conferences'] as JsonRecord[]) ?? []) {
    for (const listKey of ['speakers', 'seminars']) {
      for (const item of (conference[listKey] as JsonRecord[]) ?? []) {
        delete item['id'];
      }
    }
  }
  for (const member of (doc['team'] as JsonRecord[]) ?? []) {
    delete member['id'];
  }
  return doc;
};

const idsOf = (doc: unknown): string[] => {
  const out: string[] = [];
  const record = doc as JsonRecord;
  for (const conference of (record['conferences'] as JsonRecord[]) ?? []) {
    for (const listKey of ['speakers', 'seminars']) {
      for (const item of (conference[listKey] as JsonRecord[]) ?? []) {
        if (typeof item['id'] === 'string') out.push(item['id']);
      }
    }
  }
  for (const member of (record['team'] as JsonRecord[]) ?? []) {
    if (typeof member['id'] === 'string') out.push(member['id']);
  }
  return out;
};

describe('backfillListItemIds — production read-safety (ADR 0006)', () => {
  test('an id-less document (the pre-migration shape) decodes after backfill', () => {
    const idLess = stripIds(encodedDefaults());

    // Sanity: WITHOUT backfill the legacy document fails decode — this is the
    // hazard the backfill exists to prevent.
    expect(decodes(idLess)).toBe(false);

    // WITH backfill it decodes — the deploy does not break the live site.
    const repaired = backfillListItemIds(idLess);
    expect(decodes(repaired)).toBe(true);
  });

  test('assigns a fresh, distinct id to every id-less list item', () => {
    const idLess = stripIds(encodedDefaults());
    expect(idsOf(idLess)).toHaveLength(0);

    const repaired = backfillListItemIds(idLess);
    // 2024 has 2 speakers + 3 seminars; team has 3 members = 8 ids.
    expect(idsOf(repaired)).toHaveLength(8);
    expect(new Set(idsOf(repaired)).size).toBe(8);
  });

  test('is idempotent — re-running leaves an already-id-complete document untouched', () => {
    const encoded = encodedDefaults();
    // The defaults already carry ids; backfill must change nothing.
    expect(backfillListItemIds(encoded)).toEqual(encoded);

    // And a freshly-backfilled document is a fixed point.
    const once = backfillListItemIds(stripIds(encoded));
    const twice = backfillListItemIds(once);
    expect(twice).toEqual(once);
  });

  test('never mints over an existing id (a partial document keeps its ids)', () => {
    const encoded = encodedDefaults();
    const allIds = idsOf(encoded);
    expect(allIds).toHaveLength(8);

    // Strip only the team ids; the conference list ids must survive verbatim.
    const doc = clone(encoded);
    for (const member of doc['team'] as JsonRecord[]) {
      delete member['id'];
    }
    const repaired = backfillListItemIds(doc);

    const conferenceIds = allIds.slice(0, 5); // 2 speakers + 3 seminars
    const survived = idsOf(repaired).filter((id) => conferenceIds.includes(id));
    expect(survived).toEqual(conferenceIds);
    // Team got fresh ids, so the whole document now decodes.
    expect(decodes(repaired)).toBe(true);
  });

  test('leaves a bad existing id for the decoder to reject (backfill is for absence, not repair)', () => {
    const doc = clone(encodedDefaults());
    const firstTeam = (doc['team'] as JsonRecord[])[0];
    if (firstTeam) firstTeam['id'] = 'not a valid id';

    const repaired = backfillListItemIds(doc);
    // The bad id is untouched (present → not backfilled)…
    expect((repaired as JsonRecord)['team']).toBeDefined();
    expect(((repaired as JsonRecord)['team'] as JsonRecord[])[0]?.['id']).toBe(
      'not a valid id',
    );
    // …and the decoder rejects it.
    expect(decodes(repaired)).toBe(false);
  });

  test('passes a non-object value through for the decoder to reject', () => {
    expect(backfillListItemIds(null)).toBe(null);
    expect(backfillListItemIds(42)).toBe(42);
    expect(backfillListItemIds('nope')).toBe('nope');
    expect(backfillListItemIds([1, 2, 3])).toEqual([1, 2, 3]);
  });
});
