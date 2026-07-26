/** @type {import('tailwindcss').Config} */

// Bygger en Tailwind-farvefunktion der læser fra en CSS-variabel og
// understøtter opacity-modifiers (fx bg-river-600/50).
function withOpacity(variableName) {
  return ({ opacityValue }) => {
    if (opacityValue === undefined) return `rgb(var(${variableName}))`;
    return `rgb(var(${variableName}) / ${opacityValue})`;
  };
}

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        river: {
          50: withOpacity('--color-river-50'),
          100: withOpacity('--color-river-100'),
          200: withOpacity('--color-river-200'),
          300: withOpacity('--color-river-300'),
          400: withOpacity('--color-river-400'),
          500: withOpacity('--color-river-500'),
          600: withOpacity('--color-river-600'),
          700: withOpacity('--color-river-700'),
          800: withOpacity('--color-river-800'),
          900: withOpacity('--color-river-900'),
        },
        sand: {
          50: withOpacity('--color-sand-50'),
          100: withOpacity('--color-sand-100'),
          200: withOpacity('--color-sand-200'),
          300: withOpacity('--color-sand-300'),
          400: withOpacity('--color-sand-400'),
          500: withOpacity('--color-sand-500'),
        },
        // Overskriver kun de nuancer af Tailwinds indbyggede "red", som appen rent faktisk bruger
        // (til fejlbeskeder og slet-knapper), så de også kan styres via temaer.
        red: {
          100: withOpacity('--color-danger-100'),
          500: withOpacity('--color-danger-500'),
          600: withOpacity('--color-danger-600'),
          700: withOpacity('--color-danger-700'),
        },
        surface: withOpacity('--color-surface'),
        buttontext: withOpacity('--color-button-text'),
      },
      fontFamily: {
        display: ['"Fraunces"', 'serif'],
        body: ['"Inter"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
