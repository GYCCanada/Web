import { describe, expect, it } from 'bun:test';
import { ConfigProvider, Effect, Exit, Layer, Schema } from 'effect';
import { TestClock } from 'effect/testing';

import { AdminDisabled, Auth, BadPassword, Unauthorized } from './auth.server';

/**
 * `Auth` over a fixed config + a `TestClock` so token expiry is deterministic
 * (the live system clock would make a "expired" assertion flaky). `TestClock`
 * starts at the epoch and advances only via `TestClock.adjust`, so a freshly
 * minted token's 30-day TTL is exactly controllable.
 */
const authLayer = (env: Record<string, string>) =>
  Layer.provideMerge(
    Auth.layer.pipe(
      Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
    ),
    TestClock.layer(),
  );

const ENABLED_ENV = {
  ADMIN_PASSWORD: 'correct horse battery staple',
  COOKIE_SECRET: 'a-very-secret-signing-key',
};

// `Effect.scoped` supplies the `Scope` that `TestClock.adjust` requires; the
// `Auth` layer + test clock are provided beneath it.
const run = <A, E>(
  effect: Effect.Effect<A, E, Auth.Service>,
  env: Record<string, string>,
) => Effect.runPromise(Effect.scoped(Effect.provide(effect, authLayer(env))));

const runExit = <A, E>(
  effect: Effect.Effect<A, E, Auth.Service>,
  env: Record<string, string>,
) =>
  Effect.runPromise(
    Effect.exit(Effect.scoped(Effect.provide(effect, authLayer(env)))),
  );

const failedWith = (
  exit: Exit.Exit<unknown, unknown>,
  guard: (value: unknown) => boolean,
): boolean =>
  Exit.isFailure(exit) &&
  exit.cause.reasons.some(
    (reason) => reason._tag === 'Fail' && guard(reason.error),
  );

const isAdminDisabled = Schema.is(AdminDisabled);
const isBadPassword = Schema.is(BadPassword);
const isUnauthorized = Schema.is(Unauthorized);

describe('Auth (enabled)', () => {
  it('reports the admin as enabled when ADMIN_PASSWORD is set', () =>
    run(
      Effect.gen(function* () {
        const auth = yield* Auth.Service;
        expect(auth.enabled).toBe(true);
      }),
      ENABLED_ENV,
    ));

  it('round-trips: a token minted by the correct password verifies', () =>
    run(
      Effect.gen(function* () {
        const auth = yield* Auth.Service;
        const token = yield* auth.verifyPassword(ENABLED_ENV.ADMIN_PASSWORD);
        expect(token.split('.')).toHaveLength(3);
        // The signed cookie verifies through the same secret.
        yield* auth.checkCookie(auth.cookieHeader(token));
      }),
      ENABLED_ENV,
    ));

  it('rejects a wrong password with BadPassword', async () => {
    const exit = await runExit(
      Effect.gen(function* () {
        const auth = yield* Auth.Service;
        return yield* auth.verifyPassword('wrong password');
      }),
      ENABLED_ENV,
    );
    expect(failedWith(exit, isBadPassword)).toBe(true);
  });

  it('rejects a missing cookie with Unauthorized', async () => {
    const exit = await runExit(
      Effect.gen(function* () {
        const auth = yield* Auth.Service;
        yield* auth.checkCookie(null);
      }),
      ENABLED_ENV,
    );
    expect(failedWith(exit, isUnauthorized)).toBe(true);
  });

  it('rejects an expired token with Unauthorized', async () => {
    const exit = await runExit(
      Effect.gen(function* () {
        const auth = yield* Auth.Service;
        const token = yield* auth.verifyPassword(ENABLED_ENV.ADMIN_PASSWORD);
        // Advance past the 30-day TTL — the same token must now be rejected.
        yield* TestClock.adjust('31 days');
        yield* auth.checkCookie(auth.cookieHeader(token));
      }),
      ENABLED_ENV,
    );
    expect(failedWith(exit, isUnauthorized)).toBe(true);
  });

  it('rejects a token whose signature was tampered with', async () => {
    const exit = await runExit(
      Effect.gen(function* () {
        const auth = yield* Auth.Service;
        const token = yield* auth.verifyPassword(ENABLED_ENV.ADMIN_PASSWORD);
        const [issued, expires] = token.split('.');
        // Keep the issued/expires claims but forge the signature.
        const forged = `${issued}.${expires}.${'A'.repeat(43)}`;
        yield* auth.checkCookie(auth.cookieHeader(forged));
      }),
      ENABLED_ENV,
    );
    expect(failedWith(exit, isUnauthorized)).toBe(true);
  });

  it('rejects a token whose expires claim was extended', async () => {
    const exit = await runExit(
      Effect.gen(function* () {
        const auth = yield* Auth.Service;
        const token = yield* auth.verifyPassword(ENABLED_ENV.ADMIN_PASSWORD);
        const [issued, , sig] = token.split('.');
        // Push the expiry far into the future without re-signing — the
        // signature no longer covers the claims, so it must be rejected.
        const tampered = `${issued}.${'9999999999'}.${sig}`;
        yield* auth.checkCookie(auth.cookieHeader(tampered));
      }),
      ENABLED_ENV,
    );
    expect(failedWith(exit, isUnauthorized)).toBe(true);
  });

  it('rejects a malformed (non-three-part) token with Unauthorized', async () => {
    const exit = await runExit(
      Effect.gen(function* () {
        const auth = yield* Auth.Service;
        yield* auth.checkCookie('gycc_admin=not-a-valid-token');
      }),
      ENABLED_ENV,
    );
    expect(failedWith(exit, isUnauthorized)).toBe(true);
  });
});

describe('Auth (disabled when ADMIN_PASSWORD unset)', () => {
  it('reports the admin as disabled', () =>
    run(
      Effect.gen(function* () {
        const auth = yield* Auth.Service;
        expect(auth.enabled).toBe(false);
      }),
      {},
    ));

  it('rejects every password with AdminDisabled (never BadPassword)', async () => {
    const exit = await runExit(
      Effect.gen(function* () {
        const auth = yield* Auth.Service;
        // Even the empty string must NOT authenticate — a missing password is
        // "no admin", not "an admin whose password is empty".
        return yield* auth.verifyPassword('');
      }),
      {},
    );
    expect(failedWith(exit, isAdminDisabled)).toBe(true);
    expect(failedWith(exit, isBadPassword)).toBe(false);
  });

  it('rejects cookie checks with AdminDisabled (never Unauthorized)', async () => {
    const exit = await runExit(
      Effect.gen(function* () {
        const auth = yield* Auth.Service;
        yield* auth.checkCookie('gycc_admin=anything');
      }),
      {},
    );
    expect(failedWith(exit, isAdminDisabled)).toBe(true);
    expect(failedWith(exit, isUnauthorized)).toBe(false);
  });

  it('treats a present-but-blank ADMIN_PASSWORD as disabled', () =>
    run(
      Effect.gen(function* () {
        const auth = yield* Auth.Service;
        expect(auth.enabled).toBe(false);
      }),
      { ADMIN_PASSWORD: '', COOKIE_SECRET: 'secret' },
    ));
});

describe('Auth (disabled when COOKIE_SECRET unset)', () => {
  it('reports the admin as disabled when only ADMIN_PASSWORD is set', () =>
    run(
      Effect.gen(function* () {
        const auth = yield* Auth.Service;
        expect(auth.enabled).toBe(false);
      }),
      { ADMIN_PASSWORD: 'correct horse battery staple' },
    ));

  it('treats a present-but-blank COOKIE_SECRET as disabled', () =>
    run(
      Effect.gen(function* () {
        const auth = yield* Auth.Service;
        expect(auth.enabled).toBe(false);
      }),
      { ADMIN_PASSWORD: 'correct horse battery staple', COOKIE_SECRET: '' },
    ));

  // The regression this guards: when ADMIN_PASSWORD was set but COOKIE_SECRET
  // was blank, the admin used to report enabled, so verifyPassword proceeded to
  // mint a token and signed with an empty HMAC key. `crypto.subtle.importKey`
  // rejects an empty key with a DataError, crashing login with a 500. The fix
  // requires BOTH secrets, so this now fails cleanly with AdminDisabled.
  it('rejects verifyPassword with AdminDisabled instead of crashing on an empty HMAC key', async () => {
    const exit = await runExit(
      Effect.gen(function* () {
        const auth = yield* Auth.Service;
        return yield* auth.verifyPassword('correct horse battery staple');
      }),
      { ADMIN_PASSWORD: 'correct horse battery staple', COOKIE_SECRET: '' },
    );
    expect(failedWith(exit, isAdminDisabled)).toBe(true);
    expect(failedWith(exit, isBadPassword)).toBe(false);
    // It must be a clean tagged failure, not an unhandled DataError defect.
    expect(Exit.hasDies(exit)).toBe(false);
  });

  it('rejects checkCookie with AdminDisabled when COOKIE_SECRET is unset', async () => {
    const exit = await runExit(
      Effect.gen(function* () {
        const auth = yield* Auth.Service;
        yield* auth.checkCookie('gycc_admin=anything');
      }),
      { ADMIN_PASSWORD: 'correct horse battery staple' },
    );
    expect(failedWith(exit, isAdminDisabled)).toBe(true);
    expect(failedWith(exit, isUnauthorized)).toBe(false);
  });
});
