import { describe, expect, it } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { createRoutesStub } from 'react-router';

import type { PageId } from '~/lib/content/pages/registry';
import { LocalizationProvider } from '~/lib/localization/provider';
import { root as translations } from '~/lib/localization/translations';

import { Footer, TopNav } from './_layout';

/**
 * The nav is DATA-DRIVEN off the per-page `enabled` flags (Feature C, Codex R6):
 * every consumer (desktop TopNav + footer) derives its links from one nav model
 * filtered by `enabled[page]` — there is no hardcoded team-hide. These render
 * tests pin the observable contract: a disabled page's link is ABSENT from the
 * markup, and flipping `team.enabled` makes the `/team` link appear/disappear with
 * NO code change. (The mobile PopupNav maps the same `visibleLinks(PRIMARY_NAV)`
 * source, so the desktop assertion covers the shared filter.)
 */

/** Every page enabled (the all-on baseline); override per test. */
const allEnabled = (): Record<PageId, boolean> => ({
  about: true,
  faq: true,
  give: true,
  contact: true,
  volunteer: true,
  archive: true,
  home: true,
  team: true,
});

const currentConference = {
  title: 'SPEAK',
  dates: ['2026-08-12T00:00:00.000Z'],
} as const;

/**
 * Render a nav component (`TopNav` / `Footer`) with supplied `enabled` loader data.
 * Both read `useLoaderData` + `useTranslate`, so they mount inside a
 * `createRoutesStub` route (whose `loader` data satisfies `useLoaderData`) wrapped
 * in a `LocalizationProvider` (satisfying `useTranslate`).
 */
const renderNav = (
  Component: typeof TopNav | typeof Footer,
  enabled: Record<PageId, boolean>,
): string => {
  const Stub = createRoutesStub([
    {
      id: 'layout',
      path: ':lang?',
      Component: () => (
        <LocalizationProvider translation={translations.en}>
          <Component />
        </LocalizationProvider>
      ),
    },
  ]);

  return renderToString(
    <Stub
      initialEntries={['/']}
      hydrationData={{
        loaderData: {
          layout: { lang: 'en', enabled, currentConference },
        },
      }}
    />,
  );
};

describe('TopNav data-driven links (enabled flags)', () => {
  it('renders every primary link when all pages are enabled', () => {
    const html = renderNav(TopNav, allEnabled());
    expect(html).toContain('href="/about"');
    expect(html).toContain('href="/team"');
    expect(html).toContain('href="/contact"');
    expect(html).toContain('href="/give"');
    expect(html).toContain('href="/volunteer"');
  });

  it('omits a disabled page link (give.enabled=false → no /give link)', () => {
    const html = renderNav(TopNav, { ...allEnabled(), give: false });
    expect(html).not.toContain('href="/give"');
    // Sibling links are unaffected.
    expect(html).toContain('href="/about"');
    expect(html).toContain('href="/volunteer"');
  });

  it('hides /team when team.enabled=false and shows it when true (no code change)', () => {
    const hidden = renderNav(TopNav, { ...allEnabled(), team: false });
    expect(hidden).not.toContain('href="/team"');

    const shown = renderNav(TopNav, { ...allEnabled(), team: true });
    expect(shown).toContain('href="/team"');
  });
});

describe('Footer data-driven links (enabled flags)', () => {
  it('renders the footer page links when enabled, omitting a disabled FAQ', () => {
    const html = renderNav(Footer, { ...allEnabled(), faq: false });
    expect(html).toContain('href="/about"');
    expect(html).toContain('href="/contact"');
    expect(html).toContain('href="/give"');
    // FAQ is footer-only and disabled here → absent.
    expect(html).not.toContain('href="/faq"');
  });
});
