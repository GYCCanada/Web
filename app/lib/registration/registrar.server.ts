export * as Registrar from './registrar.server';

import {
  Context,
  DateTime,
  Effect,
  Layer,
  Option,
  Schema,
} from 'effect';
import { SqlClient } from 'effect/unstable/sql/SqlClient';

import {
  ConferenceSlug,
  ExternalHttpsUrl,
} from '../content/schema';
import { compileForm, type ReadinessIssue } from '../forms/compiled-form';
import { FormDefinition } from '../forms/definition';
import { FormDefinitionVersionId } from '../forms/forms.server';
import { OrderActor } from './order-actor.server';
import { StripeGateway } from './stripe-gateway.server';

export const ConferenceTimeZone = Schema.String.check(
  Schema.makeFilter<string>((timeZone) => {
    try {
      new Intl.DateTimeFormat('en-CA', { timeZone }).format();
      return undefined;
    } catch {
      return 'Expected an IANA Conference time zone';
    }
  }),
).pipe(Schema.brand('ConferenceTimeZone'));
export type ConferenceTimeZone = typeof ConferenceTimeZone.Type;

type ChannelBase = {
  readonly conference: typeof ConferenceSlug.Type;
  readonly revision: number;
  readonly updatedAt: DateTime.Utc;
};

type PinnedChannel = ChannelBase & {
  readonly state: 'preview' | 'open' | 'draining';
  readonly formVersion: FormDefinitionVersionId;
  readonly timeZone: ConferenceTimeZone;
};

export type Channel =
  | (ChannelBase & { readonly state: 'closed' })
  | (ChannelBase & {
      readonly state: 'external';
      readonly url: typeof ExternalHttpsUrl.Type;
    })
  | PinnedChannel;

export type ExpectedRevision = {
  readonly conference: typeof ConferenceSlug.Type;
  readonly expectedRevision: number;
};

export type SetExternalCommand = ExpectedRevision & {
  readonly url: typeof ExternalHttpsUrl.Type;
};

export type SetPreviewCommand = ExpectedRevision & {
  readonly formVersion: FormDefinitionVersionId;
  readonly timeZone: ConferenceTimeZone;
};

export type OpenCommand = ExpectedRevision & {
  readonly at: DateTime.Utc;
};

export type RegistrarReadinessIssue =
  | ReadinessIssue
  | {
      readonly code: 'stripe-unavailable' | 'workflows-unavailable';
      readonly message: string;
    };

export class ChannelNotFound extends Schema.TaggedErrorClass<ChannelNotFound>()(
  'Registrar.ChannelNotFound',
  { conference: ConferenceSlug },
) {
  static is = Schema.is(this);
}

export class RevisionConflict extends Schema.TaggedErrorClass<RevisionConflict>()(
  'Registrar.RevisionConflict',
  {
    conference: ConferenceSlug,
    expected: Schema.Int,
    actual: Schema.Int,
  },
) {
  static is = Schema.is(this);
}

export class InvalidTransition extends Schema.TaggedErrorClass<InvalidTransition>()(
  'Registrar.InvalidTransition',
  {
    conference: ConferenceSlug,
    from: Schema.String,
    to: Schema.String,
  },
) {
  static is = Schema.is(this);
}

export class ChannelNotReady extends Schema.TaggedErrorClass<ChannelNotReady>()(
  'Registrar.ChannelNotReady',
  {
    conference: ConferenceSlug,
    issues: Schema.Array(
      Schema.Struct({ code: Schema.String, message: Schema.String }),
    ),
  },
) {
  static is = Schema.is(this);
}

export class ActiveOrders extends Schema.TaggedErrorClass<ActiveOrders>()(
  'Registrar.ActiveOrders',
  { conference: ConferenceSlug, count: Schema.Int },
) {
  static is = Schema.is(this);
}

export class RegistrarPersistenceError extends Schema.TaggedErrorClass<RegistrarPersistenceError>()(
  'Registrar.PersistenceError',
  { operation: Schema.String },
) {
  static is = Schema.is(this);
}

type DomainError =
  | ChannelNotFound
  | RevisionConflict
  | InvalidTransition
  | ChannelNotReady
  | ActiveOrders
  | RegistrarPersistenceError;

const isDomainError = (error: unknown): error is DomainError =>
  ChannelNotFound.is(error) ||
  RevisionConflict.is(error) ||
  InvalidTransition.is(error) ||
  ChannelNotReady.is(error) ||
  ActiveOrders.is(error) ||
  RegistrarPersistenceError.is(error);

const persistenceError =
  <E>(operation: string) =>
  (error: E): Extract<E, DomainError> | RegistrarPersistenceError =>
    isDomainError(error)
      ? (error as Extract<E, DomainError>)
      : new RegistrarPersistenceError({ operation });

const mapPersistence = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  operation: string,
): Effect.Effect<
  A,
  Extract<E, DomainError> | RegistrarPersistenceError,
  R
> => effect.pipe(Effect.mapError(persistenceError<E>(operation)));

interface ChannelRow {
  readonly conferenceSlug: string;
  readonly state: string;
  readonly externalUrl: string | null;
  readonly formDefinitionVersionId: string | null;
  readonly conferenceTimezone: string | null;
  readonly revision: number;
  readonly updatedAt: string;
}

interface DefinitionRow {
  readonly definitionJson: string;
}

const decodeUpdatedAt = Schema.decodeUnknownEffect(
  Schema.DateTimeUtcFromString,
);
const decodeDefinition = Schema.decodeUnknownEffect(
  Schema.fromJsonString(FormDefinition),
);

const decodeChannel = Effect.fn('Registrar.decodeChannel')(function* (
  row: ChannelRow,
) {
  const base: ChannelBase = {
    conference: ConferenceSlug.make(row.conferenceSlug),
    revision: row.revision,
    updatedAt: yield* decodeUpdatedAt(row.updatedAt),
  };
  switch (row.state) {
    case 'closed':
      return { ...base, state: 'closed' } as const;
    case 'external':
      return {
        ...base,
        state: 'external',
        url: ExternalHttpsUrl.make(row.externalUrl ?? ''),
      } as const;
    case 'preview':
    case 'open':
    case 'draining':
      return {
        ...base,
        state: row.state,
        formVersion: FormDefinitionVersionId.make(
          row.formDefinitionVersionId ?? '',
        ),
        timeZone: ConferenceTimeZone.make(row.conferenceTimezone ?? ''),
      } as const;
    default:
      return yield* Effect.die(`Unknown registration channel state: ${row.state}`);
  }
});

const rowSelection = `
  conference_slug AS "conferenceSlug",
  state,
  external_url AS "externalUrl",
  form_definition_version_id AS "formDefinitionVersionId",
  conference_timezone AS "conferenceTimezone",
  revision,
  updated_at::text AS "updatedAt"
`;

export class Infrastructure extends Context.Service<
  Infrastructure,
  {
    readonly readiness: Effect.Effect<{
      readonly stripe: boolean;
      readonly workflows: boolean;
    }>;
  }
>()('@gycc/app/registration/RegistrarInfrastructure') {}

export const infrastructureLayer = Layer.effect(
  Infrastructure,
  Effect.gen(function* () {
    const stripe = yield* StripeGateway.Service;
    yield* OrderActor.Sender;
    return Infrastructure.of({
      readiness: Effect.succeed({
        stripe: stripe.available,
        workflows: true,
      }),
    });
  }),
);

export class Service extends Context.Service<
  Service,
  {
    readonly ensureClosed: (
      conference: typeof ConferenceSlug.Type,
    ) => Effect.Effect<Channel, RegistrarPersistenceError>;
    readonly get: (
      conference: typeof ConferenceSlug.Type,
    ) => Effect.Effect<Channel, ChannelNotFound | RegistrarPersistenceError>;
    readonly setExternal: (
      command: SetExternalCommand,
    ) => Effect.Effect<
      Channel,
      | ChannelNotFound
      | RevisionConflict
      | InvalidTransition
      | ActiveOrders
      | RegistrarPersistenceError
    >;
    readonly setPreview: (
      command: SetPreviewCommand,
    ) => Effect.Effect<
      Channel,
      | ChannelNotFound
      | RevisionConflict
      | InvalidTransition
      | RegistrarPersistenceError
    >;
    readonly open: (
      command: OpenCommand,
    ) => Effect.Effect<
      Channel,
      | ChannelNotFound
      | RevisionConflict
      | InvalidTransition
      | ChannelNotReady
      | RegistrarPersistenceError
    >;
    readonly beginDrain: (
      command: ExpectedRevision,
    ) => Effect.Effect<
      Channel,
      | ChannelNotFound
      | RevisionConflict
      | InvalidTransition
      | RegistrarPersistenceError
    >;
    readonly reopen: (
      command: OpenCommand,
    ) => Effect.Effect<
      Channel,
      | ChannelNotFound
      | RevisionConflict
      | InvalidTransition
      | ChannelNotReady
      | RegistrarPersistenceError
    >;
    readonly close: (
      command: ExpectedRevision,
    ) => Effect.Effect<
      Channel,
      | ChannelNotFound
      | RevisionConflict
      | InvalidTransition
      | ActiveOrders
      | RegistrarPersistenceError
    >;
  }
>()('@gycc/app/registration/Registrar') {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    const infrastructure = yield* Infrastructure;

    const select = Effect.fn('Registrar.select')(function* (
      conference: typeof ConferenceSlug.Type,
      forUpdate: boolean,
    ) {
      const rows = forUpdate
        ? yield* sql<ChannelRow>`
            SELECT ${sql.unsafe(rowSelection)}
            FROM registration_channels
            WHERE conference_slug = ${conference}
            FOR UPDATE
          `
        : yield* sql<ChannelRow>`
            SELECT ${sql.unsafe(rowSelection)}
            FROM registration_channels
            WHERE conference_slug = ${conference}
          `;
      const row = Option.fromNullishOr(rows[0]);
      if (Option.isNone(row)) {
        return yield* new ChannelNotFound({ conference });
      }
      return yield* decodeChannel(row.value);
    });

    const assertRevision = Effect.fn('Registrar.assertRevision')(function* (
      channel: Channel,
      expected: number,
    ) {
      if (channel.revision !== expected) {
        return yield* new RevisionConflict({
          conference: channel.conference,
          expected,
          actual: channel.revision,
        });
      }
    });

    const save = Effect.fn('Registrar.save')(function* (
      conference: typeof ConferenceSlug.Type,
      state: Channel['state'],
      externalUrl: string | null,
      formVersion: string | null,
      timeZone: string | null,
    ) {
      const rows = yield* sql<ChannelRow>`
        UPDATE registration_channels
        SET
          state = ${state},
          external_url = ${externalUrl},
          form_id = ${formVersion === null ? null : 'registration'},
          form_definition_version_id = ${formVersion},
          conference_timezone = ${timeZone},
          revision = revision + 1,
          updated_at = now()
        WHERE conference_slug = ${conference}
        RETURNING ${sql.unsafe(rowSelection)}
      `;
      const row = Option.fromNullishOr(rows[0]);
      if (Option.isNone(row)) {
        return yield* new ChannelNotFound({ conference });
      }
      return yield* decodeChannel(row.value);
    });

    const assertNoActiveOrders = Effect.fn(
      'Registrar.assertNoActiveOrders',
    )(function* (conference: typeof ConferenceSlug.Type) {
      const rows = yield* sql<{ count: number }>`
        SELECT count(*)::integer AS count
        FROM registration_orders AS registration_order
        INNER JOIN registrations AS registration
          ON registration.registration_id = registration_order.registration_id
        WHERE registration.conference_slug = ${conference}
          AND registration_order.status IN (
            'preparing_checkout',
            'awaiting_payment',
            'awaiting_async',
            'refund_pending'
          )
      `;
      const count = rows[0]?.count ?? 0;
      if (count > 0) {
        return yield* new ActiveOrders({ conference, count });
      }
    });

    const assertOpenReady = Effect.fn('Registrar.assertOpenReady')(function* (
      channel: PinnedChannel,
      at: DateTime.Utc,
    ) {
      const definitions = yield* sql<DefinitionRow>`
        SELECT definition::text AS "definitionJson"
        FROM form_definition_versions
        WHERE form_id = 'registration'
          AND version_id = ${channel.formVersion}
      `;
      const definition = Option.fromNullishOr(definitions[0]);
      if (Option.isNone(definition)) {
        return yield* new ChannelNotReady({
          conference: channel.conference,
          issues: [{
            code: 'registration-pricing-missing',
            message: 'The pinned Registration Form version is unavailable.',
          }],
        });
      }
      const issues: RegistrarReadinessIssue[] = [
        ...compileForm(
          yield* decodeDefinition(definition.value.definitionJson),
        ).readiness(at),
      ];
      const available = yield* infrastructure.readiness;
      if (!available.stripe) {
        issues.push({
          code: 'stripe-unavailable',
          message: 'Stripe Checkout is not configured.',
        });
      }
      if (!available.workflows) {
        issues.push({
          code: 'workflows-unavailable',
          message: 'The durable Registration worker is not ready.',
        });
      }
      if (issues.length > 0) {
        return yield* new ChannelNotReady({
          conference: channel.conference,
          issues,
        });
      }
    });

    const ensureClosed = Effect.fn('Registrar.ensureClosed')(function* (
      conference: typeof ConferenceSlug.Type,
    ) {
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`
            INSERT INTO registration_channels (conference_slug, state)
            VALUES (${conference}, 'closed')
            ON CONFLICT (conference_slug) DO NOTHING
          `;
          return yield* select(conference, true);
        }),
      );
    });

    const get = Effect.fn('Registrar.get')(function* (
      conference: typeof ConferenceSlug.Type,
    ) {
      return yield* select(conference, false);
    });

    const setExternal = Effect.fn('Registrar.setExternal')(function* (
      command: SetExternalCommand,
    ) {
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          const current = yield* select(command.conference, true);
          yield* assertRevision(current, command.expectedRevision);
          if (current.state === 'open') {
            return yield* new InvalidTransition({
              conference: command.conference,
              from: current.state,
              to: 'external',
            });
          }
          if (current.state === 'draining') {
            yield* assertNoActiveOrders(command.conference);
          }
          return yield* save(
            command.conference,
            'external',
            command.url,
            null,
            null,
          );
        }),
      );
    });

    const setPreview = Effect.fn('Registrar.setPreview')(function* (
      command: SetPreviewCommand,
    ) {
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          const current = yield* select(command.conference, true);
          yield* assertRevision(current, command.expectedRevision);
          if (current.state === 'open' || current.state === 'draining') {
            return yield* new InvalidTransition({
              conference: command.conference,
              from: current.state,
              to: 'preview',
            });
          }
          return yield* save(
            command.conference,
            'preview',
            null,
            command.formVersion,
            command.timeZone,
          );
        }),
      );
    });

    const open = Effect.fn('Registrar.open')(function* (
      command: OpenCommand,
    ) {
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          const current = yield* select(command.conference, true);
          yield* assertRevision(current, command.expectedRevision);
          if (current.state !== 'preview') {
            return yield* new InvalidTransition({
              conference: command.conference,
              from: current.state,
              to: 'open',
            });
          }
          yield* assertOpenReady(current, command.at);
          return yield* save(
            command.conference,
            'open',
            null,
            current.formVersion,
            current.timeZone,
          );
        }),
      );
    });

    const transition = (
      name: string,
      from: Channel['state'],
      to: Channel['state'],
    ) =>
      Effect.fn(name)(function* (command: ExpectedRevision) {
        return yield* sql.withTransaction(
          Effect.gen(function* () {
            const current = yield* select(command.conference, true);
            yield* assertRevision(current, command.expectedRevision);
            if (current.state !== from) {
              return yield* new InvalidTransition({
                conference: command.conference,
                from: current.state,
                to,
              });
            }
            if (
              current.state !== 'preview' &&
              current.state !== 'open' &&
              current.state !== 'draining'
            ) {
              return yield* Effect.die('First-party transition lost its pin');
            }
            return yield* save(
              command.conference,
              to,
              null,
              current.formVersion,
              current.timeZone,
            );
          }),
        );
      });

    const beginDrain = transition(
      'Registrar.beginDrain',
      'open',
      'draining',
    );
    const reopen = Effect.fn('Registrar.reopen')(function* (
      command: OpenCommand,
    ) {
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          const current = yield* select(command.conference, true);
          yield* assertRevision(current, command.expectedRevision);
          if (current.state !== 'draining') {
            return yield* new InvalidTransition({
              conference: command.conference,
              from: current.state,
              to: 'open',
            });
          }
          yield* assertOpenReady(current, command.at);
          return yield* save(
            command.conference,
            'open',
            null,
            current.formVersion,
            current.timeZone,
          );
        }),
      );
    });

    const close = Effect.fn('Registrar.close')(function* (
      command: ExpectedRevision,
    ) {
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          const current = yield* select(command.conference, true);
          yield* assertRevision(current, command.expectedRevision);
          if (current.state === 'open') {
            return yield* new InvalidTransition({
              conference: command.conference,
              from: current.state,
              to: 'closed',
            });
          }
          if (current.state === 'draining') {
            yield* assertNoActiveOrders(command.conference);
          }
          if (current.state === 'closed') return current;
          return yield* save(
            command.conference,
            'closed',
            null,
            null,
            null,
          );
        }),
      );
    });

    return Service.of({
      ensureClosed: (conference) =>
        mapPersistence(ensureClosed(conference), 'ensure closed channel').pipe(
          Effect.catchTag(
            'Registrar.ChannelNotFound',
            () =>
              new RegistrarPersistenceError({
                operation: 'ensure closed channel',
              }),
          ),
        ),
      get: (conference) =>
        mapPersistence(get(conference), 'read channel'),
      setExternal: (command) =>
        mapPersistence(setExternal(command), 'set external channel'),
      setPreview: (command) =>
        mapPersistence(setPreview(command), 'set preview channel'),
      open: (command) =>
        mapPersistence(open(command), 'open channel'),
      beginDrain: (command) =>
        mapPersistence(beginDrain(command), 'begin channel drain'),
      reopen: (command) =>
        mapPersistence(reopen(command), 'reopen channel'),
      close: (command) =>
        mapPersistence(close(command), 'close channel'),
    });
  }),
);
