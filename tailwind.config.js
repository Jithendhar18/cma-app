/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        canvas: 'rgb(var(--canvas) / <alpha-value>)',
        surface: {
          DEFAULT: 'rgb(var(--card) / <alpha-value>)',
          subtle: 'rgb(var(--bg-subtle) / <alpha-value>)',
          elevated: 'rgb(var(--elevated) / <alpha-value>)',
          sidebar: 'rgb(var(--sidebar) / <alpha-value>)',
        },
        ink: {
          DEFAULT: 'rgb(var(--text) / <alpha-value>)',
          2: 'rgb(var(--text-2) / <alpha-value>)',
          3: 'rgb(var(--text-3) / <alpha-value>)',
        },
      },
      borderColor: {
        DEFAULT: 'rgb(var(--line) / var(--line-alpha))',
      },
      boxShadow: {
        card: '0 1px 2px rgb(0 0 0 / 0.12), 0 8px 24px -12px rgb(0 0 0 / 0.25)',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.4s ease-out both',
      },
    },
  },
  plugins: [],
};
