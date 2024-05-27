import { useRouteLoaderData } from '@remix-run/react';

import { loader } from '~/root';

export function useRootLoader() {
  return useRouteLoaderData<typeof loader>('root');
}
