/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // The browser journeys (e2e/) run their own copy on other ports, beside a developer's `pnpm dev`.
  server: {
    port: Number(process.env.WEB_PORT ?? 5173),
    strictPort: true,
    proxy: { '/api': { target: process.env.API_ORIGIN ?? 'http://localhost:4000', changeOrigin: false } },
  },
  test: { environment: 'jsdom', css: false, exclude: ['e2e/**', 'node_modules/**'] },
});
