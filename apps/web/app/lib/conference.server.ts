import { match } from 'ts-pattern';

import { Locale } from './localization/localization';
import { assertValidLocale } from './localization/localization.server';

export type Conference = {
  year: number;
  name: string;
};

export const getCurrentConference = (locale: Locale): Conference => {
  assertValidLocale(locale);
  return match(locale)
    .with('en', () => ({
      year: 2024,
      name: 'While It Is Day',
    }))
    .with('fr', () => ({
      year: 2024,
      name: "Tant qu'il fait jour",
    }))
    .exhaustive();
};
