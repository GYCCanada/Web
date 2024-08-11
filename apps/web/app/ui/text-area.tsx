import clsx from 'clsx';
import * as React from 'react';
import { TextArea as RACTextArea  } from 'react-aria-components';
import type {TextAreaProps} from 'react-aria-components';

const base =
	'text-base py-5 px-6 rounded-sm border-b-2 border-transparent outline-none focus:border-b-accent-600 duration-200 placeholder-input-placeholder bg-input-background text-input-foreground';
const variants = {
	positive: 'bg-neutral-50 text-neutral-950',
	negative: 'bg-neutral-900 text-neutral-50',
};

export type InputVariant = keyof typeof variants;

const TextArea = React.forwardRef<
	HTMLTextAreaElement,
	TextAreaProps & {
		variant?: InputVariant;
	}
>(function TextArea({ className, variant = 'positive', ...props }, ref) {
	return (
		<RACTextArea
			{...props}
			ref={ref}
			className={clsx(base, variants[variant], className)}
		/>
	);
});

TextArea.displayName = 'Input';

export { TextArea };
