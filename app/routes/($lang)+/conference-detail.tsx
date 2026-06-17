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

/**
 * The one data-driven conference detail page, shared by every `/YYYY` route
 * (registration-launch Branch 3, Candidate 1, settled #4). It was forked
 * verbatim across `2024`/`2025`/`2026/_index.tsx` (~620 lines each, differing
 * only in hard-coded URLs / hotels / a JSX comment block); this module is the
 * single deep implementation those three thin loaders now render.
 *
 * Principles (see `~/.brain/principles`):
 *   - `small-interface-deep-implementation`: the public surface is one prop —
 *     the boundary `Conference`. Every section (`Hero`, `MapSection`,
 *     `SpeakersAndSeminars`, `RegistrationSection`, `FaqSection`) and all the
 *     framer-motion card machinery is an implementation detail hidden inside.
 *   - `boundary-discipline` / `derive-dont-sync`: the formerly hard-coded RegFox
 *     link, schedule link, map iframe `src`, and hotel list are now read from
 *     the `Conference` (`registrationUrl` / `scheduleUrl` / `mapEmbedUrl` /
 *     `hotels`), which `toConference` already projected from validated document
 *     `Option`s to `string | undefined` (XSS-safe https brands). The component
 *     consumes plain strings; it never sees an `Option`.
 *   - `subtract-before-you-add`: the three forks delete down to thin loaders
 *     (Branch 3.4) once they render this; the duplicated JSX dies.
 *
 * Section-skip (registration-launch Branch 4, Candidate 2, settled #3, CONTEXT
 * §"Section skip"): a section renders only when its data is present. The
 * discriminator is the boundary data this module already consumes — the
 * `Option`/empty-array the document modelled, projected by `toConference` to
 * `string | undefined` / `[]`. The component branches on that; there are NO JSX
 * comments and NO dormant `eslint-disable` render paths (the pre-fork
 * scaffolding the collapse already deleted). Skip is section-LEVEL — a *present*
 * item with a blank required bilingual field is still a hard `Text` decode error
 * upstream (the both-locales invariant lives in the schema, never the
 * component), so this module never sees half-filled content.
 *
 * Each gate is independent (`make-impossible-states-unrepresentable` at the
 * presentation seam):
 *   - speakers / seminars: each renders only when its list is non-empty;
 *   - the map column renders when `mapEmbedUrl !== undefined`, the hotels column
 *     when `hotels.length > 0` — each half of `MapSection` independently, and
 *     the whole section is skipped when neither half has data;
 *   - the RegFox register button / `RegistrationSection`: `registrationUrl`
 *     present;
 *   - the schedule button: `scheduleUrl` present;
 *   - `FaqSection`: always present (static contact/FAQ links, no conference
 *     data).
 *
 * `2026` (RegFox-only) thus renders hero + register button + FAQ with no empty
 * Speakers/Map sections; `2025` (cancelled) renders hero + FAQ only; `2024`
 * (fully populated) renders every section.
 */
export function ConferenceDetail({ conference }: { conference: Conference }) {
  return (
    <Main>
      <Hero conference={conference} />

      <MapSection conference={conference} />

      <SpeakersAndSeminars conference={conference} />

      <RegistrationSection conference={conference} />

      <FaqSection />
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

function MobileHero({ conference }: { conference: Conference }) {
  const hints = useHints();
  const translate = useTranslate();
  const locale = useLocale();

  return (
    <section className="flex flex-col gap-10 pb-16">
      <div>
        <img
          src={conference.hero.image.mobile}
          alt={conference.hero.alt}
        />
        <div className="absolute -bottom-6 left-4 flex items-center gap-4">
          {conference.registrationUrl === undefined ? null : (
            <a
              className={clsx(buttonStyle)}
              href={conference.registrationUrl}
            >
              {translate('registration.register')}
            </a>
          )}
          {conference.scheduleUrl === undefined ? null : (
            <a
              className={clsx(buttonStyle)}
              href={conference.scheduleUrl}
              target="_blank"
            >
              {translate('registration.schedule')}
            </a>
          )}
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

function DesktopHero({ conference }: { conference: Conference }) {
  const hints = useHints();
  const translate = useTranslate();
  return (
    <section className="full-bleed flex flex-col gap-10 p-4 pb-16">
      <div className="mx-auto flex w-(--width) gap-10 py-16">
        <div className="flex flex-1 flex-col gap-10">
          <img
            src={conference.hero.image.desktop}
            alt={conference.hero.alt}
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
              {conference.registrationUrl === undefined ? null : (
                <a
                  className={buttonStyle}
                  href={conference.registrationUrl}
                >
                  {translate('registration.register')}
                </a>
              )}
              {conference.scheduleUrl === undefined ? null : (
                <a
                  className={clsx(buttonStyle)}
                  href={conference.scheduleUrl}
                  target="_blank"
                >
                  {translate('registration.schedule')}
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function MapSection({ conference }: { conference: Conference }) {
  const translate = useTranslate();

  const hasHotels = conference.hotels.length > 0;
  const hasMap = conference.mapEmbedUrl !== undefined;

  // Skip the whole section when neither half has data (each half gated
  // independently below): a conference with no hotels and no map embed renders
  // nothing here.
  if (!hasHotels && !hasMap) return null;

  return (
    <section className="grid grid-cols-1 gap-10 p-4 pb-16 md:grid-cols-2">
      {hasHotels ? (
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
            {conference.hotels.map((hotel, i) => (
              <li key={i}>
                {hotel.name}
                {hotel.note === undefined ? null : ` ${hotel.note}`}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {conference.mapEmbedUrl === undefined ? null : (
        <div className="aspect-video">
          <iframe
            src={conference.mapEmbedUrl}
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
      )}
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
              <SpeakerCard
                key={i}
                {...speaker}
              />
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

  const cardButton = useButton({ native: false });
  const bioButton = useButton({ native: false });

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
  ref: React.RefObject<HTMLDivElement | null>,
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
        if (entry?.isIntersecting) {
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

function RegistrationSection({ conference }: { conference: Conference }) {
  const translate = useTranslate();

  // The RegFox register button is the section's reason to exist; with no
  // `registrationUrl` (e.g. a cancelled year) the whole section is skipped.
  if (conference.registrationUrl === undefined) return null;

  return (
    <section className="flex flex-col gap-6 p-4 md:py-32">
      <h2 className="text-accent-600 text-4xl font-bold">
        {translate('registration.register.title')}
      </h2>
      <p>{translate('registration.register.subtitle')}</p>

      <div>
        <a
          href={conference.registrationUrl}
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
