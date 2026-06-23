import { Schema } from "effect";

import { root } from "../localization/translations";
import {
  disabledAccommodationsSection,
  disabledFaqCopySection,
  disabledMealsSection,
  disabledParkingSection,
  disabledRegistrationCopySection,
  disabledTravelSection,
} from "./conference-section-defaults";
import {
  deterministicListItemId,
  DraftSiteContent,
  SiteContent,
} from "./schema";

/**
 * The bundled-default `SiteContent` document (CMS plan §"Defaults / seed",
 * decisions D2 / D3).
 *
 * This is the single transcription of today's typed-TS content — the three
 * conferences from `conference.server.ts`, the team from `team.server.tsx`, and
 * the UI translations from `localization/translations.ts` — into one decoded
 * `SiteContent` value. It serves two roles:
 *   1. the **dev / fallback** content the `Content` service returns when no
 *      bucket is configured or the bucket is unreachable (D3), so dev with no
 *      bucket behaves exactly like today; and
 *   2. the **seed** uploaded to a fresh bucket on first publish.
 *
 * Faithfulness notes (the content here must render identically to today):
 *   - Image paths lose their leading `/` to satisfy `AssetKey` (bucket keys are
 *     bucket-relative). The C3 `Content` boundary resolves a key back to its
 *     served URL, so the rendered `src` is unchanged.
 *   - The hero art is genuinely per-locale today (separate `…/en/…` and
 *     `…/fr/…` files on disk; the 2024 route already renders them via a
 *     localized `<img>`), so each hero crop carries a `LocalizedAssetKey`
 *     (`{ en, fr }`). Both locales' exact paths are preserved verbatim — the
 *     earlier single-key model would have dropped one locale's art.
 *   - The hero `alt` was an empty string in the old data — an accessibility
 *     defect the `Text` schema rightly forbids. Descriptive bilingual alt text
 *     is authored here; it is the only place real new content is introduced.
 *   - `2024` registration windows carry the same dates as today; `2025` / `2026`
 *     have no pricing yet, so they simply omit the `registration` key (it is an
 *     `Option.none()` on the decoded side, never empty tuples).
 *   - The UI translations are spread directly from `root` rather than re-typed,
 *     so the default table can never drift from the live one (`derive-dont-sync`).
 *
 * Authored in the schema's **encoded** form (the literal IS the JSON that would
 * live at `content/site.json`: plain `string`s, `registration` an optional key)
 * and decoded through `SiteContent` once. Decoding — not `SiteContent.make` — is
 * the honest construction: the validated primitives (`AssetKey`, `IsoDate`,
 * `HexColour`, the conference `ConferenceSlug`) are branded, so a value only
 * earns the brand by crossing the schema boundary (`boundary-discipline`,
 * `make-impossible-states-unrepresentable`). `decodeUnknownSync` throws on a
 * malformed default, so a transcription typo fails fast at module load.
 */
export const defaultContent: SiteContent = Schema.decodeUnknownSync(
  SiteContent,
)({
  meta: { schemaVersion: 1 },

  conferences: [
    // -------------------------------------------------------------------
    // 2024 — "While It Is Day" (Kelowna, BC)
    // -------------------------------------------------------------------
    {
      slug: "/2024",
      themeName: { en: "While It Is Day", fr: "Tant qu'il fait jour" },
      accentColor: "#FFD6BA",
      hero: {
        desktop: {
          // Per-locale hero art (today rendered by the 2024 route's localized
          // <img srcs={{en,fr}}>; both files exist on disk).
          key: {
            en: "2024/en/hero-desktop.jpg",
            fr: "2024/fr/hero-desktop.jpg",
          },
          alt: {
            en: "GYC Canada 2024 — While It Is Day conference hero",
            fr: "GYC Canada 2024 — bannière de la conférence Tant qu’il fait jour",
          },
        },
        mobile: {
          key: {
            en: "2024/en/hero-mobile.jpg",
            fr: "2024/fr/hero-mobile.jpg",
          },
          alt: {
            en: "GYC Canada 2024 — While It Is Day conference hero",
            fr: "GYC Canada 2024 — bannière de la conférence Tant qu’il fait jour",
          },
        },
      },
      dates: { start: "2024-08-21", end: "2024-08-25" },
      registration: {
        early: { start: "2024-05-19", end: "2024-06-22" },
        regular: { start: "2024-06-23", end: "2024-07-20" },
        late: { start: "2024-07-21", end: "2024-08-25" },
      },
      // Detail-page data (registration-launch Branch 3) — the URLs/hotels the
      // forked `2024/_index.tsx` hard-coded, now editable content. All present
      // for 2024, so every detail section renders.
      registrationUrl:
        "https://gyccanada.regfox.com/gyc-canada-2024-while-it-is-day",
      scheduleUrl:
        "https://docs.google.com/document/d/1gNAOfdW2Yhgg7FABjUqQt2k2mXV_AdhARWUOyiVL9dA/pub",
      learnMoreEnabled: false,
      travel: {
        enabled: true,
        headerCopy: { en: "Travel", fr: "Voyage" },
        bodyCopy: {
          en: "The conference will be at 130 Gerstmar Rd, Kelowna, BC V1X 4A7.",
          fr: "La conférence aura lieu au 130 Gerstmar Rd, Kelowna, BC V1X 4A7.",
        },
        mapEmbedUrl:
          "https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d2570.54720532797!2d-119.4124495876084!3d49.888529227544645!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x537d8d28862f4bfd%3A0xd41402dfff0455f4!2s130%20Gerstmar%20Rd%2C%20Kelowna%2C%20BC%20V1X%204A7!5e0!3m2!1sen!2sca!4v1720988332743!5m2!1sen!2sca",
      },
      parking: { ...disabledParkingSection },
      accommodations: {
        enabled: true,
        headerCopy: {
          en: "There are quite a few hotels in Kelowna, BC. We've listed the closest hotels to the venue below.",
          fr: "Il y a plusieurs hôtels à Kelowna, en Colombie-Britannique. Nous avons répertorié les hôtels les plus proches du lieu ci-dessous.",
        },
        hotels: [
          {
            id: "hQ1c8mZrT0vK4nXpL9aWd",
            name: {
              en: "Super 8 by Wyndham Kelowna BC",
              fr: "Super 8 by Wyndham Kelowna BC",
            },
            address: {
              en: "Kelowna, BC",
              fr: "Kelowna, BC",
            },
            roomRates: [],
          },
          {
            id: "rB7yN2eJ5sU0wG3kP8xQv",
            name: {
              en: "Fairfield Inn & Suites Kelowna",
              fr: "Fairfield Inn & Suites Kelowna",
            },
            address: {
              en: "Kelowna, BC",
              fr: "Kelowna, BC",
            },
            description: {
              en: 'Holiday Inn Express & Suites Kelowna — "GYC Canada" or Group Code: "GYC" (call 778-484-2999 for discount)',
              fr: 'Holiday Inn Express & Suites Kelowna — « GYC Canada » ou code de groupe : « GYC » (appelez le 778-484-2999 pour le rabais)',
            },
            roomRates: [],
          },
          {
            id: "tF9pX4kW6mD1cR8vN3sLb",
            name: {
              en: "Microtel Inn & Suites by Wyndham Kelowna",
              fr: "Microtel Inn & Suites by Wyndham Kelowna",
            },
            address: {
              en: "Kelowna, BC",
              fr: "Kelowna, BC",
            },
            roomRates: [],
          },
          {
            id: "yK2nV7bH5jQ0dT8wM4xPc",
            name: { en: "Comfort Suites", fr: "Comfort Suites" },
            address: {
              en: "Kelowna, BC",
              fr: "Kelowna, BC",
            },
            roomRates: [],
          },
          {
            id: "zL6mC3gR9pW1kN7vX5sQt",
            name: {
              en: "Kelowna Days Inn by Wyndham Kelowna",
              fr: "Kelowna Days Inn by Wyndham Kelowna",
            },
            address: {
              en: "Kelowna, BC",
              fr: "Kelowna, BC",
            },
            roomRates: [],
          },
        ],
      },
      meals: { ...disabledMealsSection },
      registrationCopy: {
        enabled: true,
        title: { en: "Register Now!", fr: "Inscrivez-vous!" },
        subtitle: {
          en: "Registration is now open. Secure your spot today!",
          fr: "Les inscriptions sont ouvertes. Réservez votre place dès aujourd’hui!",
        },
        buttonLabel: { en: "Register Now", fr: "S'inscrire" },
      },
      faqCopy: {
        enabled: true,
        title: { en: "Got Questions?", fr: "Des questions?" },
        subtitle: {
          en: "We are here to help. Reach out or browse our FAQ.",
          fr: "Nous sommes là pour vous aider. Contactez-nous ou consultez notre FAQ.",
        },
      },
      location: {
        en: "130 Gerstmar Rd, Kelowna, BC V1X 4A7",
        fr: "130 Gerstmar Rd, Kelowna, BC V1X 4A7",
      },
      tagline: {
        en: "“I must work the works of Him who sent Me while it is day; the night is coming when no one can work.”",
        fr: "“Il faut que je fasse, tandis qu’il est jour, les œuvres de celui qui m’a envoyé; la nuit vient, où personne ne peut travailler.”",
      },
      bible: {
        book: { en: "John", fr: "Jean" },
        chapter: 9,
        verse: 4,
      },
      speakers: [
        {
          id: "-3YbWuMRYEEr5Pd-MLdvP",
          name: { en: "Matt Parra", fr: "Matt Para" },
          activity: { en: "Morning Plenary", fr: "Plénière du matin" },
          photo: {
            key: "2024/speakers/matt.png",
            alt: { en: "Matt Parra", fr: "Matt Para" },
          },
          bio: {
            en: `Matt Parra is the lead Pastor of the Chehalis Seventh day Adentist
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
            fr: `Matt Parra est le pasteur principal de l'église adventiste du septième jour de Chehalis dans la Conférence de Washington. Il a passé 10 ans en Australie où il a été directeur des ministères personnels, de l'évangélisation et de l'école du sabbat pour la Conférence du Nord de la Nouvelle-Galles du Sud. Un des principaux objectifs du ministère de Matt au cours des 20 dernières années a été de fournir des environnements pour les jeunes où ils peuvent grandir dans leur marche avec Christ et témoigner pour Lui. Il a été directeur d'Arise Australia avec ses flux de discipleship accompagnants tels que la formation aux missions locales et Arise for Life. Matt est marié à Sherise Parra et ils ont trois fils et une fille. Matt aime lire, faire du snowboard avec ses garçons, faire de la randonnée avec sa famille, vieillir et enseigner l'écriture.`,
          },
        },
        {
          id: "fk_vA5xNiXblPj040_K4v",
          name: { en: "Alex Niculaescu", fr: "Alex Niculaescu" },
          activity: { en: "Evening Plenary", fr: "Plénière du soir" },
          photo: {
            key: "2024/speakers/alex.jpeg",
            alt: { en: "Alex Niculaescu", fr: "Alex Niculaescu" },
          },
          bio: {
            en: `Alex has worked in various mission fields over the past 13 years and
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
`,
            fr: `Alex a travaillé dans divers champs missionnaires au cours des 13 dernières années et a été introduit à la réalité des formes modernes d'exploitation et d'esclavage en vivant en Afrique de l'Est en 2009. Depuis lors, il a travaillé pour diverses organisations à but non lucratif et ONG et aux côtés de divers organismes gouvernementaux et des forces de l'ordre afin de lutter contre le problème croissant de l'esclavage moderne. Il a depuis ce temps vu de plus en plus le côté spirituel de la question et le déroulement de la grande controverse de manière très réelle et tangible. Il s'est dédié à aider les autres à comprendre la réalité d'une guerre qui passe souvent inaperçue, surtout par ceux qui devraient être les plus engagés dans cette guerre. Il vit actuellement au Michigan avec sa femme et sa fille où il travaille comme pasteur.`,
          },
        },
      ],
      seminars: [
        {
          id: "Vyux3xtt444D6rmd65zv_",
          title: {
            en: "Apologetics Seminar",
            fr: "Séminaire d’apologétique",
          },
          speaker: {
            name: { en: "Andrew Bikichky", fr: "Andrew Bikichky" },
            photo: {
              key: "2024/speakers/andrew.jpg",
              alt: { en: "Andrew Bikichky", fr: "Andrew Bikichky" },
            },
            bio: {
              en: `Andrew Bikichky was raised a 5th generation Seventh-day Adventist. At the age of 16 he left the church to pursue worldly ambitions in the entertainment industry. After spending 25 years as a Hollywood cameraman, he was drawn back by the Holy Spirit to the faith of his childhood, and started working as a Bible Worker, accepting speaking invitations in churches. After living almost 3 decades in the world, the profound truths Andrew rediscovered in the Word of God and the testimony of Jesus Christ captivated his whole being, becoming a burning fire in his heart. Of particular interest in his focus on the great light we've been given about the ministry of Christ in the heavenly sanctuary, and how He is right now seeking to prepare a people to meet Him face to face.`,
              fr: `Andrew Bikichky a été élevé adventiste du septième jour de la cinquième génération. À l'âge de 16 ans, il a quitté l'église pour poursuivre des ambitions mondaines dans l'industrie du divertissement. Après avoir passé 25 ans comme caméraman à Hollywood`,
            },
          },
          description: {
            en: "Seminar Description",
            fr: "Seminar Description",
          },
        },
        {
          id: "SJO06kN7EWW3xhyCZM6kZ",
          title: {
            en: "Personal Study Workshop",
            fr: "Atelier d’étude personnelle",
          },
          speaker: {
            name: { en: "James Niyomugabo", fr: "James Niyomugabo" },
            photo: {
              key: "2024/speakers/james.png",
              alt: { en: "James Niyomugabo", fr: "James Niyomugabo" },
            },
            bio: {
              en: `James Niyomugabo is a dedicated creator coach and entrepreneur aiming to empower 1 million Christian creators, companies, and churches with the Genesis blueprint for creation and operation. He has been an elder at Westminster SDA Church for over three years and serves as a Bible worker at Grace Church Company. James is spearheading a digital evangelism initiative, "This Gospel Must Go Viral," to spread the Gospel globally. He is also the author of “How to Create Like God Does - God’s Success Blueprint for Creators, Companies, and Churches” and leads the "Journal through the Bible in a Year" challenge to inspire deeper engagement with Scripture.`,
              fr: `James Niyomugabo est un coach et entrepreneur créatif dévoué qui vise à autonomiser 1 million de créateurs chrétiens, d'entreprises et d'églises avec le plan de Dieu pour la création et le fonctionnement. Il est ancien de l'église adventiste de Westminster depuis plus de trois ans et sert de travailleur biblique à la Grace Church Company. James est à l'origine d'une initiative d'évangélisation numérique, "This Gospel Must Go Viral", pour diffuser l'Évangile à l'échelle mondiale. Il est également l'auteur de “How to Create Like God Does - God’s Success Blueprint for Creators, Companies, and Churches” et dirige le défi "Journal through the Bible in a Year" pour inspirer un engagement plus profond avec l'Écriture.`,
            },
          },
          description: {
            en: "Seminar Description",
            fr: "Seminar Description",
          },
        },
        {
          id: "UAfLB3DIVvkqs1iLyG7Qo",
          title: {
            en: "Medical Missionary Seminar",
            fr: "Séminaire de mission médicale",
          },
          speaker: {
            name: { en: "Dave Fiedler", fr: "Dave Fiedler" },
            photo: {
              key: "2024/speakers/dave.jpg",
              alt: { en: "Dave Fiedler", fr: "Dave Fiedler" },
            },
            bio: {
              en: `Dave Fiedler has bucked logs, farmed carrots, tomato seed, and hay, run a print shop, been an editor, a classroom teacher (elementary to college), a boys’ dean, a school principal, a vegan restaurant manager, and written five books. His goal and privilege, in print and in person, is to share a vision of Christ’s own approach to the gospel that heals bodies and souls, and will—as surely as it is practiced—end the conflict. Currently, he supports this addiction to teaching, preaching, and writing, by providing IT Services to dentists in “Beautiful British Columbia” where he lives with his wife, Clarissa.`,
              fr: `Dave Fiedler a déplacé des journaux, cultivé des carottes, des graines de tomates et du foin, dirigé une imprimerie, été rédacteur en chef, enseignant en classe (de l'élémentaire à l'université), doyen des garçons, directeur d'école, gérant de restaurant végétalien et écrit cinq livres. Son objectif et son privilège, dans l'impression et en personne, est de partager une vision de l'approche du Christ à l'Évangile qui guérit les corps et les âmes, et qui mettra fin au conflit. Actuellement, il soutient cette addiction à l'enseignement, à la prédication et à l'écriture, en fournissant des services informatiques aux dentistes dans la "belle Colombie-Britannique" où il vit avec sa femme, Clarissa.`,
            },
          },
          description: {
            en: "Seminar Description",
            fr: "Seminar Description",
          },
        },
      ],
      promos: [],
    },

    // -------------------------------------------------------------------
    // 2025 — "A Still Small Voice" (Montreal, QC) — cancelled / archived
    // -------------------------------------------------------------------
    {
      slug: "/2025",
      themeName: {
        en: "A Still Small Voice",
        fr: "Une Voix Douce et Légère",
      },
      accentColor: "#FFD6BA",
      hero: {
        // Per-locale hero art (EN/FR are distinct files on disk); mobile reuses
        // the desktop crop in each locale, exactly as today's data did.
        desktop: {
          key: {
            en: "2025/en/hero-desktop.jpg",
            fr: "2025/fr/hero-desktop.jpg",
          },
          alt: {
            en: "GYC Canada 2025 — A Still Small Voice conference hero",
            fr: "GYC Canada 2025 — bannière de la conférence Une Voix Douce et Légère",
          },
        },
        mobile: {
          key: {
            en: "2025/en/hero-desktop.jpg",
            fr: "2025/fr/hero-desktop.jpg",
          },
          alt: {
            en: "GYC Canada 2025 — A Still Small Voice conference hero",
            fr: "GYC Canada 2025 — bannière de la conférence Une Voix Douce et Légère",
          },
        },
      },
      dates: { start: "2025-08-20", end: "2025-08-24" },
      learnMoreEnabled: false,
      travel: { ...disabledTravelSection },
      parking: { ...disabledParkingSection },
      accommodations: { ...disabledAccommodationsSection },
      meals: { ...disabledMealsSection },
      registrationCopy: { ...disabledRegistrationCopySection },
      faqCopy: {
        enabled: true,
        title: { en: "Got Questions?", fr: "Des questions?" },
        subtitle: {
          en: "We are here to help. Reach out or browse our FAQ.",
          fr: "Nous sommes là pour vous aider. Contactez-nous ou consultez notre FAQ.",
        },
      },
      location: { en: "Montreal, QC", fr: "Montréal, QC" },
      tagline: {
        en: '"And after the earthquake a fire, but the Lord was not in the fire; and after the fire a still small voice."',
        fr: '"Après le tremblement de terre, un feu; mais l’Éternel n’était pas dans le feu. Et après le feu, un murmure doux et léger."',
      },
      bible: {
        book: { en: "1 Kings", fr: "1 Rois" },
        chapter: 19,
        verse: 12,
      },
      speakers: [],
      seminars: [],
      promos: [],
    },

    // -------------------------------------------------------------------
    // 2026 — "Speak" (Calgary, AB) — the return conference
    // -------------------------------------------------------------------
    {
      slug: "/2026",
      themeName: { en: "Speak", fr: "Parle" },
      // Gold/amber accent sampled from the dark SPEAK hero art.
      accentColor: "#EFCB9A",
      hero: {
        // Per-locale hero art (EN/FR are distinct files on disk). Mobile
        // temporarily reuses each locale's landscape desktop image (portrait
        // crop still owed — a product deferral, not a CMS gap).
        desktop: {
          key: {
            en: "2026/en/hero-desktop.png",
            fr: "2026/fr/hero-desktop.png",
          },
          alt: {
            en: "GYC Canada 2026 — Speak conference hero",
            fr: "GYC Canada 2026 — bannière de la conférence Parle",
          },
        },
        mobile: {
          key: {
            en: "2026/en/hero-desktop.png",
            fr: "2026/fr/hero-desktop.png",
          },
          alt: {
            en: "GYC Canada 2026 — Speak conference hero",
            fr: "GYC Canada 2026 — bannière de la conférence Parle",
          },
        },
      },
      dates: { start: "2026-08-05", end: "2026-08-09" },
      // Pricing not set yet — omit `registration` (decodes to `Option.none()`).
      // The return conference carries ONLY its RegFox `registrationUrl` (the live
      // 2026 channel, settled #9) — schedule / map / hotels / speakers are still
      // TBD, so those optional fields are omitted and `hotels` is empty. This sets
      // up Branch 4's skip proof: /2026 renders hero + Register button + FAQ only.
      registrationUrl: "https://gyccanada.regfox.com/gyc-canada-2026-speak",
      learnMoreEnabled: false,
      travel: { ...disabledTravelSection },
      parking: { ...disabledParkingSection },
      accommodations: { ...disabledAccommodationsSection },
      meals: { ...disabledMealsSection },
      registrationCopy: {
        enabled: true,
        title: { en: "Register Now!", fr: "Inscrivez-vous!" },
        subtitle: {
          en: "Registration is now open. Secure your spot today!",
          fr: "Les inscriptions sont ouvertes. Réservez votre place dès aujourd’hui!",
        },
        buttonLabel: { en: "Register Now", fr: "S'inscrire" },
      },
      faqCopy: {
        enabled: true,
        title: { en: "Got Questions?", fr: "Des questions?" },
        subtitle: {
          en: "We are here to help. Reach out or browse our FAQ.",
          fr: "Nous sommes là pour vous aider. Contactez-nous ou consultez notre FAQ.",
        },
      },
      location: {
        en: "Ramada Plaza by Wyndham Calgary Downtown, Calgary, AB",
        fr: "Ramada Plaza by Wyndham Calgary Downtown, Calgary, AB",
      },
      tagline: {
        en: "But the Lord said to me, \"Do not say, 'I am too young.' You must go to everyone I send you to and say whatever I command you.\"",
        fr: "“Et l’Éternel me dit: Ne dis pas: Je suis un enfant. Car tu iras vers tous ceux auprès de qui je t’enverrai, et tu diras tout ce que je t’ordonnerai.”",
      },
      bible: {
        book: { en: "Jeremiah", fr: "Jérémie" },
        chapter: 1,
        verse: 7,
      },
      speakers: [],
      seminars: [],
      promos: [],
    },
  ],

  team: [
    {
      id: "YOQ7GeACwaTCKjY6y3HAV",
      name: "Elijah Duffy",
      position: "team.position.president",
      photo: {
        key: "team/elijah.jpg",
        alt: { en: "Elijah Duffy", fr: "Elijah Duffy" },
      },
    },
    {
      id: "kBrwceJ7qpdDAueUZIAl1",
      name: "Sebastian Elias",
      position: "team.position.vice-president",
      photo: {
        key: "team/sebastian.jpg",
        alt: { en: "Sebastian Elias", fr: "Sebastian Elias" },
      },
    },
    {
      id: "P8lC3_E_SOswzdr0Lt5ES",
      name: "Lillian Wheeler",
      position: "team.position.secretary",
      photo: {
        key: "team/lillian.jpg",
        alt: { en: "Lillian Wheeler", fr: "Lillian Wheeler" },
      },
    },
  ],

  board: [
    { id: deterministicListItemId('board-virginia-polihronova'), name: 'Virginia Polihronova' },
    { id: deterministicListItemId('board-george-cho'), name: 'George Cho' },
    { id: deterministicListItemId('board-dominique-wheeler'), name: 'Dominique Wheeler' },
    { id: deterministicListItemId('board-daniel-cho'), name: 'Daniel Cho' },
    { id: deterministicListItemId('board-craig-cleveland'), name: 'Craig Cleveland' },
    { id: deterministicListItemId('board-rudy-harnisch'), name: 'Rudy Harnisch' },
    { id: deterministicListItemId('board-abubacar-camara'), name: 'Abubacar Camara' },
  ],

  // Spread the live UI translation tables verbatim so the defaults can never
  // drift from the source-of-truth table (`derive-dont-sync`).
  translations: {
    en: { ...root.en },
    fr: { ...root.fr },
  },
});

/**
 * The editor fallback: the same document as `defaultContent`, but decoded through
 * `DraftSiteContent` so optional URL fields are plain `string | undefined` (not
 * `Option`) and the admin loader can encode for the form without a schema mismatch.
 */
export const defaultDraftContent: DraftSiteContent = Schema.decodeUnknownSync(
  DraftSiteContent,
)(Schema.encodeUnknownSync(SiteContent)(defaultContent));
