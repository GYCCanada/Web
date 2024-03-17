/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useParams } from '@remix-run/react';
import * as React from 'react';

import { Locale } from './localization';
import { Translation } from './localization.server';
import { root, TranslationKey } from './translations';

export const LocalizationContext = React.createContext<Translation | undefined>(
  undefined,
);

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
      const result: any[] = [];
      for (const param in params) {
        const index = translated.indexOf(`{{${param}}}`);
        if (index === -1) {
          throw new Error(
            `Parameter "${param}" not found in translation "${key}"`,
          );
        }
        const [head, tail] = translated.split(`{{${param}}}`);

        return [head, (params as any)[param], tail].map((part, i) =>
          React.isValidElement(part)
            ? React.cloneElement(part, { key: i })
            : part,
        );
      }
      return result;
    }
    return translations[key] as any;
  };
}

export function useLocale(): Locale {
  const params = useParams();

  return (params.lang || Locale.En) as Locale;
}
