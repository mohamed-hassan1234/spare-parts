/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig(({ mode }) => {
  const api = process.env.VITE_API_PROXY ?? loadEnv(mode, __dirname, 'VITE_').VITE_API_PROXY ?? 'http://localhost:4000';
  return {
    plugins: [react(), tailwindcss()],
    resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
    server: {
      port: 5173,
      strictPort: true,
      proxy: { '/api': { target: api, changeOrigin: false }, '/uploads': { target: api, changeOrigin: false } },
    },
    build: {
      sourcemap: true,
      chunkSizeWarningLimit: 900,
      rollupOptions: { output: { manualChunks: { react: ['react', 'react-dom', 'react-router-dom', 'react-router'], charts: ['recharts'], query: ['@tanstack/react-query'] } } },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      css: false,
    },
  };
});
