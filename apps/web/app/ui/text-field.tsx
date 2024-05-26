import { FieldMetadata, useField, useInputControl } from '@conform-to/react';
import clsx from 'clsx';
import * as React from 'react';
import {
  TextField as RACTextField,
  TextFieldProps,
} from 'react-aria-components';

import { Input, InputVariant } from './input';
import { TextArea } from './text-area';

export type TextFieldContextValue = {
  variant?: InputVariant;
  meta: FieldMetadata;
  control: ReturnType<typeof useInputControl>;
};

export const TextFieldContext = React.createContext<
  TextFieldContextValue | undefined
>(undefined);

export function useTextField() {
  const context = React.useContext(TextFieldContext);
  if (!context) {
    throw new Error('useTextField must be used within a TextFieldProvider');
  }
  return context;
}

const _TextField = React.forwardRef<
  HTMLInputElement,
  TextFieldProps & {
    variant?: InputVariant;
  }
>(function TextField({ className, ...props }, ref) {
  const [meta] = useField(props.name ?? '');
  const control = useInputControl(meta as any);

  return (
    <TextFieldContext.Provider
      value={{ variant: props.variant, meta, control }}
    >
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
    </TextFieldContext.Provider>
  );
});

_TextField.displayName = 'TextField';

export const TextField = Object.assign(_TextField, {
  Input: Input,
  TextArea: TextArea,
});
