import { parseWithZod } from '@conform-to/zod';
import { ActionFunctionArgs } from '@remix-run/node';
import { z } from 'zod';

import { TranslationKey } from '~/lib/localization/translations';
import { subscribeToNewsletter } from '~/lib/mailchimp.server';
import { redirectWithToast } from '~/lib/toast.server';

const schema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
});

export const action = async ({ request }: ActionFunctionArgs) => {
  const formData = await request.formData();
  const submission = parseWithZod(formData, { schema });

  if (submission.status !== 'success') {
    return submission.reply({
      formErrors: ['main.newsletter.error' satisfies TranslationKey],
    });
  }

  const data = submission.value;

  const res = await subscribeToNewsletter(data.email, data.name);
  if (res.status !== 200) {
    return submission.reply({
      formErrors: ['main.newsletter.error' satisfies TranslationKey],
    });
  }

  return redirectWithToast(new URL(request.url).pathname, {
    type: 'success',
    title: 'main.newsletter.success.title' satisfies TranslationKey,
    description: 'main.newsletter.success.description' satisfies TranslationKey,
  });
};
