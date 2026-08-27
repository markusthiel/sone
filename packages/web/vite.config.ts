import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // The dev server proxies to the API so the browser sees one origin. Without
    // this the session cookie is cross-site and SameSite=Lax drops it, which
    // looks exactly like a broken login.
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/sync': { target: 'ws://localhost:3000', ws: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
