import clsx from 'clsx';
import * as React from 'react';
import { InputProps, Input as RACInput } from 'react-aria-components';

const base =
  'text-base py-5 px-6 rounded-sm border-2 border-transparent focus:outline-none focus:border-b-accent-600 duration-200 placeholder-neutral-400 group-data-[variant="positive"]:text-neutral-950 group-data-[variant="negative"]:text-neutral-50 group-data-[variant="positive"]:bg-neutral-50 group-data-[variant="negative"]:bg-neutral-900';
const variants = {
  positive: 'bg-neutral-50 text-neutral-950',
  negative: 'bg-neutral-900 text-neutral-50',
};

export type InputVariant = keyof typeof variants;

const Input = React.forwardRef<
  HTMLInputElement,
  InputProps & {
    variant?: InputVariant;
  }
>(function Input({ className, variant = 'positive', ...props }, ref) {
  return (
    <RACInput
      {...props}
      ref={ref}
      className={clsx(base, variants[variant], className)}
    />
  );
});

Input.displayName = 'Input';

export { Input };
