/**
 * Shared response headers + meta for every `/admin` route (CMS plan
 * sub-commit C4). The admin area is private and must never be cached by a
 * shared cache or indexed by a crawler, so each route re-exports these.
 *
 *   - `Cache-Control: private, no-store` keeps the authenticated HTML out of
 *     any shared/CDN cache.
 *   - `X-Robots-Tag: noindex` (plus the `<meta name="robots">` for completeness)
 *     keeps the admin out of search engines.
 *   - `X-Frame-Options: DENY` / `Referrer-Policy: same-origin` are standard
 *     hardening for an authenticated surface.
 */
export const adminSecurityHeaders = (): Record<string, string> => ({
  'Cache-Control': 'private, no-store, max-age=0',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'X-Robots-Tag': 'noindex, nofollow',
});

export const adminMeta = () => [
  { name: 'robots', content: 'noindex, nofollow' },
];
