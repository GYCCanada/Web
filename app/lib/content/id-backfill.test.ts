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
    for (const listKey of ['speakers', 'seminars', 'hotels']) {
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

/**
 * The shape of a `content/site.json` published BEFORE Branch 3.1 added the
 * (required) `hotels` field: every conference is missing the `hotels` key
 * entirely (and the sibling optional URL fields). Used to pin that the read
 * boundary repairs the absent required list rather than failing decode and
 * silently falling back to bundled defaults — discarding live CMS content.
 */
const pre31Shape = (encoded: JsonRecord): JsonRecord => {
  const doc = stripIds(encoded);
  for (const conference of (doc['conferences'] as JsonRecord[]) ?? []) {
    delete conference['hotels'];
    delete conference['registrationUrl'];
    delete conference['scheduleUrl'];
    delete conference['mapEmbedUrl'];
  }
  return doc;
};

/** Ids on the conference lists only (speakers + seminars + hotels). */
const conferenceIdsOf = (doc: unknown): string[] => {
  const out: string[] = [];
  const record = doc as JsonRecord;
  for (const conference of (record['conferences'] as JsonRecord[]) ?? []) {
    for (const listKey of ['speakers', 'seminars', 'hotels']) {
      for (const item of (conference[listKey] as JsonRecord[]) ?? []) {
        if (typeof item['id'] === 'string') out.push(item['id']);
      }
    }
  }
  return out;
};

/** Ids on the team list only. */
const teamIdsOf = (doc: unknown): string[] => {
  const out: string[] = [];
  for (const member of ((doc as JsonRecord)['team'] as JsonRecord[]) ?? []) {
    if (typeof member['id'] === 'string') out.push(member['id']);
  }
  return out;
};

const idsOf = (doc: unknown): string[] => [
  ...conferenceIdsOf(doc),
  ...teamIdsOf(doc),
];

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

  test('a pre-3.1 document (no `hotels` key) decodes after backfill', () => {
    const pre31 = pre31Shape(encodedDefaults());

    // Sanity: WITHOUT backfill the pre-3.1 document fails decode because
    // `hotels` is a required (Branch 3.1) field that the legacy shape lacks —
    // the very read-safety hazard that would otherwise discard live CMS content
    // and silently fall back to the bundled defaults.
    expect(decodes(pre31)).toBe(false);

    // WITH backfill every conference gains an empty `hotels: []` (plus ids), so
    // the live document decodes and the deploy keeps the CMS-authored content.
    const repaired = backfillListItemIds(pre31);
    expect(decodes(repaired)).toBe(true);
    for (const conference of (repaired as JsonRecord)[
      'conferences'
    ] as JsonRecord[]) {
      expect(Array.isArray(conference['hotels'])).toBe(true);
    }
  });

  test('a present-but-malformed `hotels` is left for the decoder to reject, not silently emptied', () => {
    // A pre-3.1 document is missing the `hotels` KEY (handled by the test above:
    // it normalizes to `[]`). This pins the *opposite* hazard: a conference
    // whose `hotels` key is PRESENT but the wrong shape (a string here; `null`
    // and `{}` are equivalent) must NOT be overwritten with `[]` — doing so
    // would silently discard authored content before strict decode. Backfill
    // leaves it untouched so the decoder is the one to reject it, exactly like
    // a malformed speakers/seminars/team list.
    for (const malformed of ['not a list', null, {}] as const) {
      const doc = stripIds(encodedDefaults());
      const firstConference = (doc['conferences'] as JsonRecord[])[0];
      if (firstConference) firstConference['hotels'] = malformed as never;

      const repaired = backfillListItemIds(doc) as JsonRecord;
      const repairedConference = (repaired['conferences'] as JsonRecord[])[0];

      // The malformed value survives verbatim — it was NOT replaced with `[]`.
      expect(repairedConference?.['hotels']).toEqual(malformed as never);
      // …and the decoder rejects the document rather than accepting an
      // emptied-out conference (the masking this guards against).
      expect(decodes(repaired)).toBe(false);
    }
  });

  test('assigns a fresh, distinct id to every id-less list item', () => {
    const idLess = stripIds(encodedDefaults());
    expect(idsOf(idLess)).toHaveLength(0);

    const repaired = backfillListItemIds(idLess);
    // 2024 has 2 speakers + 3 seminars + 5 hotels; team has 3 members = 13 ids.
    expect(idsOf(repaired)).toHaveLength(13);
    expect(new Set(idsOf(repaired)).size).toBe(13);
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
    expect(idsOf(encoded)).toHaveLength(13);

    // Strip only the team ids; the conference list ids must survive verbatim.
    const conferenceIds = conferenceIdsOf(encoded);
    expect(conferenceIds).toHaveLength(10); // 2 speakers + 3 seminars + 5 hotels
    const doc = clone(encoded);
    for (const member of doc['team'] as JsonRecord[]) {
      delete member['id'];
    }
    const repaired = backfillListItemIds(doc);

    // Every conference-list id (speakers, seminars, hotels) survives verbatim.
    expect(conferenceIdsOf(repaired)).toEqual(conferenceIds);
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

describe('backfillListItemIds — legacy board string[] migration', () => {
  test('a legacy board: string[] decodes after backfill to id-keyed objects', () => {
    const encoded = encodedDefaults();
    const legacy = clone(encoded);
    legacy['board'] = ['Alice Board', 'Bob Board'];

    expect(decodes(legacy)).toBe(false);

    const repaired = backfillListItemIds(legacy) as JsonRecord;
    const board = repaired['board'] as JsonRecord[];
    expect(board).toHaveLength(2);
    expect(board[0]?.['name']).toBe('Alice Board');
    expect(board[1]?.['name']).toBe('Bob Board');
    expect(typeof board[0]?.['id']).toBe('string');
    expect(typeof board[1]?.['id']).toBe('string');
    expect(decodes(repaired)).toBe(true);
  });

  test('an already-migrated board is idempotent', () => {
    const encoded = encodedDefaults();
    expect(backfillListItemIds(encoded)).toEqual(encoded);
  });
});
