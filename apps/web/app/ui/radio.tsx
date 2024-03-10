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
>(function _RadioGroup({ className, variant = 'negative', ...props }, ref) {
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
      {...props}
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
          'flex rounded-full border-2 px-3 py-1.5 duration-200 data-[focused]:outline-none',
          'data-[selected]:!bg-accent-600 data-[selected]:!text-accent-50',
          'hover:!bg-accent-500 hover:!text-accent-50',
          'data-[pressed]:!bg-accent-400 data-[pressed]:!text-accent-50',
          'group-data-[variant=positive]:border-zinc-50 group-data-[variant=positive]:bg-zinc-950 group-data-[variant=positive]:text-zinc-50',
          'group-data-[variant=negative]:border-zinc-950 group-data-[variant=negative]:bg-zinc-50 group-data-[variant=negative]:text-zinc-950',
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
