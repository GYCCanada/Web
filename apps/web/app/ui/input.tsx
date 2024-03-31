import clsx from 'clsx';
import * as React from 'react';
import { InputProps, Input as RACInput } from 'react-aria-components';

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
      className={clsx(
        'focus:border-b-accent-600 rounded-sm border-b-2 px-6 py-5 text-base placeholder-neutral-400 outline-none duration-200 group-data-[variant="negative"]:bg-neutral-900 group-data-[variant="positive"]:bg-neutral-50 group-data-[variant="negative"]:text-neutral-50 group-data-[variant="positive"]:text-neutral-950',
        variants[variant],
        className,
      )}
    />
  );
});

Input.displayName = 'Input';

export { Input };
