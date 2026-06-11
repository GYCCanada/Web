import { Checkbox as BaseCheckbox } from '@base-ui/react/checkbox';
import { CheckboxGroup as BaseCheckboxGroup } from '@base-ui/react/checkbox-group';
import clsx from 'clsx';
import { Check, Minus } from 'lucide-react';
import * as React from 'react';

import { useControl, useField } from '~/lib/conform';

import { labelStyles } from './label';
import { TextFieldContext } from './text-field';

const _CheckboxGroup = ({
  className,
  variant = 'negative',
  orientation,
  defaultValue,
  value,
  name,
  ...props
}: Omit<BaseCheckboxGroup.Props, 'value' | 'defaultValue' | 'onValueChange'> & {
  name?: string;
  variant?: 'negative' | 'positive';
  orientation?: 'horizontal' | 'vertical';
  defaultValue?: string[];
  value?: string[];
}) => {
  const meta = useField<string | string[]>(name ?? '');
  const initial =
    meta.defaultOptions.length > 0
      ? meta.defaultOptions
      : (defaultValue ?? value ?? []);
  const control = useControl<string | string[]>({ defaultValue: initial });
  const labelId = React.useId();
  // Register the rendered hidden checkboxes as a same-name collection so conform
  // reads the submitted values and `control.change` checks/unchecks them.
  const collectionRef = React.useRef<HTMLDivElement>(null);
  const selected = control.options ?? initial;

  React.useEffect(() => {
    const inputs = collectionRef.current?.querySelectorAll('input');
    control.register(inputs && inputs.length > 0 ? inputs : null);
  });

  return (
    <TextFieldContext.Provider
      value={{
        meta,
        control,
        labelId,
      }}
    >
      <BaseCheckboxGroup
        className={clsx('group grid gap-2.5', className)}
        style={{
          gridTemplateAreas: '"label"\n"radio"',
        }}
        data-variant={variant}
        data-orientation={orientation}
        aria-orientation={orientation}
        aria-labelledby={labelId}
        {...props}
        value={selected}
        onValueChange={(next) => control.change(next)}
      />
      {/* conform reads the submitted value from native inputs; mirror the
          selected values as registered hidden checkboxes under the field name. */}
      <div
        ref={collectionRef}
        hidden
      >
        {selected.map((v) => (
          <input
            key={v}
            type="checkbox"
            name={meta.name}
            value={v}
            defaultChecked
          />
        ))}
      </div>
    </TextFieldContext.Provider>
  );
};

const _Checkbox = ({
  className,
  children,
  name,
  ...props
}: BaseCheckbox.Root.Props & { children?: React.ReactNode; name?: string }) => {
  const meta = useField<string | string[]>(name ?? '');
  const control = useControl({
    defaultChecked: meta.defaultChecked,
    value: typeof props.value === 'string' ? props.value : undefined,
  });

  return (
    <>
      {/* Single boolean checkbox: the hidden checkbox is the base control conform
          reads; `control.change` mirrors the Base UI checkbox's checked state. */}
      {name ? (
        <input
          ref={control.register}
          type="checkbox"
          name={meta.name}
          hidden
          aria-hidden
        />
      ) : null}
      <BaseCheckbox.Root
        className={clsx(
          'group flex items-center gap-x-2 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
          labelStyles,
          className,
        )}
        {...props}
        checked={name ? control.checked : props.checked}
        onCheckedChange={(checked, event) => {
          if (name) control.change(checked);
          props.onCheckedChange?.(checked, event);
        }}
      >
        <span
          className={clsx(
            'border-input ring-offset-background group-data-[focused]:ring-ring inline-flex size-8 shrink-0 items-center justify-center rounded-sm border group-data-[focused]:outline-none group-data-[focused]:ring-2 group-data-[focused]:ring-offset-2',
            'group-data-[indeterminate]:bg-primary group-data-[indeterminate]:text-primary-foreground',
            'group-data-[checked]:bg-primary group-data-[checked]:text-primary-foreground',
          )}
        >
          <Minus className="hidden size-6 group-data-[indeterminate]:block" />
          <Check className="hidden size-6 group-data-[checked]:block group-data-[indeterminate]:hidden" />
        </span>
        {children}
      </BaseCheckbox.Root>
    </>
  );
};

const Checkboxes = ({ children }: { children: React.ReactNode }) => (
  <div className="flex group-data-[orientation=horizontal]:flex-row group-data-[orientation=vertical]:flex-col group-data-[orientation=horizontal]:gap-4 group-data-[orientation=vertical]:gap-2.5">
    {children}
  </div>
);

export { _Checkbox as Checkbox, _CheckboxGroup as CheckboxGroup, Checkboxes };
