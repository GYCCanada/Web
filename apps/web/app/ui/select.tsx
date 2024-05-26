import { useField, useInputControl } from '@conform-to/react';
import clsx from 'clsx';
import { Check, ChevronDown } from 'lucide-react';
import {
  Button,
  ButtonProps,
  Collection,
  Header,
  ListBox,
  ListBoxItem,
  ListBoxItemProps,
  ListBoxProps,
  Popover,
  PopoverProps,
  Select as RACSelect,
  Section,
  SelectProps,
  SelectValue,
  SelectValueProps,
  Separator,
  SeparatorProps,
} from 'react-aria-components';

import { TextFieldContext } from './text-field';

const _Select = <T extends object>(props: SelectProps<T>) => {
  const [meta] = useField(props.name ?? '');
  const control = useInputControl(meta as any);
  return (
    <TextFieldContext.Provider value={{ meta, control }}>
      <RACSelect<T> {...props} />;
    </TextFieldContext.Provider>
  );
};

const SelectSection = Section;

const SelectCollection = Collection;

const _SelectValue = <T extends object>({
  className,
  ...props
}: SelectValueProps<T>) => (
  <SelectValue
    className={(values) =>
      clsx(
        'data-[placeholder]:text-muted-foreground',
        typeof className === 'function' ? className(values) : className,
      )
    }
    {...props}
  />
);

const SelectTrigger = ({ className, children, ...props }: ButtonProps) => (
  <Button
    className={(values) =>
      clsx(
        'border-input bg-background ring-offset-background data-[focused]:ring-ring flex h-10 w-full items-center justify-between rounded-md border px-3 py-2 text-sm data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[focused]:outline-none data-[focused]:ring-2 data-[focused]:ring-offset-2',
        typeof className === 'function' ? className(values) : className,
      )
    }
    {...props}
  >
    {(values) => (
      <>
        {typeof children === 'function' ? children(values) : children}
        <ChevronDown aria-hidden="true" className="h-4 w-4 opacity-50" />
      </>
    )}
  </Button>
);

const SelectHeader = ({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof Header>) => (
  <Header
    className={clsx(' py-1.5 pl-8 pr-2 text-sm font-semibold', className)}
    {...props}
  />
);

const SelectItem = ({ className, children, ...props }: ListBoxItemProps) => (
  <ListBoxItem
    className={(values) =>
      clsx(
        'data-[focused]:bg-accent data-[focused]:text-accent-foreground relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        typeof className === 'function' ? className(values) : className,
      )
    }
    {...props}
  >
    {(values) => (
      <>
        {values.isSelected && (
          <span className="absolute left-2 flex h-4 w-4 items-center justify-center">
            <Check className="h-4 w-4" />
          </span>
        )}
        {typeof children === 'function' ? children(values) : children}
      </>
    )}
  </ListBoxItem>
);

const SelectSeparator = ({ className, ...props }: SeparatorProps) => (
  <Separator
    className={clsx('bg-muted -mx-1 my-1 h-px', className)}
    {...props}
  />
);

const SelectPopover = ({ className, offset = 0, ...props }: PopoverProps) => (
  <Popover
    offset={offset}
    className={(values) =>
      clsx(
        'bg-popover text-popover-foreground data-[entering]:animate-in  data-[exiting]:animate-out data-[entering]:fade-in-0 data-[exiting]:fade-out-0 data-[exiting]:zoom-out-95 data-[placement=bottom]:slide-in-from-top-2 data-[placement=left]:slide-in-from-right-2 data-[placement=right]:slide-in-from-left-2 data-[placement=top]:slide-in-from-bottom-2 relative z-50 w-[--trigger-width] min-w-[8rem] overflow-y-auto rounded-md border shadow-md',
        'data-[placement=bottom]:translate-y-1 data-[placement=left]:-translate-x-1 data-[placement=right]:translate-x-1 data-[placement=top]:-translate-y-1',
        typeof className === 'function' ? className(values) : className,
      )
    }
    {...props}
  />
);

const SelectContent = <T extends object>({
  className,
  ...props
}: ListBoxProps<T>) => (
  <ListBox
    className={(values) =>
      clsx(
        'p-1',
        typeof className === 'function' ? className(values) : className,
      )
    }
    {...props}
  />
);

export const Select = Object.assign(_Select, {
  Collection: SelectCollection,
  Content: SelectContent,
  Header: SelectHeader,
  Item: SelectItem,
  Popover: SelectPopover,
  Section: SelectSection,
  Separator: SelectSeparator,
  Trigger: SelectTrigger,
  Value: _SelectValue,
});
