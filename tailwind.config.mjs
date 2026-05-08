/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        parchment: {
          50: '#FBF7EE',
          100: '#F4ECDB',
          200: '#EADFC4',
          300: '#DCCCA3',
          400: '#C7B384',
        },
        umber: {
          50: '#7A6A52',
          100: '#5A4D3B',
          200: '#3F3525',
          300: '#2A2117',
          400: '#1A140C',
        },
        terracotta: {
          400: '#C2724A',
          500: '#A6582C',
          600: '#854420',
          700: '#67341A',
        },
        moss: {
          400: '#7B8C5E',
          500: '#5C6E47',
          600: '#465536',
          700: '#33402A',
        },
        oxblood: {
          500: '#7A2B27',
          600: '#5C201D',
        },
      },
      fontFamily: {
        display: ['"Cormorant Garamond"', 'Garamond', 'Georgia', 'serif'],
        serif: ['"EB Garamond"', 'Garamond', 'Georgia', 'serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      letterSpacing: {
        smallcaps: '0.16em',
      },
      maxWidth: {
        prose: '68ch',
        wide: '1180px',
      },
    },
  },
  plugins: [],
};
