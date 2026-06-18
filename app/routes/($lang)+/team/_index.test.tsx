import { describe, expect, it } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { createRoutesStub } from 'react-router';

import { toTeamView } from '~/lib/content/pages/project';
import { defaultTeamPage } from '~/lib/content/pages/defaults';
import { Schema } from 'effect';
import { TeamPage } from '~/lib/content/pages/schema';
import { Locale } from '~/lib/localization/localization';
import { LocalizationProvider } from '~/lib/localization/provider';
import { root as translations } from '~/lib/localization/translations';

import Index from './_index';

/**
 * Render-parity for the Team route after migrating its CHROME into the per-page
 * CMS `TeamPage` (title / subtitle / board heading / images), keeping the per-
 * member roster + `member.position` translation untouched. These pin that the
 * migrated route renders the SAME visible copy/structure as the pre-migration
 * route given `defaultTeamPage` + a seeded image:
 *   - the rich title with the italic `movement` run (was `team.title` +
 *     `<span className="italic">team.title.movement</span>`);
 *   - the subtitle + board heading (was `team.subtitle` / `team.board`);
 *   - each roster member's name + translated `position` (UNCHANGED — still on
 *     `site.json` via `getTeam()`);
 *   - a present group photo renders its `<img>`; an absent portrait section-skips.
 */

const member = {
  name: 'Elijah Example',
  position: 'team.position.president',
  image: '/images/team/elijah.jpg',
} as const;

/**
 * Render the Team route's default component with supplied loader data. The
 * component reads `useLoaderData` + `useTranslate`, so it is mounted inside a
 * `createRoutesStub` route (whose `loader` returns the fixture, satisfying
 * `useLoaderData`) wrapped in a `LocalizationProvider` (satisfying `useTranslate`).
 */
const renderTeam = (
  loaderData: ReturnType<typeof makeLoaderData>,
  lang?: 'fr',
): string => {
  const Stub = createRoutesStub([
    {
      id: 'team',
      path: ':lang?',
      Component: () => (
        <LocalizationProvider
          translation={translations[lang === 'fr' ? 'fr' : 'en']}
        >
          <Index />
        </LocalizationProvider>
      ),
    },
  ]);

  return renderToString(
    <Stub
      initialEntries={[lang === 'fr' ? '/fr' : '/']}
      hydrationData={{ loaderData: { team: loaderData } }}
    />,
  );
};

const makeLoaderData = (page = toTeamView(defaultTeamPage, Locale.En)) => ({
  page,
  team: [member],
  board: ['Board Member One', 'Board Member Two'],
});

describe('Team route render-parity (CMS chrome + unchanged roster)', () => {
  it('renders the rich title (with the italic movement run), subtitle, and board heading', () => {
    const html = renderTeam(makeLoaderData());
    expect(html).toContain('The people behind the ');
    // The italic `movement` run renders inside `<span class="italic">`.
    expect(html).toContain('movement');
    expect(html).toContain('class="italic"');
    expect(html).toContain('We are GYC Canada');
    expect(html).toContain('Board of Directors');
  });

  it('renders each roster member name + its translated position (roster unchanged)', () => {
    const html = renderTeam(makeLoaderData());
    expect(html).toContain('Elijah Example');
    expect(html).toContain(member.image);
    // `member.position` still goes through `translate(...)` → the EN label.
    expect(html).toContain('President');
    expect(html).toContain('Board Member One');
  });

  it('renders a present group photo <img> and section-skips an absent portrait', () => {
    // Re-encode the bundled default to its JSON, then add a seeded group photo and
    // re-decode — proving a published team.json WITH a group photo renders its img.
    const encoded = Schema.encodeUnknownSync(TeamPage)(defaultTeamPage) as Record<
      string,
      unknown
    >;
    const seeded = Schema.decodeUnknownSync(TeamPage)({
      ...encoded,
      groupPhoto: {
        key: '2026/team/group.jpg',
        alt: { en: 'A group photo.', fr: 'Une photo de groupe.' },
      },
    });
    const html = renderTeam(makeLoaderData(toTeamView(seeded, Locale.En)));
    // Present group photo renders.
    expect(html).toContain('/images/2026/team/group.jpg');
    expect(html).toContain('A group photo.');
    // Absent portrait section-skips: no portrait <img> (the old /logo/gycc.png).
    expect(html).not.toContain('/logo/gycc.png');
  });

  it('renders French chrome under /fr', () => {
    const html = renderTeam(makeLoaderData(toTeamView(defaultTeamPage, Locale.Fr)), 'fr');
    expect(html).toContain('Les personnes derrière le ');
    expect(html).toContain('mouvement');
    expect(html).toContain('Conseil d');
  });
});
