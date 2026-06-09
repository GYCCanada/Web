import clsx from 'clsx';
import * as React from 'react';

export const linkStyle =
  'dark:text-link-500 dark:hover:text-link-600 dark:active:text-link-700 text-link-700 hover:text-link-600 active:text-link-800 duration-200 hover:underline active:underline';

export const ExternalLink = React.forwardRef<
  HTMLAnchorElement,
  React.ComponentProps<'a'>
>(function ExternalLink({ className, ...props }, ref) {
  return (
    <a
      target="_blank"
      rel="noopener noreferrer"
      {...props}
      ref={ref}
      className={clsx(linkStyle, className)}
    />
  );
});
