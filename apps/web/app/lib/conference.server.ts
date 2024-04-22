import { dayjs } from './dayjs';
import { Locale } from './localization/localization';
import { assertValidLocale } from './localization/localization.server';

type Conference = {
  title: string;
  dates: [number, number];
  location: string;
  tagline: string;
  bible: {
    book: string;
    chapter: number;
    verse: number;
  };
  speakers: Speaker[];
  seminars: Seminar[];
};

type Speaker = {
  name: string;
  activity: string;
  img: string;
};

type Seminar = {
  title: string;
  speaker: Speaker;
  description: string;
};

const conference: Record<Locale, Conference> = {
  en: {
    title: 'While It Is Day',
    dates: [
      dayjs('2024-08-21').utc().valueOf(),
      dayjs('2024-08-25').utc().valueOf(),
    ],
    location: 'British Columbia',
    tagline:
      '“I must work the works of Him who sent Me while it is day; the night is coming when no one can work.”',
    bible: {
      book: 'John',
      chapter: 9,
      verse: 4,
    },

    speakers: [
      {
        name: 'John Doe',
        activity: 'Morning Plenary',
        img: '/team/yves.jpg',
      },
      {
        name: 'John Doe',
        activity: 'Morning Plenary',
        img: '/team/yves.jpg',
      },
    ],
    seminars: [
      {
        title: 'Seminar Title',
        speaker: {
          name: 'John Doe',
          activity: 'Morning Plenary',
          img: '/team/yves.jpg',
        },
        description: 'Seminar Description',
      },
      {
        title: 'Seminar Title',
        speaker: {
          name: 'John Doe',
          activity: 'Morning Plenary',
          img: '/team/yves.jpg',
        },
        description: 'Seminar Description',
      },
    ],
  },
  fr: {
    title: "Tant qu'il fait jour",
    dates: [
      dayjs('2024-08-21').utc().valueOf(),
      dayjs('2024-08-25').utc().valueOf(),
    ],
    location: 'Colombie-Britannique',
    tagline:
      '“Il faut que je fasse, tandis qu’il est jour, les œuvres de celui qui m’a envoyé; la nuit vient, où personne ne peut travailler.”',
    bible: {
      book: 'Jean',
      chapter: 9,
      verse: 4,
    },
    speakers: [
      {
        name: 'John Doe',
        activity: 'Plénière du matin',
        img: '/team/yves.jpg',
      },
      {
        name: 'John Doe',
        activity: 'Plénière du matin',
        img: '/team/yves.jpg',
      },
    ],
    seminars: [
      {
        title: 'Titre du séminaire',
        speaker: {
          name: 'John Doe',
          activity: 'Plénière du matin',
          img: '/team/yves.jpg',
        },
        description: 'Description du séminaire',
      },
      {
        title: 'Titre du séminaire',
        speaker: {
          name: 'John Doe',
          activity: 'Plénière du matin',
          img: '/team/yves.jpg',
        },
        description: 'Description du séminaire',
      },
    ],
  },
};

export const getCurrentConference = (locale: Locale): Conference => {
  assertValidLocale(locale);
  return conference[locale];
};
