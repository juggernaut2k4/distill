import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        void: '#080808',
        surface: '#111111',
        raised: '#1A1A1A',
        'border-subtle': '#222222',
        'border-strong': '#333333',
        purple: {
          DEFAULT: '#7C3AED',
          bright: '#A855F7',
          950: '#1a0030',
        },
        cyan: {
          DEFAULT: '#06B6D4',
        },
        amber: {
          DEFAULT: '#F59E0B',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
    },
  },
  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/typography'),
  ],
}

export default config
