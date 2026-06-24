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
 * structural normalization — NOT a parallel schema and NOT validation.
 */

import {
  disabledAccommodationsSection,
  disabledFaqCopySection,
  disabledMealsSection,
  disabledParkingSection,
  disabledRegistrationCopySection,
  disabledTravelSection,
} from './conference-section-defaults';
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
 * Backfill ids on nested hotel room-rate lists inside accommodations.
 */
const backfillAccommodationHotels = (value: unknown): readonly Json[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  return value.map((item) => {
    if (!isObject(item)) return item;
    const hotel: Record<string, Json> = { ...item };
    if (!('roomRates' in hotel)) {
      hotel['roomRates'] = [];
    } else if (Array.isArray(hotel['roomRates'])) {
      const roomRates = backfillItems(hotel['roomRates']);
      if (roomRates !== undefined) hotel['roomRates'] = roomRates;
    }
    return withId(hotel);
  });
};

/**
 * Migrate a legacy `board: string[]` to id-keyed `{ id, name }` objects. Items
 * that already carry an `id` pass through unchanged (idempotent).
 */
const backfillBoard = (value: unknown): readonly Json[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  return value.map((item) => {
    if (typeof item === 'string') {
      return { id: newListItemId(), name: item };
    }
    return withId(item as Json);
  });
};

const backfillConferenceSections = (conference: Record<string, Json>): void => {
  if (!('travel' in conference)) {
    conference['travel'] = { ...disabledTravelSection };
  } else if (isObject(conference['travel'])) {
    const travel = { ...conference['travel'] };
    if (isObject(travel['airport'])) {
      const airport = { ...travel['airport'] };
      if (!('transitOptions' in airport)) {
        airport['transitOptions'] = [];
      } else if (Array.isArray(airport['transitOptions'])) {
        airport['transitOptions'] =
          backfillItems(airport['transitOptions']) ?? airport['transitOptions'];
      }
      travel['airport'] = airport;
    }
    conference['travel'] = travel;
  }

  if (!('parking' in conference)) {
    conference['parking'] = { ...disabledParkingSection };
  } else if (isObject(conference['parking'])) {
    const parking = { ...conference['parking'] };
    if (!('options' in parking)) {
      parking['options'] = [];
    } else if (Array.isArray(parking['options'])) {
      parking['options'] = backfillItems(parking['options']) ?? parking['options'];
    }
    conference['parking'] = parking;
  }

  if (!('accommodations' in conference)) {
    conference['accommodations'] = { ...disabledAccommodationsSection };
  } else if (isObject(conference['accommodations'])) {
    const accommodations = { ...conference['accommodations'] };
    if (!('hotels' in accommodations)) {
      accommodations['hotels'] = [];
    } else if (Array.isArray(accommodations['hotels'])) {
      const hotels = backfillAccommodationHotels(accommodations['hotels']);
      if (hotels !== undefined) accommodations['hotels'] = hotels;
    }
    conference['accommodations'] = accommodations;
  }

  if (!('meals' in conference)) {
    conference['meals'] = { ...disabledMealsSection };
  } else if (isObject(conference['meals'])) {
    const meals = { ...conference['meals'] };
    if (!('items' in meals)) {
      meals['items'] = [];
    } else if (Array.isArray(meals['items'])) {
      meals['items'] = backfillItems(meals['items']) ?? meals['items'];
    }
    conference['meals'] = meals;
  }

  if (!('registrationCopy' in conference)) {
    conference['registrationCopy'] = { ...disabledRegistrationCopySection };
  }

  if (!('faqCopy' in conference)) {
    conference['faqCopy'] = { ...disabledFaqCopySection };
  }
};

/**
 * Return a copy of the parsed `SiteContent` JSON with a fresh id assigned to any
 * id-less list item and disabled defaults for any absent conference section keys.
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
      backfillConferenceSections(conf);
      return conf;
    });
  }

  const team = backfillItems(document['team']);
  if (team !== undefined) next['team'] = team;

  const board = backfillBoard(document['board']);
  if (board !== undefined) next['board'] = board;

  return next;
};
