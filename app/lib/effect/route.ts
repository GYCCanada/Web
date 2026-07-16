import { Effect } from 'effect';

import { ReactRouterContext, type RouteArgs } from './router-context';
import type { AppServices } from './runtime';

type RouteServices = AppServices | ReactRouterContext;
type GeneratorError<Eff> = [Eff] extends [never]
  ? never
  : [Eff] extends [Effect.Effect<unknown, infer E, unknown>]
    ? E
    : never;
type GeneratorServices<Eff> = [Eff] extends [never]
  ? never
  : [Eff] extends [Effect.Effect<unknown, unknown, infer R>]
    ? R & RouteServices
    : never;

export const routeHandler =
  <Eff extends Effect.Effect<unknown, unknown, RouteServices>, AEff>(
    body: () => Generator<Eff, AEff, never>,
  ) =>
  (args: RouteArgs): Promise<AEff> => {
    // TS 7 does not reduce Effect.gen's conditional error/service extraction
    // back to the equivalent named aliases at this generic call site.
    const effect = Effect.gen(body) as Effect.Effect<
      AEff,
      GeneratorError<Eff>,
      GeneratorServices<Eff>
    >;
    return args.context.runtime.run<
      AEff,
      GeneratorError<Eff>,
      GeneratorServices<Eff>
    >(args, effect);
  };

export const routeAction =
  <Eff extends Effect.Effect<unknown, unknown, RouteServices>, AEff>(
    body: () => Generator<Eff, AEff, never>,
  ) =>
  (args: RouteArgs): Promise<AEff> => {
    // See routeHandler: this preserves Effect.gen's exact inferred channels.
    const effect = Effect.gen(body) as Effect.Effect<
      AEff,
      GeneratorError<Eff>,
      GeneratorServices<Eff>
    >;
    return args.context.runtime.run<
      AEff,
      GeneratorError<Eff>,
      GeneratorServices<Eff>
    >(args, effect);
  };
