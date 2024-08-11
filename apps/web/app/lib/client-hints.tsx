/**
 * This file contains utilities for using client hints for user preference which
 * are needed by the server, but are only known by the browser.
 */
import {  getHintUtils } from '@epic-web/client-hints';
import type {ClientHint} from '@epic-web/client-hints';
import {
	clientHint as colorSchemeHint,
	subscribeToSchemeChange,
} from '@epic-web/client-hints/color-scheme';
import { clientHint as timeZoneHint } from '@epic-web/client-hints/time-zone';
import { useRevalidator, useRouteLoaderData } from '@remix-run/react';
import * as React from 'react';
import invariant from 'tiny-invariant';

import type {loader as rootLoader} from '~/root';

export const Breakpoint = {
	Sm: 0,
	Md: 1,
	Lg: 2,
	Xl: 3,
} as const;
export type Breakpoint = (typeof Breakpoint)[keyof typeof Breakpoint];

/**
 * This breakpoint hint allows us to know the current breakpoint of the user's
 * device. We use this to render the correct layout for the user's device on the initial
 * render.
 */
const breakpointHints = {
	cookieName: 'breakpoint',
	fallback: Breakpoint.Sm as Breakpoint,
	getValueCode: `window.innerWidth <= 640 ? 0 : window.innerWidth <= 1024 ? 1 : window.innerWidth <= 1280 ? 2 : 3`,
	transform(value): Breakpoint {
		return Number.isNaN(value)
			? (Breakpoint.Sm as Breakpoint)
			: (Number(value) as Breakpoint);
	},
} as const satisfies ClientHint<Breakpoint>;

const hintsUtils = getHintUtils({
	theme: colorSchemeHint,
	timeZone: timeZoneHint,
	breakpoint: breakpointHints,
});

export const { getHints } = hintsUtils;

/**
 * @returns the request info from the root loader
 */
export function useRequestInfo() {
	const data = useRouteLoaderData<typeof rootLoader>('root');
	invariant(data?.requestInfo, 'No requestInfo found in root loader');

	return data.requestInfo;
}

/**
 * @returns an object with the client hints and their values
 */
export function useHints() {
	const requestInfo = useRequestInfo();
	return requestInfo.hints;
}

/**
 * @returns inline script element that checks for client hints and sets cookies
 * if they are not set then reloads the page if any cookie was set to an
 * inaccurate value.
 */
export function ClientHintCheck() {
	const { revalidate } = useRevalidator();
	React.useEffect(
		() => subscribeToSchemeChange(() => revalidate()),
		[revalidate],
	);

	return (
		<script
			dangerouslySetInnerHTML={{
				__html: hintsUtils.getClientHintCheckScript(),
			}}
		/>
	);
}

export function useBreakpoint(): Breakpoint {
	const hints = useHints();
	return React.useSyncExternalStore(
		React.useCallback((cb) => {
			window.addEventListener('resize', cb);
			window.addEventListener('orientationchange', cb);
			window.addEventListener('load', cb);
			return () => {
				window.removeEventListener('resize', cb);
				window.removeEventListener('orientationchange', cb);
				window.removeEventListener('load', cb);
			};
		}, []),
		React.useCallback(
			() =>
				window.innerWidth <= 640
					? Breakpoint.Sm
					: window.innerWidth <= 1024
						? Breakpoint.Md
						: window.innerWidth <= 1280
							? Breakpoint.Lg
							: Breakpoint.Xl,
			[],
		),
		React.useCallback(() => hints.breakpoint, [hints.breakpoint]),
	);
}
