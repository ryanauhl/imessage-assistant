import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@shared': path.resolve(__dirname, '../server/src') } },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3777', ws: true },
      '/healthz': 'http://127.0.0.1:3777',
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
