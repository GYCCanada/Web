import { describe, expect, it } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { createRoutesStub } from 'react-router';

import { Breakpoint } from '~/lib/client-hints';
import type { Conference } from '~/lib/content.server';
import { LocalizationProvider } from '~/lib/localization/provider';
import { root as translations } from '~/lib/localization/translations';

import { ConferenceDetail } from './conference-detail';

/**
 * `ConferenceDetail` is the single deep module the three `/YYYY` loaders render
 * (registration-launch Branch 3.3). It was extracted verbatim from the
 * `2024/_index.tsx` fork — the spec — with the formerly hard-coded RegFox link,
 * schedule link, map iframe `src`, and hotel `<li>`s replaced by reads off the
 * boundary `Conference` (`registrationUrl` / `scheduleUrl` / `mapEmbedUrl` /
 * `hotels`, projected by `toConference` from validated document `Option`s).
 *
 * These render-to-string tests pin the load-bearing claim of the extraction
 * (`prove-it-works`): a fully-populated conference renders every section, and
 * the data-driven sections render the boundary data — NOT the old hard-coded
 * constants. Section-skip (omitting a section when its data is absent) is
 * Branch 4's concern and is tested there; here the conference carries every
 * field, so every section is present.
 *
 * The component is server-rendered through `createRoutesStub` (to satisfy the
 * router hooks it uses — `useSearchParams`, `useLocation` via `Link`, `useParams`
 * via `useLocale`, and `useRouteLoaderData('root')` via `useHints`) plus a
 * `LocalizationProvider`. The `root` loader data is supplied directly through
 * `hydrationData` so the render is synchronous (no async loader suspends).
 */

/** A fully-populated boundary `Conference` — every detail section has data. */
const fullConference: Conference = {
  slug: '2024',
  title: 'While It Is Day',
  dates: [Date.UTC(2024, 7, 1), Date.UTC(2024, 7, 4)],
  hero: {
    image: {
      desktop: '/images/2024/hero/desktop.png',
      mobile: '/images/2024/hero/mobile.png',
    },
    alt: 'GYC Canada 2024',
  },
  location: '130 Gerstmar Rd, Kelowna, BC V1X 4A7',
  tagline: 'I must work the works of Him who sent Me while it is day.',
  bible: { book: 'John', chapter: 9, verse: 4 },
  speakers: [
    {
      name: 'Matt Parra',
      activity: 'Morning Plenary',
      img: '/images/2024/speakers/matt.png',
      bio: 'Matt Parra is a pastor.',
    },
  ],
  seminars: [
    {
      title: 'Discipleship',
      speaker: {
        name: 'Jane Doe',
        img: '/images/2024/speakers/jane.png',
        bio: 'Jane Doe leads a seminar.',
      },
      description: 'A seminar on discipleship.',
    },
  ],
  promos: [],
  theme: '#abcdef',
  registrationUrl:
    'https://gyccanada.regfox.com/gyc-canada-2024-while-it-is-day',
  scheduleUrl:
    'https://docs.google.com/document/d/1gNAOfdW2Yhgg7FABjUqQt2k2mXV_AdhARWUOyiVL9dA/pub',
  mapEmbedUrl: 'https://www.google.com/maps/embed?pb=!1m18!FAKE',
  hotels: [
    { name: 'Super 8 by Wyndham Kelowna BC' },
    {
      name: 'Fairfield Inn & Suites Kelowna',
      note: 'Group Code: GYC',
    },
  ],
};

/**
 * Render `ConferenceDetail` to an HTML string. `breakpoint` chooses the
 * server-rendered layout: `Sm`/`Md` render the mobile variants, anything larger
 * renders desktop (`useBreakpoint`'s server snapshot reads `hints.breakpoint`).
 */
const renderConference = (
  conference: Conference,
  {
    breakpoint = Breakpoint.Xl,
    lang,
  }: { breakpoint?: Breakpoint; lang?: 'fr' } = {},
): string => {
  const Stub = createRoutesStub([
    {
      id: 'root',
      // Mirror the app's optional leading `:lang?` segment so `useLocale`
      // (which reads `params.lang`) resolves `/fr` → French, `/` → English.
      path: ':lang?',
      Component: () => (
        <LocalizationProvider
          translation={translations[lang === 'fr' ? 'fr' : 'en']}
        >
          <ConferenceDetail conference={conference} />
        </LocalizationProvider>
      ),
    },
  ]);

  return renderToString(
    <Stub
      initialEntries={[lang === 'fr' ? '/fr' : '/']}
      hydrationData={{
        loaderData: {
          root: {
            requestInfo: {
              hints: { theme: 'light', timeZone: 'America/Toronto', breakpoint },
            },
          },
        },
      }}
    />,
  );
};

describe('ConferenceDetail', () => {
  it('renders every section for a fully-populated conference (desktop)', () => {
    const html = renderConference(fullConference);

    // Hero
    expect(html).toContain(fullConference.hero.image.desktop);
    expect(html).toContain(fullConference.tagline);
    expect(html).toContain(fullConference.bible.book);
    expect(html).toContain(fullConference.location);
    // Speakers + seminars
    expect(html).toContain('Speakers');
    expect(html).toContain('Seminars');
    expect(html).toContain('Matt Parra');
    expect(html).toContain('Discipleship');
    // Registration section
    expect(html).toContain('Register Now');
    // FAQ section (static links)
    expect(html).toContain('Got Questions?');
  });

  it('renders the register button from the boundary registrationUrl, not a hard-coded constant', () => {
    const html = renderConference(fullConference);

    expect(html).toContain(
      'href="https://gyccanada.regfox.com/gyc-canada-2024-while-it-is-day"',
    );

    // The component carries no hard-coded RegFox/schedule/map literals: change
    // the data and the rendered hrefs change with it (`derive-dont-sync`).
    const other = renderConference({
      ...fullConference,
      registrationUrl: 'https://gyccanada.regfox.com/gyc-canada-2026-speak',
    });
    expect(other).toContain(
      'href="https://gyccanada.regfox.com/gyc-canada-2026-speak"',
    );
    expect(other).not.toContain('gyc-canada-2024-while-it-is-day');
  });

  it('renders the schedule button from the boundary scheduleUrl', () => {
    const html = renderConference(fullConference);
    expect(html).toContain(`href="${fullConference.scheduleUrl}"`);
  });

  it('renders the map iframe src from the boundary mapEmbedUrl', () => {
    const html = renderConference(fullConference);
    expect(html).toContain(`src="${fullConference.mapEmbedUrl}"`);
  });

  it('renders the hotels list from the boundary hotels, including notes', () => {
    const html = renderConference(fullConference);

    expect(html).toContain('Super 8 by Wyndham Kelowna BC');
    expect(html).toContain('Fairfield Inn &amp; Suites Kelowna');
    // The optional note is appended after the name.
    expect(html).toContain('Group Code: GYC');
  });

  it('renders the mobile hero variant at a small breakpoint', () => {
    const html = renderConference(fullConference, {
      breakpoint: Breakpoint.Sm,
    });

    // Mobile hero uses the mobile crop and still carries the register button.
    expect(html).toContain(fullConference.hero.image.mobile);
    expect(html).toContain(
      'href="https://gyccanada.regfox.com/gyc-canada-2024-while-it-is-day"',
    );
  });

  it('renders French copy under the /fr locale', () => {
    const html = renderConference(fullConference, { lang: 'fr' });

    // `registration.faq.title` in French ("Got Questions?" → its FR string).
    expect(html).toContain(translations.fr['registration.faq.title']);
    // The data fields (locale-projected upstream) still flow through unchanged.
    expect(html).toContain(`src="${fullConference.mapEmbedUrl}"`);
  });
});
