import type { Config } from '@react-router/dev/config';

export default {
  ssr: true,
  appDirectory: 'app',
  future: {
    v8_middleware: true,
  },
} satisfies Config;
