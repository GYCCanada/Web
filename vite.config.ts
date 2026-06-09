import { reactRouter } from '@react-router/dev/vite';
import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  plugins: [reactRouter()],
  resolve: {
    tsconfigPaths: true,
    alias:
      command === 'build'
        ? { 'react-dom/server': 'react-dom/server.node' }
        : undefined,
  },
}));
