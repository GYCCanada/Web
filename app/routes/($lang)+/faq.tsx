import { type MetaFunction, useLoaderData } from 'react-router';

import { Content } from '~/lib/content.server';
import { ReactRouterContext } from '~/lib/effect/router-context';
import { routeHandler } from '~/lib/effect/route';
import { getLocale } from '~/lib/localization/localization';
import { toFaqView } from '~/lib/content/pages/project';
import { Main } from '~/ui/main';
import { RichText } from '~/ui/rich-text';

export const meta: MetaFunction = ({ params }) => {
  const locale = getLocale(params);
  if (locale === 'fr') {
    return [
      { title: 'FAQ | GYCC' },
      { name: 'description', content: 'Foire aux questions' },
    ];
  }
  return [
    { title: 'FAQ | GYCC' },
    { name: 'description', content: 'Frequently Asked Questions' },
  ];
};

export const loader = routeHandler(function* () {
  const { params } = yield* ReactRouterContext;
  const locale = getLocale(params);
  const content = yield* Content.Service;
  return { page: toFaqView(yield* content.getPage('faq'), locale) };
});

export default function FaqPage() {
  const { page } = useLoaderData<typeof loader>();
  return (
    <Main className="gap-10 px-3 py-12 text-2xl md:px-16">
      <h1 className="text-5xl">{page.title}</h1>

      {page.items.map((item) => (
        <QuestionLayout key={item.id}>
          <Question>{item.question}</Question>
          <Answer>
            <RichText runs={item.answer} />
          </Answer>
        </QuestionLayout>
      ))}
    </Main>
  );
}

function QuestionLayout({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-4">{children}</div>;
}

function Question({ children }: { children: React.ReactNode }) {
  return <p className="flex flex-col gap-4 text-4xl italic">{children}</p>;
}

function Answer({ children }: { children: React.ReactNode }) {
  return <p className="">{children}</p>;
}
