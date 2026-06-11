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

function TextArea({
  className,
  variant,
  ref,
  ...props
}: Omit<
  React.ComponentProps<'textarea'>,
  'value' | 'defaultValue' | 'onChange'
> & {
  variant?: InputVariant;
  ref?: React.Ref<HTMLTextAreaElement>;
}) {
  const { meta, control, variant: contextVariant, controlId } = useTextField();
  const resolvedVariant = variant ?? contextVariant ?? 'positive';

  // The native textarea *is* conform's base control: `control.register` wires it
  // so the submitted FormData carries this field's value and validation tracks it.
  const setRef = React.useCallback(
    (element: HTMLTextAreaElement | null) => {
      control.register(element);
      if (typeof ref === 'function') ref(element);
      else if (ref) ref.current = element;
    },
    [control, ref],
  );

  return (
    <textarea
      id={controlId}
      defaultValue={meta.defaultValue}
      {...props}
      ref={setRef}
      name={meta.name}
      aria-invalid={meta.ariaInvalid}
      required={meta.required}
      className={clsx(base, variants[resolvedVariant], className)}
    />
  );
}

export { TextArea };
