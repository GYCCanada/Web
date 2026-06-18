import { type MetaFunction, useLoaderData } from 'react-router';

import { getEnabledPageOr404 } from '~/lib/content/page-guard.server';
import { ReactRouterContext } from '~/lib/effect/router-context';
import { routeHandler } from '~/lib/effect/route';
import { getLocale } from '~/lib/localization/localization';
import { toAboutView } from '~/lib/content/pages/project';
import { Main } from '~/ui/main';

export const meta: MetaFunction = ({ params }) => {
  const lang = getLocale(params);
  if (lang === 'en') {
    return [
      { title: 'About Us | GYCC' },
      { name: 'description', content: 'More about us' },
    ];
  }

  return [
    { title: 'À propos de nous | GYCC' },
    { name: 'description', content: 'Plus sur nous' },
  ];
};

export const loader = routeHandler(function* () {
  const { params } = yield* ReactRouterContext;
  const locale = getLocale(params);
  // 404 when the page is disabled (Feature C); else project the decoded page.
  return { page: toAboutView(yield* getEnabledPageOr404('about'), locale) };
});

export default function Index() {
  const { page } = useLoaderData<typeof loader>();
  return (
    <Main className="gap-10 px-3 py-12 text-2xl md:px-16">
      <h1 className="text-5xl">{page.title}</h1>
      {page.paragraphs.map((paragraph) => (
        <p key={paragraph.id}>{paragraph.text}</p>
      ))}
      <p className="text-lg font-bold">{page.disclaimer}</p>
      <div className="flex flex-col gap-4 italic">
        {page.quotes.map((quote) => (
          <p key={quote.id}>
            {quote.text} <span className="font-bold">{quote.attribution}</span>
          </p>
        ))}
      </div>
    </Main>
  );
}
