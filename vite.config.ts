import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
// `base` relatif => build deployable tel quel sur GitHub Pages / Vercel / sous-chemin.
export default defineConfig({
  base: './',
  plugins: [react()],
})
