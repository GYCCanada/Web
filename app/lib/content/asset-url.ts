import type { AssetKey } from './schema';

/**
 * Resolve a bucket object key (`2024/speakers/matt.png`) to the URL the HTML
 * renders (`/images/2024/speakers/matt.png`). Every managed image is served
 * through the Effect server's `GET /images/*` route: it streams the bucket
 * object when present and falls back to the bundled `public/<key>` file
 * otherwise. So a bucket-less dev/prod still serves today's `public/` art (the
 * default keys map 1:1 onto the `public/` tree), while an uploaded image at the
 * same key transparently overrides it — with no change to any component.
 *
 * This is a LEAF module (it imports only the `AssetKey` type, nothing from
 * `content.server` or `pages/project`) so BOTH the site read path
 * (`content.server.ts`) and the per-page projection (`pages/project.ts`) share
 * ONE URL-resolution rule with no import cycle (`derive-dont-sync`,
 * `boundary-discipline`).
 */
export const assetUrl = (key: AssetKey): string => `/images/${key}`;
