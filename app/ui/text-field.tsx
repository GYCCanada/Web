import type { Control, FieldMetadata } from '@conform-to/react/future';
import clsx from 'clsx';
import * as React from 'react';

import { useControl, useField } from '~/lib/conform';

import { Input } from './input';
import type { InputVariant } from './input';
import { TextArea } from './text-area';

export type TextFieldContextValue = {
  variant?: InputVariant;
  meta: FieldMetadata<string | string[]>;
  control: Control<string | string[]>;
  /**
   * Shared id linking the field's `<label htmlFor>` to its control. Present for
   * single-control fields (text input / textarea / select); absent for grouped
   * controls (radio / checkbox groups), which use {@link labelId} instead.
   */
  controlId?: string;
  /**
   * Shared id stamped onto the field's `<label>` so a grouped control can wire
   * its accessible name via `aria-labelledby`. base-ui's RadioGroup/CheckboxGroup
   * do not discover a plain native `<label>` the way React Aria's `<Label>` did,
   * so the group must reference the label id explicitly.
   */
  labelId?: string;
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

function _TextField({
  className,
  name,
  variant,
  children,
  ref,
  ...props
}: Omit<React.ComponentProps<'div'>, 'children'> & {
  name?: string;
  variant?: InputVariant;
  children?: React.ReactNode;
  ref?: React.Ref<HTMLDivElement>;
}) {
  const meta = useField<string | string[]>(name ?? '');
  const control = useControl<string | string[]>({
    defaultValue: meta.defaultValue,
  });
  const controlId = React.useId();
  const labelId = React.useId();

  return (
    <TextFieldContext.Provider
      value={{ variant, meta, control, controlId, labelId }}
    >
      <div
        {...props}
        ref={ref}
        className={clsx('group flex flex-col gap-2.5', className)}
        data-variant={variant}
      >
        {children}
      </div>
    </TextFieldContext.Provider>
  );
}

export const TextField = Object.assign(_TextField, {
  Input: Input,
  TextArea: TextArea,
});
