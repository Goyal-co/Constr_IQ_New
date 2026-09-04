import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  /**
   * Read `.env` from the repository root, not from apps/web.
   *
   * One file configures the whole stack. Vite defaults to looking beside this
   * config, which is what produced a second env file holding a copy of the API
   * URL — and a copy is a thing that goes stale silently: the client keeps
   * building, it just points somewhere that is no longer right.
   *
   * Only `VITE_`-prefixed variables are exposed to the bundle, so sharing a file
   * with the API does not put a JWT secret or a database URL into JavaScript
   * the browser downloads.
   */
  envDir: resolve(__dirname, '../..'),
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      // Point at the shared package's source so a change to domain logic shows up
      // in the dev server without a rebuild step in between.
      '@ciq/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        // Split the vendor bundle so an app-code change does not invalidate the
        // React and query-client chunks in the browser cache.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          query: ['@tanstack/react-query'],
          forms: ['react-hook-form', '@hookform/resolvers', 'zod'],
        },
      },
    },
  },
});
