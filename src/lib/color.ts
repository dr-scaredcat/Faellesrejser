/** Konverterer "#rrggbb" til "r g b" (det format Tailwind's opacity-mønster kræver). */
export function hexToRgbString(hex: string): string {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return `${r} ${g} ${b}`;
}

/** Konverterer "r g b" tilbage til "#rrggbb", til brug i <input type="color">. */
export function rgbStringToHex(rgb: string): string {
  const [r, g, b] = rgb.split(' ').map(Number);
  const toHex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export interface ThemeColors {
  river: Record<string, string>;
  sand: Record<string, string>;
  danger: Record<string, string>;
  surface: string;
  /** Styrer om teksten på knapper og i navigationen er lys eller mørk. */
  buttonTextMode: 'light' | 'dark';
}

export const BUTTON_TEXT_LIGHT = '#ffffff';
export const BUTTON_TEXT_DARK = '#111827';

export function buttonTextColor(mode: 'light' | 'dark'): string {
  return mode === 'dark' ? BUTTON_TEXT_DARK : BUTTON_TEXT_LIGHT;
}

export const RIVER_SHADES = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900'] as const;
export const SAND_SHADES = ['50', '100', '200', '300', '400', '500'] as const;
export const DANGER_SHADES = ['100', '500', '600', '700'] as const;

export const DEFAULT_THEME_COLORS: ThemeColors = {
  river: {
    '50': '#eef5f5', '100': '#d3e6e5', '200': '#a7cdca', '300': '#79b2ac', '400': '#4d968f',
    '500': '#2f7a73', '600': '#22615c', '700': '#1b4c48', '800': '#153a38', '900': '#0f2928',
  },
  sand: {
    '50': '#fbf7ef', '100': '#f3e9d3', '200': '#e6d1a3', '300': '#d7b671', '400': '#c99e4a', '500': '#b6862f',
  },
  danger: { '100': '#fee2e2', '500': '#ef4444', '600': '#dc2626', '700': '#b91c1c' },
  surface: '#ffffff',
  buttonTextMode: 'light',
};

/** Bygger et CSS custom properties-objekt (React style-objekt) ud fra et sæt temafarver. */
export function themeToCssVars(colors: ThemeColors): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const shade of RIVER_SHADES) vars[`--color-river-${shade}`] = hexToRgbString(colors.river[shade]);
  for (const shade of SAND_SHADES) vars[`--color-sand-${shade}`] = hexToRgbString(colors.sand[shade]);
  for (const shade of DANGER_SHADES) vars[`--color-danger-${shade}`] = hexToRgbString(colors.danger[shade]);
  vars['--color-surface'] = hexToRgbString(colors.surface);
  vars['--color-button-text'] = hexToRgbString(buttonTextColor(colors.buttonTextMode ?? 'light'));
  return vars;
}

/** Sætter temafarverne som CSS-variabler direkte på <html>, så hele appen bruger dem. */
export function applyThemeToDocument(colors: ThemeColors) {
  const vars = themeToCssVars(colors);
  for (const [key, value] of Object.entries(vars)) {
    document.documentElement.style.setProperty(key, value);
  }
}
