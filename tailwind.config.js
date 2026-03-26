/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        tm: {
          bg:      '#0A0A0A',
          surface: '#0F0F0F',
          panel:   '#141414',
          active:  '#1A1A1A',
          border:  '#2a2a2a',
          text:    '#FAFAFA',
          muted:   '#6B7280',
          dim:     '#4B5563',
          green:   '#10B981',
          amber:   '#F59E0B',
          red:     '#EF4444',
          cyan:    '#06B6D4',
        },
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', '"Fira Code"', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
}
