import { MetaFunction } from '@remix-run/react';

import { useTranslate } from '~/lib/localization/context';
import { getLocale } from '~/lib/localization/localization';
import { ExternalLink } from '~/ui/external-link';
import { Main } from '~/ui/main';

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

const email = (
  <ExternalLink href="mailto:hello@gyccanada.org">
    hello@gyccanada.org
  </ExternalLink>
);

export default function FaqPage() {
  const translate = useTranslate();
  return (
    <Main className="gap-10 px-3 py-12 text-2xl md:px-16">
      <h1 className="text-5xl">{translate('faq.title')}</h1>

      <QuestionLayout>
        <Question>{translate('faq.question.1.title')}</Question>
        <Answer>
          {translate('faq.question.1.answer.1', {
            email,
          })}
          <br />
          <br />
          {translate('faq.question.1.answer.2')}
          <br />
          <br />
          {translate('faq.question.1.answer.3', {
            email,
            before: (
              <span className="font-bold">
                {translate('faq.question.1.answer.3.before')}
              </span>
            ),
          })}
        </Answer>
      </QuestionLayout>

      <QuestionLayout>
        <Question>{translate('faq.question.2.title')}</Question>
        <Answer>
          {translate('faq.question.2.answer.1', {
            email,
          })}
          <br />
          <br />
          <span className="italic">{translate('faq.question.2.answer.2')}</span>
        </Answer>
      </QuestionLayout>

      <QuestionLayout>
        <Question>{translate('faq.question.3.title')}</Question>
        <Answer>
          {translate('faq.question.3.answer.1', {
            website: (
              <ExternalLink href="https://gyccanada.org">
                gyccanada.org
              </ExternalLink>
            ),
          })}
          <br />
          <br />
          <span className="font-bold">
            {translate('faq.question.3.answer.2')}
          </span>
        </Answer>
      </QuestionLayout>
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
