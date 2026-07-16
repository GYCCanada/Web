import { Schema } from 'effect';

/** A lax bilingual value used only while authoring; strict publish requires both Locales. */
export const DraftText = Schema.Struct({
  en: Schema.optionalKey(Schema.String),
  fr: Schema.optionalKey(Schema.String),
});

const uniqueListItemIds = Schema.makeFilter<
  ReadonlyArray<{ readonly id: string }>
>(
  (items) => {
    const seen = new Set<string>();
    for (const item of items) {
      if (seen.has(item.id)) {
        return `list items must have unique ids; duplicate "${item.id}"`;
      }
      seen.add(item.id);
    }
    return undefined;
  },
  { title: 'uniqueListItemIds' },
);

/** An id-bearing array whose identity is unambiguous for remove and reorder operations. */
export const IdListArray = <
  S extends Schema.Codec<{ readonly id: string }, unknown>,
>(
  item: S,
) => Schema.Array(item).check(uniqueListItemIds);
