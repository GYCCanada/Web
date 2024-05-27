import {
  Link as LinkComponent,
  LinkProps,
  useLocation,
} from '@remix-run/react';
import * as React from 'react';

import { Locale } from '~/lib/localization/localization';

export const Link = React.forwardRef<HTMLAnchorElement, LinkProps>(
  function Link({ to, ...props }, ref) {
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

    return <LinkComponent to={to} {...props} ref={ref} />;
  },
);
