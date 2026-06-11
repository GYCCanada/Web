import { Context } from 'effect';
import type { LoaderFunctionArgs, RouterContextProvider } from 'react-router';

/**
 * Loader/action args carried through the Effect runtime as the
 * {@link ReactRouterContext} service.
 *
 * `LoaderFunctionArgs` (RR 7.17, via `DataFunctionArgs`) declares `url: URL`
 * unconditionally — it is part of the base arg type, not gated behind
 * `future.v8_passThroughRequests` (the flag only changes whether `url` is the
 * normalized or raw request URL at runtime). Consumers that destructure `url`
 * from this context (contact/volunteer/newsletter/root) therefore typecheck
 * against a guaranteed field; no intersection with `{ url: URL }` is required.
 */
export type RouteArgs = LoaderFunctionArgs<Omit<RouterContextProvider, '#private'>>;

export class ReactRouterContext extends Context.Service<
  ReactRouterContext,
  Readonly<RouteArgs>
>()('gycc/lib/effect/router-context/ReactRouterContext') {}
