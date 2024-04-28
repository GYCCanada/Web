import dedent from 'dedent';

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
  bio: string;
};

type Seminar = {
  title: string;
  speaker: {
    name: string;
    img: string;
    bio: string;
  };
  description: string;
};

const conference: Record<Locale, Conference> = {
  en: {
    title: 'While It Is Day',
    dates: [
      dayjs('2024-08-21').add(23, 'hours').utc().valueOf(),
      dayjs('2024-08-25').add(23, 'hours').utc().valueOf(),
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
        name: 'Matt Para',
        activity: 'Morning Plenary',
        img: '/2024/speakers/matt.jpg',
        bio: 'Matt Para is a pastor and speaker from the United States.',
      },
      {
        name: 'Alex Niculaescu',
        activity: 'Evening Plenary',
        img: '/2024/speakers/alex.jpg',
        bio: dedent(`Alex has worked in various mission fields over the past 13 years and
was introduced to the reality of modern forms of exploitation and
slavery while living in East Africa in 2009. Since then he has worked
for various non-profits and NGO's and alongside various government and
law enforcement agencies in order to tackle the growing problem of
modern day slavery. He has since that time seen more and more of the
spiritual side of the issue and the outplay of the great controversy in
a very real and tangible way. He has dedicated himself to help others
understand the reality of a war that often goes unnoticed, especially by
those who ought to be the ones most engaged in that war. He currently
lives in Michigan with his wife and daughter where he works as a pastor.
`),
      },
    ],
    seminars: [
      {
        title: 'Mental Health Seminar',
        speaker: {
          name: 'Opal Virgo',
          img: '/2024/speakers/opal.jpg',
          bio: 'John Doe is a pastor and speaker from Canada.',
        },
        description: 'Seminar Description',
      },
      {
        title: 'Apologetics Seminar',
        speaker: {
          name: 'Andrew Bikichky',
          img: '/2024/speakers/andrew.jpg',
          bio: 'John Doe is a pastor and speaker from Canada.',
        },
        description: 'Seminar Description',
      },
      {
        title: 'Personal Study Workshop',
        speaker: {
          name: 'James Niyomugabo',
          img: '/2024/speakers/james.jpg',
          bio: dedent(
            `James Niyomugabo is a dedicated creator coach and entrepreneur aiming to empower 1 million Christian creators, companies, and churches with the Genesis blueprint for creation and operation. He has been an elder at Westminster SDA Church for over three years and serves as a Bible worker at Grace Church Company. James is spearheading a digital evangelism initiative, "This Gospel Must Go Viral," to spread the Gospel globally. He is also the author of “How to Create Like God Does - God’s Success Blueprint for Creators, Companies, and Churches” and leads the "Journal through the Bible in a Year" challenge to inspire deeper engagement with Scripture.`,
          ),
        },
        description: 'Seminar Description',
      },
      {
        title: 'Medical Missionary Seminar',
        speaker: {
          name: 'Dave Fielder',
          img: '/2024/speakers/dave.jpg',
          bio: 'John Doe is a pastor and speaker from Canada.',
        },
        description: 'Seminar Description',
      },
    ],
  },
  fr: {
    title: "Tant qu'il fait jour",
    dates: [
      dayjs('2024-08-21').add(23, 'hours').utc().valueOf(),
      dayjs('2024-08-25').add(23, 'hours').utc().valueOf(),
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
        name: 'Matt Para',
        activity: 'Plénière du matin',
        img: '/2024/speakers/matt.jpg',
        bio: `Matt Para c'est un pasteur et orateur des États-Unis.`,
      },
      {
        name: 'Alex Niculaescu',
        activity: 'Plénière du soir',
        img: '/2024/speakers/alex.jpg',
        bio: `Alex a travaillé dans divers champs missionnaires au cours des 13 dernières années et a été introduit à la réalité des formes modernes d'exploitation et d'esclavage en vivant en Afrique de l'Est en 2009. Depuis lors, il a travaillé pour diverses organisations à but non lucratif et ONG et aux côtés de divers organismes gouvernementaux et des forces de l'ordre afin de lutter contre le problème croissant de l'esclavage moderne. Il a depuis ce temps vu de plus en plus le côté spirituel de la question et le déroulement de la grande controverse de manière très réelle et tangible. Il s'est dédié à aider les autres à comprendre la réalité d'une guerre qui passe souvent inaperçue, surtout par ceux qui devraient être les plus engagés dans cette guerre. Il vit actuellement au Michigan avec sa femme et sa fille où il travaille comme pasteur.`,
      },
    ],
    seminars: [
      {
        title: 'Séminaire sur la santé mentale',
        speaker: {
          name: 'Opal Virgo',
          img: '/2024/speakers/opal.jpg',
          bio: '',
        },
        description: 'Seminar Description',
      },
      {
        title: 'Séminaire d’apologétique',
        speaker: {
          name: 'Andrew Bikichky',
          img: '/2024/speakers/andrew.jpg',
          bio: '',
        },
        description: 'Seminar Description',
      },
      {
        title: 'Atelier d’étude personnelle',
        speaker: {
          name: 'James Niyomugabo',
          img: '/2024/speakers/james.jpg',
          bio: '',
        },
        description: 'Seminar Description',
      },
      {
        title: 'Séminaire de mission médicale',
        speaker: {
          name: 'Dave Fielder',
          img: '/2024/speakers/dave.jpg',
          bio: '',
        },
        description: 'Seminar Description',
      },
    ],
  },
};

export const getCurrentConference = (locale: Locale): Conference => {
  assertValidLocale(locale);
  return conference[locale];
};
