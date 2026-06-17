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
 * The list-item locations are the id-bearing structs the schema names today
 * (`Speaker`, `Seminar`, `Hotel`, `TeamMember`); Branch 3+ widens them as the
 * Conference / Page schemas grow id-bearing lists, and this walk grows with
 * them. The walk descends only into the arrays/objects that are actually present
 * and the expected shape, so a malformed document still reaches the decoder
 * (which rejects it) rather than throwing here.
 *
 * Branch 3.1 grows the Conference with a *required* `hotels: IdListArray(Hotel)`.
 * That is the same read-safety hazard as the required `id` itself: a
 * `content/site.json` published BEFORE 3.1 has no `hotels` key, so a required
 * field would FAIL decode on the next read and silently discard the live
 * CMS-authored content. A truly-*absent* `hotels` key normalizes to `[]`
 * (idempotent: a conference already carrying `hotels` keeps it, ids and all),
 * which is the one structural gap a pre-3.1 document leaves. A *present* but
 * malformed `hotels` (e.g. `null`, a string) is left in place so the decoder —
 * not this normalizer — rejects it, exactly like every other list above; the
 * `[]` default is reserved for an absent key and never overwrites authored
 * content. (The sibling URL
 * fields — `registrationUrl` / `scheduleUrl` / `mapEmbedUrl` — are
 * `OptionFromOptionalKey`, so their absence already decodes to `Option.none()`
 * and needs no backfill.)
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
 * `conferences[].hotels[]`, `team[]`) and an empty `hotels: []` supplied to any
 * conference that predates 3.1 and lacks the (required) key. Items already
 * carrying an `id` — and a `hotels` array that is already present — are
 * untouched (idempotent). A value that is not the expected shape is returned
 * as-is so the decoder — not this normalizer — is the one to reject it.
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
      // `hotels` is a *required* (Branch 3.1) id-keyed list. A pre-3.1 document
      // has no key at all: supply `[]` so the absent required field decodes. A
      // *present* `hotels` is backfilled like any other id list (and left as-is
      // when already id-complete). Crucially, only a truly-ABSENT key is
      // defaulted: a present-but-malformed value (`null`, `"x"`, `{}`) is left
      // in place for the decoder to reject — exactly like speakers/seminars/team
      // above. Defaulting it to `[]` would silently discard authored content
      // BEFORE strict decode, which is precisely the masking this normalizer is
      // documented (above) NOT to do.
      if (!('hotels' in conference)) {
        conf['hotels'] = [];
      } else {
        const hotels = backfillItems(conference['hotels']);
        if (hotels !== undefined) conf['hotels'] = hotels;
      }
      return conf;
    });
  }

  const team = backfillItems(document['team']);
  if (team !== undefined) next['team'] = team;

  return next;
};
