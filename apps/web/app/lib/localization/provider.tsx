import { LocalizationContext } from './context';
import { Translation } from './localization';

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
