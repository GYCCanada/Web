import { Link as LinkComponent, useLocation } from 'react-router';
import type { LinkProps } from 'react-router';
import type * as React from 'react';

import { Locale } from '~/lib/localization/localization';

// React 19: `ref` is a regular prop — no `forwardRef`. RR7's `LinkProps`
// extends AnchorHTMLAttributes, which does not include `ref`, so it is added
// explicitly here.
export function Link({
  to,
  ref,
  ...props
}: LinkProps & { ref?: React.Ref<HTMLAnchorElement> }) {
  const location = useLocation();
  // we want to augment the `to` prop to include the current locale
  const splitPathName = location.pathname.split('/');
  const locale = splitPathName.find((part) =>
    Object.values(Locale).includes(part as Locale),
  );
  if (locale) {
    if (typeof to === 'string' && !to.includes(locale) && to !== '/') {
      to = `/${locale}${to}`;
    } else if (
      typeof to === 'object' &&
      to.pathname &&
      !to.pathname.includes(locale)
    ) {
      to = { ...to, pathname: `/${locale}${to.pathname}` };
    }
  }

  return (
    <LinkComponent
      to={to}
      {...props}
      ref={ref}
    />
  );
}
