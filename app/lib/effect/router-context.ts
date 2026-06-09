import { Context } from 'effect';
import type { LoaderFunctionArgs, RouterContextProvider } from 'react-router';

export type RouteArgs = LoaderFunctionArgs<Omit<RouterContextProvider, '#private'>>;

export class ReactRouterContext extends Context.Service<
  ReactRouterContext,
  Readonly<RouteArgs>
>()('gycc/lib/effect/router-context/ReactRouterContext') {}
