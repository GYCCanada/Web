import { Schema } from 'effect';

import { newListItemId } from '../schema';
import {
  AboutPage,
  ArchivePage,
  ContactPage,
  FaqPage,
  FormDefinition,
  GivePage,
  HomePage,
  VolunteerPage,
} from './schema';

/**
 * The bundled-default page + form objects (registration-launch Branch 5.1, ADR 0008).
 *
 * One transcription per Page of today's evergreen copy (currently living in the flat
 * `translations.ts` god-bag) into its typed object. Each is the dev / fallback content
 * the `Content` service returns for `getPage(name)` when no bucket object exists
 * (Branch 5.3), and the seed uploaded on first publish — mirroring `defaults.ts`'s
 * role for `content/site.json`.
 *
 * Authored in each schema's **encoded** form (plain strings; `RichText` as `_tag`'d
 * token literals; an optional key simply omitted) and decoded once through its schema.
 * Decoding — not `.make` — is the honest construction: the branded primitives
 * (`ExternalHttpsUrl`, `ListItemId`, the `RichText` link `href`) only earn their brand
 * by crossing the boundary (`boundary-discipline`,
 * `make-impossible-states-unrepresentable`). `decodeUnknownSync` throws on a malformed
 * default, so a transcription typo fails fast at module load.
 *
 * List-item `id`s are minted with `newListItemId()` (a fresh `nanoid` per default item)
 * so every default list item is id-addressable by the `/admin` editor (Branch 5.5)
 * exactly like the seeded speakers / team members (ADR 0006). Ids are content; they
 * persist on first publish.
 *
 * Faithfulness note: these defaults carry the real bilingual copy in substance. The
 * byte-identical render parity vs the current flat-key routes is a Branch 5.4 concern
 * (when the routes migrate to read these objects and the flat keys are deleted); this
 * slice (5.1) lands the typed homes + seed content only.
 */

const GYCC_EMAIL = 'mailto:hello@gyccanada.org';
const GYCC_SITE = 'https://gyccanada.org';
const PAYPAL_DONATE =
  'https://www.paypal.com/donate/?hosted_button_id=FBZXG43LWD232&fbclid=IwAR027jskxadQlC1PFallSB0btxLH0bB0kd-xDM8UQ76ASneG0hXqsnTbJu8';

// ---------------------------------------------------------------------------
// About
// ---------------------------------------------------------------------------

export const defaultAboutPage: AboutPage = Schema.decodeUnknownSync(AboutPage)({
  title: { en: 'About Us', fr: 'Notre histoire' },
  paragraphs: [
    {
      id: newListItemId(),
      text: {
        en: 'GYC Canada (Generation of Youth for Christ) is a youth-initiated and led movement of Seventh-day Adventists from various origins, united in a common commitment to serious Bible study, intense prayer, uncompromising lifestyle, and boldness in sharing Christ with others.',
        fr: "GYC Canada (Generation of Youth for Christ) est un mouvement de jeunes adventistes du septième jour provenant de diverses origines, unis toutefois par un engagement commun à un style de vie chrétien sans compromis: une étude sérieuse de la Bible, une vie de prière active et le courage de partager Christ avec les autres.",
      },
    },
    {
      id: newListItemId(),
      text: {
        en: 'GYC Canada seeks to uphold the distinctive message of the Seventh-day Adventist Church. We seek to equip and inspire young Adventists to be Christian ambassadors in their respective places of work and study and wherever they go.',
        fr: "GYC Canada soutient le message unique de l'Église adventiste du septième jour. Nous voulons équiper et inspirer les jeunes adventistes à être des ambassadeurs chrétiens dans leurs lieux respectifs de travail et d'études.",
      },
    },
    {
      id: newListItemId(),
      text: {
        en: 'GYC Canada is the Canadian affiliate of the GYC movement initiated in 2002, in the United States of America. We are Canadian Seventh-day Adventist young people who seek to promote the spirit and ideals of GYC in Canada.',
        fr: "GYC Canada est l'affilié canadien du mouvement GYC initié en 2002, aux États-Unis d'Amérique. Nous sommes de jeunes canadiens, adventistes du septième jour, qui cherchent à promouvoir l'esprit et les principes de GYC au Canada.",
      },
    },
    {
      id: newListItemId(),
      text: {
        en: 'GYC Canada is a recognized independent supporting ministry of the Seventh-day Adventist Church of Canada. GYC Canada encourages young Seventh-day Adventists across Canada to be active members in their local churches.',
        fr: "GYC Canada est un ministère indépendant, soutenant l'Église adventiste du septième jour au Canada et reconnu par celle-ci. GYC Canada encourage les jeunes adventistes du septième jour à être des membres actifs de leurs églises locales.",
      },
    },
  ],
  disclaimer: {
    en: 'Disclaimer: GYC Canada does not accept tithes. We encourage donors to give tithes to their respective churches.',
    fr: "Notice importante : GYC Canada n'accepte pas les dîmes. Nous encourageons les donateurs à donner leurs dîmes à leurs églises respectives.",
  },
  quotes: [
    {
      id: newListItemId(),
      text: {
        en: '“Let no one despise you for your youth, but set the believers an example in speech, in conduct, in love, in faith, in purity.”',
        fr: '“Que personne ne méprise ta jeunesse, mais sois un modèle pour les croyants en parole, en conduite, en amour, en foi et en pureté.”',
      },
      attribution: { en: '1 Timothy 4:12', fr: '1 Timothée 4:12' },
    },
    {
      id: newListItemId(),
      text: {
        en: '“With such an army of workers as our youth, rightly trained, might furnish, how soon the message of a crucified, risen, and soon-coming Saviour might be carried to the whole world!”',
        fr: "“Avec l'armée que formeraient nos jeunes, bien préparés, la bonne nouvelle de notre Sauveur crucifié, ressuscité, prêt à revenir, serait vite portée au monde entier.”",
      },
      attribution: { en: 'Education, p. 271.2', fr: 'Éducation, p. 304.2' },
    },
  ],
});

// ---------------------------------------------------------------------------
// FAQ — answers as closed RichText token sequences (text / bold / link)
// ---------------------------------------------------------------------------

export const defaultFaqPage: FaqPage = Schema.decodeUnknownSync(FaqPage)({
  title: { en: 'Frequently Asked Questions', fr: 'Foire aux questions' },
  items: [
    {
      id: newListItemId(),
      question: { en: 'Exhibitor Booths', fr: 'Stands d’exposants' },
      // Three answer paragraphs (`faq.question.1.answer.1/.2/.3`); the `\n\n`
      // breaks carry today's `<br/><br/>` paragraph separators through the
      // inline RichText model. EN answer.3 reads "BEFORE registering, please
      // email {{email}} …"; FR answer.3 reorders to "… courriel à {{email}}
      // AVANT de vous inscrire …", so the bold "AVANT" token follows the link.
      answer: [
        {
          _tag: 'text',
          value: {
            en: "GYC Canada reserves the right to refuse any exhibitor that does not uphold the Spirit of GYC as documented in the 'About Us' section of our website. Email us with any questions at ",
            fr: "GYC Canada se réserve le droit de refuser tout exposant qui ne respecte pas l’esprit de GYC tel que documenté dans la section 'À propos de nous' de notre site Web. Pour toute question envoyez-nous un message à l'adresse courriel ",
          },
        },
        {
          _tag: 'link',
          text: { en: 'hello@gyccanada.org', fr: 'hello@gyccanada.org' },
          href: GYCC_EMAIL,
        },
        {
          _tag: 'text',
          value: {
            en: '.\n\nA single-table exhibitor booth can be reserved for the price of $100, and a two-table exhibitor booth for the price of $50. An exhibitor booth reservation does not include registration(s) for the person(s) running the booth to the conference. The Exhibit manager(s) must first register as attendees for the full conference.\n\n',
            fr: ".\n\nUn stand d’exposant d’une table peut être acheté pour le prix de 100 $, et un stand d’exposant de deux tables pour le prix de 50 $. Un stand d’exposant n'inclut pas l’inscription à la conférence des personnes qui présentent le stand. Le responsable du stand doit d'abord inscrire tous les présentateurs du stand en tant que participants à la conférence pour la durée totale de la conférence avant de réserver un stand d'exposant.\n\n",
          },
        },
        {
          _tag: 'bold',
          value: { en: 'BEFORE', fr: 'AVANT' },
        },
        {
          _tag: 'text',
          value: {
            en: ' registering, please email ',
            fr: ' courriel à ',
          },
        },
        {
          _tag: 'link',
          text: { en: 'hello@gyccanada.org', fr: 'hello@gyccanada.org' },
          href: GYCC_EMAIL,
        },
        {
          _tag: 'text',
          value: {
            en: ' to get approval for your booth. This can avoid issues with your booth, and can help avoid refund issues if we decide you are not a fit for our conference.',
            fr: " de vous inscrire afin d'obtenir l’approbation pour votre stand. Cela peut éviter des problèmes avec votre stand et de remboursement si jamais nous décidons que vous ne correspondez pas avec les critères pour participer à notre conférence.",
          },
        },
      ],
    },
    {
      id: newListItemId(),
      question: {
        en: 'Cancellation and Refunds',
        fr: 'Annulation et remboursements',
      },
      // `faq.question.2.answer.1` (with the "NON-refundable*" asterisk) ends the
      // first paragraph, then a `\n\n` break, then the `faq.question.2.answer.2`
      // footnote as an `italic` run — the pre-migration route wrapped this footnote
      // in `<span className="italic">`, so it carries an `italic` token to preserve
      // that styling without HTML (closed RichText model; renderer maps it to `<em>`).
      answer: [
        {
          _tag: 'text',
          value: {
            en: 'Conference registration fees are strictly NON-refundable*. You may transfer your registration to another person as long as they qualify for the same type of registration. You must notify GYC Canada of this change by emailing us at ',
            fr: 'Les frais d’inscription à la conférence sont strictement NON-remboursables*. Vous pouvez transférer votre inscription à une autre personne tant qu’elle est admissible pour le même type d’inscription. Vous devez informer GYC Canada de ce changement en nous envoyant un courriel à ',
          },
        },
        {
          _tag: 'link',
          text: { en: 'hello@gyccanada.org', fr: 'hello@gyccanada.org' },
          href: GYCC_EMAIL,
        },
        {
          _tag: 'text',
          value: { en: '.\n\n', fr: '.\n\n' },
        },
        {
          _tag: 'italic',
          value: {
            en: '* The ONLY exception to the above rule are government imposed restrictions that may inhibit in-person events',
            fr: "* La SEULE exception admissible à la règle mentionnée plus haut est le cas d'une restriction imposée par le gouvernement qui pourrait empêcher la participation de quelqu'un à l'évènement.",
          },
        },
      ],
    },
    {
      id: newListItemId(),
      question: { en: 'Letter of Invitation', fr: 'Lettre d’invitation' },
      // The full `faq.question.3.answer.1` paragraph (everyone welcome /
      // attendee responsible / livestreams DO NOT cover Workshops or Breakouts /
      // "not viable for a refund") with the inline website link, then the bold
      // `faq.question.3.answer.2` ("All ticket sales are final.").
      answer: [
        {
          _tag: 'text',
          value: {
            en: 'GYC Canada does not and will not provide you with a letter of invitation for any purpose. Everyone is welcome to attend our conference, but you as an attendee are fully responsible for ensuring you can attend and arranging your transport. We will have livestreams available for those who are not able to attend in person or would like to go back and review what was covered. Livestreams DO NOT cover Workshops or Breakouts, which are only available for those who attend in person. Livestreams will be available via our YouTube channel, Facebook page and Website (',
            fr: 'GYC Canada ne peut vous fournir une lettre d’invitation peu importe votre besoin. Tout le monde est le bienvenu à notre conférence, mais en tant que participant vous êtes entièrement responsable de vous assurer que vous pouvez y assister et êtes responsable d’organiser votre transport. Nous aurons des diffusions en direct disponibles pour ceux qui ne peuvent pas assister en personne ou aimeraient revenir sur ce qui a été présenté. Les diffusions en direct NE présenteront PAS les ateliers, car ceux-ci ne sont disponibles que pour ceux qui assistent en personne. Les diffusions en direct seront disponibles via notre canal YouTube, page Facebook et Site Web (',
          },
        },
        {
          _tag: 'link',
          text: { en: 'gyccanada.org', fr: 'gyccanada.org' },
          href: GYCC_SITE,
        },
        {
          _tag: 'text',
          value: {
            en: '). If you purchase a ticket and need an invitation, you are not viable for a refund.\n\n',
            fr: '). Si vous achetez un billet et avez besoin d’une invitation, vous n’êtes pas admissible à un remboursement.\n\n',
          },
        },
        {
          _tag: 'bold',
          value: {
            en: 'All ticket sales are final.',
            fr: 'Toutes les ventes de billets sont finales.',
          },
        },
      ],
    },
  ],
});

// ---------------------------------------------------------------------------
// Give
// ---------------------------------------------------------------------------

export const defaultGivePage: GivePage = Schema.decodeUnknownSync(GivePage)({
  title: { en: 'Support the movement.', fr: 'Soutenez le mouvement.' },
  reason: {
    en: "Our call to mission, is to be the light of the world. Our Savior calls us to a worldwide mission of spreading the gospel of Christ's love in this world filled with darkness. This light should not be hidden, covered by the humdrum of life, but out in the open, where all can see and hear. GYC Canada wants to magnify that light, to bring it to all of Canada and the world.",
    fr: "Notre appel à la mission est d'être la lumière du monde. Notre Seigneur nous appelle à répandre la bonne nouvelle de l'amour de Christ dans un monde rempli de ténèbres. Cette lumière ne devrait pas être cachée ou couverte par la routine de la vie, mais bien en vue, afin que tout le monde puisse la voir et l'entendre. GYC Canada veut amplifier cette lumière, la faire briller partout au Canada et dans le monde.",
  },
  directions: [
    {
      id: newListItemId(),
      text: {
        en: "Enter the amount you'd like to give.",
        fr: 'Entrez le montant que vous souhaitez donner.',
      },
    },
    {
      id: newListItemId(),
      text: {
        en: 'Choose your preferred payment method.',
        fr: 'Choisissez votre mode de paiement préféré.',
      },
    },
    {
      id: newListItemId(),
      text: {
        en: 'If you want to give monthly, tap on "Make this a monthly donation".',
        fr: 'Si vous souhaitez donner mensuellement, appuyez sur « Faire de ce don un don mensuel ».',
      },
    },
    {
      id: newListItemId(),
      text: {
        en: 'If there\'s a specific purpose for your gift, let us know in the "Add a note" section.',
        fr: 'Si votre don a un but précis, indiquez-le dans la section « Ajouter une note ».',
      },
    },
  ],
  donateUrl: PAYPAL_DONATE,
});

// ---------------------------------------------------------------------------
// Contact (page copy only)
// ---------------------------------------------------------------------------

export const defaultContactPage: ContactPage = Schema.decodeUnknownSync(
  ContactPage,
)({
  title: { en: 'Get in touch with us!', fr: 'Entrez en contact avec nous!' },
  directions: [
    {
      _tag: 'text',
      value: {
        en: 'You can reach us anytime via email at ',
        fr: 'Vous pouvez nous joindre à tout moment par courriel à ',
      },
    },
    {
      _tag: 'link',
      text: { en: 'hello@gyccanada.org', fr: 'hello@gyccanada.org' },
      href: GYCC_EMAIL,
    },
    {
      _tag: 'text',
      value: {
        en: ', or with the form below.',
        fr: ', ou avec le formulaire ci-dessous.',
      },
    },
  ],
});

// ---------------------------------------------------------------------------
// Volunteer (page copy only)
// ---------------------------------------------------------------------------

export const defaultVolunteerPage: VolunteerPage = Schema.decodeUnknownSync(
  VolunteerPage,
)({
  title: [
    { _tag: 'text', value: { en: 'Become a part of the ', fr: 'Faites partie du ' } },
    { _tag: 'bold', value: { en: 'movement', fr: 'mouvement' } },
    { _tag: 'text', value: { en: '.', fr: '.' } },
  ],
  subtitle: {
    en: 'Join a group of dedicated and passionate young people, professionals, and laypersons. As a youth-led organization, GYC is mobilizing to share Christ with all of Canada.',
    fr: 'Rejoignez un groupe de jeunes adultes, de professionnels et de laïcs dédiés et passionnés. En tant qu’organisation dirigée par des jeunes, GYC se mobilise pour partager Christ avec tout le Canada.',
  },
  directions: {
    en: 'Select the area you are interested in:',
    fr: 'Sélectionnez le domaine qui vous intéresse :',
  },
});

// ---------------------------------------------------------------------------
// Archive (empty by default — section-skip renders nothing)
// ---------------------------------------------------------------------------

export const defaultArchivePage: ArchivePage = Schema.decodeUnknownSync(
  ArchivePage,
)({
  title: { en: 'Archive', fr: 'Archives' },
  entries: [],
});

// ---------------------------------------------------------------------------
// Home (evergreen, non-conference sections)
// ---------------------------------------------------------------------------

export const defaultHomePage: HomePage = Schema.decodeUnknownSync(HomePage)({
  tagline: {
    en: 'GYC Canada is a movement founded by young people for young people.',
    fr: 'GYC Canada est un mouvement fondé par des jeunes pour des jeunes.',
  },
  mission: {
    readStoryLabel: { en: 'Read our story', fr: 'Lire notre histoire' },
  },
  join: {
    title: { en: 'Join the Movement', fr: 'Rejoignez le mouvement' },
    subtitle: {
      en: 'GYC Canada is a non-profit organization run by a handful of amazing volunteers. That means we depend entirely on your attendance and your generous donations to keep the movement growing.',
      fr: 'GYC Canada est un organisme à but non lucratif géré par une poignée de bénévoles formidables. Cela signifie que nous dépendons entièrement de votre présence et de vos généreux dons pour faire grandir le mouvement.',
    },
    donateLabel: { en: 'Consider donating', fr: 'Envisagez de donner' },
    volunteerLabel: { en: 'Volunteer', fr: 'Devenir bénévole' },
  },
  newsletter: {
    title: { en: 'Stay in the loop', fr: 'Restez informé' },
    subtitle: {
      en: 'We’ll send our monthly newsletter straight to your inbox, giving you a chance for early-bird pricing the moment it launches, updates on all our latest projects, and more!',
      fr: 'Nous enverrons notre infolettre mensuelle directement dans votre boîte de réception, vous donnant la chance de profiter des tarifs préférentiels dès leur lancement, des nouvelles de nos derniers projets, et plus encore!',
    },
    socials: {
      en: 'Don’t forget to follow us on social media to get to know our team and stay up-to-date!',
      fr: 'N’oubliez pas de nous suivre sur les réseaux sociaux pour faire connaissance avec notre équipe et rester à jour!',
    },
  },
});

// ---------------------------------------------------------------------------
// Form definitions (placeholder — page-level copy only until Branch 6)
// ---------------------------------------------------------------------------

export const defaultContactForm: FormDefinition = Schema.decodeUnknownSync(
  FormDefinition,
)({
  title: { en: 'Contact', fr: 'Contact' },
});

export const defaultVolunteerForm: FormDefinition = Schema.decodeUnknownSync(
  FormDefinition,
)({
  title: { en: 'Volunteer', fr: 'Bénévolat' },
});

export const defaultRegistrationForm: FormDefinition = Schema.decodeUnknownSync(
  FormDefinition,
)({
  title: { en: 'Registration', fr: 'Inscription' },
});
