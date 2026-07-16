export * as Database from './database.server';

import { PgClient } from '@effect/sql-pg';
import { Config, Context, Effect, Layer, Schema } from 'effect';
import * as Migrator from 'effect/unstable/sql/Migrator';
import { SqlClient } from 'effect/unstable/sql/SqlClient';

import { loader } from './database/migrations';

export class DatabaseUnavailable extends Schema.TaggedErrorClass<DatabaseUnavailable>()(
  'gycc/DatabaseUnavailable',
  { operation: Schema.String },
) {}

export class Service extends Context.Service<
  Service,
  {
    readonly ready: Effect.Effect<void, DatabaseUnavailable>;
  }
>()('gycc/lib/database.server/Service') {}

export const makeLayer = <A, E, R>(clientLayer: Layer.Layer<A, E, R>) => {
  const migratedClient = Layer.effectDiscard(
    Migrator.make({})({ loader }),
  ).pipe(Layer.provideMerge(clientLayer));

  return Layer.effect(
    Service,
    Effect.gen(function* () {
      const sql = yield* SqlClient;
      const ready = sql`SELECT 1`.pipe(
        Effect.asVoid,
        Effect.mapError(
          () => new DatabaseUnavailable({ operation: 'readiness check' }),
        ),
      );
      return Service.of({ ready });
    }),
  ).pipe(Layer.provideMerge(migratedClient));
};

export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const url = yield* Config.redacted('DATABASE_URL');
    return makeLayer(PgClient.layer({ url, applicationName: 'gycc' }));
  }),
);
