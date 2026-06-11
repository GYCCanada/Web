import { Effect } from 'effect';
import { type MetaFunction, useActionData } from 'react-router';

import { Content } from '~/lib/content.server';
import { ReactRouterContext } from '~/lib/effect/router-context';
import { routeAction, routeHandler } from '~/lib/effect/route';
import { getLocale } from '~/lib/localization/localization';

import { RegistrationForm } from '../../registration-form';

export const meta: MetaFunction<typeof loader> = ({ params }) => {
  const locale = getLocale(params);

  if (locale === 'fr') {
    return [
      { title: 'Formulaire d’inscription | GYCC' },
      {
        name: 'description',
        content: `Inscrivez-vous à la conférence de ${new Date().getFullYear()}.`,
      },
    ];
  }
  return [
    { title: 'Registration Form | GYCC' },
    {
      name: 'description',
      content: `Register for the ${new Date().getFullYear()} conference.`,
    },
  ];
};

export const loader = routeHandler(function* () {
  const { params } = yield* ReactRouterContext;
  const locale = getLocale(params);
  const content = yield* Content.Service;
  const conference = yield* content.getCurrentConference(locale);
  return { conference };
});

// Registration submission is a deliberate no-op (product decision pending).
export const action = routeAction(function* () {
  yield* Effect.void;
});

export default function Registration2024() {
  const actionData = useActionData<typeof action>();
  return (
    <RegistrationForm
      year={2024}
      actionData={actionData}
    />
  );
}
