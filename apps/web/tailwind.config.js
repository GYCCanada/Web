import { zinc } from 'tailwindcss/colors';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./app/**/*.{tsx,html}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: 'rgb(var(--color-background))',
        foreground: 'rgb(var(--color-foreground))',
        accent: {
          50: 'rgb(var(--color-accent-50) / <alpha-value>)',
          100: 'rgb(var(--color-accent-100) / <alpha-value>)',
          200: 'rgb(var(--color-accent-200) / <alpha-value>)',
          300: 'rgb(var(--color-accent-300) / <alpha-value>)',
          400: 'rgb(var(--color-accent-400) / <alpha-value>)',
          500: 'rgb(var(--color-accent-500) / <alpha-value>)',
          600: 'rgb(var(--color-accent-600) / <alpha-value>)',
          700: 'rgb(var(--color-accent-700) / <alpha-value>)',
          800: 'rgb(var(--color-accent-800) / <alpha-value>)',
          900: 'rgb(var(--color-accent-900) / <alpha-value>)',
          950: 'rgb(var(--color-accent-950) / <alpha-value>)',
        },
        link: {
          50: 'rgb(var(--color-link-50) / <alpha-value>)',
          100: 'rgb(var(--color-link-100) / <alpha-value>)',
          200: 'rgb(var(--color-link-200) / <alpha-value>)',
          300: 'rgb(var(--color-link-300) / <alpha-value>)',
          400: 'rgb(var(--color-link-400) / <alpha-value>)',
          500: 'rgb(var(--color-link-500) / <alpha-value>)',
          600: 'rgb(var(--color-link-600) / <alpha-value>)',
          700: 'rgb(var(--color-link-700) / <alpha-value>)',
          800: 'rgb(var(--color-link-800) / <alpha-value>)',
          900: 'rgb(var(--color-link-900) / <alpha-value>)',
          950: 'rgb(var(--color-link-950) / <alpha-value>)',
        },
        neutral: zinc,
        wood: {
          50: 'rgb(var(--color-wood-50) / <alpha-value>)',
          100: 'rgb(var(--color-wood-100) / <alpha-value>)',
          200: 'rgb(var(--color-wood-200) / <alpha-value>)',
          300: 'rgb(var(--color-wood-300) / <alpha-value>)',
          400: 'rgb(var(--color-wood-400) / <alpha-value>)',
          500: 'rgb(var(--color-wood-500) / <alpha-value>)',
          600: 'rgb(var(--color-wood-600) / <alpha-value>)',
          700: 'rgb(var(--color-wood-700) / <alpha-value>)',
          800: 'rgb(var(--color-wood-800) / <alpha-value>)',
          900: 'rgb(var(--color-wood-900) / <alpha-value>)',
          950: 'rgb(var(--color-wood-950) / <alpha-value>)',
        },
      },
    },
  },
  plugins: [],
};
