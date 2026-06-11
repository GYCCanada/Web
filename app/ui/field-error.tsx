import { useTranslate } from '~/lib/localization/context';
import type { TranslationKey } from '~/lib/localization/translations';

import { useTextField } from './text-field';

export const fieldErrorStyle = 'text-sm text-red-600';

export function FieldError({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={fieldErrorStyle}
      role="alert"
    >
      {children}
    </div>
  );
}

export function FieldErrors() {
  const translate = useTranslate();
  const { meta } = useTextField();
  const errors = meta.errors as string[] | undefined;

  if (!errors || errors.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      {errors.map((error) => (
        <FieldError key={error}>
          {translate(error as TranslationKey)}
        </FieldError>
      ))}
    </div>
  );
}
