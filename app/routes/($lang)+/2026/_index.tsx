import { type MetaFunction, useLoaderData } from 'react-router';

import { Content } from '~/lib/content.server';
import { ConferenceSlug } from '~/lib/content/schema';
import { ReactRouterContext } from '~/lib/effect/router-context';
import { routeHandler } from '~/lib/effect/route';
import { getLocale } from '~/lib/localization/localization';
import { Registrar } from '~/lib/registration/registrar.server';

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
  const channel = yield* (yield* Registrar.Service).get(ConferenceSlug.make('/2026'));
  const publicChannel = Registrar.projectPublicChannel(channel, locale);
  const loaded = yield* content.getConference(locale, 2026);
  const registrationUrl =
    publicChannel.intake === 'external'
      ? publicChannel.url
      : publicChannel.intake === 'open'
        ? publicChannel.registrationUrl
        : undefined;
  return { conference: { ...loaded, registrationUrl } };
});

export default function Registration() {
  const { conference } = useLoaderData<typeof loader>();
  return <ConferenceDetail conference={conference} />;
}
