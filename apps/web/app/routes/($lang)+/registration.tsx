import { FormProvider, useForm } from '@conform-to/react';
import { parseWithZod } from '@conform-to/zod';
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from '@remix-run/node';
import { Form, redirect, useActionData, useLoaderData } from '@remix-run/react';
import { Breakpoint, useBreakpoint, useHints } from '~/lib/client-hints';
import { getCurrentConference } from '~/lib/conference.server';
import { dayjs } from '~/lib/dayjs';
import { useLocale, useTranslate } from '~/lib/localization/context';
import { getLocale } from '~/lib/localization/localization.server';
import { Button, buttonStyle } from '~/ui/button';
import { FieldErrors, fieldErrorStyle } from '~/ui/field-error';
import { LocalizedImage } from '~/ui/image';
import { Label } from '~/ui/label';
import { Link } from '~/ui/link';
import { Main } from '~/ui/main';
import { TextField } from '~/ui/text-field';
import { motion, transform, useMotionValue } from 'framer-motion';
import {
  ArrowRightIcon,
  FacebookIcon,
  InstagramIcon,
  PlayIcon,
  YoutubeIcon,
} from 'lucide-react';
import * as React from 'react';
import { match } from 'ts-pattern';
import { z } from 'zod';

export const meta: MetaFunction = () => {
  return [
    { title: 'While It Is Day | GYCC' },
    { name: 'description', content: 'Welcome to GYCC!' },
  ];
};

export const loader = ({ params }: LoaderFunctionArgs) => {
  const locale = getLocale(params);
  return { conference: getCurrentConference(locale) };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const formData = await request.formData();
  const submission = parseWithZod(formData, { schema });

  if (submission.status !== 'success') {
    return submission.reply();
  }

  // const data = submission.payload;

  return redirect(new URL(request.url).pathname);
};

export default function Index() {
  const translate = useTranslate();
  const { conference } = useLoaderData<typeof loader>();
  return (
    <Main>
      <Hero />
      <section className="relative flex flex-col gap-6 px-3 py-12">
        <StickyTitle className="bg-inherit text-4xl font-bold data-[sticky]:fixed data-[sticky]:top-[60px] data-[sticky]:z-10">
          {translate('registration.speakers.title')}
        </StickyTitle>
        <div className="flex flex-col gap-20 md:grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {conference.speakers.map((speaker, i) => (
            <SpeakerCard key={i} {...speaker} />
          ))}
        </div>
      </section>
      <section className="flex flex-col gap-6 px-3 py-12">
        <h2 className="sticky top-0 bg-inherit text-4xl font-bold">
          {translate('registration.seminars.title')}
        </h2>
        <div className="flex flex-col gap-20 md:grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {conference.seminars.map((seminar, i) => (
            <SpeakerCard
              key={i}
              img={seminar.speaker.img}
              name={seminar.speaker.name}
              activity={seminar.title}
            />
          ))}
        </div>
      </section>

      <NewsletterForm />

      <section className="flex flex-col gap-6 p-4 md:py-32">
        <h2 className="text-accent-600 text-4xl font-bold">
          {translate('registration.faq.title')}
        </h2>
        <p>{translate('registration.faq.subtitle')}</p>
        <div className="flex flex-col gap-4">
          <div>
            <Link to="/contact" className={buttonStyle} data-variant="accent">
              {translate('registration.faq.contact')}
            </Link>
          </div>
          <div>
            <Link to="/faq" className={buttonStyle} data-variant="positive">
              {translate('registration.faq.view')}
            </Link>
          </div>
        </div>
      </section>
    </Main>
  );
}

function Hero() {
  const breakpoint = useBreakpoint();
  return match(breakpoint)
    .when(
      (b) => b <= Breakpoint.Md,
      () => <MobileHero />,
    )
    .otherwise(() => <DesktopHero />);
}

function MobileHero() {
  const { conference } = useLoaderData<typeof loader>();
  const hints = useHints();
  const translate = useTranslate();
  const locale = useLocale();
  return (
    <section className="flex flex-col gap-10 pb-16">
      <div>
        <LocalizedImage
          srcs={{
            en: '/2024/en/hero-mobile.jpg',
            fr: '/2024/fr/hero-mobile.jpg',
          }}
        />
        <Button className="absolute -bottom-6 left-4" variant="default">
          <PlayIcon className="size-5" />{' '}
          {translate('registration.watch-promo')}
        </Button>
      </div>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2 text-4xl">
          <h2>
            {dayjs(conference.dates[0]).tz(hints.timeZone).format('MMM')}{' '}
            {dayjs(conference.dates[0]).tz(hints.timeZone).format('D')}-
            {dayjs(conference.dates[1]).tz(hints.timeZone).format('D')},{' '}
            {dayjs(conference.dates[0]).tz(hints.timeZone).format('YYYY')}
          </h2>
          <h3>{conference.location}</h3>
        </div>
        <p className="text-balance text-xl italic">{conference.tagline}</p>
        <p className="text-xl uppercase">
          {conference.bible.book} {conference.bible.chapter}:
          {conference.bible.verse}
        </p>
        <div>
          <a
            className={buttonStyle}
            data-variant="accent"
            href={`https://www.biblegateway.com/passage/?search=${conference.bible.book}+${conference.bible.chapter}&version=${locale === 'en' ? 'NKJV' : 'LSG'}`}
          >
            {translate('main.read_bible')}
          </a>
        </div>
      </div>
    </section>
  );
}
function DesktopHero() {
  const { conference } = useLoaderData<typeof loader>();
  const hints = useHints();
  const translate = useTranslate();
  return (
    <section className="full-bleed flex flex-col gap-10 p-4 pb-16">
      <div className="mx-auto flex w-[--width] gap-10 py-16">
        <div className="flex flex-1 flex-col gap-10">
          <LocalizedImage
            srcs={{
              en: '/2024/en/hero-desktop.jpg',
              fr: '/2024/fr/hero-desktop.jpg',
            }}
          />
          <p className="text-2xl italic">{conference.tagline}</p>
        </div>
        <div className="flex w-1/4 flex-col justify-between gap-6">
          <div
            className="flex flex-col justify-end uppercase"
            style={{
              writingMode: 'vertical-rl',
            }}
          >
            <h1 className="text-[96px] font-black leading-tight tracking-tight">
              {conference.bible.book}
            </h1>
            <h1 className="text-[168px] font-black leading-[0.5]">
              {conference.bible.chapter}:{conference.bible.verse}
            </h1>
          </div>
          <div className="flex flex-col gap-10">
            <div className="flex flex-col gap-6">
              <h2 className="text-5xl">
                {dayjs(conference.dates[0]).tz(hints.timeZone).format('MMM')}{' '}
                {dayjs(conference.dates[0]).tz(hints.timeZone).format('D')}-
                {dayjs(conference.dates[1]).tz(hints.timeZone).format('D')},{' '}
                {dayjs(conference.dates[0]).tz(hints.timeZone).format('YYYY')}
              </h2>
              <h3 className="text-5xl">{conference.location}</h3>
            </div>
            <div>
              <Button>{translate('registration.watch-promo')}</Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

interface SpeakerCardProps {
  name: string;
  activity: string;
  img: string;
}

function SpeakerCard({ name, activity, img }: SpeakerCardProps) {
  const id = React.useId();
  const ref = React.useRef<HTMLDivElement>(null);

  const position = useMotionValue(20);
  const rotate = useMotionValue(0);

  React.useEffect(() => {
    const scrollContainer = document.querySelector('[data-scroll-container]');

    if (!scrollContainer) return;

    let isInViewport = false;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry.isIntersecting) {
          isInViewport = true;
        } else {
          isInViewport = false;
        }
      },
      {
        root: scrollContainer,

        threshold: 0,
      },
    );

    observer.observe(ref.current!);

    const initialCardRect = ref.current?.getBoundingClientRect();

    if (!initialCardRect) return;
    const bounds = [
      initialCardRect.top,
      initialCardRect.top + initialCardRect.height,
    ];

    function onScroll() {
      const containerEle = document.querySelector(
        '[data-scroll-container]',
      ) as HTMLElement;
      if (!containerEle) return;
      if (!isInViewport) return;
      const scrollY = containerEle.scrollTop + containerEle.clientHeight;

      const nextPosition = transform(scrollY, bounds, [20, 4]);
      const nextRotate = transform(scrollY, bounds, [0, -3]);

      position.set(nextPosition);
      rotate.set(nextRotate);
    }

    scrollContainer.addEventListener('scroll', onScroll);
    return () => {
      observer.disconnect();
      scrollContainer.removeEventListener('scroll', onScroll);
    };
  }, [position, rotate]);

  return (
    <div className="relative aspect-square w-full" ref={ref} id={id}>
      <motion.div
        className="text-link-50 bg-link-600 rota size-[95%] h-[90%] overflow-hidden p-4"
        style={{
          left: position,
          top: position,
          rotate,
        }}
      >
        <p className="break-words text-[100px] font-black uppercase leading-[0.8] tracking-tight opacity-30">
          {activity}
        </p>
      </motion.div>

      <div className="absolute bottom-0 right-0 size-[90%] overflow-hidden rounded-md">
        <img className="size-full" src={img} alt={`${name}, ${activity}`} />
        <div className="absolute inset-x-0 bottom-0 flex flex-col bg-black/30 p-4">
          <div className="flex items-center gap-2">
            <h3 className="text-3xl font-bold leading-5">{name}</h3>
            <ArrowRightIcon className="size-8" />
          </div>
          <p className="text-xl">{activity}</p>
        </div>
      </div>
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
    <section className="flex flex-col gap-4 px-3 py-16 md:py-32">
      <div className="flex flex-col gap-4 md:flex-row-reverse">
        <img
          src="/main/mission.png"
          alt="Mission"
          className="aspect-auto max-md:w-full md:flex-1"
        />
        <div className="flex flex-col gap-4 md:flex-1">
          <h2 className="text-accent-600 flex-1 shrink text-4xl font-bold">
            {translate('main.newsletter.title')}
            <span className="inline-flex align-middle">
              <PaperPlane className="size-16" />
            </span>
          </h2>

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
        </div>
      </div>
      <div className="flex flex-col gap-6">
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
      </div>
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

function StickyTitle({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = React.useRef<HTMLHeadingElement>(null);

  const [isSticky, setIsSticky] = React.useState(false);

  React.useEffect(() => {
    const element = ref.current;
    const scrollContainer = document.querySelector('[data-scroll-container]');
    if (!scrollContainer) return;
    if (!element) return;
    const container = element.parentElement;
    if (!container) return;
    let headerIsVisible = false;
    let containerIsVisible = false;
    const containerObserver = new IntersectionObserver(
      ([e]) => {
        containerIsVisible = e.isIntersecting;
        setIsSticky(containerIsVisible && !headerIsVisible);
      },
      {
        root: scrollContainer,
        threshold: 0.5,
      },
    );
    const headerObserver = new IntersectionObserver(
      ([e]) => {
        headerIsVisible = e.isIntersecting;
        setIsSticky(containerIsVisible && !headerIsVisible);
      },
      {
        root: scrollContainer,
        threshold: 0,
      },
    );
    containerObserver.observe(container);
    headerObserver.observe(element);

    return () => {
      containerObserver.disconnect();
      headerObserver.disconnect();
    };
  }, []);

  return (
    <h2 className={className} ref={ref} data-sticky={isSticky ? '' : undefined}>
      {children}
    </h2>
  );
}
