import { describe, expect, test } from 'bun:test';
import { Result, Schema } from 'effect';

import { IsoDate, newListItemId } from '../content/schema';
import { Cents, CurrencyCode } from '../forms/pricing';

import {
  canTransition,
  OrderState,
  RefundNotAllowed,
  type BucketStatus,
} from './order.actor';

/**
 * G4 — unit tests for the Order entity's STATE MACHINE, exercised WITHOUT a
 * runtime (no SQL, no runner — that is G3's probe and G6's lifecycle test). Two
 * things are pinned here:
 *
 *   1. the pure transition-table predicate (`canTransition`) — every legal flip
 *      passes and every illegal flip is rejected, including the
 *      never-downgrade-a-terminal-state discipline;
 *   2. the persisted `OrderState` schema round-trips losslessly through
 *      `encode → JSON → decode` (the shape the actor's durable State cache
 *      serializes as) and rejects out-of-domain tokens.
 */

const ALL_STATUSES: ReadonlyArray<BucketStatus> = [
  'pending',
  'paid',
  'cancelled',
  'refunded',
  'expired',
  'failed',
];

/**
 * The authoritative legal set (Decision 5): `pending → {paid,cancelled,expired,
 * failed}`, `paid → refunded`, plus every identity flip. Expressed here
 * independently of the implementation so the test is a real spec, not a mirror.
 */
const LEGAL: ReadonlyArray<readonly [BucketStatus, BucketStatus]> = [
  ['pending', 'paid'],
  ['pending', 'cancelled'],
  ['pending', 'expired'],
  ['pending', 'failed'],
  ['paid', 'refunded'],
];

describe('canTransition (Order lifecycle predicate)', () => {
  test('every declared transition is legal', () => {
    for (const [from, to] of LEGAL) {
      expect(canTransition(from, to)).toBe(true);
    }
  });

  test('every identity flip is legal (idempotent replay no-op)', () => {
    for (const status of ALL_STATUSES) {
      expect(canTransition(status, status)).toBe(true);
    }
  });

  test('every non-declared, non-identity flip is illegal', () => {
    const legalSet = new Set(LEGAL.map(([from, to]) => `${from}->${to}`));
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        if (from === to) continue;
        const expected = legalSet.has(`${from}->${to}`);
        expect(canTransition(from, to)).toBe(expected);
      }
    }
  });

  test('terminal states never downgrade (cancelled/refunded/expired/failed are sinks)', () => {
    const terminals: ReadonlyArray<BucketStatus> = [
      'cancelled',
      'refunded',
      'expired',
      'failed',
    ];
    for (const from of terminals) {
      for (const to of ALL_STATUSES) {
        if (to === from) continue;
        expect(canTransition(from, to)).toBe(false);
      }
    }
  });

  test('paid may ONLY advance to refunded', () => {
    for (const to of ALL_STATUSES) {
      if (to === 'paid' || to === 'refunded') continue;
      expect(canTransition('paid', to)).toBe(false);
    }
  });
});

describe('RefundNotAllowed (G7 — the typed non-refundable guard)', () => {
  test('is a tagged error carrying the orderId + the offending bucket status', () => {
    // The status field is the BUCKET literal — `failed` (a bucket-only terminal,
    // never an actor-State value) is a legitimate non-refundable source.
    const error = new RefundNotAllowed({ orderId: 'ord-1', status: 'failed' });
    expect(error._tag).toBe('Order.RefundNotAllowed');
    expect(error.orderId).toBe('ord-1');
    expect(error.status).toBe('failed');
  });
});

describe('OrderState schema', () => {
  const validState = {
    status: 'paid' as const,
    sessionId: 'cs_test_1',
    paidAt: IsoDate.make('2026-06-22'),
  };

  test('round-trips losslessly through encode → JSON → decode', () => {
    const json = Schema.encodeSync(Schema.fromJsonString(OrderState))(
      validState,
    );
    const back = Schema.decodeUnknownResult(Schema.fromJsonString(OrderState))(
      json,
    );
    expect(Result.isSuccess(back)).toBe(true);
    if (Result.isSuccess(back)) {
      expect(back.success).toEqual(validState);
    }
  });

  test('round-trips a pending state with no paidAt (optionalKey absent)', () => {
    const pending = { status: 'pending' as const, sessionId: 'cs_test_2' };
    const json = Schema.encodeSync(Schema.fromJsonString(OrderState))(pending);
    const back = Schema.decodeUnknownResult(Schema.fromJsonString(OrderState))(
      json,
    );
    expect(Result.isSuccess(back)).toBe(true);
    if (Result.isSuccess(back)) {
      expect(back.success).toEqual(pending);
    }
  });

  test('carries the five actor-visible states (NOT failed)', () => {
    for (const status of ['pending', 'paid', 'cancelled', 'refunded', 'expired'] as const) {
      const result = Schema.decodeUnknownResult(OrderState)({
        status,
        sessionId: 'cs_test',
      });
      expect(Result.isSuccess(result)).toBe(true);
    }
  });

  test('rejects failed (a bucket-only terminal, never an actor State value)', () => {
    const result = Schema.decodeUnknownResult(OrderState)({
      status: 'failed',
      sessionId: 'cs_test',
    });
    expect(Result.isFailure(result)).toBe(true);
  });

  test('rejects an off-list status token', () => {
    const result = Schema.decodeUnknownResult(OrderState)({
      status: 'bogus',
      sessionId: 'cs_test',
    });
    expect(Result.isFailure(result)).toBe(true);
  });
});

/**
 * The reused registrar brands compile into the actor payloads — a compile-time
 * smoke that `ArmPayload`'s `Cents` / `CurrencyCode` / `ListItemId` are the
 * shared definitions (`derive-dont-sync`), not redeclared. Constructing the
 * branded values here keeps the import live and asserts the brand makers accept
 * in-domain values.
 */
describe('Order actor payload brands (reused, not redeclared)', () => {
  test('the frozen-linkage brands construct from in-domain values', () => {
    expect(Cents.make(15000)).toBe(15000 as typeof Cents.Type);
    expect(CurrencyCode.make('cad')).toBe('cad' as typeof CurrencyCode.Type);
    expect(typeof newListItemId()).toBe('string');
  });
});
