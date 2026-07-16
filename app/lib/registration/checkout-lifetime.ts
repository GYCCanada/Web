export const STRIPE_MINIMUM_CHECKOUT_LIFETIME_MS = 30 * 60 * 1_000;
export const STRIPE_MAXIMUM_CHECKOUT_LIFETIME_MS = 24 * 60 * 60 * 1_000;

export type CheckoutLifetime =
  | { readonly ok: true; readonly expiresAtSeconds: number }
  | { readonly ok: false; readonly reason: 'below-provider-minimum' };

/**
 * Preserve the frozen quote deadline while satisfying Stripe's Checkout limits.
 * A too-short quote is rejected; it is never extended past Registration close.
 */
export const checkoutLifetime = (
  now: number,
  quoteExpiresAt: number,
): CheckoutLifetime => {
  const providerFloor = Math.ceil(
    (now + STRIPE_MINIMUM_CHECKOUT_LIFETIME_MS) / 1_000,
  );
  const quote = Math.floor(quoteExpiresAt / 1_000);
  if (quote < providerFloor) {
    return { ok: false, reason: 'below-provider-minimum' };
  }
  return {
    ok: true,
    expiresAtSeconds: Math.min(
      quote,
      Math.floor((now + STRIPE_MAXIMUM_CHECKOUT_LIFETIME_MS) / 1_000),
    ),
  };
};
