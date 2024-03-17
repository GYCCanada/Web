import type { MetaFunction } from '@remix-run/node';
import { useTranslate } from '~/lib/localization/context';
import { buttonStyle } from '~/ui/button';
import { Main } from '~/ui/main';

export const meta: MetaFunction = () => {
  return [
    { title: 'Give | GYCC' },
    { name: 'description', content: 'Support the GYC Canada movement.' },
  ];
};

export default function Index() {
  const translate = useTranslate();
  return (
    <Main className="px-3 py-4">
      <div className="flex flex-col gap-4">
        <h1 className="text-5xl">
          {translate('give.title', {
            movement: (
              <span className="italic">{translate('give.movement')}</span>
            ),
          })}
        </h1>
        <p>{translate('give.reason')}</p>
      </div>

      <div className="flex flex-col gap-4">
        <h2 className="text-3xl">{translate('give.directions')}</h2>
        <ol className="list-inside list-decimal">
          <li>{translate('give.directions.1')}</li>
          <li>{translate('give.directions.2')}</li>
          <li>{translate('give.directions.3')}</li>
          <li>{translate('give.directions.4')}</li>
        </ol>
        <div>
          <a
            className={buttonStyle}
            href="https://www.paypal.com/donate/?hosted_button_id=FBZXG43LWD232&fbclid=IwAR027jskxadQlC1PFallSB0btxLH0bB0kd-xDM8UQ76ASneG0hXqsnTbJu8"
          >
            {translate('give.contine')}
          </a>
        </div>
      </div>
    </Main>
  );
}
