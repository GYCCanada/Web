import { FormProvider, useForm } from '@conform-to/react';
import { parseWithZod } from '@conform-to/zod';
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from '@remix-run/node';
import { Form, redirect, useActionData, useLoaderData } from '@remix-run/react';
import { useHints } from '~/lib/client-hints';
import { useTranslate } from '~/lib/localization/context';
import { Locale } from '~/lib/localization/localization';
import { getLocale } from '~/lib/localization/localization.server';
import { Button, buttonStyle } from '~/ui/button';
import { FieldErrors, fieldErrorStyle } from '~/ui/field-error';
import { Label } from '~/ui/label';
import { Link } from '~/ui/link';
import { Main } from '~/ui/main';
import { TextField } from '~/ui/text-field';
import clsx from 'clsx';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import { FacebookIcon, InstagramIcon, YoutubeIcon } from 'lucide-react';
import { z } from 'zod';

dayjs.extend(timezone);

export const meta: MetaFunction = () => {
  return [
    { title: 'While It Is Day | GYCC' },
    { name: 'description', content: 'Welcome to GYCC!' },
  ];
};

type Conference = {
  title: string;
  dates: [number, number];
  location: string;
  tagline: string;
  verse: string;
};

const conference: Record<Locale, Conference> = {
  en: {
    title: 'While It Is Day',
    dates: [dayjs('2024-08-21').valueOf(), dayjs('2024-08-25').valueOf()],
    location: 'British Columbia',
    tagline:
      '“I must work the works of Him who sent Me while it is day; the night is coming when no one can work.”',
    verse: 'John 9:4',
  },
  fr: {
    title: "Tant qu'il fait jour",
    dates: [dayjs('2024-08-21').valueOf(), dayjs('2024-08-25').valueOf()],
    location: 'Colombie-Britannique',
    tagline:
      '“Il faut que je fasse, tandis qu’il est jour, les œuvres de celui qui m’a envoyé; la nuit vient, où personne ne peut travailler.”',
    verse: 'Jean 9:4',
  },
};

export const loader = ({ params }: LoaderFunctionArgs) => {
  const locale = getLocale(params);
  return {
    conference: conference[locale],
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const formData = await request.formData();
  const submission = parseWithZod(formData, { schema });

  if (submission.status !== 'success') {
    return submission.reply();
  }

  const data = submission.payload;

  console.log(data);

  return redirect(new URL(request.url).pathname);
};

export default function Index() {
  const { conference } = useLoaderData<typeof loader>();
  const translate = useTranslate();
  return (
    <Main>
      <section className="flex flex-col gap-10 bg-[#FFD6BA] p-3 pb-16 text-black">
        <div>
          <img
            src="/2024/hero.png"
            alt={conference.title}
            className="aspect-auto w-full"
          />
          <Button className="absolute -bottom-6 right-4">
            {translate('main.reserve')}
          </Button>
        </div>
        <div className="flex flex-col gap-1 text-4xl">
          <h2>{conference.verse}</h2>
          <h2>
            {dayjs(conference.dates[0]).format('MMM')}{' '}
            {dayjs(conference.dates[0]).format('D')}-
            {dayjs(conference.dates[1]).format('D')},{' '}
            {dayjs(conference.dates[0]).format('YYYY')}
          </h2>
          <h2>{conference.location}</h2>
        </div>
        <p className="text-xl italic">{conference.tagline}</p>
      </section>
      <TimeLeft />
      <section className="flex flex-col px-3 py-12 text-5xl">
        <h3 className="text-5xl">
          {translate('main.gyc_tagline', {
            movement: (
              <span className="inline-block w-max italic">
                <GradientLine className="absolute inset-x-0 bottom-2" />
                <span>{translate('main.gyc_tagline.movement')}</span>
              </span>
            ),
            for: (
              <span className="inline-block w-max italic">
                <GradientLine className="absolute inset-x-0 bottom-2" />
                <span>{translate('main.gyc_tagline.for')}</span>
              </span>
            ),
          })}
        </h3>
      </section>
      <section className="flex flex-col pt-16 text-5xl">
        <img
          src="/main/people.png"
          alt="Mission"
          className="aspect-auto w-full"
        />
        <div className="absolute top-0 flex flex-col gap-6 p-3">
          <div>
            <Link to="/about" className={buttonStyle} data-variant="accent">
              {translate('main.read_our_story')}
            </Link>
          </div>
          <div>
            <Link to="/team" className={buttonStyle} data-variant="positive">
              {translate('main.meet_the_team')}
            </Link>
          </div>
        </div>
      </section>
      <NewsletterForm />
      <section className="flex flex-col gap-6 p-3">
        <p>{translate('main.socials.title')}</p>
        <div className="flex items-center gap-2.5">
          <a
            href="https://www.instagram.com/gyccanada"
            target="_blank"
            rel="noopener noreferrer"
            className="bg-foreground text-background px-4 py-3"
          >
            <InstagramIcon className="size-8" />
          </a>
          <a
            href="https://www.youtube.com/@gyccanada"
            target="_blank"
            rel="noopener noreferrer"
            className="bg-foreground text-background px-4 py-3"
          >
            <YoutubeIcon className="size-8" />
          </a>
          <a
            href="https://www.facebook.com/GYCCanada"
            target="_blank"
            rel="noopener noreferrer"
            className="bg-foreground text-background px-4 py-3"
          >
            <FacebookIcon className="size-8" />
          </a>
        </div>
      </section>
      <section className="flex flex-col gap-6 p-3">
        <img
          src="/main/mission.png"
          alt="Mission"
          className="aspect-auto w-full"
        />
        <h2 className="text-accent-600 text-4xl font-bold">
          {translate('main.join.title')}
        </h2>
        <p>
          {translate('main.join.subtitle', {
            br: (
              <>
                <br />
                <br />
              </>
            ),
          })}
        </p>
        <div className="flex flex-col gap-4">
          <div>
            <Link to="/give" className={buttonStyle} data-variant="accent">
              {translate('main.donate.link')}
            </Link>
          </div>
          <div>
            <Link
              to="/volunteer"
              className={buttonStyle}
              data-variant="positive"
            >
              {translate('main.join.link')}
            </Link>
          </div>
        </div>
      </section>
    </Main>
  );
}

function TimeLeft() {
  const hints = useHints();
  const { conference } = useLoaderData<typeof loader>();
  const translate = useTranslate();

  const days = dayjs(conference.dates[0])
    .tz(hints.timeZone)
    .diff(dayjs().tz(hints.timeZone), 'days');

  return (
    <section className="flex flex-col items-center justify-center gap-6 p-3 py-16 text-center text-4xl">
      {translate('main.time_left', {
        days: <p className="py-10 text-[144px] tabular-nums">{days}</p>,
      })}
    </section>
  );
}

function GradientLine({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        'to-link-700 h-2 w-full bg-gradient-to-r from-transparent',
        className,
      )}
    >
      {children}
    </div>
  );
}

const schema = z.object({
  email: z.string(),
  name: z.string(),
});

function NewsletterForm() {
  const translate = useTranslate();
  const lastResult = useActionData<typeof action>();
  const [form, fields] = useForm({
    shouldValidate: 'onSubmit',
    shouldRevalidate: 'onInput',
    defaultValue: {
      name: '',
      email: '',
    },
    lastResult,
    onValidate({ formData }) {
      return parseWithZod(formData, { schema });
    },
  });
  return (
    <section className="flex flex-col gap-4 px-3 py-16">
      <div className="text-accent-600 flex items-center gap-2">
        <h2 className="text-accent-600 text-4xl font-bold">
          {translate('main.newsletter.title')}
        </h2>
        <PaperPlane className="h-20 w-20" />
      </div>
      <p>{translate('main.newsletter.subtitle')}</p>
      <FormProvider context={form.context}>
        <Form method="POST" className="flex flex-col gap-4" id={form.id}>
          <TextField name={fields.name.name}>
            <Label>{translate('main.newsletter.name.label')}</Label>

            <TextField.Input
              type="text"
              placeholder={
                translate('main.newsletter.name.placeholder') as string
              }
            />
            <FieldErrors errors={fields.name.errors} />
          </TextField>
          <TextField name={fields.email.name}>
            <Label>{translate('main.newsletter.email.label')}</Label>
            <TextField.Input
              type="email"
              placeholder={
                translate('main.newsletter.email.placeholder') as string
              }
            />
            <FieldErrors errors={fields.email.errors} />
          </TextField>

          <div>
            <Button type="submit" variant="accent">
              {translate('main.newsletter.submit')}
            </Button>
            {form.errors && form.errors.length > 0 ? (
              <p className={fieldErrorStyle}>
                {translate('volunteer.form.error')}
              </p>
            ) : null}
          </div>
        </Form>
      </FormProvider>
    </section>
  );
}

function PaperPlane(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="76"
      height="76"
      viewBox="0 0 76 76"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="M7.58447 50.0722C10.9916 50.018 14.2149 49.6359 15.7678 49.4172C21.9565 48.5186 23.326 47.2259 26.8053 45.3179C28.4167 44.3457 29.565 42.5077 30.0083 40.6933C30.2425 38.9725 30.1091 38.6873 29.4554 37.4455C29.075 36.6041 27.6779 35.9148 27.1767 35.7096C25.2707 34.9037 24.1586 35.0158 23.0271 35.4679C21.742 35.9128 21.1858 36.5961 20.3537 38.055C19.8166 39.0667 19.3005 40.7229 19.4068 42.1195C19.5714 43.6723 20.0955 44.9991 20.6227 45.9925C20.9665 46.7298 23.1052 48.926 27.0399 49.2207C28.0985 49.2488 28.9371 49.2671 30.1354 49.1638C32.1528 49.0572 33.1762 49.1947 35.0904 48.6236C37.2662 48 38.5787 46.7384 40.3228 45.7958"
        stroke="currentColor"
        strokeWidth="2"
        strokeDasharray="4 4"
      />
      <path
        d="M65.2942 21.898C68.6557 20.5466 69.4211 21.1766 67.0342 24.177L51.6323 42.48C50.7375 43.4097 50.4723 43.6466 49.7069 43.8378C49.0877 43.9002 48.5582 43.8258 48.0327 43.2996L41.1706 34.0096C40.7456 33.3775 40.3556 32.8511 40.3937 32.2212C40.5835 31.4125 41.3568 31.0224 41.9911 30.6772L65.2942 21.898Z"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M67.7911 22.0789L43.7886 36.9696"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M43.514 37.5051C43.514 37.5051 43.3676 39.6341 43.3703 40.7002C43.372 41.4045 43.2951 42.1298 43.4757 42.8106C43.5416 43.0589 43.6156 43.3479 43.824 43.4981C44.038 43.6523 44.3577 43.7012 44.6066 43.614C44.8672 43.5227 44.9888 43.215 45.1711 43.0075C45.6456 42.4672 46.5473 41.346 46.5473 41.346"
        stroke="currentColor"
        strokeWidth="2"
      />
    </svg>
  );
}
