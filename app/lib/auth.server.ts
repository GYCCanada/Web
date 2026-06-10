import {
  Clock,
  Config,
  Context,
  Effect,
  Layer,
  Redacted,
  Schema,
} from 'effect';

/**
 * Admin session auth for the `/admin` CMS editor (CMS plan §"Services",
 * sub-commit C4), ported from the `paulo-suzanne` sibling's `Auth` service.
 *
 * A stateless, HMAC-SHA-256 signed session cookie (`gycc_admin`) carries the
 * whole session: `issued.expires.sig`, where `sig = HMAC(secret,
 * "issued.expires")`. There is no server-side session store — verifying a
 * cookie is recomputing the signature and checking the expiry, so the service
 * holds no mutable state (`small-interface-deep-implementation`).
 *
 * `ADMIN_PASSWORD` and `COOKIE_SECRET` are **optional everywhere** (CMS plan
 * §"Env wiring"): like the bucket, the admin area degrades to *disabled* when
 * unconfigured rather than failing the layer at boot, so dev and a
 * prod-without-admin both 404 the admin area while mail/mailchimp keep their
 * own fail-fast. The admin is enabled only when BOTH `ADMIN_PASSWORD` and
 * `COOKIE_SECRET` are set; if either is unset/blank the admin is DISABLED:
 * `verifyPassword` and `checkCookie` both fail with `AdminDisabled`, which the
 * routes map to a 404 (`make-impossible-states-unrepresentable` — a missing
 * password is "no admin", never "an admin with the empty password"; and an
 * admin with no signing secret cannot mint a token, so it is "no admin" too).
 *
 * Both the password check and the signature check use a constant-time compare
 * so neither leaks length/prefix information through timing. The signature
 * check compares two fixed-length HMAC base64url digests (length is public), so
 * a direct compare is safe. The password check, however, compares the
 * *submitted* password against the secret `ADMIN_PASSWORD`, whose length is
 * itself secret — so it first HMACs **both** sides to a fixed-length SHA-256
 * digest under `COOKIE_SECRET` and compares those equal-length digests, never
 * branching on the password length (the digest is keyed, so the comparands are
 * not offline-recomputable from the public digest length).
 */

export class BadPassword extends Schema.TaggedErrorClass<BadPassword>()(
  'gycc/lib/auth.server/BadPassword',
  {},
) {}

export class Unauthorized extends Schema.TaggedErrorClass<Unauthorized>()(
  'gycc/lib/auth.server/Unauthorized',
  {},
) {}

/**
 * The admin area is unconfigured (`ADMIN_PASSWORD` unset). Distinct from
 * `Unauthorized` (configured, but no valid cookie) so the routes can 404 the
 * whole admin area when it is disabled while merely redirecting an
 * unauthenticated visitor to the login page when it is enabled.
 */
export class AdminDisabled extends Schema.TaggedErrorClass<AdminDisabled>()(
  'gycc/lib/auth.server/AdminDisabled',
  {},
) {}

const COOKIE_NAME = 'gycc_admin';
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;

const toBase64Url = (bytes: Uint8Array): string => {
  const b64 = Buffer.from(bytes).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const importKey = Effect.fnUntraced(function* (secret: string) {
  return yield* Effect.promise(() =>
    crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify'],
    ),
  );
});

const sign = Effect.fnUntraced(function* (secret: string, payload: string) {
  const key = yield* importKey(secret);
  const sig = yield* Effect.promise(() =>
    crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)),
  );
  return toBase64Url(new Uint8Array(sig));
});

const constantTimeEqual = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
};

const verifySig = Effect.fnUntraced(function* (
  secret: string,
  payload: string,
  sig: string,
) {
  const expected = yield* sign(secret, payload);
  return constantTimeEqual(
    new TextEncoder().encode(expected),
    new TextEncoder().encode(sig),
  );
});

const parseCookie = (header: string | null, name: string): string | null => {
  if (header === null) return null;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return null;
};

export class Auth extends Context.Service<
  Auth,
  {
    /**
     * Whether the admin area is configured (both `ADMIN_PASSWORD` and
     * `COOKIE_SECRET` are set).
     */
    readonly enabled: boolean;
    /**
     * Verify the submitted password and, on success, mint a fresh signed
     * session token. Fails `AdminDisabled` when the admin is unconfigured and
     * `BadPassword` when the password does not match.
     */
    readonly verifyPassword: (
      password: string,
    ) => Effect.Effect<string, AdminDisabled | BadPassword>;
    /**
     * Validate the `gycc_admin` cookie off a request `Cookie` header. Fails
     * `AdminDisabled` when the admin is unconfigured, `Unauthorized` when the
     * cookie is missing, malformed, expired, or its signature does not verify.
     */
    readonly checkCookie: (
      cookieHeader: string | null,
    ) => Effect.Effect<void, AdminDisabled | Unauthorized>;
    readonly cookieHeader: (token: string) => string;
    readonly clearCookieHeader: () => string;
  }
>()('gycc/lib/auth.server/Auth') {
  static layer = Layer.effect(
    Auth,
    Effect.gen(function* () {
      // Both optional — a missing password disables the admin (degrade, not
      // fail-fast), matching the bucket's optional-everywhere contract.
      const adminPassword = yield* Config.redacted('ADMIN_PASSWORD').pipe(
        Config.withDefault(Redacted.make('')),
      );
      const cookieSecret = yield* Config.redacted('COOKIE_SECRET').pipe(
        Config.withDefault(Redacted.make('')),
      );

      const adminPw = Redacted.value(adminPassword);
      const secret = Redacted.value(cookieSecret);
      // The admin is enabled only when BOTH a real password AND a real signing
      // secret are set — matching the `.env.example` contract ("set both to
      // enable it"). An "enabled admin with a blank secret" is an impossible,
      // unsafe state (make-impossible-states-unrepresentable): the HMAC key
      // would be the empty string, which `crypto.subtle.importKey` rejects with
      // a `DataError` — so the first sign/verify would crash login with a 500 —
      // and a blank signing key is trivially forgeable anyway. Requiring both
      // collapses "auth on, no secret" into the single "disabled" state.
      const enabled = adminPw !== '' && secret !== '';

      // Internal helpers (not part of the service surface) — untraced, mirroring
      // opencode's traced-boundary / untraced-internal split (`git.ts`).
      const issueToken = Effect.fnUntraced(function* () {
        const now = yield* Clock.currentTimeMillis;
        const issued = Math.floor(now / 1000);
        const expires = issued + TOKEN_TTL_SECONDS;
        const payload = `${issued}.${expires}`;
        const sig = yield* sign(secret, payload);
        return `${payload}.${sig}`;
      });

      const validateToken = Effect.fnUntraced(function* (token: string) {
        const parts = token.split('.');
        if (parts.length !== 3) return yield* new Unauthorized();
        const [issuedStr, expiresStr, sig] = parts as [string, string, string];
        const expires = Number(expiresStr);
        if (!Number.isFinite(expires)) return yield* new Unauthorized();
        const now = yield* Clock.currentTimeMillis;
        if (expires < Math.floor(now / 1000)) return yield* new Unauthorized();
        const ok = yield* verifySig(secret, `${issuedStr}.${expiresStr}`, sig);
        if (!ok) return yield* new Unauthorized();
      });

      const verifyPassword = Effect.fn('Auth.verifyPassword')(function* (
        password: string,
      ) {
        if (!enabled) return yield* new AdminDisabled();
        // HMAC both sides to a fixed-length digest under the signing secret
        // before comparing, so the compare never branches on the secret
        // `ADMIN_PASSWORD`'s length — defeating a timing probe of the
        // password length. The digests are equal-length (43-char base64url
        // of a 32-byte SHA-256 HMAC), so the constant-time compare runs the
        // full loop regardless of the submitted password.
        const submitted = yield* sign(secret, password);
        const expected = yield* sign(secret, adminPw);
        const ok = constantTimeEqual(
          new TextEncoder().encode(submitted),
          new TextEncoder().encode(expected),
        );
        if (!ok) return yield* new BadPassword();
        return yield* issueToken();
      });

      const checkCookie = Effect.fn('Auth.checkCookie')(function* (
        header: string | null,
      ) {
        if (!enabled) return yield* new AdminDisabled();
        const token = parseCookie(header, COOKIE_NAME);
        if (token === null) return yield* new Unauthorized();
        yield* validateToken(token);
      });

      return Auth.of({
        enabled,
        verifyPassword,
        checkCookie,

        cookieHeader: (token) =>
          `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${TOKEN_TTL_SECONDS}`,

        clearCookieHeader: () =>
          `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
      });
    }),
  );
}
