/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        tea: {
          50: '#F3F7F4',
          100: '#E4EDE6',
          200: '#C7DBCB',
          300: '#9EBF9F',
          400: '#75A177',
          500: '#5F8265',
          600: '#4A6B53',
          700: '#3D5944',
          800: '#2F4534',
          900: '#213024',
        },
        parchment: {
          50: '#FDFCF7',
          100: '#FBF9F5',
          200: '#F3EFE6',
          300: '#E7E0D2',
          400: '#D5C9B5',
          500: '#BFB097',
        },
        ink: {
          900: '#231F1C',
          800: '#2D2824',
          700: '#433D37',
          600: '#5E564F',
          500: '#786F66',
          400: '#948B82',
          300: '#B8B0A8',
        },
        terracotta: {
          500: '#B84A39',
          600: '#9E3E2F',
        },
        amberGold: {
          500: '#C97A3E',
          600: '#B26730',
        }
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
