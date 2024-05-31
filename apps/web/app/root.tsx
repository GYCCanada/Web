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
import { getToast } from './lib/toast.server';
import { Toaster } from './ui/toaster';

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
        <script
          dangerouslySetInnerHTML={{
            __html:
              "if (window.location.host !== 'gyccanada.org');window.goatcounter = {no_onload: true}",
          }}
        />
        <script
          data-goatcounter="https://gyccanada.goatcounter.com/count"
          async
          src="//gc.zgo.at/count.js"
        />
      </body>
    </html>
  );
}

export default function App() {
  return (
    <>
      <Outlet />
      <Toaster closeButton position="bottom-right" />
    </>
  );
}

export function ErrorBoundary() {
  return (
    <Main className="flex h-screen flex-col items-center justify-center">
      <h1>Something went wrong...</h1>
    </Main>
  );
}
