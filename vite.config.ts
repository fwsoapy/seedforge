import { defineConfig } from 'vite';

// The site is served from https://<user>.github.io/seedforge/ on Pages, so the
// base path is configurable through BASE_PATH for other deployments.
export default defineConfig({
  root: 'src',
  base: process.env.BASE_PATH ?? '/seedforge/',
  publicDir: '../public',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2022',
  },
  worker: {
    format: 'es',
  },
  server: {
    port: 5173,
  },
});
