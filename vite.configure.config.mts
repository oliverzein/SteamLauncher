import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'node:path'

export default defineConfig({
  root: path.resolve(__dirname, 'src/windows/configure'),
  plugins: [vue()],
  build: {
    outDir: path.resolve(__dirname, '.vite/renderer/configure_window'),
    emptyOutDir: true,
  },
})
