import { useSearchParams } from 'react-router';
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
import { useButton } from '@base-ui/react/internals/use-button';
import { match } from 'ts-pattern';

import { Breakpoint, useBreakpoint, useHints } from '~/lib/client-hints';
import type { Conference } from '~/lib/content.server';
import { dayjs } from '~/lib/dayjs';
import { useLocale, useTranslate } from '~/lib/localization/context';
import { buttonStyle } from '~/ui/button';
import { ExternalLink } from '~/ui/external-link';
import { Link } from '~/ui/link';
import { Main } from '~/ui/main';

export function ConferenceDetail({ conference }: { conference: Conference }) {
  return (
    <Main>
      <Hero conference={conference} />
      <TravelSection conference={conference} />
      <SpeakersAndSeminars conference={conference} />
      <ParkingSection conference={conference} />
      <AccommodationsSection conference={conference} />
      <MealsSection conference={conference} />
      <RegistrationSection conference={conference} />
      <FaqSection conference={conference} />
    </Main>
  );
}

function Hero({ conference }: { conference: Conference }) {
  const breakpoint = useBreakpoint();
  return match(breakpoint)
    .when(
      (b) => b <= Breakpoint.Md,
      () => <MobileHero conference={conference} />,
    )
    .otherwise(() => <DesktopHero conference={conference} />);
}

function HeroCtas({ conference }: { conference: Conference }) {
  const translate = useTranslate();
  return (
    <div className="flex flex-wrap items-center gap-4">
      {conference.registrationUrl === undefined ? null : (
        <a className={buttonStyle} href={conference.registrationUrl}>
          {translate('registration.register')}
        </a>
      )}
      {conference.scheduleUrl === undefined ? null : (
        <a
          className={clsx(buttonStyle)}
          href={conference.scheduleUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          {translate('registration.schedule')}
        </a>
      )}
    </div>
  );
}

function MobileHero({ conference }: { conference: Conference }) {
  const hints = useHints();
  const translate = useTranslate();
  const locale = useLocale();

  return (
    <section className="flex flex-col gap-10 pb-16">
      <img
        src={conference.hero.image.mobile}
        alt={conference.hero.alt}
        className="aspect-auto w-full"
      />
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
        <HeroCtas conference={conference} />
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

function DesktopHero({ conference }: { conference: Conference }) {
  const hints = useHints();
  return (
    <section className="full-bleed flex flex-col gap-10 p-4 pb-16">
      <div className="mx-auto flex w-(--width) gap-10 py-16">
        <div className="flex flex-1 flex-col gap-10">
          <img
            src={conference.hero.image.desktop}
            alt={conference.hero.alt}
            className="aspect-auto w-full"
          />
          <div className="flex flex-col gap-6">
            <h2 className="text-5xl">
              {dayjs(conference.dates[0]).tz(hints.timeZone).format('MMM')}{' '}
              {dayjs(conference.dates[0]).tz(hints.timeZone).format('D')}-
              {dayjs(conference.dates[1]).tz(hints.timeZone).format('D')},{' '}
              {dayjs(conference.dates[0]).tz(hints.timeZone).format('YYYY')}
            </h2>
            <h3 className="text-5xl">{conference.location}</h3>
          </div>
          <p className="text-2xl italic">{conference.tagline}</p>
        </div>
        <div className="flex w-1/4 flex-col gap-10">
          <div
            className="flex flex-col justify-end uppercase"
            style={{ writingMode: 'vertical-rl' }}
          >
            <h1 className="text-[96px] font-black leading-tight tracking-tight">
              {conference.bible.book}
            </h1>
            <h1 className="text-[168px] font-black leading-[0.5]">
              {conference.bible.chapter}:{conference.bible.verse}
            </h1>
          </div>
          <HeroCtas conference={conference} />
        </div>
      </div>
    </section>
  );
}

function sectionHeadingClassName() {
  return 'text-accent-600 text-4xl font-bold';
}

function TravelSection({ conference }: { conference: Conference }) {
  if (!conference.travel.enabled) return null;

  return (
    <section className="flex flex-col gap-6 p-4 pb-16">
      <h2 className={sectionHeadingClassName()}>{conference.travel.headerCopy}</h2>
      <p className="whitespace-pre-line">{conference.travel.bodyCopy}</p>
      {conference.travel.mapEmbedUrl === undefined ? null : (
        <div className="aspect-video">
          <iframe
            src={conference.travel.mapEmbedUrl}
            style={{ border: 0 }}
            className="size-full"
            allowFullScreen
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            title="Map"
          />
        </div>
      )}
    </section>
  );
}

function ParkingSection({ conference }: { conference: Conference }) {
  if (!conference.parking.enabled) return null;

  return (
    <section className="flex flex-col gap-6 p-4 pb-16">
      <h2 className={sectionHeadingClassName()}>
        {conference.parking.headerCopy}
      </h2>
      <ul className="flex flex-col gap-6">
        {conference.parking.options.map((option, index) => (
          <li key={index} className="flex flex-col gap-2">
            <div className="text-xl">
              {option.link === undefined ? (
                option.title
              ) : (
                <ExternalLink href={option.link}>{option.title}</ExternalLink>
              )}
              {option.address === undefined ? null : (
                <>
                  {' | '}
                  {option.link === undefined ? (
                    option.address
                  ) : (
                    <ExternalLink href={option.link}>{option.address}</ExternalLink>
                  )}
                </>
              )}
            </div>
            {option.description === undefined ? null : (
              <p className="text-neutral-700">{option.description}</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function AccommodationsSection({ conference }: { conference: Conference }) {
  const translate = useTranslate();
  if (!conference.accommodations.enabled) return null;

  return (
    <section className="flex flex-col gap-10 p-4 pb-16">
      <h2 className={sectionHeadingClassName()}>
        {conference.accommodations.headerCopy}
      </h2>
      <div className="flex flex-col gap-12">
        {conference.accommodations.hotels.map((hotel, index) => (
          <article key={index} className="flex flex-col gap-4">
            <h3 className="text-2xl font-bold">{hotel.name}</h3>
            <p>{hotel.address}</p>
            {hotel.checkIn === undefined ? null : (
              <p>
                {translate('registration.accommodations.check_in')}: {hotel.checkIn}
              </p>
            )}
            {hotel.checkOut === undefined ? null : (
              <p>
                {translate('registration.accommodations.check_out')}: {hotel.checkOut}
              </p>
            )}
            {hotel.roomRates.length === 0 ? null : (
              <ul className="list-disc pl-6">
                {hotel.roomRates.map((rate, rateIndex) => (
                  <li key={rateIndex}>{rate.description}</li>
                ))}
              </ul>
            )}
            {hotel.description === undefined ? null : (
              <p className="whitespace-pre-line">{hotel.description}</p>
            )}
            <div className="flex flex-wrap gap-4">
              {hotel.navigateUrl === undefined ? null : (
                <ExternalLink
                  href={hotel.navigateUrl}
                  className={buttonStyle}
                  data-variant="default"
                >
                  {translate('registration.accommodations.navigate')}
                </ExternalLink>
              )}
              {hotel.reservationUrl === undefined ? null : (
                <ExternalLink
                  href={hotel.reservationUrl}
                  className={buttonStyle}
                  data-variant="accent"
                >
                  {translate('registration.accommodations.reserve')}
                </ExternalLink>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function MealsSection({ conference }: { conference: Conference }) {
  if (!conference.meals.enabled) return null;

  return (
    <section className="flex flex-col gap-6 p-4 pb-16">
      <h2 className={sectionHeadingClassName()}>{conference.meals.headerCopy}</h2>
      {conference.meals.bodyCopy === undefined ? null : (
        <p className="whitespace-pre-line">{conference.meals.bodyCopy}</p>
      )}
      <ul className="flex flex-col gap-2">
        {conference.meals.items.map((item, index) => (
          <li key={index} className="text-xl">
            {item.label} — {item.price}
          </li>
        ))}
      </ul>
    </section>
  );
}

function SpeakersAndSeminars({ conference }: { conference: Conference }) {
  const translate = useTranslate();
  return (
    <>
      {conference.speakers.length === 0 ? null : (
        <section className="relative flex flex-col gap-6 px-3 py-12">
          <h2 className="bg-inherit text-4xl font-bold data-[sticky]:fixed data-[sticky]:top-[60px] data-[sticky]:z-10">
            {translate('registration.speakers.title')}
          </h2>
          <div className="flex flex-col gap-20 md:grid md:grid-cols-1">
            {conference.speakers.map((speaker, i) => (
              <SpeakerCard key={i} {...speaker} />
            ))}
          </div>
        </section>
      )}
      {conference.seminars.length === 0 ? null : (
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
      )}
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
      <motion.div className="relative aspect-square flex-1" ref={ref} id={id}>
        <motion.div
          className="text-link-50 bg-link-600 rota size-[95%] h-[90%] overflow-hidden p-4"
          style={{ left: position, top: position, rotate }}
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
            <motion.h3 className="shrink text-3xl font-bold leading-8 text-white">
              {name}
            </motion.h3>
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
      setSearchParams((params) => {
        params.delete('speaker');
        return params;
      });
    } else {
      setSearchParams((params) => {
        params.set('speaker', id);
        return params;
      });
    }
  }

  const containerRef = React.useRef<HTMLDivElement>(null);
  const heightRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    heightRef.current = container.offsetHeight;
  }, [isActive]);

  const bioRef = React.useRef<HTMLDivElement>(null);
  const cardButton = useButton({ native: false });
  const bioButton = useButton({ native: false });

  return (
    <MotionConfig transition={{ type: 'spring', duration: 0.3, bounce: 0 }}>
      <motion.div animate={{ height: heightRef.current || undefined }}>
        <div className="overflow-hidden" ref={containerRef}>
          <AnimatePresence mode="popLayout" initial={false}>
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
                {...bioButton.getButtonProps({ onClick: onPress })}
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
                {...cardButton.getButtonProps({ onClick: onPress })}
              >
                <motion.div
                  className="text-link-50 bg-link-600 rota size-[95%] h-[90%] overflow-hidden p-4"
                  style={{ left: position, top: position, rotate }}
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
                    <motion.h3 className="text-3xl font-bold leading-5 text-white">
                      {name}
                    </motion.h3>
                    <ArrowRightIcon className="size-8" />
                    <motion.p className="text-xl text-white">{activity}</motion.p>
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
  enter: { opacity: 1, x: 0 },
  exit: (isActive: boolean) => ({
    opacity: 0,
    x: isActive ? '-100%' : '100%',
  }),
};

function useCardRotation(
  ref: React.RefObject<HTMLDivElement | null>,
  isActive?: boolean,
) {
  const position = useMotionValue(20);
  const rotate = useMotionValue(0);
  React.useEffect(() => {
    const scrollContainer = document.querySelector('[data-scroll-container]');
    if (!scrollContainer || !ref.current) return;

    let isInViewport = false;
    const observer = new IntersectionObserver(
      (entries) => {
        isInViewport = entries[0]?.isIntersecting ?? false;
      },
      { root: scrollContainer, threshold: 0 },
    );
    observer.observe(ref.current);

    const initialCardRect = ref.current.getBoundingClientRect();
    const bounds = [initialCardRect.top, initialCardRect.top + initialCardRect.height];

    function onScroll() {
      const containerEle = document.querySelector(
        '[data-scroll-container]',
      ) as HTMLElement;
      if (!containerEle || !isInViewport) return;
      const scrollY = containerEle.scrollTop + containerEle.clientHeight;
      position.set(transform(scrollY, bounds, [20, 4]));
      rotate.set(transform(scrollY, bounds, [0, -3]));
    }

    scrollContainer.addEventListener('scroll', onScroll);
    return () => {
      observer.disconnect();
      scrollContainer.removeEventListener('scroll', onScroll);
    };
  }, [position, rotate, ref, isActive]);

  return { position, rotate };
}

function RegistrationSection({ conference }: { conference: Conference }) {
  if (!conference.registrationCopy.enabled) return null;
  if (conference.registrationUrl === undefined) return null;

  return (
    <section className="flex flex-col gap-6 p-4 md:py-32">
      <h2 className={sectionHeadingClassName()}>
        {conference.registrationCopy.title}
      </h2>
      <p>{conference.registrationCopy.subtitle}</p>
      <div>
        <a
          href={conference.registrationUrl}
          className={buttonStyle}
          data-variant="accent"
        >
          {conference.registrationCopy.buttonLabel}
        </a>
      </div>
    </section>
  );
}

function FaqSection({ conference }: { conference: Conference }) {
  const translate = useTranslate();
  if (!conference.faqCopy.enabled) return null;

  return (
    <section className="flex flex-col gap-6 p-4 md:py-32">
      <h2 className={sectionHeadingClassName()}>{conference.faqCopy.title}</h2>
      <p>{conference.faqCopy.subtitle}</p>
      <div className="flex flex-col gap-4">
        <Link to="/contact" className={buttonStyle} data-variant="accent">
          {translate('registration.faq.contact')}
        </Link>
        <Link to="/faq" className={buttonStyle} data-variant="default">
          {translate('registration.faq.view')}
        </Link>
      </div>
    </section>
  );
}
