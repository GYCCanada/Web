import { useField, useInputControl } from '@conform-to/react';
import clsx from 'clsx';
import * as React from 'react';
import {
  Radio,
  RadioGroup,
  RadioGroupProps,
  RadioProps,
} from 'react-aria-components';

import { InputVariant } from './input';

const _RadioGroup = React.forwardRef<
  HTMLDivElement,
  RadioGroupProps & {
    variant?: InputVariant;
  }
>(function _RadioGroup(
  { className, variant = 'negative', orientation, ...props },
  ref,
) {
  const [meta] = useField(props.name ?? '');
  const control = useInputControl(meta as any);
  return (
    <RadioGroup
      ref={ref}
      className={(values) =>
        clsx(
          'group grid gap-2.5',
          typeof className === 'function' ? className(values) : className,
        )
      }
      style={{
        gridTemplateAreas: '"label"\n"radio"',
      }}
      data-variant={variant}
      orientation={orientation ? orientation : 'horizontal'}
      {...props}
      name={meta.name}
      value={(control.value as any) ?? props.defaultValue ?? props.value}
      onChange={control.change}
      onBlur={control.blur}
      isInvalid={meta.errors && meta.errors.length > 0}
      isRequired={meta.required}
    />
  );
});
_RadioGroup.displayName = 'RadioGroup';

const Radios = React.forwardRef<HTMLDivElement, { children: React.ReactNode }>(
  function Radios({ children }, ref) {
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
  },
);

Radios.displayName = 'Radios';

const _Radio = React.forwardRef<HTMLLabelElement, RadioProps>(function _Radio(
  { className, children, ...props },
  ref,
) {
  return (
    <Radio
      ref={ref}
      className={(values) =>
        clsx(
          'bg-radio-background text-radio-foreground border-radio-border flex cursor-pointer rounded-full border-2 px-3 py-1.5 outline-none duration-200',
          'data-[selected]:!bg-accent-600 data-[selected]:!text-accent-50',
          'hover:!bg-accent-500 hover:!text-accent-50',
          'data-[pressed]:bg-accent-400 data-[pressed]:text-accent-50',
          typeof className === 'function' ? className(values) : className,
        )
      }
      {...props}
    >
      {(values) => (
        <>{typeof children === 'function' ? children(values) : children}</>
      )}
    </Radio>
  );
});

export { _RadioGroup as RadioGroup, _Radio as Radio, Radios };
