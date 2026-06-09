import type { Config } from '@react-router/dev/config';

export default {
  ssr: true,
  appDirectory: 'app',
  future: {
    // Middleware: already adopted (matches paulo-suzanne).
    v8_middleware: true,
    // Build-side, behaviour-neutral — opt in now to get ahead of the RR8 default.
    v8_splitRouteModules: true,
    v8_viteEnvironmentApi: true,
    // Behavioural flags: these change the request/url loaders receive and the
    // data-request URL format. Pinned to false (current behaviour) so the RR8
    // warning is silenced without altering runtime behaviour; flip deliberately
    // with per-loader verification when upgrading toward v8.
    v8_passThroughRequests: false,
    v8_trailingSlashAwareDataRequests: false,
  },
} satisfies Config;
