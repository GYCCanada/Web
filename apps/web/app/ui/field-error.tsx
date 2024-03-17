import { useTranslate } from '~/lib/localization/context';
import { TranslationKey } from '~/lib/localization/translations';
import { FieldError as RACFieldError } from 'react-aria-components';

export const fieldErrorStyle = 'text-sm text-red-600';

export function FieldError({ children }: { children: React.ReactNode }) {
  return <RACFieldError className={fieldErrorStyle}>{children}</RACFieldError>;
}

export function FieldErrors({ errors }: { errors?: string[] }) {
  const translate = useTranslate();
  if (!errors || errors.length === 0) {
    return null;
  }
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
