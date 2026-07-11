/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Palette psyche fixe (voir README). Le composant utilise surtout des styles inline,
        // ces tokens sont la pour d'eventuelles surcouches UI.
        void: '#0a0118',
        magenta: '#ff2e97',
        cyan: '#00f0ff',
        amber: '#ffd600',
        acid: '#39ff14',
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
}
