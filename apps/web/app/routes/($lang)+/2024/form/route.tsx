import {
	FormProvider,
	getFieldsetProps,
	getFormProps,
	useForm,
} from '@conform-to/react';
import { parseWithZod } from '@conform-to/zod';
import type {ActionFunctionArgs, LoaderFunctionArgs} from '@remix-run/node';
import { Form,  useActionData } from '@remix-run/react';
import type {MetaFunction} from '@remix-run/react';
import dayjs from 'dayjs';
import { z } from 'zod';

import { getCurrentConference } from '~/lib/conference.server';
import { useTranslate } from '~/lib/localization/context';
import { getLocale } from '~/lib/localization/localization';
import { Button } from '~/ui/button';
import { Checkbox, Checkboxes, CheckboxGroup } from '~/ui/checkbox';
import { FieldErrors } from '~/ui/field-error';
import { Label } from '~/ui/label';
import { Main } from '~/ui/main';
import { Radio, RadioGroup, Radios } from '~/ui/radio';
import { TextField } from '~/ui/text-field';

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

export const loader = async ({ params }: LoaderFunctionArgs) => {
	const locale = getLocale(params);
	const conference = getCurrentConference(locale);
	return {
		conference,
	};
};
 
export const action = async (_args: ActionFunctionArgs) => {};

const RegistrationSchema = z.object({
	registrants: z.array(
		z.discriminatedUnion('type', [
			z.object({
				type: z.literal('attendee'),
				name: z.string(),
				email: z.string().email(),
				phone: z.string(),
				dateOfBirth: z.string(),
				parent: z
					.object({
						name: z.string(),
						email: z.string(),
						phone: z.string(),
					})
					.optional(),
				gender: z.union([z.literal('male'), z.literal('female')]),
				meals: z.boolean(),
				dietaryRestrictions: z.string().optional(),
				outreach: z.array(
					z.union([
						z.literal('laws-of-health'),
						z.literal('homeless-carepacks'),
						z.literal('back-to-school'),
						z.literal('not-sure'),
					]),
				),
				extra: z.object({
					howDidYouHear: z.string(),
					whyAreYouAttending: z.string(),
					whatAreYouExcitedAbout: z.string(),
					firstTimeAttending: z.boolean(),
					church: z.string().optional(),
					merch: z.array(
						z.union([
							z.literal('t-shirt'),
							z.literal('hoodie'),
							z.literal('shirt'),
							z.literal('none'),
						]),
					),
					other: z.string(),
					tos: z.boolean(),
				}),
				volunteer: z.object({
					songLeader: z.boolean().optional(),
					musician: z.boolean().optional(),
					instrument: z.string().optional(),
					specialMusic: z.boolean().optional(),
					hospitality: z.boolean().optional(),
					registrationStation: z.boolean().optional(),
					usher: z.boolean().optional(),
					outreachLeader: z.boolean().optional(),
					smallGroupLeader: z.boolean().optional(),
					seminarRoomHost: z.boolean().optional(),
					cameraOperator: z.boolean().optional(),
					photographer: z.boolean().optional(),
					roamingMic: z.boolean().optional(),
				}),
			}),
			z.object({
				type: z.literal('exhibitor'),
				name: z.string(),
				email: z.string().email(),
				phone: z.string(),
				synopsis: z.string(),
				website: z.string().url(),
				company: z.string(),
			}),
		]),
	),
});

type FormData = z.infer<typeof RegistrationSchema>;
type DeepPartial<T> = T extends object
	? {
			[P in keyof T]?: DeepPartial<T[P]>;
		}
	: T;
type Registrant = DeepPartial<FormData['registrants'][0]>;

export const makeDefaultRegistrant = (): Registrant => ({
	name: '',
	email: '',
	phone: '',
	dateOfBirth: '',
	parent: undefined,
	gender: undefined,
	dietaryRestrictions: undefined,
	meals: undefined,
	extra: {
		firstTimeAttending: undefined,
		howDidYouHear: '',
		whyAreYouAttending: '',
		whatAreYouExcitedAbout: '',
		church: undefined,
		merch: [],
		other: '',
		tos: undefined,
	},
	outreach: [],
	volunteer: {
		songLeader: undefined,
		musician: undefined,
		instrument: undefined,
		specialMusic: undefined,
		hospitality: undefined,
		registrationStation: undefined,
		usher: undefined,
		outreachLeader: undefined,
		smallGroupLeader: undefined,
		seminarRoomHost: undefined,
		cameraOperator: undefined,
		photographer: undefined,
		roamingMic: undefined,
	},
});

export default function RegistrationForm() {
	const translate = useTranslate();
	const lastResult = useActionData<typeof action>();

	const [form, fields] = useForm({
		shouldValidate: 'onSubmit',
		shouldRevalidate: 'onInput',
		defaultValue: {
			registrants: [makeDefaultRegistrant()],
		},

		lastResult,
		onValidate({ formData }) {
			return parseWithZod(formData, { schema: RegistrationSchema });
		},
	});

	const registrants = fields.registrants.getFieldList();

	return (
		<Main className="gap-10 px-3 py-12 text-2xl md:px-16">
			<h1>{translate('registration.form.title')}</h1>
			<FormProvider context={form.context}>
				<Form
					method="POST"
					className="flex flex-col gap-4"
					{...getFormProps(form)}
				>
					{registrants.map((registrant, index) => {
						const type = (form.value?.registrants?.[index] as any)?.type as
							| 'attendee'
							| 'exhibitor';

						const fields = registrant.getFieldset();
						const dateOfBirth = (form.value?.registrants?.[index] as any)
							?.dateOfBirth;
						const age = dayjs().diff(dayjs(dateOfBirth), 'year');
						const isMinor = age < 18;
						const parent = fields.parent.getFieldset();
						const extras = fields.extra.getFieldset();
						const volunteer = fields.volunteer.getFieldset();

						return (
							<>
								<fieldset
									key={registrant.key}
									{...getFieldsetProps(registrant)}
									className="flex flex-col gap-4"
								>
									<RadioGroup name={fields.type.name}>
										<Radios>
											<Radio value="attendee">
												{translate('registration.form.attendee')}
											</Radio>
											<Radio value="exhibitor">
												{translate('registration.form.exhibitor')}
											</Radio>
										</Radios>
										<FieldErrors />
									</RadioGroup>
									<TextField name={fields.name.name}>
										<Label>{translate('registration.form.name.label')}</Label>
										<TextField.Input
											type="text"
											placeholder={
												translate(
													'registration.form.name.placeholder',
												) as string
											}
										/>
										<FieldErrors />
									</TextField>
									<TextField name={fields.email.name}>
										<Label>{translate('registration.form.email.label')}</Label>
										<TextField.Input
											type="text"
											placeholder={
												translate(
													'registration.form.email.placeholder',
												) as string
											}
										/>
										<FieldErrors />
									</TextField>
									<TextField name={fields.phone.name}>
										<Label>{translate('registration.form.phone.label')}</Label>
										<TextField.Input
											type="text"
											placeholder={
												translate(
													'registration.form.phone.placeholder',
												) as string
											}
										/>
										<FieldErrors />
									</TextField>

									{type === 'attendee' ? (
										<>
											<RadioGroup name={fields.gender.name}>
												<Label>
													{translate('registration.form.gender.label')}
												</Label>
												<Radios>
													<Radio value="male">
														{translate('registration.form.gender.male')}
													</Radio>
													<Radio value="female">
														{translate('registration.form.gender.female')}
													</Radio>
												</Radios>
												<FieldErrors />
											</RadioGroup>

											<TextField name={fields.dateOfBirth.name}>
												<Label>
													{translate('registration.form.date-of-birth.label')}
												</Label>
												<TextField.Input
													type="date"
													placeholder={
														translate(
															'registration.form.date-of-birth.placeholder',
														) as string
													}
												/>
												<FieldErrors />
											</TextField>

											{isMinor && (
												<fieldset>
													<TextField name={parent.name.name}>
														<Label>
															{translate('registration.form.parent.label')}
														</Label>
														<TextField.Input
															type="text"
															placeholder={
																translate(
																	'registration.form.parent.placeholder',
																) as string
															}
														/>
														<FieldErrors />
													</TextField>
													<TextField name={parent.email.name}>
														<Label>
															{translate(
																'registration.form.parent-email.label',
															)}
														</Label>
														<TextField.Input
															type="text"
															placeholder={
																translate(
																	'registration.form.parent-email.placeholder',
																) as string
															}
														/>
														<FieldErrors />
													</TextField>
													<TextField name={parent.phone.name}>
														<Label>
															{translate(
																'registration.form.parent-phone.label',
															)}
														</Label>
														<TextField.Input
															type="text"
															placeholder={
																translate(
																	'registration.form.parent-phone.placeholder',
																) as string
															}
														/>
														<FieldErrors />
													</TextField>
												</fieldset>
											)}

											<h2>Meals</h2>

											<RadioGroup name={fields.meals.name}>
												<Label>
													{translate('registration.form.meals.label')}
												</Label>
												<Radios>
													<Radio value="true">
														{translate('registration.form.meals.yes')}
													</Radio>
													<Radio value="false">
														{translate('registration.form.meals.no')}
													</Radio>
												</Radios>
												<FieldErrors />
											</RadioGroup>

											<TextField name={fields.dietaryRestrictions.name}>
												<Label>
													{translate(
														'registration.form.dietary-restrictions.label',
													)}
												</Label>
												<TextField.Input
													type="text"
													placeholder={
														translate(
															'registration.form.dietary-restrictions.placeholder',
														) as string
													}
												/>
												<FieldErrors />
											</TextField>

											<h2>Outreach</h2>
											<CheckboxGroup
												name={fields.outreach.name}
												orientation="vertical"
											>
												<Label>
													{translate('registration.form.outreach.label')}
												</Label>
												<Checkboxes>
													<Checkbox value="laws-of-health">
														{translate(
															'registration.form.outreach.laws-of-health',
														)}
													</Checkbox>
													<Checkbox value="homeless-carepacks">
														{translate(
															'registration.form.outreach.homeless-carepacks',
														)}
													</Checkbox>
													<Checkbox value="back-to-school">
														{translate(
															'registration.form.outreach.back-to-school',
														)}
													</Checkbox>
													<Checkbox value="not-sure">
														{translate('registration.form.outreach.not-sure')}
													</Checkbox>
												</Checkboxes>
												<FieldErrors />
											</CheckboxGroup>

											<h2>Extra Information</h2>

											<TextField name={extras.howDidYouHear.name}>
												<Label>
													{translate(
														'registration.form.how-did-you-hear.label',
													)}
												</Label>
												<TextField.Input
													type="text"
													placeholder={
														translate(
															'registration.form.how-did-you-hear.placeholder',
														) as string
													}
												/>
												<FieldErrors />
											</TextField>

											<TextField name={extras.whyAreYouAttending.name}>
												<Label>
													{translate(
														'registration.form.why-are-you-attending.label',
													)}
												</Label>
												<TextField.Input
													type="text"
													placeholder={
														translate(
															'registration.form.why-are-you-attending.placeholder',
														) as string
													}
												/>
												<FieldErrors />
											</TextField>

											<TextField name={extras.whatAreYouExcitedAbout.name}>
												<Label>
													{translate(
														'registration.form.what-are-you-excited-about.label',
													)}
												</Label>
												<TextField.Input
													type="text"
													placeholder={
														translate(
															'registration.form.what-are-you-excited-about.placeholder',
														) as string
													}
												/>
												<FieldErrors />
											</TextField>

											<RadioGroup name={extras.firstTimeAttending.name}>
												<Label>
													{translate(
														'registration.form.first-time-attending.label',
													)}
												</Label>
												<Radios>
													<Radio value="true">
														{translate(
															'registration.form.first-time-attending.yes',
														)}
													</Radio>
													<Radio value="false">
														{translate(
															'registration.form.first-time-attending.no',
														)}
													</Radio>
												</Radios>
												<FieldErrors />
											</RadioGroup>

											<TextField name={extras.church.name}>
												<Label>
													{translate('registration.form.church.label')}
												</Label>
												<TextField.Input
													type="text"
													placeholder={
														translate(
															'registration.form.church.placeholder',
														) as string
													}
												/>
												<FieldErrors />
											</TextField>

											<CheckboxGroup name={extras.merch.name}>
												<Label>
													{translate('registration.form.merch.label')}
												</Label>
												<Checkboxes>
													<Checkbox value="t-shirt">
														{translate('registration.form.merch.t-shirt')}
													</Checkbox>
													<Checkbox value="hoodie">
														{translate('registration.form.merch.hoodie')}
													</Checkbox>
													<Checkbox value="shirt">
														{translate('registration.form.merch.shirt')}
													</Checkbox>
													<Checkbox value="none">
														{translate('registration.form.merch.none')}
													</Checkbox>
												</Checkboxes>
												<FieldErrors />
											</CheckboxGroup>

											<TextField name={extras.other.name}>
												<Label>
													{translate('registration.form.other.label')}
												</Label>
												<TextField.Input
													type="text"
													placeholder={
														translate(
															'registration.form.other.placeholder',
														) as string
													}
												/>
												<FieldErrors />
											</TextField>

											<CheckboxGroup name={extras.tos.name}>
												<Label>
													{translate('registration.form.tos.label')}
												</Label>
												<Checkboxes>
													<Checkbox value="true">
														{translate('registration.form.tos.agree')}
													</Checkbox>
												</Checkboxes>
												<FieldErrors />
											</CheckboxGroup>

											<h2>Volunteer</h2>

											<Checkbox name={volunteer.songLeader.name}>
												{translate('registration.form.song-leader.label')}
											</Checkbox>
											<Checkbox name={volunteer.musician.name}>
												{translate('registration.form.musician.label')}
											</Checkbox>
											<TextField name={volunteer.instrument.name}>
												<Label>
													{translate('registration.form.instrument.label')}
												</Label>
												<TextField.Input
													type="text"
													placeholder={
														translate(
															'registration.form.instrument.placeholder',
														) as string
													}
												/>
												<FieldErrors />
											</TextField>

											<Checkbox name={volunteer.specialMusic.name}>
												{translate('registration.form.special-music.label')}
											</Checkbox>
											<Checkbox name={volunteer.hospitality.name}>
												{translate('registration.form.hospitality.label')}
											</Checkbox>
											<Checkbox name={volunteer.registrationStation.name}>
												{translate(
													'registration.form.registration-station.label',
												)}
											</Checkbox>
											<Checkbox name={volunteer.usher.name}>
												{translate('registration.form.usher.label')}
											</Checkbox>

											<Checkbox name={volunteer.outreachLeader.name}>
												{translate('registration.form.outreach-leader.label')}
											</Checkbox>
											<Checkbox name={volunteer.smallGroupLeader.name}>
												{translate(
													'registration.form.small-group-leader.label',
												)}
											</Checkbox>
											<Checkbox name={volunteer.seminarRoomHost.name}>
												{translate('registration.form.seminar-room-host.label')}
											</Checkbox>
											<Checkbox name={volunteer.photographer.name}>
												{translate('registration.form.camera-operator.label')}
											</Checkbox>
											<Checkbox>
												{translate('registration.form.photographer.label')}
											</Checkbox>
											<Checkbox name={volunteer.roamingMic.name}>
												{translate('registration.form.roaming-mic.label')}
											</Checkbox>
										</>
									) : (
										<>
											<TextField name={fields.company.name}>
												<Label>
													{translate('registration.form.company.label')}
												</Label>
												<TextField.Input
													type="text"
													placeholder={
														translate(
															'registration.form.company.placeholder',
														) as string
													}
												/>
												<FieldErrors />
											</TextField>

											<TextField name={fields.synopsis.name}>
												<Label>
													{translate('registration.form.synopsis.label')}
												</Label>
												<TextField.Input
													type="text"
													placeholder={
														translate(
															'registration.form.synopsis.placeholder',
														) as string
													}
												/>
												<FieldErrors />
											</TextField>

											<TextField name={fields.website.name}>
												<Label>
													{translate('registration.form.website.label')}
												</Label>
												<TextField.Input
													type="text"
													placeholder={
														translate(
															'registration.form.website.placeholder',
														) as string
													}
												/>
												<FieldErrors />
											</TextField>
										</>
									)}
								</fieldset>
							</>
						);
					})}
					<div>
						<Button
							type="button"
							onPress={() => {
								form.insert({ name: 'registrants' });
							}}
						>
							Add Registrant
						</Button>
					</div>
					<div>
						<Button type="submit">Submit</Button>
					</div>
				</Form>
			</FormProvider>
		</Main>
	);
}
