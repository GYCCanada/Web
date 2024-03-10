import clsx from 'clsx';
import * as React from 'react';
import {
  TextField as RACTextField,
  TextFieldProps,
} from 'react-aria-components';

import { InputVariant } from './input';

const TextField = React.forwardRef<
  HTMLInputElement,
  TextFieldProps & {
    variant?: InputVariant;
  }
>(function TextField({ className, ...props }, ref) {
  return (
    <RACTextField
      {...props}
      ref={ref}
      className={clsx('group flex flex-col gap-2.5', className)}
      data-variant={props.variant}
    />
  );
});

TextField.displayName = 'TextField';

export { TextField };
