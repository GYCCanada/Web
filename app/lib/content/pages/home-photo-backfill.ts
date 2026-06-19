import type { Json } from '../admin-form';
import { defaultHomePage } from './defaults';

/**
 * Read-path backfill for the home page's `mission.photo` slot (Feature A
 * remediation) — the per-page analogue of `backfillListItemIds` (registration-
 * launch Branch 2.1).
 *
 * The hazard: `mission.photo` is a NEW field on `HomePage`. Every `content/pages/
 * home.json` published BEFORE it existed carries a `mission` object WITHOUT a
 * `photo` key. Such an object decodes cleanly (the field is `optionalKey`), so the
 * `getPage` read path returns it as-is and the bundled-default seed (which carries
 * the photo) NEVER applies — the seed only fires when the object is absent or
 * unreadable. The route then section-skips, and the mission photo silently
 * VANISHES on the next deploy, even though the default seeds it. (`Content`'s read
 * boundary at `content.server.ts` decodes the stored object and falls back to
 * `spec.default` only on FAILURE, not on a successfully-decoded legacy object.)
 *
 * The fix is the same one-shot, idempotent normalization `backfillListItemIds`
 * applies for absent ids / `hotels`: before decode, if the parsed home JSON has a
 * `mission` object with NO `photo` key, fill it with the seeded default photo. It
 * is `make-operations-idempotent`:
 *   - It fires ONLY on an ABSENT `photo` key — a present `photo` (a real upload, or
 *     the seeded default once persisted) is left untouched, so re-running on an
 *     already-migrated object is a no-op and the first `/admin` publish persists
 *     the photo (from then on this changes nothing).
 *   - It is for ABSENCE, not repair: a present-but-malformed `photo` is left for the
 *     decoder to reject, exactly like `backfillListItemIds` leaves a bad id.
 * `boundary-discipline`: it runs over already-parsed `unknown` JSON, never mutates
 * its input, and hands a fresh value to the sole decode gate. A non-object or a
 * `mission` that isn't an object is returned verbatim (the decoder rejects it).
 *
 * Why home and not a blanket page hook: home is the ONLY page that (a) gained a new
 * field after it could already be published AND (b) needs the field's default to
 * render unchanged (the photo always showed pre-migration). The other pages' new
 * fields are either `enabled` (its own decoding default) or list items (covered by
 * the site backfill). Wired as the home spec's `normalize` so it is one registry
 * entry, not an `if (key === 'home')` in the generic cache (`derive-dont-sync`).
 */
const isObject = (value: unknown): value is { readonly [key: string]: Json } =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const backfillHomeMissionPhoto = (parsed: unknown): unknown => {
  if (!isObject(parsed)) return parsed;
  const mission = parsed['mission'];
  if (!isObject(mission)) return parsed;
  if ('photo' in mission) return parsed; // present (upload or persisted seed) — leave it
  return {
    ...parsed,
    mission: { ...mission, photo: defaultHomePage.mission.photo as Json },
  };
};
