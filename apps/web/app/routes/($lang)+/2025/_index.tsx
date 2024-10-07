import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData, useSearchParams } from '@remix-run/react';
import clsx from 'clsx';
import {
  AnimatePresence,
  motion,
  MotionConfig,
  transform,
  useMotionValue,
} from 'framer-motion';
import { ArrowLeftIcon, ArrowRightIcon } from 'lucide-react';
import * as React from 'react';
import { useButton } from 'react-aria';
import { match } from 'ts-pattern';

import { Breakpoint, useBreakpoint, useHints } from '~/lib/client-hints';
import { getConferenceByYear } from '~/lib/conference.server';
import { dayjs } from '~/lib/dayjs';
import { useLocale, useTranslate } from '~/lib/localization/context';
import { getLocale } from '~/lib/localization/localization';
import { buttonStyle } from '~/ui/button';
import { ExternalLink } from '~/ui/external-link';
import { LocalizedImage } from '~/ui/image';
import { Link } from '~/ui/link';
import { Main } from '~/ui/main';

export const meta: MetaFunction = ({ params }) => {
  const locale = getLocale(params);

  if (locale === 'fr') {
    return [
      { title: `${new Date().getFullYear()} Inscription | GYCC` },
      { name: 'description', content: 'Inscrivez-vous à la conférence 2024.' },
    ];
  }

  return [
    { title: `${new Date().getFullYear()} Registration | GYCC` },
    { name: 'description', content: 'Register for the 2024 conference.' },
  ];
};

export const loader = ({ params }: LoaderFunctionArgs) => {
  const locale = getLocale(params);
  return { conference: getConferenceByYear(locale, 2025) };
};

export default function Registration() {
  return (
    <Main>
      <Hero />

      <MapSection />

      <SpeakersAndSeminars />

      <RegistrationSection />

      <FaqSection />
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
        <div className="absolute -bottom-6 left-4 flex items-center gap-4">
          <a
            className={clsx(buttonStyle)}
            href="https://gyccanada.regfox.com/gyc-canada-2024-while-it-is-day"
          >
            {translate('registration.register')}
          </a>
          <a
            className={clsx(buttonStyle)}
            href="https://docs.google.com/document/d/1gNAOfdW2Yhgg7FABjUqQt2k2mXV_AdhARWUOyiVL9dA/pub"
            target="_blank"
          >
            {translate('registration.schedule')}
          </a>
        </div>
      </div>
      <div className="flex flex-col gap-4 px-4">
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
            <div className="flex items-center gap-4">
              <a
                className={buttonStyle}
                href="https://gyccanada.regfox.com/gyc-canada-2024-while-it-is-day"
              >
                {translate('registration.register')}
              </a>
              <a
                className={clsx(buttonStyle)}
                href="https://docs.google.com/document/d/1gNAOfdW2Yhgg7FABjUqQt2k2mXV_AdhARWUOyiVL9dA/pub"
                target="_blank"
              >
                {translate('registration.schedule')}
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// 1. two column section with hotel info & map on right hand side (one column on mobile)
// 2. change early bird to normal rates
function MapSection() {
  const translate = useTranslate();
  return (
    <section className="grid grid-cols-1 gap-10 p-4 pb-16 md:grid-cols-2">
      <div className="flex flex-col gap-6">
        <p>
          {translate('registration.hotels.description', {
            facebook: (
              <ExternalLink href="https://www.facebook.com/groups/1741752369173171">
                {translate('registration.hotels.description.facebook')}
              </ExternalLink>
            ),
          })}
        </p>
        <ul>
          <li>Super 8 by Wyndham Kelowna BC</li>
          <li>
            Fairfield Inn & Suites Kelowna Holiday Inn Express & Suites Kelowna
            - "GYC Canada” or Group Code: “GYC" (call 778-484-2999 for discount)
          </li>
          <li>Microtel Inn & Suites by Wyndham Kelowna</li>
          <li>Comfort Suites</li>
          <li>Kelowna Days Inn by Wyndham Kelowna</li>
        </ul>
      </div>
      <div className="aspect-video">
        <iframe
          src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d2570.54720532797!2d-119.4124495876084!3d49.888529227544645!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x537d8d28862f4bfd%3A0xd41402dfff0455f4!2s130%20Gerstmar%20Rd%2C%20Kelowna%2C%20BC%20V1X%204A7!5e0!3m2!1sen!2sca!4v1720988332743!5m2!1sen!2sca"
          style={{
            border: 0,
          }}
          className="size-full"
          allowFullScreen
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          title="Map"
        ></iframe>
      </div>
    </section>
  );
}

function SpeakersAndSeminars() {
  const { conference } = useLoaderData<typeof loader>();
  const translate = useTranslate();
  return (
    <>
      <section className="relative flex flex-col gap-6 px-3 py-12">
        <h2 className="bg-inherit text-4xl font-bold data-[sticky]:fixed data-[sticky]:top-[60px] data-[sticky]:z-10">
          {translate('registration.speakers.title')}
        </h2>
        <div className="flex flex-col gap-20 md:grid md:grid-cols-1">
          {conference.speakers.map((speaker, i) => (
            <SpeakerCard
              key={i}
              {...speaker}
            />
          ))}
        </div>
      </section>
      <section className="flex flex-col gap-6 px-3 py-12">
        <h2 className="sticky top-0 bg-inherit text-4xl font-bold">
          {translate('registration.seminars.title')}
        </h2>
        <div className="flex flex-col gap-20 md:grid md:grid-cols-1">
          {conference.seminars.map((seminar, i) => (
            <SpeakerCard
              key={i}
              img={seminar.speaker.img}
              name={seminar.speaker.name}
              activity={seminar.title}
              bio={seminar.speaker.bio}
            />
          ))}
        </div>
      </section>
    </>
  );
}

interface SpeakerCardProps {
  name: string;
  activity: string;
  img: string;
  bio: string;
}

function SpeakerCard(props: SpeakerCardProps) {
  const breakpoint = useBreakpoint();
  return match(breakpoint)
    .when(
      (b) => b <= Breakpoint.Md,
      () => <MobileSpeakerCard {...props} />,
    )
    .otherwise(() => <DesktopSpeakerCard {...props} />);
}

function DesktopSpeakerCard({ name, activity, img, bio }: SpeakerCardProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  const id = React.useId();
  const { position, rotate } = useCardRotation(ref);
  return (
    <div className="flex items-start gap-8">
      <motion.div
        className="relative aspect-square flex-1"
        ref={ref}
        id={id}
      >
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
          <img
            className="size-full object-cover"
            src={img}
            alt={`${name}, ${activity}`}
          />
          <div className="absolute inset-x-0 bottom-0 flex flex-col bg-black/30 p-4 text-white">
            <div className="flex items-center gap-2">
              <motion.h3 className="shrink text-3xl font-bold leading-8 text-white">
                {name}
              </motion.h3>
            </div>
            <motion.p className="text-xl text-white">{activity}</motion.p>
          </div>
        </div>
      </motion.div>

      <div className="flex flex-[3] flex-col gap-8">
        <div className="flex flex-col gap-4">
          <motion.h3 className="text-3xl font-bold leading-5">{name}</motion.h3>
          <motion.p className="text-xl">{activity}</motion.p>
        </div>

        <motion.p className="text-xl">{bio}</motion.p>
      </div>
    </div>
  );
}

function MobileSpeakerCard({ name, activity, img, bio }: SpeakerCardProps) {
  const id = React.useId();
  const ref = React.useRef<HTMLDivElement>(null);

  const [searchParams, setSearchParams] = useSearchParams();
  const isActive =
    searchParams.has('speaker') && searchParams.get('speaker') === id;
  const { position, rotate } = useCardRotation(ref, isActive);

  function onPress() {
    if (isActive) {
      setSearchParams((searchParams) => {
        searchParams.delete('speaker');
        return searchParams;
      });
    } else {
      setSearchParams((searchParams) => {
        searchParams.set('speaker', id);
        return searchParams;
      });
    }
  }

  const containerRef = React.useRef<HTMLDivElement>(null);

  const heightRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const height = container.offsetHeight;
    heightRef.current = height;
  }, [isActive]);

  const bioRef = React.useRef<HTMLDivElement>(null);

  const cardProps = useButton({ onPress, elementType: 'div' }, ref);
  const bioProps = useButton({ onPress, elementType: 'div' }, bioRef);

  return (
    <MotionConfig transition={{ type: 'spring', duration: 0.3, bounce: 0 }}>
      <motion.div
        animate={{
          height: heightRef.current || undefined,
        }}
      >
        <div
          className="overflow-hidden"
          ref={containerRef}
        >
          <AnimatePresence
            mode="popLayout"
            initial={false}
          >
            {isActive ? (
              <motion.div
                key="bio"
                custom={isActive}
                variants={SpeakerCardVariants}
                initial="initial"
                animate="enter"
                exit="exit"
                className="flex flex-col gap-8 p-4 outline-none"
                ref={bioRef}
                {...(bioProps.buttonProps as any)}
              >
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <ArrowLeftIcon className="size-8" />
                    <motion.h3 className="text-3xl font-bold leading-5">
                      {name}
                    </motion.h3>
                  </div>
                  <motion.p className="text-xl">{activity}</motion.p>
                </div>

                <motion.p className="text-xl">{bio}</motion.p>
              </motion.div>
            ) : (
              <motion.div
                className="relative aspect-square w-full outline-none"
                ref={ref}
                id={id}
                key="image"
                custom={isActive}
                variants={SpeakerCardVariants}
                initial="initial"
                animate="enter"
                exit="exit"
                {...(cardProps.buttonProps as any)}
              >
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
                  <img
                    className="size-full object-cover"
                    src={img}
                    alt={`${name}, ${activity}`}
                  />
                  <div className="absolute inset-x-0 bottom-0 flex flex-col bg-black/30 p-4 text-white">
                    <div className="flex items-center gap-2">
                      <motion.h3 className="text-3xl font-bold leading-5 text-white">
                        {name}
                      </motion.h3>
                      <ArrowRightIcon className="size-8" />
                    </div>
                    <motion.p className="text-xl text-white">
                      {activity}
                    </motion.p>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </MotionConfig>
  );
}

const SpeakerCardVariants = {
  initial: (isActive: boolean) => ({
    opacity: 0,
    x: isActive ? '-100%' : '100%',
  }),
  enter: {
    opacity: 1,
    x: 0,
  },
  exit: (isActive: boolean) => ({
    opacity: 0,
    x: isActive ? '-100%' : '100%',
  }),
};

function useCardRotation(
  ref: React.RefObject<HTMLDivElement>,
  isActive?: boolean,
) {
  const position = useMotionValue(20);
  const rotate = useMotionValue(0);
  React.useEffect(() => {
    const scrollContainer = document.querySelector('[data-scroll-container]');

    if (!scrollContainer) return;
    if (!ref.current) return;

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
  }, [position, rotate, ref, isActive]);

  return {
    position,
    rotate,
  };
}

function RegistrationSection() {
  const translate = useTranslate();

  return (
    <section className="flex flex-col gap-6 p-4 md:py-32">
      <h2 className="text-accent-600 text-4xl font-bold">
        {translate('registration.register.title')}
      </h2>
      <p>{translate('registration.register.subtitle')}</p>

      <div>
        <a
          href="https://gyccanada.regfox.com/gyc-canada-2024-while-it-is-day"
          className={buttonStyle}
          data-variant="accent"
        >
          {translate('registration.register.button')}
        </a>
      </div>
    </section>
  );
}

function FaqSection() {
  const translate = useTranslate();
  return (
    <section className="flex flex-col gap-6 p-4 md:py-32">
      <h2 className="text-accent-600 text-4xl font-bold">
        {translate('registration.faq.title')}
      </h2>
      <p>{translate('registration.faq.subtitle')}</p>
      <div className="flex flex-col gap-4">
        <div>
          <Link
            to="/contact"
            className={buttonStyle}
            data-variant="accent"
          >
            {translate('registration.faq.contact')}
          </Link>
        </div>
        <div>
          <Link
            to="/faq"
            className={buttonStyle}
            data-variant="default"
          >
            {translate('registration.faq.view')}
          </Link>
        </div>
      </div>
    </section>
  );
}
