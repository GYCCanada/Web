import { describe, expect, it } from 'effect-bun-test';
import { ConfigProvider, Effect, Layer } from 'effect';
import { TestClock } from 'effect/testing';

import { AdminDisabled, Auth, BadPassword, Unauthorized } from './auth.server';

/**
 * `Auth` over a fixed config. `it.effect` already provides a `TestClock` (and a
 * `Scope`), so token expiry is deterministic — the clock starts at the epoch and
 * advances only via `TestClock.adjust`, making a freshly minted token's 30-day
 * TTL exactly controllable (the live system clock would make an "expired"
 * assertion flaky).
 */
const authLayer = (env: Record<string, string>) =>
  Auth.layer.pipe(
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
  );

const ENABLED_ENV = {
  ADMIN_PASSWORD: 'correct horse battery staple',
  COOKIE_SECRET: 'a-very-secret-signing-key',
};

describe('Auth (enabled)', () => {
  const test = it.effect.layer(authLayer(ENABLED_ENV));

  test('reports the admin as enabled when ADMIN_PASSWORD is set', () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service;
      expect(auth.enabled).toBe(true);
    }));

  test('round-trips: a token minted by the correct password verifies', () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service;
      const token = yield* auth.verifyPassword(ENABLED_ENV.ADMIN_PASSWORD);
      expect(token.split('.')).toHaveLength(3);
      // The signed cookie verifies through the same secret.
      yield* auth.checkCookie(auth.cookieHeader(token));
    }));

  test('rejects a wrong password with BadPassword', () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service;
      const error = yield* Effect.flip(auth.verifyPassword('wrong password'));
      expect(error).toBeInstanceOf(BadPassword);
    }));

  test('rejects a missing cookie with Unauthorized', () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service;
      const error = yield* Effect.flip(auth.checkCookie(null));
      expect(error).toBeInstanceOf(Unauthorized);
    }));

  test('rejects an expired token with Unauthorized', () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service;
      const token = yield* auth.verifyPassword(ENABLED_ENV.ADMIN_PASSWORD);
      // Advance past the 30-day TTL — the same token must now be rejected.
      yield* TestClock.adjust('31 days');
      const error = yield* Effect.flip(auth.checkCookie(auth.cookieHeader(token)));
      expect(error).toBeInstanceOf(Unauthorized);
    }));

  test('rejects a token whose signature was tampered with', () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service;
      const token = yield* auth.verifyPassword(ENABLED_ENV.ADMIN_PASSWORD);
      const [issued, expires] = token.split('.');
      // Keep the issued/expires claims but forge the signature.
      const forged = `${issued}.${expires}.${'A'.repeat(43)}`;
      const error = yield* Effect.flip(auth.checkCookie(auth.cookieHeader(forged)));
      expect(error).toBeInstanceOf(Unauthorized);
    }));

  test('rejects a token whose expires claim was extended', () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service;
      const token = yield* auth.verifyPassword(ENABLED_ENV.ADMIN_PASSWORD);
      const [issued, , sig] = token.split('.');
      // Push the expiry far into the future without re-signing — the
      // signature no longer covers the claims, so it must be rejected.
      const tampered = `${issued}.${'9999999999'}.${sig}`;
      const error = yield* Effect.flip(auth.checkCookie(auth.cookieHeader(tampered)));
      expect(error).toBeInstanceOf(Unauthorized);
    }));

  test('rejects a malformed (non-three-part) token with Unauthorized', () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service;
      const error = yield* Effect.flip(
        auth.checkCookie('gycc_admin=not-a-valid-token'),
      );
      expect(error).toBeInstanceOf(Unauthorized);
    }));
});

describe('Auth (disabled when ADMIN_PASSWORD unset)', () => {
  const test = it.effect.layer(authLayer({}));

  test('reports the admin as disabled', () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service;
      expect(auth.enabled).toBe(false);
    }));

  test('rejects every password with AdminDisabled (never BadPassword)', () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service;
      // Even the empty string must NOT authenticate — a missing password is
      // "no admin", not "an admin whose password is empty".
      const error = yield* Effect.flip(auth.verifyPassword(''));
      expect(error).toBeInstanceOf(AdminDisabled);
      expect(error).not.toBeInstanceOf(BadPassword);
    }));

  test('rejects cookie checks with AdminDisabled (never Unauthorized)', () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service;
      const error = yield* Effect.flip(auth.checkCookie('gycc_admin=anything'));
      expect(error).toBeInstanceOf(AdminDisabled);
      expect(error).not.toBeInstanceOf(Unauthorized);
    }));
});

describe('Auth (disabled when ADMIN_PASSWORD present-but-blank)', () => {
  const test = it.effect.layer(
    authLayer({ ADMIN_PASSWORD: '', COOKIE_SECRET: 'secret' }),
  );

  test('treats a present-but-blank ADMIN_PASSWORD as disabled', () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service;
      expect(auth.enabled).toBe(false);
    }));
});

describe('Auth (disabled when COOKIE_SECRET unset)', () => {
  const test = it.effect.layer(
    authLayer({ ADMIN_PASSWORD: 'correct horse battery staple' }),
  );

  test('reports the admin as disabled when only ADMIN_PASSWORD is set', () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service;
      expect(auth.enabled).toBe(false);
    }));

  // The regression this guards: when ADMIN_PASSWORD was set but COOKIE_SECRET
  // was blank, the admin used to report enabled, so verifyPassword proceeded to
  // mint a token and signed with an empty HMAC key. `crypto.subtle.importKey`
  // rejects an empty key with a DataError, crashing login with a 500. The fix
  // requires BOTH secrets, so this now fails cleanly with AdminDisabled. (A
  // defect would escape `Effect.flip` and fail the test as an unhandled error,
  // so this asserts a clean tagged failure rather than a crash.)
  test('rejects verifyPassword with AdminDisabled instead of crashing on an empty HMAC key', () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service;
      const error = yield* Effect.flip(
        auth.verifyPassword('correct horse battery staple'),
      );
      expect(error).toBeInstanceOf(AdminDisabled);
      expect(error).not.toBeInstanceOf(BadPassword);
    }));

  test('rejects checkCookie with AdminDisabled when COOKIE_SECRET is unset', () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service;
      const error = yield* Effect.flip(auth.checkCookie('gycc_admin=anything'));
      expect(error).toBeInstanceOf(AdminDisabled);
      expect(error).not.toBeInstanceOf(Unauthorized);
    }));
});
