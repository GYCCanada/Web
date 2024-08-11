import mailchimp from '@mailchimp/mailchimp_marketing';

import { env } from './env.server';

mailchimp.setConfig({
  apiKey: env.MAILCHIMP_API_KEY,
  server: 'us10',
});

export async function subscribeToNewsletter(email: string, name: string) {
  const nameParts = name.split(' ');
  return await mailchimp.lists.addListMember(env.MAILCHIMP_LIST_ID!, {
    email_address: email,
    status: 'subscribed',
    merge_fields: {
      FNAME: nameParts[0],
      LNAME: nameParts.slice(1).join(' '),
    },
  });
}
