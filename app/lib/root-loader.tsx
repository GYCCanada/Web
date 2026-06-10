import { useRouteLoaderData } from 'react-router';

import type { loader } from '~/root';

export function useRootLoader() {
  return useRouteLoaderData<typeof loader>('root');
}
