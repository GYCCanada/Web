import type { MetaFunction } from '@remix-run/node';
import { useTranslate } from '~/lib/localization/context';
import { Main } from '~/ui/main';

export const meta: MetaFunction = () => {
  return [
    { title: 'About Us | GYCC' },
    { name: 'description', content: 'More about us' },
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
