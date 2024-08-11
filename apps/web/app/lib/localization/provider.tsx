import { LocalizationContext } from './context';
import type { Translation } from './localization';

export function LocalizationProvider({
  translation,
  children,
}: {
  translation: Translation;
  children: React.ReactNode;
}) {
  return (
    <LocalizationContext.Provider value={translation}>
      {children}
    </LocalizationContext.Provider>
  );
}
