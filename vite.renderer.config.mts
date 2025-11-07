import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vitejs.dev/config
export default defineConfig({
  plugins: [vue()],
  optimizeDeps: {
    force: true,
    // persist false prevents reusing a potentially stale optimizer cache between runs
    persist: false,
  },
})
