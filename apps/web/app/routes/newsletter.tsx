import { parseWithZod } from '@conform-to/zod';
import mailchimp from '@mailchimp/mailchimp_marketing';
import { ActionFunctionArgs } from '@remix-run/node';
import { z } from 'zod';

import { env } from '~/lib/env.server';
import { TranslationKey } from '~/lib/localization/translations';
import { redirectWithToast } from '~/lib/toast.server';

mailchimp.setConfig({
  apiKey: env.MAILCHIMP_API_KEY,
  server: 'us10',
});

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

  if (env.NODE_ENV === 'production') {
    const res = await mailchimp.lists.addListMember(env.MAILCHIMP_LIST_ID!, {
      email_address: data.email,
      status: 'subscribed',
      merge_fields: {
        FNAME: data.name,
      },
    });
    if (res.status !== 200) {
      return submission.reply({
        formErrors: ['main.newsletter.error' satisfies TranslationKey],
      });
    }
  }

  return redirectWithToast(new URL(request.url).pathname, {
    type: 'success',
    title: 'main.newsletter.success.title' satisfies TranslationKey,
    description: 'main.newsletter.success.description' satisfies TranslationKey,
  });
};
