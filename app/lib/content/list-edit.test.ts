import { describe, expect, it, test } from 'effect-bun-test';
import { Effect, Schema } from 'effect';

import type { Json } from './admin-form';
import { defaultContent } from './defaults';
import {
  addOp,
  applyListEdit,
  collectListOps,
  fieldName,
  listOpFieldName,
  removeOp,
  reorderOp,
  type ListOp,
} from './list-edit';
import { ListItemId, newListItemId, SiteContent } from './schema';

/**
 * `applyListEdit` is the one deep operation (ADR 0006): id-keyed add / remove /
 * reorder against the encoded document. These pin its behaviour — identity, not
 * position, is the key; unedited deep fields survive verbatim; the input is never
 * mutated; and an empty appended item is publish-invalid (blocked by the strict
 * decode boundary, not by the structural edit).
 */

const encode = Schema.encodeUnknownEffect(SiteContent);
const decode = Schema.decodeUnknownEffect(SiteContent);

/**
 * A short identity token for the structural tests. `applyListEdit` keys items by
 * string equality (it never re-validates the brand — the decode boundary does),
 * so a fixture id need not be a real 21-char nanoid; a readable `'a'`/`'b'` keeps
 * the add/remove/reorder assertions legible. Real-nanoid behaviour is covered by
 * the `newListItemId()` and round-trip-through-`defaultContent` cases below.
 */
const id = (raw: string): ListItemId => raw as ListItemId;

const entries = (
  record: Record<string, string>,
): Iterable<readonly [string, string]> => Object.entries(record);

/** A small id-bearing list standing in for `team` / `speakers`. */
const list = (...items: ReadonlyArray<{ readonly [k: string]: Json }>): Json => [
  ...items,
];

describe('applyListEdit — add', () => {
  test('appends a fresh empty item with the given id', () => {
    const base: Json = { team: list({ id: 'a', name: 'Ana' }) };
    const next = applyListEdit(base, [addOp('team', id('b'))]) as {
      team: ReadonlyArray<{ id: string; name?: string }>;
    };
    expect(next.team).toEqual([{ id: 'a', name: 'Ana' }, { id: 'b' }]);
  });

  test('the appended item carries only its id (publish-invalid until edited)', () => {
    const base: Json = { team: list({ id: 'a', name: 'Ana' }) };
    const next = applyListEdit(base, [addOp('team', id('b'))]) as {
      team: ReadonlyArray<Record<string, Json>>;
    };
    expect(Object.keys(next.team[1] ?? {})).toEqual(['id']);
  });

  test('a duplicate-id add is a no-op (two items can never share an identity)', () => {
    const base: Json = { team: list({ id: 'a', name: 'Ana' }) };
    const next = applyListEdit(base, [addOp('team', id('a'))]) as {
      team: readonly unknown[];
    };
    expect(next.team).toHaveLength(1);
  });
});

describe('applyListEdit — remove', () => {
  test('drops the item whose id matches', () => {
    const base: Json = {
      team: list({ id: 'a', name: 'Ana' }, { id: 'b', name: 'Bea' }),
    };
    const next = applyListEdit(base, [removeOp('team', id('a'))]) as {
      team: ReadonlyArray<Record<string, Json>>;
    };
    expect(next.team).toEqual([{ id: 'b', name: 'Bea' }]);
  });

  test('removing an absent id is a no-op', () => {
    const base: Json = { team: list({ id: 'a', name: 'Ana' }) };
    const next = applyListEdit(base, [removeOp('team', id('z'))]) as {
      team: readonly unknown[];
    };
    expect(next.team).toHaveLength(1);
  });
});

describe('applyListEdit — reorder', () => {
  test('reorders the list to the named permutation', () => {
    const base: Json = {
      team: list({ id: 'a' }, { id: 'b' }, { id: 'c' }),
    };
    const next = applyListEdit(base, [
      reorderOp('team', [id('c'), id('a'), id('b')]),
    ]) as { team: ReadonlyArray<{ id: string }> };
    expect(next.team.map((m) => m.id)).toEqual(['c', 'a', 'b']);
  });

  test('a partial order keeps the unnamed items (in their original order) — never drops one', () => {
    const base: Json = {
      team: list({ id: 'a' }, { id: 'b' }, { id: 'c' }),
    };
    const next = applyListEdit(base, [reorderOp('team', [id('c')])]) as {
      team: ReadonlyArray<{ id: string }>;
    };
    expect(next.team.map((m) => m.id)).toEqual(['c', 'a', 'b']);
  });

  test('a stale id in the order is ignored', () => {
    const base: Json = { team: list({ id: 'a' }, { id: 'b' }) };
    const next = applyListEdit(base, [
      reorderOp('team', [id('b'), id('gone'), id('a')]),
    ]) as { team: ReadonlyArray<{ id: string }> };
    expect(next.team.map((m) => m.id)).toEqual(['b', 'a']);
  });
});

describe('applyListEdit — board', () => {
  test('adds a fresh id-only board member', () => {
    const base: Json = {
      board: list({ id: 'a', name: 'Alice' }),
    };
    const next = applyListEdit(base, [addOp('board', id('b'))]) as {
      board: ReadonlyArray<{ id: string; name?: string }>;
    };
    expect(next.board).toHaveLength(2);
    expect(next.board[1]).toEqual({ id: 'b' });
  });

  test('removes a board member by id', () => {
    const base: Json = {
      board: list({ id: 'a', name: 'Alice' }, { id: 'b', name: 'Bob' }),
    };
    const next = applyListEdit(base, [removeOp('board', id('a'))]) as {
      board: ReadonlyArray<{ id: string; name: string }>;
    };
    expect(next.board).toHaveLength(1);
    expect(next.board[0]?.name).toBe('Bob');
  });

  test('reorders board members by id', () => {
    const base: Json = {
      board: list(
        { id: 'a', name: 'Alice' },
        { id: 'b', name: 'Bob' },
        { id: 'c', name: 'Carol' },
      ),
    };
    const next = applyListEdit(base, [
      reorderOp('board', [id('c'), id('a'), id('b')]),
    ]) as { board: ReadonlyArray<{ id: string }> };
    expect(next.board.map((m) => m.id)).toEqual(['c', 'a', 'b']);
  });
});

describe('applyListEdit — id-keyed, not positional', () => {
  test('preserves every unedited deep field of the items it keeps', () => {
    const base: Json = {
      team: list(
        { id: 'a', name: 'Ana', photo: { key: 'a.png', alt: { en: 'A', fr: 'A' } } },
        { id: 'b', name: 'Bea', photo: { key: 'b.png', alt: { en: 'B', fr: 'B' } } },
      ),
    };
    const next = applyListEdit(base, [removeOp('team', id('a'))]) as {
      team: ReadonlyArray<Record<string, Json>>;
    };
    // The surviving item keeps its deep photo/alt verbatim (the property the
    // index merge had: an edit never silently drops sibling fields).
    expect(next.team[0]).toEqual({
      id: 'b',
      name: 'Bea',
      photo: { key: 'b.png', alt: { en: 'B', fr: 'B' } },
    });
  });

  test('navigates a nested list path by conference slug, not position (conferences./2024.speakers)', () => {
    const base: Json = {
      conferences: [
        { slug: '/2024', speakers: list({ id: 's1' }, { id: 's2' }) },
        { slug: '/2026', speakers: list({ id: 's3' }) },
      ],
    };
    const next = applyListEdit(base, [
      addOp('conferences./2024.speakers', id('s9')),
    ]) as {
      conferences: ReadonlyArray<{ speakers: ReadonlyArray<{ id: string }> }>;
    };
    expect(next.conferences[0]?.speakers.map((s) => s.id)).toEqual([
      's1',
      's2',
      's9',
    ]);
    // The sibling conference is untouched.
    expect(next.conferences[1]?.speakers.map((s) => s.id)).toEqual(['s3']);
  });

  test('a reordered conferences array still resolves the right year by slug', () => {
    // Position 0 is now /2026, position 1 is /2024 — an index-based navigation
    // would edit the wrong conference; identity navigation finds /2024.
    const base: Json = {
      conferences: [
        { slug: '/2026', speakers: list({ id: 's3' }) },
        { slug: '/2024', speakers: list({ id: 's1' }) },
      ],
    };
    const next = applyListEdit(base, [
      addOp('conferences./2024.speakers', id('s9')),
    ]) as {
      conferences: ReadonlyArray<{ slug: string; speakers: ReadonlyArray<{ id: string }> }>;
    };
    expect(next.conferences.find((c) => c.slug === '/2024')?.speakers.map((s) => s.id)).toEqual([
      's1',
      's9',
    ]);
    expect(next.conferences.find((c) => c.slug === '/2026')?.speakers.map((s) => s.id)).toEqual(['s3']);
  });

  test('does not mutate its input', () => {
    const base: Json = { team: list({ id: 'a' }) };
    const snapshot = structuredClone(base);
    applyListEdit(base, [addOp('team', id('b')), removeOp('team', id('a'))]);
    expect(base).toEqual(snapshot);
  });

  test('a listPath that does not resolve to an array is left untouched', () => {
    const base: Json = { team: list({ id: 'a' }) };
    const next = applyListEdit(base, [addOp('missing', id('b'))]);
    expect(next).toEqual(base);
  });

  test('applies ops in order — a reorder sees a just-added id', () => {
    const base: Json = { team: list({ id: 'a' }) };
    const newId = newListItemId();
    const next = applyListEdit(base, [
      addOp('team', newId),
      reorderOp('team', [newId, id('a')]),
    ]) as { team: ReadonlyArray<{ id: string }> };
    expect(next.team.map((m) => m.id)).toEqual([String(newId), 'a']);
  });
});

describe('applyListEdit — round-trips through the real document', () => {
  it.effect('removing then re-adding a speaker decodes once each item is complete', () =>
    Effect.gen(function* () {
      const base = (yield* encode(defaultContent)) as Json & {
        conferences: ReadonlyArray<{ slug: string; speakers: readonly { id: string }[] }>;
      };
      const conf = base.conferences.find((c) => c.slug === '/2024');
      const firstSpeakerId = conf?.speakers[0]?.id;
      expect(firstSpeakerId).toBeDefined();

      // Remove the first 2024 speaker (addressed by slug, ADR 0006) — the rest of
      // the document still decodes.
      const removed = applyListEdit(base, [
        removeOp('conferences./2024.speakers', id(firstSpeakerId!)),
      ]);
      const decoded = yield* decode(removed);
      const conf2024 = decoded.conferences.find((c) => c.slug === '/2024');
      expect(conf2024?.speakers.length).toBe(
        (defaultContent.conferences.find((c) => c.slug === '/2024')?.speakers
          .length ?? 0) - 1,
      );
      // …and every surviving deep field (the other speakers' bios) is intact.
      const survivor = conf2024?.speakers[0];
      const expectedSurvivor = defaultContent.conferences.find(
        (c) => c.slug === '/2024',
      )?.speakers[1];
      expect(survivor?.bio).toEqual(expectedSurvivor?.bio);
    }));

  it.effect('an added empty item is publish-invalid — the strict decode rejects it', () =>
    Effect.gen(function* () {
      const base = (yield* encode(defaultContent)) as Json & {
        conferences: ReadonlyArray<{ slug: string }>;
      };

      // Add an empty speaker (id only) to /2024. The list grew, but the item has
      // no required `name`/`bio`/… — so the publish-time decode FAILS (ADR 0006:
      // an empty required field blocks publish, not the structural edit).
      const added = applyListEdit(base, [
        addOp('conferences./2024.speakers', newListItemId()),
      ]);
      const exit = yield* Effect.exit(decode(added));
      expect(exit._tag).toBe('Failure');
    }));
});

describe('collectListOps', () => {
  test('parses add / remove / reorder control fields, skipping other entries', () => {
    const ops = collectListOps(
      entries({
        [listOpFieldName('team', 'add')]: 'newid000000000000000A',
        [listOpFieldName('team', 'remove')]: 'oldid000000000000000B',
        [listOpFieldName('conferences./2024.speakers', 'reorder')]: 'idA, idB ,idC',
        'team.some-member-id-00000.name': 'ignored — a field, not a control op',
        intent: 'save-draft',
      }),
    );
    expect(ops).toEqual([
      addOp('team', id('newid000000000000000A')),
      removeOp('team', id('oldid000000000000000B')),
      reorderOp('conferences./2024.speakers', [
        'idA',
        'idB',
        'idC',
      ] as unknown as readonly ListItemId[]),
    ] as readonly ListOp[]);
  });

  test('skips a control field with an empty value', () => {
    const ops = collectListOps(
      entries({
        [listOpFieldName('team', 'add')]: '',
        [listOpFieldName('team', 'reorder')]: ' , ',
      }),
    );
    expect(ops).toEqual([]);
  });

  test('keeps a listPath that itself contains dots intact (lastIndexOf split)', () => {
    const ops = collectListOps(
      entries({ [listOpFieldName('conferences./2026.seminars', 'add')]: 'someid0000000000000AB' }),
    );
    expect(ops).toEqual([
      addOp('conferences./2026.seminars', id('someid0000000000000AB')),
    ]);
  });
});

describe('field-name templates', () => {
  test('listOpFieldName round-trips through collectListOps', () => {
    expect(listOpFieldName('team', 'add')).toBe('list:team:add');
    expect(listOpFieldName('conferences./2024.speakers', 'remove')).toBe(
      'list:conferences./2024.speakers:remove',
    );
  });

  test('fieldName addresses a list-item leaf by id, not position', () => {
    const speaker = id('abcdefghij0123456789X');
    expect(fieldName('conferences./2024.speakers', speaker, 'name.en')).toBe(
      'conferences./2024.speakers.abcdefghij0123456789X.name.en',
    );
  });
});
