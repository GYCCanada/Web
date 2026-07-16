import { Layer } from 'effect';

import { DatabaseTest } from '../database.test-helper';
import { Env } from '../env.server';
import { Mailer } from '../mailer.server';
import { Storage } from '../storage.server';
import { makeAppLayer } from './runtime';

/** Complete isolated app layer for route and service integration tests. */
export const makeTestAppLayer = (
  storageLayer: Layer.Layer<Storage.Service, never, Env.Service>,
  mailerLayer: Layer.Layer<Mailer.Service, never, Env.Service> = Mailer.layer,
) => makeAppLayer(storageLayer, DatabaseTest.layer, mailerLayer, 'memory');
