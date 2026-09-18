import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Host app for PR #11251 verification: consumes @qwen-code/web-shell through
// the workspace symlink -> package exports -> dist/index.js (npm consumer path).
export default defineConfig({
  root: __dirname,
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom', '@qwen-code/sdk'],
  },
  optimizeDeps: {
    // The lib bundle is a single 7 MB ESM file; prebundling it keeps reloads sane.
    include: ['@qwen-code/web-shell'],
  },
  server: {
    port: Number(process.env.HOST_PORT ?? 5251),
    strictPort: true,
    host: '127.0.0.1',
    fs: { allow: [resolve(__dirname, '../..')] },
  },
});
