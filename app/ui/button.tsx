import { Button as BaseButton } from '@base-ui/react/button';
import clsx from 'clsx';
import * as React from 'react';

export const buttonStyle =
  'text-base uppercase py-5 px-10 font-bold inline-flex items-center justify-center gap-2 border-2 border-transparent focus:outline-none focus:ring-2 focus:ring-offset-2 duration-200 rounded-sm focus:ring-accent-500 ring-offset-background bg-accent-600 text-accent-50 hover:bg-accent-700 data-[pressed]:bg-accent-500' +
  ' ' +
  'data-[variant=accent]:bg-accent-600 data-[variant=accent]:text-accent-50 data-[variant=accent]:hover:bg-accent-700 data-[variant=accent]:data-[pressed]:bg-accent-500 data-[variant=accent]:active:bg-accent-500' +
  ' ' +
  'data-[variant=default]:bg-button-background data-[variant=default]:text-button-foreground data-[variant=default]:hover:bg-button-background-hover data-[variant=default]:data-[pressed]:bg-button-background-active data-[variant=default]:active:bg-button-background-active';

export type ButtonVariant = 'accent' | 'default';

const Button = React.forwardRef<
  HTMLButtonElement,
  BaseButton.Props & {
    variant?: ButtonVariant;
  }
>(({ variant = 'accent', className = '', ...props }, ref) => {
  return (
    <BaseButton
      {...props}
      ref={ref}
      className={clsx(buttonStyle, className)}
      data-variant={variant}
    />
  );
});

Button.displayName = 'Button';

export { Button };
