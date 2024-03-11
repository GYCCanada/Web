import { LoaderFunctionArgs } from '@remix-run/node';
import { Link, Outlet, useLoaderData, useLocation } from '@remix-run/react';
import { useTranslate } from '~/lib/localization/context';
import { Locale } from '~/lib/localization/localization';
import { getTranslation } from '~/lib/localization/localization.server';
import { LocalizationProvider } from '~/lib/localization/provider';
import { root } from '~/lib/localization/translations';
import { CloseIcon, LanguageIcon, MenuIcon } from '~/ui/icon';
import { Portal } from '~/ui/portal';
import { AnimatePresence, motion } from 'framer-motion';
import * as React from 'react';
import { Button } from 'react-aria-components';
import { ClientOnly } from 'remix-utils/client-only';
import { match } from 'ts-pattern';

export const loader = ({ params }: LoaderFunctionArgs) => {
  const translation = getTranslation(params, root);
  return { ...translation };
};

export default function Layout() {
  const { translation } = useLoaderData<typeof loader>();
  return (
    <LocalizationProvider translation={translation}>
      <Nav />
      <Outlet />
    </LocalizationProvider>
  );
}

function Nav() {
  const [open, setOpen] = React.useState(false);
  const toggle = () => setOpen((prev) => !prev);
  const translate = useTranslate();
  return (
    <>
      <nav className="bg-background text-foreground sticky inset-x-0 top-0 flex h-[60px] items-center justify-between gap-4 px-3 py-2">
        <img
          src="/gycc-logo-small-red.png"
          alt="GYCC Logo"
          className="size-[44px]"
        />

        <div className="flex items-center gap-6">
          <Language />
          <Button
            className="text-accent-600 p-2 hover:bg-neutral-100 focus:outline-none data-[pressed]:bg-neutral-200 dark:hover:bg-neutral-800 dark:data-[pressed]:bg-neutral-700"
            onPress={toggle}
          >
            {open ? <CloseIcon /> : <MenuIcon />}
          </Button>
        </div>
      </nav>
      <ClientOnly>
        {() => (
          <Portal>
            <AnimatePresence>
              {open ? (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                  className="bg-background text-foreground fixed inset-x-0 top-[60px] flex h-[calc(100%_-_60px)] flex-1 flex-col justify-center gap-10 p-4"
                >
                  <NavItem to="/">{translate('nav.home')}</NavItem>
                  <NavItem to="/about">{translate('nav.about')}</NavItem>
                  <NavItem to="/contact">{translate('nav.contact')}</NavItem>
                  <NavItem to="/donate">{translate('nav.donate')}</NavItem>
                  <NavItem to="/join">{translate('nav.join')}</NavItem>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </Portal>
        )}
      </ClientOnly>
    </>
  );
}

function Language() {
  const { lang } = useLoaderData<typeof loader>();
  const location = useLocation();

  return match(lang)
    .with('en', () => (
      <Link
        className="flex items-center gap-2"
        to={getNextLocalePath(location.pathname, Locale.Fr)}
      >
        English <LanguageIcon />
      </Link>
    ))
    .with('fr', () => (
      <Link
        className="flex items-center gap-2"
        to={getNextLocalePath(location.pathname, Locale.En)}
      >
        Français <LanguageIcon />
      </Link>
    ))
    .exhaustive();
}

function getNextLocalePath(path: string, nextLocale: Locale): string {
  return match(nextLocale)
    .with('en', () => path.replace(/^\/fr/, ''))
    .with('fr', () => {
      const parts = path.split('/');
      parts.splice(1, 0, 'fr');
      return parts.join('/');
    })
    .exhaustive();
}

function NavItem({
  to,
  children,
  ...props
}: {
  to: string;
  children: React.ReactNode;
}) {
  const location = useLocation();
  const pathname = location.pathname.split('/');

  // sometimes the path may have the locale in it, so we need to remove it
  const filteredPath = pathname.filter(
    (part) => !Object.values(Locale).includes(part as Locale),
  );
  const isActive = filteredPath.join('/').startsWith(to);

  return (
    <Link
      {...props}
      to={to}
      className={'data-[active]:text-accent-600 text-5xl font-medium uppercase'}
      data-active={isActive ? '' : undefined}
    >
      {children}
    </Link>
  );
}
