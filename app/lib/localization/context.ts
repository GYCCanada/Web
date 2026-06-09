import { useParams } from '@remix-run/react';
import * as React from 'react';

import { Locale } from './localization';
import type { Translation } from './localization';
import type { TranslationKey } from './translations';

export const LocalizationContext = React.createContext<Translation | undefined>(
  undefined,
);

const interpolationRegex = /{{([^}]+)}}/g;

export function useTranslate(): <Key extends TranslationKey>(
  key: Key,
  params?: Record<string, React.ReactNode>,
) => React.ReactNode {
  const translations = React.useContext(LocalizationContext);
  if (!translations) {
    throw new Error('useTranslate must be used within a LocalizationProvider');
  }

  return (key, params) => {
    if (params) {
      const translated = translations[key] as string;
      const split: React.ReactNode[] = translated.split(interpolationRegex);
      for (const param in params) {
        const index = split.indexOf(param);
        if (index === -1) {
          throw new Error(
            `Parameter "${param}" not found in translation "${key}"`,
          );
        }

        split[index] = params[param];
      }

      return split.map((part, i) =>
        React.isValidElement(part)
          ? React.cloneElement(part, { key: i })
          : part,
      );
    }
    return translations[key] as any;
  };
}

export function useLocale(): Locale {
  const params = useParams();

  return (params.lang || Locale.En) as Locale;
}
