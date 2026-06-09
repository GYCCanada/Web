import { Radio as BaseRadio } from '@base-ui/react/radio';
import { RadioGroup as BaseRadioGroup } from '@base-ui/react/radio-group';
import { useField, useInputControl } from '@conform-to/react';
import clsx from 'clsx';
import * as React from 'react';

import type { InputVariant } from './input';
import { TextFieldContext } from './text-field';

function _RadioGroup({
  className,
  variant = 'negative',
  orientation,
  defaultValue,
  value,
  ref,
  ...props
}: Omit<BaseRadioGroup.Props, 'value' | 'defaultValue' | 'onValueChange'> & {
  name?: string;
  variant?: InputVariant;
  orientation?: 'horizontal' | 'vertical';
  defaultValue?: string;
  value?: string;
  ref?: React.Ref<HTMLDivElement>;
}) {
  const [meta] = useField<string | string[]>(props.name ?? '');
  const control = useInputControl(meta);
  const labelId = React.useId();

  return (
    <TextFieldContext.Provider
      value={{
        variant,
        meta,
        control,
        labelId,
      }}
    >
      <BaseRadioGroup
        ref={ref}
        className={clsx('group grid gap-2.5', className)}
        style={{
          gridTemplateAreas: '"label"\n"radio"',
        }}
        data-variant={variant}
        aria-orientation={orientation ?? 'horizontal'}
        aria-labelledby={labelId}
        {...props}
        name={meta.name}
        value={(control.value as string) ?? defaultValue ?? value ?? ''}
        onValueChange={(next) => control.change(next as string)}
        onBlur={() => control.blur()}
        required={meta.required}
      />
    </TextFieldContext.Provider>
  );
}

function Radios({
  children,
  ref,
}: {
  children: React.ReactNode;
  ref?: React.Ref<HTMLDivElement>;
}) {
  return (
    <div
      ref={ref}
      className="flex group-aria-[orientation=horizontal]:flex-row group-aria-[orientation=vertical]:flex-col group-aria-[orientation=horizontal]:gap-4 group-aria-[orientation=vertical]:gap-2.5"
      style={{
        gridArea: 'radio',
      }}
    >
      {children}
    </div>
  );
}

function _Radio({
  className,
  children,
  ref,
  ...props
}: BaseRadio.Root.Props & {
  children?: React.ReactNode;
  ref?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <BaseRadio.Root
      ref={ref}
      className={clsx(
        'bg-radio-background text-radio-foreground border-radio-border flex cursor-pointer rounded-full border-2 px-3 py-1.5 outline-none duration-200',
        'data-[checked]:!bg-accent-600 data-[checked]:!text-accent-50',
        'hover:!bg-accent-500 hover:!text-accent-50',
        'active:bg-accent-400 active:text-accent-50',
        className,
      )}
      {...props}
    >
      {children}
    </BaseRadio.Root>
  );
}

export { _RadioGroup as RadioGroup, _Radio as Radio, Radios };
