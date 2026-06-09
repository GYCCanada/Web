import clsx from 'clsx';
import * as React from 'react';

import { useTextField } from './text-field';

const base =
  'text-base py-5 px-6 rounded-sm border-b-2 border-transparent outline-none focus:border-b-accent-600 duration-200 placeholder-input-placeholder bg-input-background text-input-foreground';
const variants = {
  positive: 'bg-neutral-50 text-neutral-950',
  negative: 'bg-neutral-900 text-neutral-50',
};

export type InputVariant = keyof typeof variants;

const TextArea = React.forwardRef<
  HTMLTextAreaElement,
  Omit<React.ComponentProps<'textarea'>, 'value' | 'defaultValue' | 'onChange'> & {
    variant?: InputVariant;
  }
>(function TextArea({ className, variant, ...props }, ref) {
  const { meta, control, variant: contextVariant, controlId } = useTextField();
  const resolvedVariant = variant ?? contextVariant ?? 'positive';

  return (
    <textarea
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
      className={clsx(base, variants[resolvedVariant], className)}
    />
  );
});

TextArea.displayName = 'TextArea';

export { TextArea };
