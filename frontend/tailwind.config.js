/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        red: { 50: '#fff2f3', 100: '#ffe4e6', 200: '#fecdd3', 500: '#e13a43', 600: '#c72026', 700: '#ac1b23', 800: '#8f1c24' },
        gray: { 50: '#f7f8fa', 100: '#f0f2f5', 200: '#e4e7ec', 300: '#d1d6de', 400: '#8993a3', 500: '#667085', 600: '#526071', 700: '#364152', 800: '#202b3a', 900: '#152031' },
      },
      fontSize: {
        xs: ['0.8125rem', { lineHeight: '1.5' }],
        sm: ['0.9375rem', { lineHeight: '1.6' }],
        base: ['1.0625rem', { lineHeight: '1.65' }],
      },
      borderRadius: { lg: '0.75rem', xl: '1rem', '2xl': '1.5rem' },
      boxShadow: {
        DEFAULT: '0 3px 18px -8px rgb(21 32 49 / 0.13)',
        md: '0 8px 28px -12px rgb(21 32 49 / 0.16)',
        lg: '0 12px 36px -16px rgb(21 32 49 / 0.2)',
      },
    },
  },
  plugins: [],
}

