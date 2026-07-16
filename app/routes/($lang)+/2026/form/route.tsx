import { type MetaFunction, redirect, useActionData, useLoaderData } from 'react-router';
import { Effect, Result, Schema } from 'effect';

import { Auth } from '~/lib/auth.server';
import { Content } from '~/lib/content.server';
import { ConferenceSlug } from '~/lib/content/schema';
import { ReactRouterContext } from '~/lib/effect/router-context';
import { routeHandler } from '~/lib/effect/route';
import { FormDefinition } from '~/lib/forms/definition';
import { Forms } from '~/lib/forms/forms.server';
import {
  newSubmissionCommandFields,
  resolveSubmissionCommandFields,
} from '~/lib/forms/submission-command';
import { getLocale } from '~/lib/localization/localization';
import { registrationIntakeAction } from '~/lib/registration/intake-action.server';
import { Registrar } from '~/lib/registration/registrar.server';

import { RegistrationForm } from '../../registration-form';

export const action = registrationIntakeAction;

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
  const { params, request } = yield* ReactRouterContext;
  const locale = getLocale(params);
  const content = yield* Content.Service;
  const forms = yield* Forms.Service;
  const channel = yield* (yield* Registrar.Service).get(ConferenceSlug.make('/2026'));
  if (channel.state === 'external') {
    return yield* Effect.fail(redirect(channel.url));
  }
  if (channel.state === 'closed' || channel.state === 'draining') {
    return yield* Effect.fail(new Response('Not Found', { status: 404 }));
  }
  if (channel.state === 'preview') {
    const auth = yield* Auth.Service;
    const authenticated = yield* auth
      .checkCookie(request.headers.get('cookie'))
      .pipe(Effect.result);
    if (Result.isFailure(authenticated)) {
      return yield* Effect.fail(new Response('Not Found', { status: 404 }));
    }
  }
  const conference = yield* content.getCurrentConference(locale);
  const published = yield* forms.published('registration', channel.formVersion);
  return {
    conference,
    definition: yield* Schema.encodeEffect(FormDefinition)(published.definition),
    command: newSubmissionCommandFields(published.version),
    preview: channel.state === 'preview',
  };
});

export default function Registration2026() {
  const { definition, command, preview } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  return (
    <RegistrationForm
      year={2026}
      definition={definition}
      command={resolveSubmissionCommandFields(command, actionData?.command)}
      actionData={actionData?.result}
      preview={preview}
    />
  );
}
