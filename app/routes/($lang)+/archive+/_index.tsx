import { type MetaFunction, useLoaderData } from 'react-router';

import { Content } from '~/lib/content.server';
import { toArchiveView } from '~/lib/content/pages/project';
import { ReactRouterContext } from '~/lib/effect/router-context';
import { routeHandler } from '~/lib/effect/route';
import { getLocale } from '~/lib/localization/localization';
import { Main } from '~/ui/main';

export const meta: MetaFunction = ({ params }) => {
  const locale = getLocale(params);
  if (locale === 'fr') {
    return [
      { title: 'Archives | GYCC' },
      {
        name: 'description',
        content: 'Conférences passées de GYC Canada.',
      },
    ];
  }
  return [
    { title: 'Archive | GYCC' },
    { name: 'description', content: 'Past GYC Canada conferences.' },
  ];
};

export const loader = routeHandler(function* () {
  const { params } = yield* ReactRouterContext;
  const locale = getLocale(params);
  const content = yield* Content.Service;
  return { page: toArchiveView(yield* content.getPage('archive'), locale) };
});

export default function Index() {
  const { page } = useLoaderData<typeof loader>();

  // section-skip: an empty archive renders nothing (no past-conference links
  // yet), preserving today's blank index until entries are published.
  if (page.entries.length === 0) {
    return <div className="flex flex-1 flex-col"></div>;
  }

  return (
    <Main className="gap-10 px-3 py-12 text-2xl md:px-16">
      <h1 className="text-5xl">{page.title}</h1>
      <ul className="flex flex-col gap-4">
        {page.entries.map((entry) => (
          <li key={entry.id}>
            <a className="underline" href={entry.url}>
              {entry.label}
            </a>
          </li>
        ))}
      </ul>
    </Main>
  );
}
