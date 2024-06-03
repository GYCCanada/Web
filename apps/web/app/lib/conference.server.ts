import dedent from 'dedent';

import { dayjs } from './dayjs';
import { assertValidLocale, Locale } from './localization/localization';

export type Conference = {
  slug: string;
  title: string;
  dates: [start: number, end: number];
  registration: {
    early: [start: number, end: number];
    regular: [start: number, end: number];
    late: [start: number, end: number];
  };
  location: string;
  tagline: string;
  bible: {
    book: string;
    chapter: number;
    verse: number;
  };
  speakers: Speaker[];
  seminars: Seminar[];
  promos: string[];
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
    slug: '/2024',
    title: 'While It Is Day',
    dates: [
      dayjs('2024-08-21').utcOffset(0).startOf('day').valueOf(),
      dayjs('2024-08-25').utcOffset(0).endOf('day').valueOf(),
    ],
    registration: {
      early: [
        dayjs('2024-05-19').utcOffset(0).startOf('day').valueOf(),
        dayjs('2024-06-22').utcOffset(0).endOf('day').valueOf(),
      ],
      regular: [
        dayjs('2024-06-23').utcOffset(0).startOf('day').valueOf(),
        dayjs('2024-07-20').utcOffset(0).endOf('day').valueOf(),
      ],
      late: [
        dayjs('2024-07-21').utcOffset(0).startOf('day').valueOf(),
        dayjs('2024-08-25').utcOffset(0).endOf('day').valueOf(),
      ],
    },

    location: 'Kelowna, British Columbia',
    tagline:
      '“I must work the works of Him who sent Me while it is day; the night is coming when no one can work.”',
    bible: {
      book: 'John',
      chapter: 9,
      verse: 4,
    },

    speakers: [
      {
        name: 'Matt Parra',
        activity: 'Morning Plenary',
        img: '/2024/speakers/matt.png',
        bio: dedent`Matt Parra is the lead Pastor of the Chehalis Seventh day Adentist
Church in the Washington Conference. He has spent 10 years in Australia
where he served as Personal Ministries, Evangelism, and Sabbath School
Director for the North NSW Conference. A main focus of Matt's ministry
for the past 20 years has been providing environments for young people
where they can grow in their walk with Christ and witness for Him. He
served as DIrector for Arise Australia with its accompanying
discipleship streams such as Local Missions Training, and Arise for
Life. Matt is married to Sherise Parra and they have three sons and one
girl. Matt enjoys reading, snowboarding with his boys, hiking with his
family, getting old, and teaching scripture.`,
      },
      {
        name: 'Alex Niculaescu',
        activity: 'Evening Plenary',
        img: '/2024/speakers/alex.jpeg',
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
        title: 'Apologetics Seminar',
        speaker: {
          name: 'Andrew Bikichky',
          img: '/2024/speakers/andrew.jpg',
          bio: dedent`Andrew Bikichky was raised a 5th generation Seventh-day Adventist. At the age of 16 he left the church to pursue worldly ambitions in the entertainment industry. After spending 25 years as a Hollywood cameraman, he was drawn back by the Holy Spirit to the faith of his childhood, and started working as a Bible Worker, accepting speaking invitations in churches. After living almost 3 decades in the world, the profound truths Andrew rediscovered in the Word of God and the testimony of Jesus Christ captivated his whole being, becoming a burning fire in his heart. Of particular interest in his focus on the great light we've been given about the ministry of Christ in the heavenly sanctuary, and how He is right now seeking to prepare a people to meet Him face to face.`,
        },
        description: 'Seminar Description',
      },
      {
        title: 'Personal Study Workshop',
        speaker: {
          name: 'James Niyomugabo',
          img: '/2024/speakers/james.png',
          bio: dedent(
            `James Niyomugabo is a dedicated creator coach and entrepreneur aiming to empower 1 million Christian creators, companies, and churches with the Genesis blueprint for creation and operation. He has been an elder at Westminster SDA Church for over three years and serves as a Bible worker at Grace Church Company. James is spearheading a digital evangelism initiative, "This Gospel Must Go Viral," to spread the Gospel globally. He is also the author of “How to Create Like God Does - God’s Success Blueprint for Creators, Companies, and Churches” and leads the "Journal through the Bible in a Year" challenge to inspire deeper engagement with Scripture.`,
          ),
        },
        description: 'Seminar Description',
      },
      {
        title: 'Medical Missionary Seminar',
        speaker: {
          name: 'Dave Fiedler',
          img: '/2024/speakers/dave.jpg',
          bio: dedent`Dave Fiedler has bucked logs, farmed carrots, tomato seed, and hay, run a print shop, been an editor, a classroom teacher (elementary to college), a boys’ dean, a school principal, a vegan restaurant manager, and written five books. His goal and privilege, in print and in person, is to share a vision of Christ’s own approach to the gospel that heals bodies and souls, and will—as surely as it is practiced—end the conflict. Currently, he supports this addiction to teaching, preaching, and writing, by providing IT Services to dentists in “Beautiful British Columbia” where he lives with his wife, Clarissa.`,
        },
        description: 'Seminar Description',
      },
    ],
    promos: [],
  },
  fr: {
    slug: '/2024',
    title: "Tant qu'il fait jour",
    dates: [
      dayjs('2024-08-21').utcOffset(0).startOf('day').valueOf(),
      dayjs('2024-08-25').utcOffset(0).endOf('day').valueOf(),
    ],
    registration: {
      early: [
        dayjs('2024-05-19').utcOffset(0).startOf('day').valueOf(),
        dayjs('2024-06-22').utcOffset(0).endOf('day').valueOf(),
      ],
      regular: [
        dayjs('2024-06-23').utcOffset(0).startOf('day').valueOf(),
        dayjs('2024-07-20').utcOffset(0).endOf('day').valueOf(),
      ],
      late: [
        dayjs('2024-07-21').utcOffset(0).startOf('day').valueOf(),
        dayjs('2024-08-25').utcOffset(0).endOf('day').valueOf(),
      ],
    },
    location: 'Kelowna, Colombie-Britannique',
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
        img: '/2024/speakers/matt.png',
        bio: `Matt Parra est le pasteur principal de l'église adventiste du septième jour de Chehalis dans la Conférence de Washington. Il a passé 10 ans en Australie où il a été directeur des ministères personnels, de l'évangélisation et de l'école du sabbat pour la Conférence du Nord de la Nouvelle-Galles du Sud. Un des principaux objectifs du ministère de Matt au cours des 20 dernières années a été de fournir des environnements pour les jeunes où ils peuvent grandir dans leur marche avec Christ et témoigner pour Lui. Il a été directeur d'Arise Australia avec ses flux de discipleship accompagnants tels que la formation aux missions locales et Arise for Life. Matt est marié à Sherise Parra et ils ont trois fils et une fille. Matt aime lire, faire du snowboard avec ses garçons, faire de la randonnée avec sa famille, vieillir et enseigner l'écriture.`,
      },
      {
        name: 'Alex Niculaescu',
        activity: 'Plénière du soir',
        img: '/2024/speakers/alex.jpeg',
        bio: `Alex a travaillé dans divers champs missionnaires au cours des 13 dernières années et a été introduit à la réalité des formes modernes d'exploitation et d'esclavage en vivant en Afrique de l'Est en 2009. Depuis lors, il a travaillé pour diverses organisations à but non lucratif et ONG et aux côtés de divers organismes gouvernementaux et des forces de l'ordre afin de lutter contre le problème croissant de l'esclavage moderne. Il a depuis ce temps vu de plus en plus le côté spirituel de la question et le déroulement de la grande controverse de manière très réelle et tangible. Il s'est dédié à aider les autres à comprendre la réalité d'une guerre qui passe souvent inaperçue, surtout par ceux qui devraient être les plus engagés dans cette guerre. Il vit actuellement au Michigan avec sa femme et sa fille où il travaille comme pasteur.`,
      },
    ],
    seminars: [
      {
        title: 'Séminaire d’apologétique',
        speaker: {
          name: 'Andrew Bikichky',
          img: '/2024/speakers/andrew.jpg',
          bio: `Andrew Bikichky a été élevé adventiste du septième jour de la cinquième génération. À l'âge de 16 ans, il a quitté l'église pour poursuivre des ambitions mondaines dans l'industrie du divertissement. Après avoir passé 25 ans comme caméraman à Hollywood`,
        },
        description: 'Seminar Description',
      },
      {
        title: 'Atelier d’étude personnelle',
        speaker: {
          name: 'James Niyomugabo',
          img: '/2024/speakers/james.png',
          bio: `James Niyomugabo est un coach et entrepreneur créatif dévoué qui vise à autonomiser 1 million de créateurs chrétiens, d'entreprises et d'églises avec le plan de Dieu pour la création et le fonctionnement. Il est ancien de l'église adventiste de Westminster depuis plus de trois ans et sert de travailleur biblique à la Grace Church Company. James est à l'origine d'une initiative d'évangélisation numérique, "This Gospel Must Go Viral", pour diffuser l'Évangile à l'échelle mondiale. Il est également l'auteur de “How to Create Like God Does - God’s Success Blueprint for Creators, Companies, and Churches” et dirige le défi "Journal through the Bible in a Year" pour inspirer un engagement plus profond avec l'Écriture.`,
        },
        description: 'Seminar Description',
      },
      {
        title: 'Séminaire de mission médicale',
        speaker: {
          name: 'Dave Fiedler',
          img: '/2024/speakers/dave.jpg',
          bio: `Dave Fiedler a déplacé des journaux, cultivé des carottes, des graines de tomates et du foin, dirigé une imprimerie, été rédacteur en chef, enseignant en classe (de l'élémentaire à l'université), doyen des garçons, directeur d'école, gérant de restaurant végétalien et écrit cinq livres. Son objectif et son privilège, dans l'impression et en personne, est de partager une vision de l'approche du Christ à l'Évangile qui guérit les corps et les âmes, et qui mettra fin au conflit. Actuellement, il soutient cette addiction à l'enseignement, à la prédication et à l'écriture, en fournissant des services informatiques aux dentistes dans la "belle Colombie-Britannique" où il vit avec sa femme, Clarissa.`,
        },
        description: 'Seminar Description',
      },
    ],
    promos: [],
  },
};

export const getCurrentConference = (locale: Locale): Conference => {
  assertValidLocale(locale);
  return conference[locale];
};
