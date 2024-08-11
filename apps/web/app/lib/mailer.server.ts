import nodemailer from 'nodemailer';

import { env } from './env.server';

let transporter: nodemailer.Transporter;

if (env.NODE_ENV === 'production') {
	const host = env.MAIL_HOST;
	const port = env.MAIL_PORT;
	const user = env.MAIL_USER;
	const pass = env.MAIL_PASS;

	const options = {
		host: host,
		port: port,
		secure: port === 465 ? true : false,
		auth: {
			user: user,
			pass: pass,
		},
	};
	transporter = nodemailer.createTransport(options);
}

export async function sendMail({
	subject,
	content,
}: {
	subject: string;
	content: string;
}): Promise<void> {
	if (env.NODE_ENV !== 'production') {
		return;
	}
	await transporter.sendMail({
		from: `GYCC Contact <${env.MAIL_FROM}>`,
		to: env.MAIL_TO,
		subject,
		text: content,
	});
}
