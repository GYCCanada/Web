import clsx from 'clsx';
import * as React from 'react';
import { ButtonProps, Button as RACButton } from 'react-aria-components';

export const buttonStyle =
  'text-base uppercase py-5 px-10 font-bold inline-flex items-center justify-center gap-2 border-2 border-transparent focus:outline-none focus:ring-2 focus:ring-offset-2 duration-200 rounded-sm focus:ring-accent-500 ring-offset-background bg-accent-600 text-accent-50 hover:bg-accent-700 data-[pressed]:bg-accent-500' +
  ' ' +
  'data-[variant=accent]:bg-accent-600 data-[variant=accent]:text-accent-50 data-[variant=accent]:hover:bg-accent-700 data-[variant=accent]:data-[pressed]:bg-accent-500 data-[variant=accent]:active:bg-accent-500' +
  ' ' +
  'data-[variant=positive]:bg-neutral-50 data-[variant=positive]:text-neutral-950 data-[variant=positive]:hover:bg-neutral-200 data-[variant=positive]:data-[pressed]:bg-neutral-300 data-[variant=positive]:active:bg-neutral-300' +
  ' ' +
  'data-[variant=negative]:bg-neutral-900 data-[variant=negative]:text-neutral-50 data-[variant=negative]:hover:bg-neutral-800 data-[variant=negative]:data-[pressed]:bg-neutral-700 data-[variant=negative]:active:bg-neutral-700';

export type ButtonVariant = 'accent' | 'positive' | 'negative';

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
        className={clsx(buttonStyle, className)}
        data-variant={variant}
      />
    );
  },
);

Button.displayName = 'Button';

export { Button };
