import { describe, expect, test } from 'effect-bun-test';
import { Result, Schema } from 'effect';

import { defaultContent } from './defaults';
import { backfillListItemIds } from './id-backfill';
import { SiteContent } from './schema';

type JsonRecord = Record<string, unknown>;

const encodedDefaults = (): JsonRecord =>
  Schema.encodeUnknownSync(SiteContent)(defaultContent) as JsonRecord;

const decodes = (value: unknown): boolean =>
  Result.isSuccess(Schema.decodeUnknownResult(SiteContent)(value));

const clone = (value: JsonRecord): JsonRecord =>
  JSON.parse(JSON.stringify(value)) as JsonRecord;

const stripIds = (encoded: JsonRecord): JsonRecord => {
  const doc = clone(encoded);
  for (const conference of (doc['conferences'] as JsonRecord[]) ?? []) {
    for (const listKey of ['speakers', 'seminars']) {
      for (const item of (conference[listKey] as JsonRecord[]) ?? []) {
        delete item['id'];
      }
    }
    const accommodations = conference['accommodations'] as JsonRecord | undefined;
    for (const item of (accommodations?.['hotels'] as JsonRecord[]) ?? []) {
      delete item['id'];
    }
  }
  for (const member of (doc['team'] as JsonRecord[]) ?? []) {
    delete member['id'];
  }
  return doc;
};

const preSectionShape = (encoded: JsonRecord): JsonRecord => {
  const doc = stripIds(encoded);
  for (const conference of (doc['conferences'] as JsonRecord[]) ?? []) {
    delete conference['travel'];
    delete conference['parking'];
    delete conference['accommodations'];
    delete conference['meals'];
    delete conference['registrationCopy'];
    delete conference['faqCopy'];
    delete conference['learnMoreEnabled'];
  }
  return doc;
};

const conferenceIdsOf = (doc: unknown): string[] => {
  const out: string[] = [];
  const record = doc as JsonRecord;
  for (const conference of (record['conferences'] as JsonRecord[]) ?? []) {
    for (const listKey of ['speakers', 'seminars']) {
      for (const item of (conference[listKey] as JsonRecord[]) ?? []) {
        if (typeof item['id'] === 'string') out.push(item['id']);
      }
    }
    const accommodations = conference['accommodations'] as JsonRecord | undefined;
    for (const item of (accommodations?.['hotels'] as JsonRecord[]) ?? []) {
      if (typeof item['id'] === 'string') out.push(item['id']);
    }
  }
  return out;
};

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
    expect(decodes(idLess)).toBe(false);
    const repaired = backfillListItemIds(idLess);
    expect(decodes(repaired)).toBe(true);
  });

  test('a pre-section document (no section keys) decodes after backfill', () => {
    const legacy = preSectionShape(encodedDefaults());
    expect(decodes(legacy)).toBe(false);
    const repaired = backfillListItemIds(legacy);
    expect(decodes(repaired)).toBe(true);
    for (const conference of (repaired as JsonRecord)[
      'conferences'
    ] as JsonRecord[]) {
      expect(conference['travel']).toBeDefined();
      expect(conference['accommodations']).toBeDefined();
    }
  });

  test('a present-but-malformed accommodations.hotels is left for the decoder to reject', () => {
    for (const malformed of ['not a list', null, {}] as const) {
      const doc = stripIds(encodedDefaults());
      const firstConference = (doc['conferences'] as JsonRecord[])[0];
      const accommodations = (firstConference?.['accommodations'] ??
        {}) as JsonRecord;
      accommodations['hotels'] = malformed as never;
      if (firstConference) firstConference['accommodations'] = accommodations;

      const repaired = backfillListItemIds(doc) as JsonRecord;
      const repairedConference = (repaired['conferences'] as JsonRecord[])[0];
      const repairedAccommodations = repairedConference?.[
        'accommodations'
      ] as JsonRecord;
      expect(repairedAccommodations?.['hotels']).toEqual(malformed as never);
      expect(decodes(repaired)).toBe(false);
    }
  });

  test('assigns a fresh, distinct id to every id-less list item', () => {
    const idLess = stripIds(encodedDefaults());
    expect(idsOf(idLess)).toHaveLength(0);
    const repaired = backfillListItemIds(idLess);
    expect(idsOf(repaired)).toHaveLength(13);
    expect(new Set(idsOf(repaired)).size).toBe(13);
  });

  test('is idempotent — re-running leaves an already-id-complete document untouched', () => {
    const encoded = encodedDefaults();
    expect(backfillListItemIds(encoded)).toEqual(encoded);
    const once = backfillListItemIds(stripIds(encoded));
    const twice = backfillListItemIds(once);
    expect(twice).toEqual(once);
  });

  test('never mints over an existing id (a partial document keeps its ids)', () => {
    const encoded = encodedDefaults();
    expect(idsOf(encoded)).toHaveLength(13);
    const conferenceIds = conferenceIdsOf(encoded);
    expect(conferenceIds).toHaveLength(10);
    const doc = clone(encoded);
    for (const member of doc['team'] as JsonRecord[]) {
      delete member['id'];
    }
    const repaired = backfillListItemIds(doc);
    expect(conferenceIdsOf(repaired)).toEqual(conferenceIds);
    expect(decodes(repaired)).toBe(true);
  });

  test('leaves a bad existing id for the decoder to reject (backfill is for absence, not repair)', () => {
    const doc = clone(encodedDefaults());
    const firstTeam = (doc['team'] as JsonRecord[])[0];
    if (firstTeam) firstTeam['id'] = 'not a valid id';
    const repaired = backfillListItemIds(doc);
    expect(((repaired as JsonRecord)['team'] as JsonRecord[])[0]?.['id']).toBe(
      'not a valid id',
    );
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
    expect(decodes(repaired)).toBe(true);
  });

  test('an already-migrated board is idempotent', () => {
    const encoded = encodedDefaults();
    expect(backfillListItemIds(encoded)).toEqual(encoded);
  });
});
