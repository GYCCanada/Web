import { Params, redirect } from '@remix-run/react';

import { Locale } from './localization';

export type Translations = {
  [key in Locale]: Translation;
};

export type Translation = Record<string, string>;

export const RootTranslations = {
  en: {},
  fr: {},
} satisfies Translations;

// matches {{ key }} in a string
export const interpolationRegex = /{{\s*([^}\s]+)\s*}}/g;

export const interpolate = (str: string, values: Record<string, string>) => {
  return str.replace(interpolationRegex, (match, group) => {
    return values[group] || match;
  });
};

const isValidLocale = (locale: string): locale is Locale => {
  //@ts-expect-error - we're checking if the value is in the enum
  return Object.values(Locale).includes(locale);
};

export const getTranslation = <T extends Translations>(
  params: Params,
  translations: T,
): {
  lang: Locale;
  translation: T[Locale];
} => {
  const lang = (params.lang || Locale.En) as Locale;
  if (!isValidLocale(lang)) {
    throw redirect('/');
  }

  return { lang, translation: translations[lang] };
};
