import { type MetaFunction, useLoaderData } from 'react-router';

import { Content } from '~/lib/content.server';
import { toTeamView } from '~/lib/content/pages/project';
import { ReactRouterContext } from '~/lib/effect/router-context';
import { routeHandler } from '~/lib/effect/route';
import { useTranslate } from '~/lib/localization/context';
import { getLocale } from '~/lib/localization/localization';
import { Main } from '~/ui/main';
import { RichText } from '~/ui/rich-text';

export const meta: MetaFunction = ({ params }) => {
  const lang = getLocale(params);
  if (lang === 'fr') {
    return [
      { title: "L'équipe | GYCC" },
      { name: 'description', content: "Rencontrez l'équipe derrière GYCC" },
    ];
  }
  return [
    { title: 'The Team | GYCC' },
    { name: 'description', content: 'Meet the team behind GYCC' },
  ];
};

export const loader = routeHandler(function* () {
  const { params } = yield* ReactRouterContext;
  const locale = getLocale(params);
  const content = yield* Content.Service;
  // Page CHROME (title / subtitle / board heading / images) comes from the CMS
  // `TeamPage` object; the per-member executive roster stays on `site.json` via
  // `getTeam()` (conference-executive data, not page copy — not migrated here).
  const page = toTeamView(yield* content.getPage('team'), locale);
  const { team, board } = yield* content.getTeam();
  return { page, team, board };
});

export default function Index() {
  // `useTranslate` stays for the per-member `member.position` keys (`team.position.*`),
  // which remain on `site.json` — only the page-chrome translation keys migrated.
  const translate = useTranslate();
  const { page, team, board } = useLoaderData<typeof loader>();
  return (
    <Main className="gap-10">
      <div className="mx-auto flex h-[700px] w-(--width) flex-col md:h-[478px] md:pt-0">
        {page.groupPhoto && (
          <img
            src={page.groupPhoto.src}
            className="absolute inset-0 size-full object-cover md:object-top"
            alt={page.groupPhoto.alt}
          />
        )}
        <div className="flex items-center justify-center gap-6 text-neutral-950 md:pt-8">
          <h1 className="flex-1 shrink text-balance text-2xl sm:text-3xl md:max-w-[30%] md:text-4xl lg:text-5xl">
            <RichText runs={page.title} />
          </h1>
          {page.portrait && (
            <img
              className="block size-[140px] object-contain"
              src={page.portrait.src}
              alt={page.portrait.alt}
            />
          )}
        </div>
      </div>
      <div className="flex flex-col gap-8 p-4">
        <p>{page.subtitle}</p>

        <div className="grid grid-cols-2 gap-4 pb-20 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {team.map((member) => (
            <div
              key={member.name}
              className="flex flex-col gap-1.5"
            >
              <img
                src={member.image}
                alt={member.name}
                className="aspect-square w-full object-cover object-top"
              />
              <h2 className="font-medium">{member.name}</h2>
              <p className="text-sm italic">{translate(member.position)}</p>
            </div>
          ))}
        </div>
        <hr />
        <div className="flex flex-col gap-7">
          <h3 className="text-xl font-bold">{page.boardHeading}</h3>
          <ul className="grid grid-cols-2 gap-2.5 md:grid-cols-3 lg:grid-cols-4">
            {board.map((name, index) => (
              <li key={index}>{name}</li>
            ))}
          </ul>
        </div>
      </div>
    </Main>
  );
}
