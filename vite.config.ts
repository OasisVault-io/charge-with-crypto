import path from 'node:path';
import { defineConfig } from 'vite';

const clientRoot = path.resolve(__dirname, 'client');

export default defineConfig({
  appType: 'mpa',
  root: clientRoot,
  publicDir: path.resolve(__dirname, 'public'),
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:3037'
    }
  },
  build: {
    outDir: path.resolve(__dirname, 'dist/client'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: path.resolve(clientRoot, 'index.html'),
        checkout: path.resolve(clientRoot, 'checkout.html'),
        dashboard: path.resolve(clientRoot, 'dashboard.html')
      }
    }
  }
});
