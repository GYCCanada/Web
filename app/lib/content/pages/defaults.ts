import { Schema } from 'effect';

import { FormDefinition } from '../../forms/definition';
import { newListItemId } from '../schema';
import {
  AboutPage,
  ArchivePage,
  ContactPage,
  FaqPage,
  GivePage,
  HomePage,
  TeamPage,
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
  enabled: true,
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
  enabled: true,
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
  enabled: true,
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
  enabled: true,
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
  enabled: true,
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
  enabled: true,
  title: { en: 'Archive', fr: 'Archives' },
  entries: [],
});

// ---------------------------------------------------------------------------
// Home (evergreen, non-conference sections)
// ---------------------------------------------------------------------------

export const defaultHomePage: HomePage = Schema.decodeUnknownSync(HomePage)({
  enabled: true,
  tagline: {
    en: 'GYC Canada is a movement founded by young people for young people.',
    fr: 'GYC Canada est un mouvement fondé par des jeunes pour des jeunes.',
  },
  mission: {
    readStoryLabel: { en: 'Read our story', fr: 'Lire notre histoire' },
    // Seed the existing mission art (`public/main/people.png`) under its managed
    // AssetKey so the day-one render is byte-identical to the pre-migration
    // hardcoded `<img src="/main/people.png">` — `assetUrl('main/people.png')`
    // resolves to `/images/main/people.png`, which the `GET /images/*` route
    // serves from the bundled `public/` tree until an admin upload overrides it.
    // Unlike Team's omitted photos (uploaded at launch), home ALWAYS shows this
    // photo today, so seeding it (rather than section-skipping) preserves behavior.
    photo: {
      key: 'main/people.png',
      alt: { en: 'Mission', fr: 'Mission' },
    },
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
// Team (page chrome — the per-member roster stays on site.json via getTeam())
// ---------------------------------------------------------------------------

/**
 * The Team page chrome transcribed from today's flat-key copy (`team.title` +
 * `team.title.movement`, `team.subtitle`, `team.board`). The italic `movement` run
 * is carried as an `italic` token so the `<span className="italic">…</span>` styling
 * of the pre-migration route survives without HTML (closed RichText model).
 *
 * The two image slots (`groupPhoto` / `portrait`) are OMITTED here (optionalKey ⇒
 * section-skip): the real photos are uploaded via the CMS at launch, mirroring how
 * the site defaults map `public/` art only once an upload overrides it. A brand-new
 * `team.json` therefore renders the roster + copy with NO broken `<img>`; the launch
 * upload sets `groupPhoto` / `portrait`. (The legacy `public/team/group-van-2022.jpg`
 * + `public/logo/gycc.png` stay on disk until an upload supersedes them.)
 *
 * `enabled: false`: the Team page ships HIDDEN — preserving today's hidden-team
 * behavior as DATA (the seed `team.json`'s own flag), not a hardcoded nav comment
 * (Feature C, `derive-dont-sync`). The launch flips it on in `/admin/pages/team`
 * once the photos are uploaded; until then the route 404s and the nav link is
 * absent, driven entirely off this flag.
 */
export const defaultTeamPage: TeamPage = Schema.decodeUnknownSync(TeamPage)({
  enabled: false,
  title: [
    {
      _tag: 'text',
      value: {
        en: 'The people behind the ',
        fr: 'Les personnes derrière le ',
      },
    },
    { _tag: 'italic', value: { en: 'movement', fr: 'mouvement' } },
    { _tag: 'text', value: { en: '.', fr: '.' } },
  ],
  subtitle: {
    en: 'We are GYC Canada, young people dedicated to spreading the Gospel and living the lives that God has planned for us. As ambassadors of Christ in this world, we are fulfilling His purpose for us and go boldly where our Savior leads.',
    fr: "Nous sommes GYC Canada, des jeunes dédiés à faire connaître l'Évangile et à vivre les vies que Dieu a prévues pour nous. En tant qu'ambassadeurs de Christ dans ce monde, nous accomplissons Sa volonté pour nous et allons avec courage là où notre Seigneur nous conduit.",
  },
  boardHeading: {
    en: 'Board of Directors',
    fr: 'Conseil d’administration',
  },
});

// ---------------------------------------------------------------------------
// Form definitions (structural — Branch 6.1)
// ---------------------------------------------------------------------------

/**
 * The bundled-default `FormDefinition`s. Branch 6.1 lands the structural schema
 * (the closed `FieldKind` set, variants, cross-field rules); volunteer and
 * registration carry the CMS-editable page copy with an EMPTY `fields` graph
 * until they migrate onto the engine (volunteer 6.4, registration 6.5) — until
 * then each falls back to its hand-tuned schema, and `Content.getForm` reads this
 * typed default so the per-form object + read path stay proven
 * (`migrate-callers-then-delete-legacy-apis`).
 */

/**
 * The contact form's field graph (Branch 6.3) — the data-driven equivalent of the
 * hand-tuned `contact.tsx` schema, proven byte-equivalent by
 * `forms/equivalence.contact.test.ts`. `email`/`phone` are `optional: true`
 * (optional-at-key, non-empty-when-present). The `method`-gated behaviour is two
 * orthogonal rule pairs (registrar plan Decision 5): an `activeWhenEquals` rule
 * drives VISIBILITY (the field renders, and POSTs, only when `method` matches —
 * absent otherwise, so its `optional: true` codec accepts the absence) and a
 * `requiredWhenEquals` rule re-imposes PRESENCE server-side when shown. Before
 * Decision 5 the `requiredWhenEquals` rule doubled as the visibility gate; that
 * conflation is retired — the rules are now separate axes, behaviour-preserving
 * (`derive-dont-sync`: this object IS the contact validation now, no hand-written
 * schema beside it).
 */
export const defaultContactForm: FormDefinition = Schema.decodeUnknownSync(
  FormDefinition,
)({
  title: { en: 'Contact', fr: 'Contact' },
  fields: [
    {
      _tag: 'requiredText',
      name: 'name',
      label: { en: 'What is your name?', fr: 'Quel est votre nom?' },
      placeholder: {
        en: 'Type your full name here',
        fr: 'Entrez votre nom complet ici',
      },
      requiredMessage: 'contact.form.name.required',
    },
    {
      _tag: 'literal',
      name: 'method',
      label: {
        en: 'Preferred contact method:',
        fr: 'Méthode de contact préférée: ',
      },
      options: [
        { value: 'email', label: { en: 'Email', fr: 'Courriel' } },
        { value: 'phone', label: { en: 'Phone', fr: 'Téléphone' } },
        { value: 'both', label: { en: 'Email & Phone', fr: 'Courriel et téléphone' } },
      ],
      requiredMessage: 'contact.form.contact-method.required',
    },
    {
      _tag: 'email',
      name: 'email',
      label: {
        en: 'What is your email address?',
        fr: 'Quelle est votre adresse courriel?',
      },
      placeholder: { en: 'example@mail.com', fr: 'example@mail.com' },
      optional: true,
      requiredMessage: 'contact.form.email.required',
      invalidMessage: 'contact.form.email.error',
    },
    {
      _tag: 'requiredText',
      name: 'phone',
      label: {
        en: 'What is your phone number?',
        fr: 'Quel est votre numéro de téléphone?',
      },
      placeholder: { en: '123-456-7890', fr: '123-456-7890' },
      optional: true,
      requiredMessage: 'contact.form.phone.required',
    },
    {
      _tag: 'requiredText',
      name: 'message',
      label: {
        en: 'What can we help you with?',
        fr: 'Comment pouvons-nous vous aider?',
      },
      placeholder: {
        en: 'Type your message here...',
        fr: 'Entrez votre message ici...',
      },
      multiline: true,
      requiredMessage: 'contact.form.message.required',
    },
  ],
  rules: [
    {
      _tag: 'activeWhenEquals',
      predicate: {
        _tag: 'literalEquals',
        when: 'method',
        equals: ['email', 'both'],
      },
      target: 'email',
    },
    {
      _tag: 'requiredWhenEquals',
      when: 'method',
      equals: ['email', 'both'],
      target: 'email',
      message: 'contact.form.email.required',
    },
    {
      _tag: 'activeWhenEquals',
      predicate: {
        _tag: 'literalEquals',
        when: 'method',
        equals: ['phone', 'both'],
      },
      target: 'phone',
    },
    {
      _tag: 'requiredWhenEquals',
      when: 'method',
      equals: ['phone', 'both'],
      target: 'phone',
      message: 'contact.form.phone.required',
    },
  ],
});

/**
 * The volunteer form's field graph (Branch 6.4) — the data-driven equivalent of
 * the hand-tuned `volunteer.tsx` schema, proven byte-equivalent by
 * `forms/equivalence.volunteer.test.ts`. Like contact it carries the `method`
 * discriminator as a `literal` + the two orthogonal rule pairs gating
 * `email`/`phone` (an `activeWhenEquals` rule for VISIBILITY, a
 * `requiredWhenEquals` rule for server-side PRESENCE — registrar plan Decision 5);
 * volunteer adds the always-required `age`/`location`/
 * `background`/`why` free-text fields (the latter two `multiline`). The fields
 * are listed in their rendered order (`volunteer.tsx` view order: name, method,
 * email/phone, age, location, background, why) so the migrated `<FormFields>`
 * draws the identical sequence.
 *
 * `email` is `optional: true` (optional-at-key, non-empty-when-present) gated by
 * a `requiredWhenEquals` rule; `phone` is an `optional: true` `requiredText`
 * (the oracle's `Schema.optional(Phone)` where `Phone` is a bare non-empty
 * string with no email/url format check) gated by the second rule — exactly the
 * contact shape (`derive-dont-sync`: this object IS the volunteer validation
 * now, no hand-written schema beside it).
 *
 * The oracle's vestigial `positions` multi-checkbox is intentionally NOT a field
 * here: the volunteer route never populated `data.positions` (a hardcoded `[]`),
 * so its checkbox block never rendered and the field was never submitted — its
 * options are dynamic loader data, never a closed `OptionList`, so it does not
 * fit the closed `FieldKind` set (`subtract-before-you-add`,
 * `make-impossible-states-unrepresentable`). The harness pins this one decoded-
 * default delta (oracle emits `positions: []`, the engine omits it) and the
 * migrated `notify` preserves the email's always-empty `Positions:` line.
 */
export const defaultVolunteerForm: FormDefinition = Schema.decodeUnknownSync(
  FormDefinition,
)({
  title: { en: 'Volunteer', fr: 'Bénévolat' },
  fields: [
    {
      _tag: 'requiredText',
      name: 'name',
      label: { en: 'What is your name?', fr: 'Quel est votre nom?' },
      placeholder: {
        en: 'Type your full name here',
        fr: 'Entrez votre nom complet ici',
      },
      requiredMessage: 'volunteer.form.name.required',
    },
    {
      _tag: 'literal',
      name: 'method',
      label: {
        en: 'Preferred contact method:',
        fr: 'Préférez-vous le téléphone ou le courriel?',
      },
      options: [
        { value: 'phone', label: { en: 'Phone', fr: 'Téléphone' } },
        { value: 'email', label: { en: 'Email', fr: 'Courriel' } },
        {
          value: 'both',
          label: { en: 'Email & Phone', fr: 'Courriel et téléphone' },
        },
      ],
      requiredMessage: 'volunteer.form.method.required',
    },
    {
      _tag: 'email',
      name: 'email',
      label: {
        en: 'What is your email address?',
        fr: 'Quelle est votre adresse courriel?',
      },
      placeholder: { en: 'example@mail.com', fr: 'example@mail.com' },
      optional: true,
      requiredMessage: 'volunteer.form.email.required',
      invalidMessage: 'volunteer.form.email.error',
    },
    {
      _tag: 'requiredText',
      name: 'phone',
      label: {
        en: 'What is your phone number?',
        fr: 'Quel est votre numéro de téléphone?',
      },
      placeholder: { en: '123-456-7890', fr: '123-456-7890' },
      optional: true,
      requiredMessage: 'volunteer.form.phone.required',
    },
    {
      _tag: 'requiredText',
      name: 'age',
      label: { en: 'What is your age?', fr: 'Quel est votre âge?' },
      placeholder: { en: 'Enter your age here', fr: 'Entrez votre âge ici' },
      requiredMessage: 'volunteer.form.age.required',
    },
    {
      _tag: 'requiredText',
      name: 'location',
      label: {
        en: 'Where are you located?',
        fr: 'Où êtes-vous situé?',
      },
      placeholder: {
        en: 'Enter your location here',
        fr: 'Entrez votre emplacement ici',
      },
      requiredMessage: 'volunteer.form.location.required',
    },
    {
      _tag: 'requiredText',
      name: 'background',
      label: {
        en: 'Please tell us more about yourself and your background.',
        fr: "S'il-vous-plait, dites-nous en davantage sur vous et votre parcours?",
      },
      placeholder: {
        en: 'Enter your background here',
        fr: 'Entrez votre parcours ici',
      },
      multiline: true,
      requiredMessage: 'volunteer.form.background.required',
    },
    {
      _tag: 'requiredText',
      name: 'why',
      label: {
        en: 'What motivates you to volunteer with us?',
        fr: "Qu'est-ce qui vous motive à faire du bénévolat avec nous?",
      },
      placeholder: {
        en: 'Enter your reason here',
        fr: 'Entrez votre raison ici',
      },
      multiline: true,
      requiredMessage: 'volunteer.form.why.required',
    },
  ],
  rules: [
    {
      _tag: 'activeWhenEquals',
      predicate: {
        _tag: 'literalEquals',
        when: 'method',
        equals: ['email', 'both'],
      },
      target: 'email',
    },
    {
      _tag: 'requiredWhenEquals',
      when: 'method',
      equals: ['email', 'both'],
      target: 'email',
      message: 'volunteer.form.email.required',
    },
    {
      _tag: 'activeWhenEquals',
      predicate: {
        _tag: 'literalEquals',
        when: 'method',
        equals: ['phone', 'both'],
      },
      target: 'phone',
    },
    {
      _tag: 'requiredWhenEquals',
      when: 'method',
      equals: ['phone', 'both'],
      target: 'phone',
      message: 'volunteer.form.phone.required',
    },
  ],
});

/**
 * The registration form's PER-REGISTRANT field graph (Branch 6) — the data-driven
 * equivalent of the former hand-tuned `Registrant` struct, proven byte-equivalent
 * by the registration equivalence harness against the hand-tuned oracle before both
 * were retired in Branch 6.6 (ADR 0007: "the oracle is removed once registration is
 * fully migrated"). The live form's field-name contract is now pinned by the
 * render-parity tests in `forms/registration-form.test.tsx`. See
 * `docs/forms/registration-spec.md` for the field-for-field transcription.
 *
 * SCOPE: this `FormDefinition` describes ONE registrant. The registration form is
 * `{ registrants: Registrant[] }` — a repeating array of these, which is NOT in
 * the closed `FieldKind` set (the brief's non-goal: the kind-set is closed, not an
 * arbitrary builder). So the engine owns the registrant VALIDATION GRAPH (the
 * attendee/exhibitor discriminator, the per-type requirements, the nested groups,
 * the boolean codecs — the riskiest part the harness pins); the registration route
 * keeps the multi-registrant SHELL (the `registrants` array, the
 * `registrants[n].` field prefix, the minors-only `parent` client gating, the
 * boolean-RADIO rendering of `meals` / `firstTimeAttending`) and derives its
 * validation from `Schema.Array(definitionToSchema(this))`
 * (`derive-dont-sync`).
 *
 * Two oracle subtleties faithfully transcribed:
 *   - `parent.email` is a bare `requiredText`, NOT an `email` kind — the oracle's
 *     `Parent.email` is a `RequiredString` with no `/@/` pattern check, so the
 *     engine must not tighten it (the harness would flag a divergence).
 *   - `parent` / `volunteer` are `optional: true` `nestedGroup`s — the oracle's
 *     attendee filter never REQUIRES them (they are conditionally rendered:
 *     `parent` only for minors, `volunteer` opt-in). The always-rendered `extra`
 *     group is a non-optional `nestedGroup`, so an attendee that omits it is an
 *     error anchored at `extra.tos` (the oracle's `['extra','tos']` anchor).
 */
export const defaultRegistrationForm: FormDefinition = Schema.decodeUnknownSync(
  FormDefinition,
)({
  title: { en: 'Registration', fr: 'Inscription' },
  fields: [
    {
      _tag: 'requiredText',
      name: 'name',
      label: { en: 'Name', fr: 'Nom' },
      placeholder: { en: 'Your full name', fr: 'Votre nom complet' },
      requiredMessage: 'registration.form.name.required',
    },
    {
      _tag: 'email',
      name: 'email',
      label: { en: 'Email', fr: 'Courriel' },
      placeholder: { en: 'example@mail.com', fr: 'example@mail.com' },
      // optional-at-key (registrar plan 2b.3): an ABSENT registrant email
      // decodes valid; a PRESENT blank still rejects. In `group` the shell
      // drops blank non-leader emails before the per-registrant codec (C7);
      // in `perRegistrant` the shell re-imposes presence on every registrant
      // (C7.5). The relaxation is dormant until the published
      // `forms/registration.json` is re-authored.
      optional: true,
      requiredMessage: 'registration.form.email.required',
      invalidMessage: 'registration.form.email.error',
    },
    {
      _tag: 'requiredText',
      name: 'phone',
      label: { en: 'Phone', fr: 'Téléphone' },
      placeholder: { en: '123-456-7890', fr: '123-456-7890' },
      requiredMessage: 'registration.form.phone.required',
    },
  ],
  variant: {
    discriminator: 'type',
    requiredMessage: 'registration.form.type.required',
    options: [
      { value: 'attendee', label: { en: 'Attendee', fr: 'Participant' } },
      { value: 'exhibitor', label: { en: 'Exhibitor', fr: 'Exposant' } },
    ],
    variants: [
      {
        value: 'attendee',
        label: { en: 'Attendee', fr: 'Participant' },
        fields: [
          {
            _tag: 'literal',
            name: 'gender',
            label: { en: 'Gender', fr: 'Genre' },
            options: [
              { value: 'male', label: { en: 'Male', fr: 'Homme' } },
              { value: 'female', label: { en: 'Female', fr: 'Femme' } },
            ],
            requiredMessage: 'registration.form.gender.required',
          },
          {
            _tag: 'requiredText',
            name: 'dateOfBirth',
            label: { en: 'Date of birth', fr: 'Date de naissance' },
            requiredMessage: 'registration.form.date-of-birth.required',
          },
          {
            _tag: 'nestedGroup',
            name: 'parent',
            label: { en: 'Parent / guardian', fr: 'Parent / tuteur' },
            optional: true,
            fields: [
              {
                _tag: 'requiredText',
                name: 'name',
                label: { en: 'Parent name', fr: 'Nom du parent' },
                requiredMessage: 'registration.form.parent.required',
              },
              {
                _tag: 'requiredText',
                name: 'email',
                label: { en: 'Parent email', fr: 'Courriel du parent' },
                requiredMessage: 'registration.form.parent-email.required',
              },
              {
                _tag: 'requiredText',
                name: 'phone',
                label: { en: 'Parent phone', fr: 'Téléphone du parent' },
                requiredMessage: 'registration.form.parent-phone.required',
              },
            ],
          },
          {
            _tag: 'checkboxBoolean',
            name: 'meals',
            label: { en: 'Meals', fr: 'Repas' },
            requiredMessage: 'registration.form.meals.required',
          },
          {
            _tag: 'optionalText',
            name: 'dietaryRestrictions',
            label: {
              en: 'Dietary restrictions',
              fr: 'Restrictions alimentaires',
            },
            invalidMessage: 'registration.form.dietary-restrictions.required',
          },
          {
            _tag: 'arrayOfLiteral',
            name: 'outreach',
            label: { en: 'Outreach', fr: 'Sensibilisation' },
            options: [
              {
                value: 'laws-of-health',
                label: { en: 'Laws of Health', fr: 'Lois de la santé' },
              },
              {
                value: 'homeless-carepacks',
                label: {
                  en: 'Homeless Care Packs',
                  fr: 'Trousses pour sans-abri',
                },
              },
              {
                value: 'back-to-school',
                label: { en: 'Back to School', fr: 'Rentrée scolaire' },
              },
              {
                value: 'not-sure',
                label: { en: 'Not sure', fr: 'Pas sûr' },
              },
            ],
            requiredMessage: 'registration.form.outreach.required',
          },
          {
            _tag: 'nestedGroup',
            name: 'extra',
            label: { en: 'Extra information', fr: 'Informations supplémentaires' },
            // An absent `extra` group anchors its presence error at `tos`,
            // matching the registration oracle's `['extra','tos']` anchor
            // (registration-spec.md:78). Without this, `groupPresenceIssue` would
            // anchor at the group's first presence-requirable field
            // (`howDidYouHear`), diverging from the oracle's emitted key set.
            presenceAnchor: 'tos',
            fields: [
              {
                _tag: 'requiredText',
                name: 'howDidYouHear',
                label: { en: 'How did you hear about us?', fr: 'Comment avez-vous entendu parler de nous?' },
                requiredMessage: 'registration.form.how-did-you-hear.required',
              },
              {
                _tag: 'requiredText',
                name: 'whyAreYouAttending',
                label: { en: 'Why are you attending?', fr: 'Pourquoi participez-vous?' },
                requiredMessage:
                  'registration.form.why-are-you-attending.required',
              },
              {
                _tag: 'requiredText',
                name: 'whatAreYouExcitedAbout',
                label: { en: 'What are you excited about?', fr: 'Qu’est-ce qui vous enthousiasme?' },
                requiredMessage:
                  'registration.form.what-are-you-excited-about.required',
              },
              {
                _tag: 'checkboxBoolean',
                name: 'firstTimeAttending',
                label: { en: 'First time attending?', fr: 'Première participation?' },
                requiredMessage:
                  'registration.form.first-time-attending.required',
              },
              {
                _tag: 'optionalText',
                name: 'church',
                label: { en: 'Church', fr: 'Église' },
                invalidMessage: 'registration.form.church.required',
              },
              {
                _tag: 'arrayOfLiteral',
                name: 'merch',
                label: { en: 'Merch', fr: 'Articles' },
                options: [
                  { value: 't-shirt', label: { en: 'T-shirt', fr: 'T-shirt' } },
                  { value: 'hoodie', label: { en: 'Hoodie', fr: 'Pull' } },
                  { value: 'shirt', label: { en: 'Shirt', fr: 'Chemise' } },
                  { value: 'none', label: { en: 'None', fr: 'Aucun' } },
                ],
                requiredMessage: 'registration.form.merch.required',
              },
              {
                _tag: 'optionalText',
                name: 'other',
                label: { en: 'Other', fr: 'Autre' },
                // Realizes the former hand-tuned `OptionalText` (the registration
                // oracle's `other`, retired in 6.6): key-must-be-present,
                // empty-string-allowed — the always-rendered `extra` block POSTs an
                // empty `other`, so an absent `other` inside a present `extra` is an
                // out-of-form payload that schema rejects.
                // `church`/`instrument`/`dietaryRestrictions` are genuinely-optional
                // (the former `OptionalString`) and omit this flag.
                requirePresent: true,
                invalidMessage: 'registration.form.other.required',
              },
              {
                _tag: 'checkboxBoolean',
                name: 'tos',
                label: { en: 'I agree to the terms', fr: 'J’accepte les conditions' },
                requiredMessage: 'registration.form.tos.required',
              },
            ],
          },
          {
            _tag: 'nestedGroup',
            name: 'volunteer',
            label: { en: 'Volunteer', fr: 'Bénévolat' },
            optional: true,
            fields: [
              ...(
                [
                  'songLeader',
                  'musician',
                ] as const
              ).map((name) => ({
                _tag: 'checkboxBoolean' as const,
                name,
                label: { en: name, fr: name },
                optional: true,
                requiredMessage: 'registration.form.volunteer.required' as const,
              })),
              {
                _tag: 'optionalText' as const,
                name: 'instrument',
                label: { en: 'Instrument', fr: 'Instrument' },
                invalidMessage: 'registration.form.instrument.required' as const,
              },
              ...(
                [
                  'specialMusic',
                  'hospitality',
                  'registrationStation',
                  'usher',
                  'outreachLeader',
                  'smallGroupLeader',
                  'seminarRoomHost',
                  'cameraOperator',
                  'photographer',
                  'roamingMic',
                ] as const
              ).map((name) => ({
                _tag: 'checkboxBoolean' as const,
                name,
                label: { en: name, fr: name },
                optional: true,
                requiredMessage: 'registration.form.volunteer.required' as const,
              })),
            ],
          },
        ],
      },
      {
        value: 'exhibitor',
        label: { en: 'Exhibitor', fr: 'Exposant' },
        fields: [
          {
            _tag: 'requiredText',
            name: 'synopsis',
            label: { en: 'Synopsis', fr: 'Synopsis' },
            requiredMessage: 'registration.form.synopsis.required',
          },
          {
            _tag: 'url',
            name: 'website',
            label: { en: 'Website', fr: 'Site web' },
            requiredMessage: 'registration.form.website.required',
            invalidMessage: 'registration.form.website.required',
          },
          {
            _tag: 'requiredText',
            name: 'company',
            label: { en: 'Company', fr: 'Entreprise' },
            requiredMessage: 'registration.form.company.required',
          },
        ],
      },
    ],
  },
  // The CMS-authored party scope (registrar plan Decision 2b / C7a + C7.5). C7a
  // authored GROUP-ONLY options; C7.5 adds the `perRegistrant` option NOW that the
  // server branch which fans out per-registrant intents exists (the C7-standalone
  // hazard the plan calls out: never offer a mode the server cannot yet handle).
  // With BOTH modes offered the shell builds a real two-arm union — the selector
  // renders (≥2 authored modes) and the live mode drives email-required + payment
  // cardinality (the orthogonality table rows (i)/(ii)). The biconditional on
  // FormDefinition requires a `payer` block here because `group` ∈ options keys.
  // Every label is CMS-editable `Text`; the message keys are the tokens that
  // shipped in `translations.ts` in C7a.
  party: {
    intro: {
      en: 'Tell us how your party is paying.',
      fr: 'Dites-nous comment votre groupe paie.',
    },
    billingMode: {
      label: { en: 'How are you paying?', fr: 'Comment payez-vous?' },
      requiredMessage: 'registration.party.billingMode.required',
      options: {
        group: {
          en: 'One person pays for everyone',
          fr: 'Une personne paie pour tout le monde',
        },
        perRegistrant: {
          en: 'Each person pays for themselves',
          fr: 'Chaque personne paie pour soi',
        },
      },
    },
    payer: {
      label: { en: 'Who is paying?', fr: 'Qui paie?' },
      nameField: {
        label: { en: "Payer's name", fr: 'Nom du payeur' },
        requiredMessage: 'registration.party.payer.name.required',
      },
      emailField: {
        label: { en: "Payer's email", fr: 'Courriel du payeur' },
        requiredMessage: 'registration.party.payer.email.required',
        invalidMessage: 'registration.party.payer.email.error',
      },
    },
  },
});
