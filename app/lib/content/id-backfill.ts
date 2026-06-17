/**
 * Read-path id-backfill normalization (ADR 0006 consequence, registration-launch
 * Branch 2 sub-commit 2.1).
 *
 * Every CMS list item now carries a *required* `id: ListItemId` (a `nanoid`) so
 * the editor can address it by identity rather than by array position. But every
 * `content/site.json` already published BEFORE this change has no ids, so a
 * required `id` would make the live document FAIL decode on the next read — the
 * deploy would break the public site on its own content.
 *
 * The fix is a one-shot repair at the read boundary: before the document is
 * Schema-decoded, `backfillListItemIds` walks the parsed (untrusted) JSON and
 * assigns a fresh `nanoid` to any list item that lacks an `id`. It is a pure
 * structural normalization — NOT a parallel schema and NOT validation:
 *   - `derive-dont-sync`: there is one decode boundary; this only fills the gap
 *     a pre-ids document leaves, so the decoded value is always id-complete.
 *   - `make-operations-idempotent`: an item that already has an `id` key is left
 *     untouched (even a *bad* id is left for the decoder to reject — backfill is
 *     for absence, not repair), so re-running on an already-migrated document is
 *     a no-op. The first admin publish persists the backfilled ids; from then on
 *     the normalization changes nothing.
 *   - `boundary-discipline`: it runs only over already-parsed JSON inside the
 *     read path, never mutates its input, and hands a fresh value to the decoder
 *     which remains the sole gate that brands the ids. The input is `unknown`
 *     (raw parsed JSON), so the walk narrows defensively and never trusts shape.
 *
 * The list-item locations are the three id-bearing structs the schema names
 * today (`Speaker`, `Seminar`, `TeamMember`); Branch 3+ widens them as the
 * Conference / Page schemas grow id-bearing lists, and this walk grows with
 * them. The walk descends only into the arrays/objects that are actually present
 * and the expected shape, so a malformed document still reaches the decoder
 * (which rejects it) rather than throwing here.
 */

import { newListItemId } from './schema';
import type { Json } from './admin-form';

const isObject = (value: unknown): value is { readonly [key: string]: Json } =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Assign a fresh id to a list item that has no `id` key; else leave it alone. */
const withId = (item: Json): Json => {
  if (!isObject(item)) return item;
  if ('id' in item) return item;
  return { id: newListItemId(), ...item };
};

/** Backfill ids on every element of `value` when it is an array of items. */
const backfillItems = (value: unknown): readonly Json[] | undefined =>
  Array.isArray(value) ? value.map(withId) : undefined;

/**
 * Return a copy of the parsed `SiteContent` JSON with a fresh id assigned to any
 * id-less list item (`conferences[].speakers[]`, `conferences[].seminars[]`,
 * `team[]`). Items already carrying an `id` are untouched (idempotent). A value
 * that is not the expected shape is returned as-is so the decoder — not this
 * normalizer — is the one to reject it.
 */
export const backfillListItemIds = (document: unknown): unknown => {
  if (!isObject(document)) return document;

  const next: Record<string, Json> = { ...document };

  const conferences = document['conferences'];
  if (Array.isArray(conferences)) {
    next['conferences'] = conferences.map((conference: Json) => {
      if (!isObject(conference)) return conference;
      const conf: Record<string, Json> = { ...conference };
      const speakers = backfillItems(conference['speakers']);
      if (speakers !== undefined) conf['speakers'] = speakers;
      const seminars = backfillItems(conference['seminars']);
      if (seminars !== undefined) conf['seminars'] = seminars;
      return conf;
    });
  }

  const team = backfillItems(document['team']);
  if (team !== undefined) next['team'] = team;

  return next;
};
