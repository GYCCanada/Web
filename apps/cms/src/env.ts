import 'dotenv/config';

import { z } from 'zod';

/**
 * This file is used to validate the environment variables.
 * It allows for process.env to be typed and validated.
 * We import this file in server.ts, so that the environment variables are validated before the server starts.
 * If the environment variables are invalid, the server will not start.
 * This makes it easy to catch errors early during deployment.
 */

const envSchema = z.object({
	DATABASE_URL: z.string(),
	PAYLOAD_SECRET: z.string(),
});

export type Env = z.infer<typeof envSchema>;

declare global {
	namespace NodeJS {
		interface ProcessEnv extends Env {}
	}
}

const res = envSchema.safeParse(process.env);
if (!res.success) {
	const errors = res.error.flatten().fieldErrors;
	throw new Error(
		`Invalid environment variables:\n${JSON.stringify(errors, null, 2)}`,
	);
}
