import * as React from 'react';

import { useBreakpoint } from '~/lib/client-hints';
import type { Breakpoint } from '~/lib/client-hints';
import { useLocale } from '~/lib/localization/context';
import type { Locale } from '~/lib/localization/localization';

function findNearestBreakpointSrc(
	images: Partial<Record<Breakpoint, string>>,
	breakpoint: Breakpoint,
): string | undefined {
	const keys = Object.keys(images).sort(
		(a, b) => +a - +b,
	) as unknown as Breakpoint[];
	const index = keys.indexOf(breakpoint);

	if (index !== -1) {
		return images[breakpoint];
	}

	for (let i = index; i < keys.length; i++) {
		if (images[keys[i]]) {
			return images[keys[i]];
		}
	}

	return images[keys[0]];
}

interface LocalizedImageProps extends Omit<React.ComponentProps<'img'>, 'src'> {
	breakpointSrcs?: Record<Locale, Partial<Record<Breakpoint, string>>>;
	srcs?: Record<Locale, string>;
}

const LocalizedImage = React.forwardRef<HTMLImageElement, LocalizedImageProps>(
	function Image({ srcs, breakpointSrcs, ...props }, ref) {
		const locale = useLocale();
		const breakpoint = useBreakpoint();
		const localeSrc = srcs?.[locale];
		const breakpoints = breakpointSrcs?.[locale];
		const breakpointSrc = breakpoints
			? findNearestBreakpointSrc(breakpoints, breakpoint)
			: undefined;
		const src = breakpointSrc ?? localeSrc;

		return (
			<img
				ref={ref}
				src={src}
				{...props}
			/>
		);
	},
);

LocalizedImage.displayName = 'LocalizedImage';

export { LocalizedImage };
