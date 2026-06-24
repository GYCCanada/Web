/**
 * Disabled-by-default conference section shapes for backfill and bundled defaults.
 * Placeholder copy satisfies strict `Text` (both locales non-empty) while sections
 * remain invisible until `enabled: true` in CMS.
 */

const placeholder = { en: '—', fr: '—' } as const;

export const disabledTravelSection = {
  enabled: false,
  headerCopy: { en: 'Travel', fr: 'Voyage' },
} as const;

export const disabledParkingSection = {
  enabled: false,
  headerCopy: { en: 'Parking', fr: 'Stationnement' },
  options: [],
} as const;

export const disabledAccommodationsSection = {
  enabled: false,
  headerCopy: { en: 'Accommodations', fr: 'Hébergement' },
  hotels: [],
} as const;

export const disabledMealsSection = {
  enabled: false,
  headerCopy: { en: 'Meals', fr: 'Repas' },
  bodyCopy: placeholder,
  items: [],
} as const;

export const disabledRegistrationCopySection = {
  enabled: false,
  title: { en: 'Register Now!', fr: 'Inscrivez-vous!' },
  subtitle: {
    en: 'Registration is now open. Secure your spot today!',
    fr: 'Les inscriptions sont ouvertes. Réservez votre place dès aujourd’hui!',
  },
  buttonLabel: { en: 'Register Now', fr: "S'inscrire" },
} as const;

export const disabledFaqCopySection = {
  enabled: false,
  title: { en: 'Got Questions?', fr: 'Des questions?' },
  subtitle: {
    en: 'We are here to help. Reach out or browse our FAQ.',
    fr: 'Nous sommes là pour vous aider. Contactez-nous ou consultez notre FAQ.',
  },
} as const;
