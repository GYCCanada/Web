import * as React from 'react';

import { Locale } from './localization';
import { Translation } from './localization.server';
import { root } from './translations';

export const LocalizationContext = React.createContext<Translation | undefined>(
  undefined,
);

export function useTranslate(): <Key extends keyof (typeof root)[Locale]>(
  key: Key,
) => (typeof root)[Locale][Key] {
  const translations = React.useContext(LocalizationContext);
  if (!translations) {
    throw new Error('useTranslate must be used within a LocalizationProvider');
  }

  return <Key extends keyof (typeof root)[Locale]>(key: Key) =>
    translations[key] as (typeof root)[Locale][Key];
}
