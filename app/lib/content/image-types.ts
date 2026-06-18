/**
 * The accepted image MIME types and their file extensions — the single source of
 * truth for "what counts as an uploadable image" and "what extension its bytes
 * get on disk".
 *
 * This is a LEAF module: it imports nothing from `admin-form` (form/key policy)
 * or `image-optimize.server` (the resize boundary), so both can depend on it
 * without a cycle and without the pure image-optimization boundary reaching into
 * admin-form's naming policy (`boundary-discipline`, `derive-dont-sync` — one
 * MIME↔extension table, not a copy per consumer).
 */

const ACCEPTED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
]);

/** Whether `type` is an image MIME we accept for upload (case-insensitive). */
export const isAcceptedImageType = (type: string): boolean =>
  ACCEPTED_IMAGE_TYPES.has(type.toLowerCase());

const EXTENSION_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};

/** The file extension for an image MIME (`'bin'` for anything unrecognized). */
export const extensionForType = (type: string): string =>
  EXTENSION_BY_TYPE[type.toLowerCase()] ?? 'bin';
