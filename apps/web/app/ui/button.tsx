import clsx from 'clsx';
import * as React from 'react';
import { ButtonProps, Button as RACButton } from 'react-aria-components';

const base =
  'text-base uppercase py-5 px-10 font-bold inline-flex items-center justify-center gap-2 border-2 border-transparent focus:outline-none focus:ring-2 focus:ring-offset-2 duration-200 rounded-sm focus:ring-accent-500 ring-offset-background';
const variants = {
  accent:
    'bg-accent-600 text-accent-50 hover:bg-accent-700 data-[pressed]:bg-accent-500',
  positive:
    'bg-neutral-50 text-neutral-950 hover:bg-neutral-200 data-[pressed]:bg-neutral-300',
  negative:
    'bg-neutral-900 text-neutral-50 hover:bg-neutral-800 data-[pressed]:bg-neutral-700',
} as const;

export type ButtonVariant = keyof typeof variants;

const Button = React.forwardRef<
  HTMLButtonElement,
  ButtonProps & {
    variant?: ButtonVariant;
    disabled?: boolean;
  }
>(
  (
    { variant = 'accent', className = '', disabled, isDisabled, ...props },
    ref,
  ) => {
    return (
      <RACButton
        {...props}
        ref={ref}
        isDisabled={disabled || isDisabled}
        className={clsx(base, variants[variant], className)}
      />
    );
  },
);

Button.displayName = 'Button';

export { Button };
