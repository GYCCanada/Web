import { z } from 'zod';

const schema = z.discriminatedUnion('NODE_ENV', [
  z.object({
    NODE_ENV: z.enum(['development', 'test']),
    MAIL_HOST: z.string().optional(),
    MAIL_PORT: z.coerce.number().optional(),
    MAIL_USER: z.string().optional(),
    MAIL_PASS: z.string().optional(),
    MAIL_FROM: z.string().optional(),
    MAIL_TO: z.string().optional(),
    MAILCHIMP_API_KEY: z.string().optional(),
    MAILCHIMP_LIST_ID: z.string().optional(),
  }),
  z.object({
    NODE_ENV: z.literal('production'),
    MAIL_HOST: z.string(),
    MAIL_PORT: z.coerce.number(),
    MAIL_USER: z.string(),
    MAIL_PASS: z.string(),
    MAIL_FROM: z.string(),
    MAIL_TO: z.string(),
    MAILCHIMP_API_KEY: z.string(),
    MAILCHIMP_LIST_ID: z.string(),
  }),
]);
const parsed = schema.safeParse(process.env);

if (parsed.success === false) {
  console.error(
    '❌ Invalid environment variables:',
    parsed.error.flatten().fieldErrors,
  );

  throw new Error('Invalid environment variables');
}

export const env = parsed.data;

/**
 * This is used in both `entry.server.ts` and `root.tsx` to ensure that
 * the environment variables are set and globally available before the app is
 * started.
 *
 * NOTE: Do *not* add any environment variables in here that you do not wish to
 * be included in the client.
 * @returns all public ENV variables
 */
export function getEnv() {
  return {
    ENV: env.NODE_ENV,
  };
}

type ENV = ReturnType<typeof getEnv>;

declare global {
  var ENV: ENV;
  interface Window {
    ENV: ENV;
  }
}
