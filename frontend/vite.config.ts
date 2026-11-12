import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:3001' } },
  build: { chunkSizeWarningLimit: 4000 }, // the Bryntum calendar is one large, lazily loaded chunk
});
