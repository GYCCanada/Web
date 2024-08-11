import { useField, useInputControl } from '@conform-to/react';
import clsx from 'clsx';
import { Check, Minus } from 'lucide-react';
import {
	
	
	Checkbox as RACCheckbox,
	CheckboxGroup as RACCheckboxGroup
} from 'react-aria-components';
import type {CheckboxGroupProps, CheckboxProps} from 'react-aria-components';

import { labelStyles } from './label';
import { TextFieldContext } from './text-field';

const _CheckboxGroup = ({
	className,
	variant = 'negative',
	orientation,
	...props
}: CheckboxGroupProps & {
	variant?: 'negative' | 'positive';
	orientation?: 'horizontal' | 'vertical';
}) => {
	const [meta] = useField(props.name ?? '');
	const control = useInputControl(meta as any);

	return (
		<TextFieldContext.Provider
			value={{
				meta,
				control,
			}}
		>
			<RACCheckboxGroup
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
				data-orientation={orientation}
				{...props}
				name={meta.name}
				value={(control.value as any) ?? props.defaultValue ?? props.value}
				onChange={control.change}
				onBlur={control.blur}
				isInvalid={meta.errors && meta.errors.length > 0}
				isRequired={meta.required}
			/>
		</TextFieldContext.Provider>
	);
};

const _Checkbox = ({ className, children, ...props }: CheckboxProps) => (
	<RACCheckbox
		className={(values) =>
			clsx(
				'group flex items-center gap-x-2 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
				labelStyles,
				typeof className === 'function' ? className(values) : className,
			)
		}
		{...props}
	>
		{(values) => (
			<>
				<div
					className={clsx(
						'border-input ring-offset-background group-data-[focus-visible]:ring-ring inline-flex size-8 shrink-0 items-center justify-center rounded-sm border group-data-[focus-visible]:outline-none group-data-[focus-visible]:ring-2 group-data-[focus-visible]:ring-offset-2',
						'group-data-[indeterminate]:bg-primary group-data-[indeterminate]:text-primary-foreground',
						'group-data-[selected]:bg-primary group-data-[selected]:text-primary-foreground',
					)}
				>
					{values.isIndeterminate ? (
						<Minus className="size-6" />
					) : values.isSelected ? (
						<Check className="size-6" />
					) : null}
				</div>
				{typeof children === 'function' ? children(values) : children}
			</>
		)}
	</RACCheckbox>
);

const Checkboxes = ({ children }: { children: React.ReactNode }) => (
	<div className="flex group-data-[orientation=horizontal]:flex-row group-data-[orientation=vertical]:flex-col group-data-[orientation=horizontal]:gap-4 group-data-[orientation=vertical]:gap-2.5">
		{children}
	</div>
);

export { _Checkbox as Checkbox, _CheckboxGroup as CheckboxGroup, Checkboxes };
