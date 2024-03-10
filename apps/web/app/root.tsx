import { LinksFunction, LoaderFunctionArgs } from '@remix-run/node';
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
} from '@remix-run/react';

import { ClientHintCheck, getHints } from './lib/client-hints';
import tailwindHref from './tailwind.css?url';

export const links: LinksFunction = () => {
  return [{ rel: 'stylesheet', href: tailwindHref }];
};

export const loader = ({ request }: LoaderFunctionArgs) => {
  return {
    requestInfo: {
      hints: getHints(request),
      path: new URL(request.url).pathname,
    },
  };
};

export function Layout({ children }: { children: React.ReactNode }) {
  const data = useLoaderData<typeof loader>();
  return (
    <html
      lang="en"
      className={data.requestInfo.hints.theme === 'dark' ? 'dark' : undefined}
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
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}
