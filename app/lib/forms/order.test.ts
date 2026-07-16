import { describe, expect, test } from 'bun:test';
import { Result, Schema } from 'effect';

import { IsoDate, newListItemId } from '../content/schema';

import { RegistrationOrder } from './order';
import { Cents, CurrencyCode } from './pricing';

/**
 * The frozen `RegistrationOrder` record (registrar plan Decision 2 / C7) — the
 * durable receipt one group checkout mints. These pins prove it round-trips
 * losslessly through `encode → JSON → decode` (the bucket boundary
 * `persistOrder` writes it across) and that its closed-token fields reject
 * out-of-domain values (so a hand-built order can never silently store a bad
 * amount/currency/mode/status).
 */
const validOrder = {
  orderId: 'abc123fingerprint',
  mode: 'group' as const,
  sessionId: 'cs_test_1',
  amount: Cents.make(15000),
  currency: CurrencyCode.make('cad'),
  receiptEmail: 'leader@example.com',
  status: 'pending' as const,
  registrantIds: [newListItemId(), newListItemId()],
};

describe('RegistrationOrder', () => {
  test('round-trips losslessly through encode → JSON → decode', () => {
    const json = Schema.encodeSync(Schema.fromJsonString(RegistrationOrder))(
      validOrder,
    );
    const back = Schema.decodeUnknownResult(
      Schema.fromJsonString(RegistrationOrder),
    )(json);
    expect(Result.isSuccess(back)).toBe(true);
    if (Result.isSuccess(back)) {
      expect(back.success).toEqual(validOrder);
    }
  });

  test('round-trips at each widened status (cancelled, refunded, expired)', () => {
    // The G5 widen added `cancelled` + `refunded` (atop the original
    // pending/paid/failed/expired). A `refunded` order ALSO carries the frozen
    // `refundedAt`; every status round-trips losslessly through the bucket codec.
    const codec = Schema.fromJsonString(RegistrationOrder);
    const cases = [
      { ...validOrder, status: 'cancelled' as const },
      { ...validOrder, status: 'expired' as const },
      {
        ...validOrder,
        status: 'refunded' as const,
        paidAt: IsoDate.make('2026-06-18'),
        refundedAt: IsoDate.make('2026-06-20'),
      },
    ];
    for (const order of cases) {
      const back = Schema.decodeUnknownResult(codec)(
        Schema.encodeSync(codec)(order),
      );
      expect(Result.isSuccess(back)).toBe(true);
      if (Result.isSuccess(back)) {
        expect(back.success).toEqual(order);
      }
    }
  });

  test('rejects an off-list status (still a CLOSED literal after the widen)', () => {
    const result = Schema.decodeUnknownResult(RegistrationOrder)({
      ...validOrder,
      status: 'partially_refunded',
    });
    expect(Result.isFailure(result)).toBe(true);
  });

  test('rejects a negative amount (Cents brand)', () => {
    const result = Schema.decodeUnknownResult(RegistrationOrder)({
      ...validOrder,
      amount: -1,
    });
    expect(Result.isFailure(result)).toBe(true);
  });

  test('rejects an unsupported currency token', () => {
    const result = Schema.decodeUnknownResult(RegistrationOrder)({
      ...validOrder,
      currency: 'usd',
    });
    expect(Result.isFailure(result)).toBe(true);
  });

  test('a missing receiptEmail FAILS (required, never optionalKey — backfill guard)', () => {
    const { receiptEmail: _drop, ...withoutReceipt } = validOrder;
    const result = Schema.decodeUnknownResult(RegistrationOrder)(withoutReceipt);
    expect(Result.isFailure(result)).toBe(true);
  });
});
