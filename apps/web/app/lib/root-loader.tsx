import { useRouteLoaderData } from '@remix-run/react';

import type { loader } from '~/root';

export function useRootLoader() {
  return useRouteLoaderData<typeof loader>('root');
}
