export * as DatabaseTest from './database.test-helper';

import { PgliteClient } from '@effect/sql-pglite';

import { makeLayer } from './database.server';

/** PGlite-backed adapter isolated from the production server module graph. */
export const layer = makeLayer(PgliteClient.layer({}));
