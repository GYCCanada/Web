import { parseWithZod } from '@conform-to/zod';
import mailchimp from '@mailchimp/mailchimp_marketing';
import { ActionFunctionArgs, redirect } from '@remix-run/node';
import { z } from 'zod';

import { env } from '~/lib/env.server';

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
    return submission.reply();
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
      return submission.reply();
    }
  }

  return redirect(new URL(request.url).pathname);
};
