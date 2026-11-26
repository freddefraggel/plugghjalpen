import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages serverar sajten under /plugghjalpen/
export default defineConfig({
  base: process.env.VITE_BASE ?? '/plugghjalpen/',
  plugins: [react()],
});
