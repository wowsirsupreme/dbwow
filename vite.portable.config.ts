// Portable build: the same DBWOW source compiled into ONE self-contained HTML file
// (JS, CSS and the SQLite WebAssembly binary all inlined). Used for the hosted
// browser version and for running DBWOW from a USB stick with no server.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import path from 'node:path';
export default defineConfig({
  root: path.resolve(__dirname, 'portable'),
  plugins: [react(), viteSingleFile()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  css: { postcss: path.resolve(__dirname) },
  define: { 'process.env.NODE_ENV': '"production"' },
  build: { outDir: path.resolve(__dirname, 'dist-portable'), emptyOutDir: true, assetsInlineLimit: 100000000, chunkSizeWarningLimit: 100000000 },
});
