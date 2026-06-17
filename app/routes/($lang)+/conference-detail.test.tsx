import { describe, expect, it } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { createRoutesStub } from 'react-router';

import { Breakpoint } from '~/lib/client-hints';
import type { Conference } from '~/lib/content.server';
import { defaultContent } from '~/lib/content/defaults';
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

  /**
   * Pin the 2024 hotel list render against the REAL bundled defaults (not the
   * synthetic `fullConference` above), so the `{name}{note ? ` ${note}` : null}`
   * template + the authored hotel strings are guarded together going forward.
   *
   * The pre-migration `2024/_index.tsx` fork hard-coded hotel #2 as one `<li>`:
   *   `Fairfield Inn & Suites Kelowna Holiday Inn Express & Suites Kelowna
   *    - "GYC Canada” or Group Code: “GYC" (call 778-484-2999 for discount)`
   * — with a literal `- ` separator and *mismatched* straight-then-curly quotes
   * (`"GYC Canada”` … `“GYC"`), a pre-existing typo. The plan (line 136) pinned a
   * "byte-identical 2024 render"; this branch CONSCIOUSLY cleans that typo: the
   * default note (`defaults.ts`) uses an em-dash separator and consistent quotes.
   * That is the single intentional render delta vs the old fork. This test is the
   * regression assertion the plan amendment requires — it pins the cleaned text
   * exactly, so any future drift is caught.
   */
  it('renders the 2024 Fairfield hotel `<li>` exactly as authored in the defaults (typo-cleanup pinned)', () => {
    const doc2024 = defaultContent.conferences.find((c) => c.slug === '/2024');
    expect(doc2024).toBeDefined();
    // Project the defaults' 2024 hotels to the en boundary shape `toConference`
    // emits (`{ name: name.en, note?: note.en }`), so the render is driven by the
    // authored content, not a hand-copied string.
    const hotels = (doc2024?.hotels ?? []).map((hotel) => ({
      name: hotel.name.en,
      ...(hotel.note === undefined ? {} : { note: hotel.note.en }),
    }));

    const fairfield = hotels.find((h) => h.name.startsWith('Fairfield'));
    expect(fairfield?.note).toBeDefined();

    const html = renderConference({ ...fullConference, hotels });

    // The component renders `{name}{note ? ` ${note}` : null}` inside one <li>.
    // React server-renders the two adjacent text children separated by a comment
    // marker (`<!-- -->`) and HTML-escapes `&` → `&amp;` and `"` → `&quot;`. Pin
    // the exact rendered <li> innerHTML: a single space before `Holiday`, the
    // em-dash separator, and consistent straight quotes — the consciously-cleaned
    // form, NOT the old fork's `- ` separator + mismatched straight/curly quotes.
    expect(html).toContain(
      '<li>Fairfield Inn &amp; Suites Kelowna<!-- --> Holiday Inn Express &amp; Suites Kelowna — &quot;GYC Canada&quot; or Group Code: &quot;GYC&quot; (call 778-484-2999 for discount)</li>',
    );
    // And the old typo'd separator/quotes must NOT survive (the curly `”`/`“`
    // and the `Kelowna - ` separator the pre-branch fork hard-coded).
    expect(html).not.toContain('Kelowna — &quot;GYC Canada”');
    expect(html).not.toContain('Kelowna - ');
    expect(html).not.toContain('“GYC');
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

  it('omits the map iframe when mapEmbedUrl is absent but keeps the hotels column', () => {
    const html = renderConference({
      ...fullConference,
      mapEmbedUrl: undefined,
    });

    // The iframe (its `title="Map"` + the old fallback src) is gone…
    expect(html).not.toContain('title="Map"');
    expect(html).not.toContain('/maps/embed');
    // …but the hotels half of the section survives (each half gated independently).
    expect(html).toContain('Super 8 by Wyndham Kelowna BC');
  });

  it('omits the hotels column when hotels is empty but keeps the map iframe', () => {
    const html = renderConference({ ...fullConference, hotels: [] });

    expect(html).not.toContain('Super 8 by Wyndham Kelowna BC');
    expect(html).not.toContain('Fairfield Inn');
    // The map half survives.
    expect(html).toContain(`src="${fullConference.mapEmbedUrl}"`);
    expect(html).toContain('title="Map"');
  });

  it('omits the whole MapSection when neither a map embed nor hotels are present', () => {
    const html = renderConference({
      ...fullConference,
      mapEmbedUrl: undefined,
      hotels: [],
    });

    expect(html).not.toContain('title="Map"');
    expect(html).not.toContain('Super 8 by Wyndham Kelowna BC');
    // The hotels-description copy (the section's only other content) is gone too.
    expect(html).not.toContain(translations.en['registration.hotels.description.facebook']);
  });

  it('omits the register button + RegistrationSection when registrationUrl is absent', () => {
    const html = renderConference({
      ...fullConference,
      registrationUrl: undefined,
    });

    // The `RegistrationSection` (its title) and the RegFox href are both gone.
    expect(html).not.toContain(translations.en['registration.register.title']);
    expect(html).not.toContain('regfox.com');
    expect(html).not.toContain(
      'href="https://gyccanada.regfox.com/gyc-canada-2024-while-it-is-day"',
    );
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
   * The `2026` launch shape: RegFox only (settled #9). The conference carries a
   * `registrationUrl` and nothing else optional — so the page is hero + register
   * button + FAQ, with NO empty Speakers / Seminars / Map / schedule sections.
   * This is the Friday gate's render contract.
   */
  it('renders the 2026 RegFox-only shape: hero + register button + FAQ, no empty sections', () => {
    const conference2026: Conference = {
      ...fullConference,
      slug: '2026',
      speakers: [],
      seminars: [],
      scheduleUrl: undefined,
      mapEmbedUrl: undefined,
      hotels: [],
      registrationUrl: 'https://gyccanada.regfox.com/gyc-canada-2026-speak',
    };
    const html = renderConference(conference2026);

    // Present: hero, register button, FAQ.
    expect(html).toContain(conference2026.hero.image.desktop);
    expect(html).toContain(translations.en['registration.register.title']);
    expect(html).toContain(
      'href="https://gyccanada.regfox.com/gyc-canada-2026-speak"',
    );
    expect(html).toContain(translations.en['registration.faq.title']);
    // Absent: every data-less section.
    expect(html).not.toContain('Speakers');
    expect(html).not.toContain('Seminars');
    expect(html).not.toContain('title="Map"');
    expect(html).not.toContain('Super 8 by Wyndham Kelowna BC');
  });

  /**
   * The `2025` cancelled shape: every optional field absent (CONTEXT §Hiatus).
   * The page collapses to hero + FAQ only — no register button, no schedule, no
   * speakers / seminars / map / hotels. This proves a fully-empty conference
   * renders cleanly through the shared module (it used to be a forked dead page).
   */
  it('renders the 2025 cancelled shape: hero + FAQ only', () => {
    const conference2025: Conference = {
      ...fullConference,
      slug: '2025',
      speakers: [],
      seminars: [],
      registrationUrl: undefined,
      scheduleUrl: undefined,
      mapEmbedUrl: undefined,
      hotels: [],
    };
    const html = renderConference(conference2025);

    // Present: hero (image + tagline) and FAQ.
    expect(html).toContain(conference2025.hero.image.desktop);
    expect(html).toContain(conference2025.tagline);
    expect(html).toContain(translations.en['registration.faq.title']);
    // Absent: everything data-driven.
    expect(html).not.toContain('Speakers');
    expect(html).not.toContain('Seminars');
    expect(html).not.toContain(translations.en['registration.register.title']);
    expect(html).not.toContain('regfox.com');
    expect(html).not.toContain('title="Map"');
    expect(html).not.toContain('Super 8 by Wyndham Kelowna BC');
  });

  it('renders the 2025 cancelled shape (hero + FAQ only) under /fr too', () => {
    const conference2025: Conference = {
      ...fullConference,
      slug: '2025',
      speakers: [],
      seminars: [],
      registrationUrl: undefined,
      scheduleUrl: undefined,
      mapEmbedUrl: undefined,
      hotels: [],
    };
    const html = renderConference(conference2025, { lang: 'fr' });

    expect(html).toContain(translations.fr['registration.faq.title']);
    expect(html).not.toContain(translations.fr['registration.register.title']);
    expect(html).not.toContain('title="Map"');
  });
});
