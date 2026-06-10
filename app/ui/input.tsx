import { Input as BaseInput } from '@base-ui/react/input';
import clsx from 'clsx';
import type * as React from 'react';

import { useTextField } from './text-field';

const variants = {
  positive: 'bg-neutral-50 text-neutral-950',
  negative: 'bg-neutral-900 text-neutral-50',
};

export type InputVariant = keyof typeof variants;

function Input({
  className,
  variant,
  ref,
  ...props
}: Omit<BaseInput.Props, 'value' | 'defaultValue' | 'onChange'> & {
  variant?: InputVariant;
  ref?: React.Ref<HTMLInputElement>;
}) {
  const { meta, control, variant: contextVariant, controlId } = useTextField();
  const resolvedVariant = variant ?? contextVariant ?? 'positive';

  return (
    <BaseInput
      id={controlId}
      {...props}
      ref={ref}
      name={meta.name}
      value={(control.value as string) ?? ''}
      onChange={(event) => control.change(event.target.value)}
      onBlur={() => control.blur()}
      onFocus={() => control.focus()}
      aria-invalid={meta.errors && meta.errors.length > 0 ? true : undefined}
      required={meta.required}
      className={clsx(
        'focus:border-b-accent-600 bg-input-background text-input-foreground placeholder-input-placeholder rounded-sm border-b-2 px-6 py-5 text-base outline-none duration-200',
        variants[resolvedVariant],
        className,
      )}
    />
  );
}

export { Input };
