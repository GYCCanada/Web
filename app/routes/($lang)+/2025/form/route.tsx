import { type MetaFunction, useActionData, useLoaderData } from 'react-router';
import { Schema } from 'effect';

import { Content } from '~/lib/content.server';
import { ReactRouterContext } from '~/lib/effect/router-context';
import { routeHandler } from '~/lib/effect/route';
import { FormDefinition } from '~/lib/forms/definition';
import { Forms } from '~/lib/forms/forms.server';
import {
  newSubmissionCommandFields,
  resolveSubmissionCommandFields,
} from '~/lib/forms/submission-command';
import { getLocale } from '~/lib/localization/localization';

import { action } from '../../registration-route';
import { RegistrationForm } from '../../registration-form';

// The registration server action (net-new in Branch 7.3) is shared across all
// three year shells — RegFox carries the live channel (settled #9), so the
// on-site persist-then-notify path is one configured action, not three forks.
export { action };

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
  const forms = yield* Forms.Service;
  const conference = yield* content.getCurrentConference(locale);
  // The current immutable relational definition drives validation and copy; an
  // admin publication changes both with no code deploy.
  const published = yield* forms.current('registration');
  return {
    conference,
    definition: yield* Schema.encodeEffect(FormDefinition)(published.definition),
    command: newSubmissionCommandFields(published.version),
  };
});

export default function Registration2025() {
  const { definition, command } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  return (
    <RegistrationForm
      year={2025}
      definition={definition}
      command={resolveSubmissionCommandFields(command, actionData?.command)}
      actionData={actionData?.result}
    />
  );
}
