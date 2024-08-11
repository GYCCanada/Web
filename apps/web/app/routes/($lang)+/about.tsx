import type { MetaFunction } from '@remix-run/node';

import { useTranslate } from '~/lib/localization/context';
import { getLocale } from '~/lib/localization/localization';
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

export default function Index() {
  const translate = useTranslate();
  return (
    <Main className="gap-10 px-3 py-12 text-2xl md:px-16">
      <h1 className="text-5xl">{translate('about.title')}</h1>
      <p>{translate('about.1')}</p>
      <p>{translate('about.2')}</p>
      <p>{translate('about.3')}</p>
      <p>{translate('about.4')}</p>
      <p className="text-lg font-bold">{translate('about.disclaimer')}</p>
      <div className="flex flex-col gap-4 italic">
        <p>
          {translate('about.quote.1', {
            verse: (
              <span className="font-bold">
                {translate('about.quote.1.verse')}
              </span>
            ),
          })}
        </p>
        <p>
          {translate('about.quote.2', {
            source: (
              <span className="font-bold">
                {translate('about.quote.2.source')}
              </span>
            ),
          })}
        </p>
      </div>
    </Main>
  );
}
