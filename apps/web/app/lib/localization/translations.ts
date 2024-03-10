import { Translations } from './localization.server';

export const root = {
  en: {
    'nav.home': 'GYC Canada',
    'nav.about': 'Our Story',
    'nav.team': 'Meet the Team',
    'nav.contact': 'Get in Touch',
    'nav.donate': 'Give to the Mission',
    'nav.join': 'Join the Movement',
  },
  fr: {
    'nav.home': 'GYC Canada',
    'nav.about': 'Notre histoire',
    'nav.team': 'Rencontrez l’équipe',
    'nav.contact': 'Entrer en contact',
    'nav.donate': 'Donnez à la mission',
    'nav.join': 'Rejoignez le mouvement',
  },
} as const satisfies Translations;
