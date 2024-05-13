import { Params, redirect } from '@remix-run/react';

import { root } from './translations';

export const Locale = {
  En: 'en',
  Fr: 'fr',
} as const;
export type Locale = (typeof Locale)[keyof typeof Locale];

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

export function assertValidLocale(locale: string): asserts locale is Locale {
  //@ts-expect-error - we're checking if the value is in the enum
  if (!Object.values(Locale).includes(locale)) {
    throw redirect('/');
  }
}

export const getTranslation = <T extends Translations>(
  params: Params,
  translations: T,
): {
  lang: Locale;
  translation: T[Locale];
} => {
  const lang = (params.lang || Locale.En) as Locale;
  assertValidLocale(lang);
  return { lang, translation: translations[lang] };
};

export const getLocale = (params: Params): Locale => {
  const lang = (params.lang || Locale.En) as Locale;
  assertValidLocale(lang);
  return lang;
};

export const translate = <L extends Locale, Key extends keyof (typeof root)[L]>(
  locale: L,
  key: Key,
  params?: Record<string, string>,
) => {
  const translation = root[locale][key] as string;
  if (params) {
    return translation.replace(interpolationRegex, (match, group) => {
      return params[group] || match;
    });
  }
  return translation;
};
