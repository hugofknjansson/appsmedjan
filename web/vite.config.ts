import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const server = process.env.SERVER_ORIGIN ?? 'http://localhost:8787';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    // The Host header is passed through unchanged so the server's WebSocket origin check sees the page's own host.
    proxy: {
      '/api': { target: server },
      '/ws': { target: server, ws: true },
    },
  },
});
