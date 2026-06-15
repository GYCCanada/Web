import {
  Outlet,
  Link as RLink,
  useLoaderData,
  useLocation,
} from "react-router";
import dayjs from "dayjs";
import { AnimatePresence, motion } from "framer-motion";
import { FacebookIcon, InstagramIcon, YoutubeIcon } from "lucide-react";
import * as React from "react";
import { Button } from "@base-ui/react/button";
import { ClientOnly } from "remix-utils/client-only";
import { match } from "ts-pattern";

import { Breakpoint, useBreakpoint } from "~/lib/client-hints";
import { Content } from "~/lib/content.server";
import { ReactRouterContext } from "~/lib/effect/router-context";
import { routeHandler } from "~/lib/effect/route";
import { useTranslate } from "~/lib/localization/context";
import { getLocale, Locale } from "~/lib/localization/localization";
import { LocalizationProvider } from "~/lib/localization/provider";
import { useRootLoader } from "~/lib/root-loader";
import { useToast } from "~/lib/toast";
import { ExternalLink, linkStyle } from "~/ui/external-link";
import { CloseIcon, LanguageIcon, MenuIcon } from "~/ui/icon";
import { Link } from "~/ui/link";
import { Portal } from "~/ui/portal";

export const loader = routeHandler(function* () {
  const { params } = yield* ReactRouterContext;
  const lang = getLocale(params);
  const content = yield* Content.Service;
  const translation = yield* content.getTranslations(lang);
  const currentConference = yield* content.getCurrentConference(lang);
  return { lang, translation, currentConference };
});

export default function Layout() {
  const { translation } = useLoaderData<typeof loader>();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const location = useLocation();

  React.useEffect(() => {
    containerRef.current?.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <LocalizationProvider translation={translation}>
      <Nav />
      <div
        data-scroll-container
        className="flex flex-1 flex-col overflow-y-auto overflow-x-hidden"
        ref={containerRef}
      >
        <Outlet />
        <Footer />
      </div>
      <Toast />
    </LocalizationProvider>
  );
}

function Toast() {
  const data = useRootLoader();
  useToast(data?.toast);
  return null;
}

function Nav() {
  const breakpoint = useBreakpoint();

  return match(breakpoint)
    .when(
      (bp) => bp < Breakpoint.Xl,
      () => <PopupNav />,
    )
    .otherwise(() => <TopNav />);
}

function TopNav() {
  const translate = useTranslate();

  return (
    <header className="bg-background text-foreground w-full">
      <nav className="mx-auto flex h-[60px] w-(--width) items-center justify-between gap-4 px-3 py-2">
        <Link to="/">
          <img
            src="/logo/gycc-logo-small-red.png"
            alt="GYCC Logo"
            className="size-[44px]"
          />
        </Link>
        <NavItem to={`/`}>
          {translate("nav.home", {
            year: new Date().getFullYear(),
          })}
        </NavItem>
        <NavItem to="/about">{translate("nav.about")}</NavItem>
        {/* <NavItem to="/team">{translate('nav.team')}</NavItem> */}
        <NavItem to="/contact">{translate("nav.contact")}</NavItem>
        <NavItem to="/give">{translate("nav.give")}</NavItem>
        <NavItem to="/volunteer">{translate("nav.volunteer")}</NavItem>
        <Language />
      </nav>
    </header>
  );
}

function PopupNav() {
  const [open, setOpen] = React.useState(false);
  const toggle = () => setOpen((prev) => !prev);
  const translate = useTranslate();

  const location = useLocation();

  React.useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  return (
    <header className="bg-background text-foreground w-full">
      <nav className="mx-auto flex h-[60px] w-(--width) items-center justify-between gap-4 px-3 py-2">
        <Link to="/">
          <img
            src="/logo/gycc-logo-small-red.png"
            alt="GYCC Logo"
            className="size-[44px]"
          />
        </Link>

        <div className="flex items-center gap-6">
          <Language />
          <Button
            className="text-accent-600 p-2 hover:bg-neutral-100 focus:outline-none active:bg-neutral-200 dark:hover:bg-neutral-800 dark:active:bg-neutral-700"
            onClick={toggle}
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
                <motion.nav
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="bg-background text-foreground fixed inset-x-0 top-[60px] flex h-[calc(100%_-_60px)] flex-1 flex-col justify-center gap-10 p-4"
                >
                  {[
                    {
                      to: `/${new Date().getFullYear()}`,
                      label: translate("nav.home", {
                        year: new Date().getFullYear(),
                      }),
                    },
                    { to: "/about", label: translate("nav.about") },
                    { to: "/team", label: translate("nav.team") },
                    { to: "/contact", label: translate("nav.contact") },
                    { to: "/give", label: translate("nav.give") },
                    { to: "/volunteer", label: translate("nav.volunteer") },
                  ].map((item, index) => (
                    <NavItem
                      key={item.to}
                      to={item.to}
                      revealDelay={index * STAGGER_STEP}
                    >
                      {item.label}
                    </NavItem>
                  ))}
                </motion.nav>
              ) : null}
            </AnimatePresence>
          </Portal>
        )}
      </ClientOnly>
    </header>
  );
}

function Language() {
  const { lang } = useLoaderData<typeof loader>();
  const location = useLocation();

  return match(lang)
    .with("en", () => (
      <RLink
        className="flex items-center gap-2"
        to={getNextLocalePath(location.pathname, Locale.Fr)}
      >
        Français <LanguageIcon />
      </RLink>
    ))
    .with("fr", () => (
      <RLink
        className="flex items-center gap-2"
        to={getNextLocalePath(location.pathname, Locale.En)}
      >
        English <LanguageIcon />
      </RLink>
    ))
    .exhaustive();
}

function getNextLocalePath(path: string, nextLocale: Locale): string {
  return match(nextLocale)
    .with("en", () => path.replace(/^\/fr/, ""))
    .with("fr", () => {
      const parts = path.split("/");
      parts.splice(1, 0, "fr");
      return parts.join("/");
    })
    .exhaustive();
}

const MotionLink = motion(Link);

/** Per-link delay (seconds) for the staggered PopupNav reveal. */
const STAGGER_STEP = 0.1;

function NavItem({
  to,
  children,
  revealDelay,
  ...props
}: {
  to: string;
  children: React.ReactNode;
  /**
   * When set, the link self-drives its enter animation (hidden -> show) with
   * this delay (seconds), reproducing the PopupNav staggered reveal.
   *
   * The reveal is driven per-link rather than via the parent's
   * `staggerChildren` because Framer Motion's variant-child orchestration does
   * not propagate reliably through a `motion()`-wrapped custom forwardRef
   * component (our `Link`): the parent registers the children but the variant
   * animation stalls at `hidden` (opacity:0) — the original
   * "mobile-nav-links-invisible" regression. Self-driving with an explicit
   * staggered delay restores the visual identity (ADR 0002) without depending
   * on that orchestration channel.
   *
   * TopNav (desktop) omits this, so the links render statically as before.
   */
  revealDelay?: number;
  onClick?: () => void;
}) {
  const location = useLocation();
  const splitPathname = location.pathname.split("/");

  // sometimes the path may have the locale in it, so we need to remove it
  const filteredPath = splitPathname.filter(
    (part) => !Object.values(Locale).includes(part as Locale),
  );
  const activeLocale = splitPathname.find((part) =>
    Object.values(Locale).includes(part as Locale),
  );

  const isActive =
    to === "/"
      ? filteredPath.every((part) => part === "")
      : filteredPath.join("/").startsWith(to);

  return (
    <MotionLink
      {...props}
      to={activeLocale ? `/${activeLocale}${to}` : to}
      {...(revealDelay !== undefined
        ? {
            initial: { opacity: 0, y: -10 },
            animate: { opacity: 1, y: 0 },
            transition: {
              delay: revealDelay,
              duration: 0.2,
              ease: "easeInOut",
            },
          }
        : {})}
      className={
        "data-[active]:text-accent-600 hover:text-accent-500 active:text-accent-700 text-5xl font-medium duration-200 max-xl:uppercase xl:text-base"
      }
      data-active={isActive ? "" : undefined}
    >
      {children}
    </MotionLink>
  );
}

function Footer() {
  const translate = useTranslate();
  const { currentConference } = useLoaderData<typeof loader>();
  return (
    <footer className="bg-background text-foreground">
      <div className="mx-auto flex w-(--width) flex-col gap-12 px-4 py-10">
        <div className="flex flex-col gap-12 md:flex-row">
          <div className="flex flex-col gap-3 md:flex-1">
            <p>{translate("footer.copy")}</p>
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
          </div>

          <div className="flex flex-col gap-2 md:flex-1">
            <p className="text-neutral-50 dark:text-neutral-500">
              {translate("footer.links")}
            </p>
            <Link to={`/`} className={linkStyle}>
              {currentConference.title}{" "}
              {dayjs(currentConference.dates[0]).format("YYYY")}
            </Link>
            <Link to="/about" className={linkStyle}>
              {translate("nav.about")}
            </Link>
            <Link to="/contact" className={linkStyle}>
              {translate("nav.contact")}
            </Link>
            <Link to="/give" className={linkStyle}>
              {translate("nav.give")}
            </Link>
            <Link to="/faq" className={linkStyle}>
              {translate("nav.faq")}
            </Link>
          </div>
        </div>

        <p>
          {translate("footer.affiliation", {
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
      </div>
    </footer>
  );
}
