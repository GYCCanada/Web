import { LoaderFunctionArgs } from '@remix-run/node';
import {
  Outlet,
  Link as RLink,
  useLoaderData,
  useLocation,
} from '@remix-run/react';
import { getCurrentConference } from '~/lib/conference.server';
import { useTranslate } from '~/lib/localization/context';
import { Locale } from '~/lib/localization/localization';
import { getTranslation } from '~/lib/localization/localization.server';
import { LocalizationProvider } from '~/lib/localization/provider';
import { root } from '~/lib/localization/translations';
import { ExternalLink, linkStyle } from '~/ui/external-link';
import { CloseIcon, LanguageIcon, MenuIcon } from '~/ui/icon';
import { Link } from '~/ui/link';
import { Portal } from '~/ui/portal';
import { AnimatePresence, motion } from 'framer-motion';
import { FacebookIcon, InstagramIcon, YoutubeIcon } from 'lucide-react';
import * as React from 'react';
import { Button } from 'react-aria-components';
import { ClientOnly } from 'remix-utils/client-only';
import { match } from 'ts-pattern';

export const loader = ({ params }: LoaderFunctionArgs) => {
  const translation = getTranslation(params, root);
  const currentConference = getCurrentConference(
    ((params.lang as Locale) || undefined) ?? Locale.En,
  );
  return { ...translation, currentConference };
};

export default function Layout() {
  const { translation } = useLoaderData<typeof loader>();
  return (
    <LocalizationProvider translation={translation}>
      <Nav />
      <Outlet />
      <Footer />
    </LocalizationProvider>
  );
}

function Nav() {
  const [open, setOpen] = React.useState(false);
  const toggle = () => setOpen((prev) => !prev);
  const translate = useTranslate();

  React.useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'auto';
    }
  }, [open]);

  return (
    <>
      <nav className="bg-background text-foreground sticky inset-x-0 top-0 z-10 flex h-[60px] items-center justify-between gap-4 px-3 py-2">
        <Link
          to="/"
          onClick={() => {
            setOpen(false);
          }}
        >
          <img
            src="/logo/gycc-logo-small-red.png"
            alt="GYCC Logo"
            className="size-[44px]"
          />
        </Link>

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
                  variants={{
                    hidden: { opacity: 0, y: -10 },
                    show: {
                      opacity: 1,
                      y: 0,
                      transition: {
                        staggerChildren: 0.1,
                        ease: 'easeInOut',
                        type: 'tween',
                        stiffness: 100,
                        damping: 20,
                      },
                    },
                  }}
                  initial="hidden"
                  animate="show"
                  exit="hidden"
                  transition={{ duration: 0.2 }}
                  className="bg-background text-foreground fixed inset-x-0 top-[60px] flex h-[calc(100%_-_60px)] flex-1 flex-col justify-center gap-10 p-4"
                >
                  <NavItem
                    onClick={() => {
                      setOpen(false);
                    }}
                    to="/"
                  >
                    {translate('nav.home')}
                  </NavItem>
                  <NavItem
                    onClick={() => {
                      setOpen(false);
                    }}
                    to="/about"
                  >
                    {translate('nav.about')}
                  </NavItem>
                  <NavItem
                    onClick={() => {
                      setOpen(false);
                    }}
                    to="/team"
                  >
                    {translate('nav.team')}
                  </NavItem>
                  <NavItem
                    onClick={() => {
                      setOpen(false);
                    }}
                    to="/contact"
                  >
                    {translate('nav.contact')}
                  </NavItem>
                  <NavItem
                    onClick={() => {
                      setOpen(false);
                    }}
                    to="/give"
                  >
                    {translate('nav.give')}
                  </NavItem>
                  <NavItem
                    onClick={() => {
                      setOpen(false);
                    }}
                    to="/volunteer"
                  >
                    {translate('nav.volunteer')}
                  </NavItem>
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
      <RLink
        className="flex items-center gap-2"
        to={getNextLocalePath(location.pathname, Locale.Fr)}
      >
        English <LanguageIcon />
      </RLink>
    ))
    .with('fr', () => (
      <RLink
        className="flex items-center gap-2"
        to={getNextLocalePath(location.pathname, Locale.En)}
      >
        Français <LanguageIcon />
      </RLink>
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

const MotionLink = motion(Link);

function NavItem({
  to,
  children,
  ...props
}: {
  to: string;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  const location = useLocation();
  const splitPathname = location.pathname.split('/');

  // sometimes the path may have the locale in it, so we need to remove it
  const filteredPath = splitPathname.filter(
    (part) => !Object.values(Locale).includes(part as Locale),
  );
  const activeLocale = splitPathname.find((part) =>
    Object.values(Locale).includes(part as Locale),
  );

  const isActive =
    to === '/'
      ? filteredPath.every((part) => part === '')
      : filteredPath.join('/').startsWith(to);

  return (
    <MotionLink
      {...props}
      to={activeLocale ? `/${activeLocale}${to}` : to}
      variants={{
        hidden: { opacity: 0, y: -10 },
        show: { opacity: 1, y: 0 },
      }}
      className={
        'data-[active]:text-accent-600 hover:text-accent-500 active:text-accent-700 text-5xl font-medium uppercase duration-200'
      }
      data-active={isActive ? '' : undefined}
    >
      {children}
    </MotionLink>
  );
}

function Footer() {
  const translate = useTranslate();
  const { currentConference } = useLoaderData<typeof loader>();
  return (
    <footer className="bg-background text-foreground flex flex-col gap-12 px-4 py-10">
      <div className="flex flex-col gap-3">
        <p>{translate('footer.copy')}</p>
        <div className="flex items-center gap-4">
          <a
            href="https://www.instagram.com/gyccanada"
            target="_blank"
            rel="noopener noreferrer"
          >
            <InstagramIcon className="size-6" />
          </a>
          <a
            href="https://www.youtube.com/@gyccanada"
            target="_blank"
            rel="noopener noreferrer"
          >
            <YoutubeIcon className="size-6" />
          </a>
          <a
            href="https://www.facebook.com/GYCCanada"
            target="_blank"
            rel="noopener noreferrer"
          >
            <FacebookIcon className="size-6" />
          </a>
        </div>
        <p>291 Queen Street, Strathroy Ontario N7G 2J3</p>
      </div>

      <div className="flex flex-col gap-2">
        <Link to={`/`} className={linkStyle}>
          {currentConference.name} {currentConference.year}
        </Link>
        <Link to="/about" className={linkStyle}>
          {translate('nav.about')}
        </Link>
        <Link to="/contact" className={linkStyle}>
          {translate('nav.contact')}
        </Link>
        <Link to="/give" className={linkStyle}>
          {translate('nav.give')}
        </Link>
      </div>

      <p>
        {translate('footer.affiliation', {
          gyc: (
            <ExternalLink
              href="https://gycweb.org"
              className="text-accent-600 hover:text-accent-500 active:text-accent-700"
            >
              GYC
            </ExternalLink>
          ),
        })}
      </p>
    </footer>
  );
}
