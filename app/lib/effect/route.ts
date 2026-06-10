import { Effect } from 'effect';

import { ReactRouterContext, type RouteArgs } from './router-context';
import type { AppError, AppServices } from './runtime';

type RouteServices = AppServices | ReactRouterContext;

export const routeHandler =
  <Eff extends Effect.Yieldable<any, any, any, RouteServices>, AEff>(
    body: () => Generator<Eff, AEff, never>,
  ) =>
  (args: RouteArgs): Promise<AEff> =>
    args.context.runtime.run(
      args,
      Effect.gen(body) as Effect.Effect<AEff, AppError, RouteServices>,
    );

export const routeAction =
  <Eff extends Effect.Yieldable<any, any, any, RouteServices>, AEff>(
    body: () => Generator<Eff, AEff, never>,
  ) =>
  (args: RouteArgs): Promise<AEff> =>
    args.context.runtime.run(
      args,
      Effect.gen(body) as Effect.Effect<AEff, AppError, RouteServices>,
    );
