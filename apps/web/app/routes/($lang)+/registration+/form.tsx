import { MetaFunction } from '@remix-run/react';
import { getLocale } from '~/lib/localization/localization';
import { Main } from '~/ui/main';

export const meta: MetaFunction = ({ params }) => {
  const locale = getLocale(params);

  if (locale === 'fr') {
    return [
      { title: 'Formulaire d’inscription | GYCC' },
      {
        name: 'description',
        content: 'Inscrivez-vous pour devenir membre de GYCC',
      },
    ];
  }
  return [
    { title: 'Registration Form | GYCC' },
    {
      name: 'description',
      content: 'Sign up to become a member of GYCC',
    },
  ];
};

export default function RegistrationForm() {
  return (
    <Main>
      <h1>Registration Form</h1>
    </Main>
  );
}
