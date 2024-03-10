export const Locale = {
  En: 'en',
  Fr: 'fr',
} as const;
export type Locale = (typeof Locale)[keyof typeof Locale];
