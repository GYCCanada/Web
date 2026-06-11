import { Select as BaseSelect } from '@base-ui/react/select';
import clsx from 'clsx';
import { Check, ChevronDown } from 'lucide-react';
import * as React from 'react';

import { useControl, useField } from '~/lib/conform';

import { TextFieldContext } from './text-field';

const _Select = <Value, Multiple extends boolean | undefined = false>(
  props: BaseSelect.Root.Props<Value, Multiple>,
) => {
  const name = typeof props.name === 'string' ? props.name : '';
  const meta = useField<string | string[]>(name);
  const control = useControl<string | string[]>({
    defaultValue: meta.defaultValue,
  });
  return (
    <TextFieldContext.Provider value={{ meta, control }}>
      {/* Hidden base control: conform reads the submitted value here and
          `control.change` keeps it in sync with the Base UI select. */}
      {name ? (
        <input
          ref={control.register}
          name={meta.name}
          defaultValue={meta.defaultValue}
          hidden
          aria-hidden
        />
      ) : null}
      <BaseSelect.Root
        {...props}
        name={undefined}
        onValueChange={(value, eventDetails) => {
          if (name) control.change(value == null ? null : String(value));
          props.onValueChange?.(value, eventDetails);
        }}
      />
    </TextFieldContext.Provider>
  );
};

const SelectGroup = BaseSelect.Group;

const _SelectValue = ({ className, ...props }: BaseSelect.Value.Props) => (
  <BaseSelect.Value
    className={clsx('data-[placeholder]:text-muted-foreground', className)}
    {...props}
  />
);

const SelectTrigger = ({
  className,
  children,
  ...props
}: BaseSelect.Trigger.Props) => (
  <BaseSelect.Trigger
    className={clsx(
      'border-input bg-background ring-offset-background data-[focused]:ring-ring flex h-10 w-full items-center justify-between rounded-md border px-3 py-2 text-sm data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[focused]:outline-none data-[focused]:ring-2 data-[focused]:ring-offset-2',
      className,
    )}
    {...props}
  >
    {children}
    <BaseSelect.Icon
      render={
        <ChevronDown
          aria-hidden="true"
          className="size-4 opacity-50"
        />
      }
    />
  </BaseSelect.Trigger>
);

const SelectHeader = ({
  className,
  ...props
}: BaseSelect.GroupLabel.Props) => (
  <BaseSelect.GroupLabel
    className={clsx('py-1.5 pl-8 pr-2 text-sm font-semibold', className)}
    {...props}
  />
);

const SelectItem = ({
  className,
  children,
  ...props
}: BaseSelect.Item.Props) => (
  <BaseSelect.Item
    className={clsx(
      'data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      className,
    )}
    {...props}
  >
    <BaseSelect.ItemIndicator
      render={
        <span className="absolute left-2 flex size-4 items-center justify-center">
          <Check className="size-4" />
        </span>
      }
    />
    <BaseSelect.ItemText>{children}</BaseSelect.ItemText>
  </BaseSelect.Item>
);

const SelectSeparator = ({
  className,
  ...props
}: BaseSelect.Separator.Props) => (
  <BaseSelect.Separator
    className={clsx('bg-muted -mx-1 my-1 h-px', className)}
    {...props}
  />
);

const SelectContent = ({
  className,
  children,
  ...props
}: BaseSelect.Popup.Props) => (
  <BaseSelect.Portal>
    <BaseSelect.Positioner sideOffset={0}>
      <BaseSelect.Popup
        className={clsx(
          'bg-popover text-popover-foreground data-[open]:animate-in data-[closed]:animate-out data-[open]:fade-in-0 data-[closed]:fade-out-0 data-[closed]:zoom-out-95 relative z-50 min-w-32 overflow-y-auto rounded-md border shadow-md',
          className,
        )}
        {...props}
      >
        <BaseSelect.List className="p-1">{children}</BaseSelect.List>
      </BaseSelect.Popup>
    </BaseSelect.Positioner>
  </BaseSelect.Portal>
);

export const Select = Object.assign(_Select, {
  Content: SelectContent,
  Group: SelectGroup,
  Header: SelectHeader,
  Item: SelectItem,
  Separator: SelectSeparator,
  Trigger: SelectTrigger,
  Value: _SelectValue,
});
