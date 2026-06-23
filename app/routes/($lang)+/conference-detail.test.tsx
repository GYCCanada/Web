import { describe, expect, it } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { createRoutesStub } from 'react-router';

import { Breakpoint } from '~/lib/client-hints';
import type { Conference } from '~/lib/content.server';
import { defaultContent } from '~/lib/content/defaults';
import { LocalizationProvider } from '~/lib/localization/provider';
import { root as translations } from '~/lib/localization/translations';

import { ConferenceDetail } from './conference-detail';

const disabledTravel = {
  enabled: false,
  headerCopy: 'Travel',
  bodyCopy: '—',
  mapEmbedUrl: undefined,
} as const;

const disabledParking = {
  enabled: false,
  headerCopy: 'Parking',
  options: [],
} as const;

const disabledAccommodations = {
  enabled: false,
  headerCopy: 'Accommodations',
  hotels: [],
} as const;

const disabledMeals = {
  enabled: false,
  headerCopy: 'Meals',
  bodyCopy: undefined,
  items: [],
} as const;

const disabledRegistrationCopy = {
  enabled: false,
  title: 'Register Now!',
  subtitle: 'Subtitle',
  buttonLabel: 'Register Now',
} as const;

const disabledFaqCopy = {
  enabled: false,
  title: 'Got Questions?',
  subtitle: 'FAQ subtitle',
} as const;

/** A fully-populated boundary `Conference` — every detail section has data. */
const fullConference: Conference = {
  slug: '/2024',
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
  learnMoreEnabled: false,
  travel: {
    enabled: true,
    headerCopy: 'Travel',
    bodyCopy: 'Venue directions and travel notes.',
    mapEmbedUrl: 'https://www.google.com/maps/embed?pb=!1m18!FAKE',
  },
  parking: disabledParking,
  accommodations: {
    enabled: true,
    headerCopy: 'Accommodations near the venue',
    hotels: [
      {
        name: 'Super 8 by Wyndham Kelowna BC',
        address: 'Kelowna, BC',
        checkIn: undefined,
        checkOut: undefined,
        roomRates: [],
        description: undefined,
        navigateUrl: undefined,
        reservationUrl: undefined,
      },
      {
        name: 'Fairfield Inn & Suites Kelowna',
        address: 'Kelowna, BC',
        checkIn: undefined,
        checkOut: undefined,
        roomRates: [],
        description:
          'Holiday Inn Express & Suites Kelowna — "GYC Canada" or Group Code: "GYC" (call 778-484-2999 for discount)',
        navigateUrl: undefined,
        reservationUrl: undefined,
      },
    ],
  },
  meals: disabledMeals,
  registrationCopy: {
    enabled: true,
    title: 'Register Now!',
    subtitle: 'Registration is open.',
    buttonLabel: 'Register Now',
  },
  faqCopy: {
    enabled: true,
    title: 'Got Questions?',
    subtitle: 'We are here to help.',
  },
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
    expect(html).toContain('Register Now!');
    // FAQ section
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

  it('renders the map iframe src from the travel section mapEmbedUrl', () => {
    const html = renderConference(fullConference);
    expect(html).toContain(`src="${fullConference.travel.mapEmbedUrl}"`);
  });

  it('renders accommodations hotels including descriptions', () => {
    const html = renderConference(fullConference);
    expect(html).toContain('Super 8 by Wyndham Kelowna BC');
    expect(html).toContain('Fairfield Inn &amp; Suites Kelowna');
    expect(html).toContain('GYC Canada');
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

    expect(html).toContain(translations.fr['registration.faq.contact']);
    expect(html).toContain(`src="${fullConference.travel.mapEmbedUrl}"`);
  });
});

/**
 * Section-skip (registration-launch Branch 4, Candidate 2, settled #3, CONTEXT
 * §"Section skip"). Branch 4.1 gated every detail section on the boundary data
 * `toConference` already emits — the document `Option` projected to
 * `string | undefined`, and the list projected to `[]`. These tests pin the
 * gating from the OUTSIDE (`prove-it-works`): with a field absent / a list empty,
 * the section is genuinely gone from the rendered HTML — not merely visually
 * hidden, not a dormant JSX comment. Each gate is exercised independently, then
 * the two launch shapes (`2026` RegFox-only and `2025` cancelled) are pinned.
 *
 * Skip is section-LEVEL: a *present* item with a blank required bilingual field
 * is a hard `Text` decode error upstream (proven in `schema.test.ts`), so the
 * component never receives half-filled content — these tests omit whole sections,
 * they never half-fill one.
 */
describe('ConferenceDetail section-skip', () => {
  it('omits the speakers section when speakers is empty (seminars unaffected)', () => {
    const html = renderConference({ ...fullConference, speakers: [] });

    // The speakers heading and the speaker's name are both gone.
    expect(html).not.toContain('Speakers');
    expect(html).not.toContain('Matt Parra');
    // Seminars is gated independently — still present.
    expect(html).toContain('Seminars');
    expect(html).toContain('Discipleship');
  });

  it('omits the seminars section when seminars is empty (speakers unaffected)', () => {
    const html = renderConference({ ...fullConference, seminars: [] });

    expect(html).not.toContain('Seminars');
    expect(html).not.toContain('Discipleship');
    // Speakers is gated independently — still present.
    expect(html).toContain('Speakers');
    expect(html).toContain('Matt Parra');
  });

  it('omits the travel map when mapEmbedUrl is absent but keeps accommodations', () => {
    const html = renderConference({
      ...fullConference,
      travel: { ...fullConference.travel, mapEmbedUrl: undefined },
    });

    expect(html).not.toContain('title="Map"');
    expect(html).not.toContain('/maps/embed');
    expect(html).toContain('Super 8 by Wyndham Kelowna BC');
    expect(html).toContain('Travel');
  });

  it('omits accommodations when disabled but keeps the travel map', () => {
    const html = renderConference({
      ...fullConference,
      accommodations: disabledAccommodations,
    });

    expect(html).not.toContain('Super 8 by Wyndham Kelowna BC');
    expect(html).not.toContain('Fairfield Inn');
    expect(html).toContain(`src="${fullConference.travel.mapEmbedUrl}"`);
    expect(html).toContain('title="Map"');
  });

  it('omits the whole travel section when travel is disabled', () => {
    const html = renderConference({
      ...fullConference,
      travel: disabledTravel,
      accommodations: disabledAccommodations,
    });

    expect(html).not.toContain('title="Map"');
    expect(html).not.toContain('Super 8 by Wyndham Kelowna BC');
    expect(html).not.toContain('Venue directions and travel notes.');
  });

  it('omits the register button + RegistrationSection when registrationUrl is absent', () => {
    const html = renderConference({
      ...fullConference,
      registrationUrl: undefined,
    });

    expect(html).not.toContain(fullConference.registrationCopy.title);
    expect(html).not.toContain('regfox.com');
    expect(html).not.toContain(
      'href="https://gyccanada.regfox.com/gyc-canada-2024-while-it-is-day"',
    );
    expect(html).not.toContain(translations.en['registration.register']);
  });

  it('omits the schedule button when scheduleUrl is absent', () => {
    const html = renderConference({ ...fullConference, scheduleUrl: undefined });

    expect(html).not.toContain(`href="${fullConference.scheduleUrl}"`);
    expect(html).not.toContain('docs.google.com');
    // Assert the schedule *label* is gone, not just the href: a regressed gate
    // that rendered the button unconditionally with `href={undefined}` would drop
    // the attribute (React omits undefined attrs) and still pass the href/host
    // checks above — but the `Schedule` label would survive. `registration.schedule`
    // is used ONLY inside the gated schedule button (conference-detail.tsx:125,211),
    // so its absence pins the whole button is gone (prove-it-works).
    expect(html).not.toContain(translations.en['registration.schedule']);
  });

  /**
   * The MOBILE hero carries its OWN register + schedule gates
   * (`MobileHero`, conference-detail.tsx:111-127) — a separate layout from the
   * desktop hero, never reached by the default `Breakpoint.Xl` renders above.
   * Without a mobile-breakpoint render, deleting either mobile gate leaves every
   * test green (the desktop gates are a different code path). Exercise both:
   * with `registrationUrl`/`scheduleUrl` absent, neither the mobile register
   * label (`registration.register` = 'Register') nor the schedule label
   * (`registration.schedule` = 'Schedule') nor any RegFox href survives. The
   * existing 'renders the mobile hero variant' test pins the PRESENT case, so the
   * gates are load-bearing in both directions.
   */
  it('omits the mobile hero register + schedule buttons when their URLs are absent', () => {
    const html = renderConference(
      {
        ...fullConference,
        registrationUrl: undefined,
        scheduleUrl: undefined,
      },
      { breakpoint: Breakpoint.Sm },
    );

    // Render the mobile layout (mobile hero crop confirms the breakpoint took).
    expect(html).toContain(fullConference.hero.image.mobile);
    // Both mobile-hero CTA labels are gone (different keys; both substrings of
    // larger copy, so this only holds because the whole `RegistrationSection` is
    // also skipped — registrationUrl is absent).
    expect(html).not.toContain(translations.en['registration.register']);
    expect(html).not.toContain(translations.en['registration.schedule']);
    // And no RegFox / schedule hrefs leak through the mobile hero.
    expect(html).not.toContain('regfox.com');
    expect(html).not.toContain(`href="${fullConference.scheduleUrl}"`);
  });

  /**
   * The `2026` launch shape: RegFox only (settled #9). The conference carries a
   * `registrationUrl` and nothing else optional — so the page is hero + register
   * button + FAQ, with NO empty Speakers / Seminars / Map / schedule sections.
   * This is the Friday gate's render contract.
   */
  it('renders the 2026 RegFox-only shape: hero + register button + FAQ, no empty sections', () => {
    const conference2026: Conference = {
      ...fullConference,
      slug: '/2026',
      speakers: [],
      seminars: [],
      scheduleUrl: undefined,
      travel: disabledTravel,
      parking: disabledParking,
      accommodations: disabledAccommodations,
      meals: disabledMeals,
      registrationCopy: fullConference.registrationCopy,
      faqCopy: fullConference.faqCopy,
      registrationUrl: 'https://gyccanada.regfox.com/gyc-canada-2026-speak',
    };
    const html = renderConference(conference2026);

    expect(html).toContain(conference2026.hero.image.desktop);
    expect(html).toContain('Register Now!');
    expect(html).toContain(
      'href="https://gyccanada.regfox.com/gyc-canada-2026-speak"',
    );
    expect(html).toContain('Got Questions?');
    expect(html).not.toContain('Speakers');
    expect(html).not.toContain('Seminars');
    expect(html).not.toContain('title="Map"');
    expect(html).not.toContain('Super 8 by Wyndham Kelowna BC');
  });

  it('renders the 2025 cancelled shape: hero + FAQ only', () => {
    const conference2025: Conference = {
      ...fullConference,
      slug: '/2025',
      speakers: [],
      seminars: [],
      registrationUrl: undefined,
      scheduleUrl: undefined,
      travel: disabledTravel,
      parking: disabledParking,
      accommodations: disabledAccommodations,
      meals: disabledMeals,
      registrationCopy: disabledRegistrationCopy,
      faqCopy: fullConference.faqCopy,
    };
    const html = renderConference(conference2025);

    expect(html).toContain(conference2025.hero.image.desktop);
    expect(html).toContain(conference2025.tagline);
    expect(html).toContain('Got Questions?');
    expect(html).not.toContain('Speakers');
    expect(html).not.toContain('Seminars');
    expect(html).not.toContain('Register Now!');
    expect(html).not.toContain('regfox.com');
    expect(html).not.toContain('title="Map"');
    expect(html).not.toContain('Super 8 by Wyndham Kelowna BC');
  });

  it('renders the 2025 cancelled shape (hero + FAQ only) under /fr too', () => {
    const conference2025: Conference = {
      ...fullConference,
      slug: '/2025',
      speakers: [],
      seminars: [],
      registrationUrl: undefined,
      scheduleUrl: undefined,
      travel: disabledTravel,
      parking: disabledParking,
      accommodations: disabledAccommodations,
      meals: disabledMeals,
      registrationCopy: disabledRegistrationCopy,
      faqCopy: {
        enabled: true,
        title: 'Des questions?',
        subtitle: 'Nous sommes là pour vous aider.',
      },
    };
    const html = renderConference(conference2025, { lang: 'fr' });

    expect(html).toContain('Des questions?');
    expect(html).not.toContain('Inscrivez-vous!');
    expect(html).not.toContain('title="Map"');
  });
});
