import type { Config } from '@react-router/dev/config';

export default {
  ssr: true,
  appDirectory: 'app',
  future: {
    // Middleware: already adopted (matches paulo-suzanne).
    v8_middleware: true,
    // Build-side, behaviour-neutral.
    v8_splitRouteModules: true,
    v8_viteEnvironmentApi: true,
    // Behavioural: `request` now passes through un-normalised (`.data` suffix,
    // `index`/`_routes` params), and the normalised URL is the `url` arg.
    // Every loader/action that read `new URL(request.url).pathname`
    // (root.tsx, contact.tsx, volunteer.tsx) has been migrated to the `url`
    // arg, so enabling this is safe. Form actions otherwise only read
    // `request.formData()`, which is unaffected.
    v8_passThroughRequests: true,
    // Data-request URL format change — transparent to app code (no loader
    // constructs single-fetch `.data` URLs by hand).
    v8_trailingSlashAwareDataRequests: true,
  },
} satisfies Config;
