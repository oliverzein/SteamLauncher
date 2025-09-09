import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    rollupOptions: {
      // Avoid bundling native addon; keep require('keytar') at runtime
      external: ['keytar']
    }
  }
});
