import * as React from 'react';

import { Locale, Translation } from './localization.server';
import { root } from './translations';

export const LocalizationContext = React.createContext<Translation | undefined>(
  undefined,
);

export function useTranslate<Key extends keyof (typeof root)[Locale]>(
  key: Key,
): (typeof root)[Locale][Key] {
  const translations = React.useContext(LocalizationContext);
  if (!translations) {
    throw new Error('useTranslate must be used within a LocalizationProvider');
  }

  return translations[key] as (typeof root)[Locale][Key];
}
