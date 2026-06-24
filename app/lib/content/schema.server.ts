/**
 * Server-only extensions to `schema.ts` that rely on `node:crypto`.
 *
 * `schema.ts` is imported by client-side routes (admin UI, forms) so it must
 * not import `node:crypto` — Vite externalises that module and installs a
 * Proxy that **throws** on any property access, killing React hydration
 * silently. Everything here is server-only (`.server.ts` suffix keeps it out
 * of the browser bundle).
 */

import { createHash } from 'node:crypto';

export * from './schema';
import { ListItemId } from './schema';

/**
 * nanoid's URL-safe default alphabet (`A-Za-z0-9_-`, 64 chars) — the alphabet a
 * {@link ListItemId} validates against. {@link deterministicListItemId} maps a
 * hash digest into it so a derived id is byte-for-byte a nanoid (same shape the
 * brand's pattern accepts), not a hex/base64 string the schema would reject.
 */
const NANOID_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';

/**
 * Derive a **deterministic**, schema-valid `ListItemId` from an idempotency
 * `key` — the SAME `key` always yields the SAME id. Unlike {@link newListItemId}
 * (a fresh random nanoid per call), this lets a write be idempotent: a retry of
 * the same logical record re-derives the same id → the same bucket key → the
 * `Storage.put` overwrites rather than minting a duplicate object
 * (registration-launch Branch 7.3 follow-up — the registration multi-registrant
 * partial-write the deep review escalated). The 21-char output is shaped like a
 * nanoid (it maps a SHA-256 digest into nanoid's alphabet), so it satisfies the
 * `ListItemId` pattern; it is NOT a random nanoid and is not meant to be
 * unguessable — it is a content-addressed id, derived not authored.
 */
export const deterministicListItemId = (key: string): ListItemId => {
  // SHA-256 → 32 bytes; take the first 21 and fold each into nanoid's 64-char
  // alphabet (a clean `& 63` mask — 64 divides 256, so no modulo bias).
  const digest = createHash('sha256').update(key).digest();
  let id = '';
  for (let i = 0; i < 21; i += 1) {
    // `digest` is 32 bytes, so `digest[i]` for i<21 is always a byte; `& 63` keeps
    // the index in `[0, 63]`, always a valid position in the 64-char alphabet.
    id += NANOID_ALPHABET.charAt((digest[i] ?? 0) & 63);
  }
  return ListItemId.make(id);
};
