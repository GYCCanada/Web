import { type MetaFunction, useLoaderData } from 'react-router';

import { Content } from '~/lib/content.server';
import { ReactRouterContext } from '~/lib/effect/router-context';
import { routeHandler } from '~/lib/effect/route';
import { getLocale } from '~/lib/localization/localization';

import { ConferenceDetail } from '../conference-detail';

export const meta: MetaFunction = ({ params }) => {
  const locale = getLocale(params);

  if (locale === 'fr') {
    return [
      { title: '2026 Inscription | GYCC' },
      { name: 'description', content: 'Inscrivez-vous à la conférence 2026.' },
    ];
  }

  return [
    { title: '2026 Registration | GYCC' },
    { name: 'description', content: 'Register for the 2026 conference.' },
  ];
};

export const loader = routeHandler(function* () {
  const { params } = yield* ReactRouterContext;
  const locale = getLocale(params);
  const content = yield* Content.Service;
  return { conference: yield* content.getConference(locale, 2026) };
});

export default function Registration() {
  const { conference } = useLoaderData<typeof loader>();
  return <ConferenceDetail conference={conference} />;
}
