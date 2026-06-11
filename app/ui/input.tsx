import { Input as BaseInput } from '@base-ui/react/input';
import clsx from 'clsx';
import * as React from 'react';

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

  // The native input *is* conform's base control: `control.register` wires it so
  // the submitted FormData carries this field's value and validation tracks it.
  const setRef = React.useCallback(
    (element: HTMLInputElement | null) => {
      control.register(element);
      if (typeof ref === 'function') ref(element);
      else if (ref) ref.current = element;
    },
    [control, ref],
  );

  return (
    <BaseInput
      id={controlId}
      defaultValue={meta.defaultValue}
      {...props}
      ref={setRef}
      name={meta.name}
      aria-invalid={meta.ariaInvalid}
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
