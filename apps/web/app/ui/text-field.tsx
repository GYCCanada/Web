import { useField, useInputControl } from '@conform-to/react';
import clsx from 'clsx';
import * as React from 'react';
import {
  TextField as RACTextField,
  TextFieldProps,
} from 'react-aria-components';

import { Input, InputVariant } from './input';
import { Label } from './label';
import { TextArea } from './text-area';

const _TextField = React.forwardRef<
  HTMLInputElement,
  TextFieldProps & {
    variant?: InputVariant;
  }
>(function TextField({ className, ...props }, ref) {
  const [meta] = useField(props.name ?? '');
  const control = useInputControl(meta as any);

  return (
    <RACTextField
      {...props}
      name={meta.name}
      value={
        (control.value as string) ?? props.defaultValue ?? props.value ?? ''
      }
      onChange={(value) => control.change(value)}
      onBlur={control.blur}
      isInvalid={meta.errors && meta.errors.length > 0}
      isRequired={meta.required}
      ref={ref}
      className={clsx('group flex flex-col gap-2.5', className)}
      data-variant={props.variant}
    />
  );
});

_TextField.displayName = 'TextField';

export const TextField = Object.assign(_TextField, {
  Input: Input,
  TextArea: TextArea,
  Label: Label,
});
