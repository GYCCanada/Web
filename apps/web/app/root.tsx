import { LoaderFunctionArgs } from '@remix-run/node';
import {
  json,
  Links,
  Meta,
  Outlet,
  Scripts,
  useLoaderData,
} from '@remix-run/react';

import { ClientHintCheck, getHints } from './lib/client-hints';
import { Main } from './ui/main';

import './tailwind.css';

import { combineHeaders } from './lib/misc';
import { useToast } from './lib/toast.client';
import { getToast } from './lib/toast.server';

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { toast, headers: toastHeaders } = await getToast(request);
  return json(
    {
      requestInfo: {
        hints: getHints(request),
        path: new URL(request.url).pathname,
      },
      toast,
    },
    {
      headers: combineHeaders(toastHeaders),
    },
  );
};

export function Layout({ children }: { children: React.ReactNode }) {
  const data = useLoaderData<typeof loader>();
  return (
    <html
      lang="en"
      className={data?.requestInfo.hints.theme === 'dark' ? 'dark' : undefined}
    >
      <head>
        <ClientHintCheck />
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  const data = useLoaderData<typeof loader>();
  useToast(data.toast);
  return <Outlet />;
}

export function ErrorBoundary() {
  return (
    <Main className="flex h-screen flex-col items-center justify-center">
      <h1>Something went wrong...</h1>
    </Main>
  );
}
