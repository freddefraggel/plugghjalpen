import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';

const commit = (() => {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'lokal';
  }
})();

// GitHub Pages serverar sajten under /plugghjalpen/
export default defineConfig({
  base: process.env.VITE_BASE ?? '/plugghjalpen/',
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(`${commit} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`),
  },
});
