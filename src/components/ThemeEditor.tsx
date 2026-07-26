import { useState } from 'react';
import {
  DANGER_SHADES,
  DEFAULT_THEME_COLORS,
  RIVER_SHADES,
  SAND_SHADES,
  type ThemeColors,
} from '../lib/color';
import { ThemeMockup } from './ThemeMockup';

const GROUPS: { key: 'river' | 'sand' | 'danger'; label: string; shades: readonly string[] }[] = [
  { key: 'river', label: 'Hovedfarve (knapper, faner, overskrifter)', shades: RIVER_SHADES },
  { key: 'sand', label: 'Accentfarve (badges, fremhævninger)', shades: SAND_SHADES },
  { key: 'danger', label: 'Fejlfarve (slet-knapper, fejlbeskeder)', shades: DANGER_SHADES },
];

interface Props {
  initialColors?: ThemeColors;
  initialName?: string;
  busy?: boolean;
  onCancel: () => void;
  onSave: (name: string, colors: ThemeColors) => void;
}

export function ThemeEditor({ initialColors, initialName, busy, onCancel, onSave }: Props) {
  const [name, setName] = useState(initialName ?? '');
  const [colors, setColors] = useState<ThemeColors>(() => {
    const base = JSON.parse(JSON.stringify(DEFAULT_THEME_COLORS));
    return initialColors ? { ...base, ...JSON.parse(JSON.stringify(initialColors)) } : base;
  });

  function setShade(group: 'river' | 'sand' | 'danger', shade: string, hex: string) {
    setColors((prev) => ({
      ...prev,
      [group]: { ...prev[group], [shade]: hex },
    }));
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        <div>
          <label className="label">Navn på tema</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="fx 'Efterår'" />
        </div>

        {GROUPS.map((group) => (
          <details key={group.key} className="rounded-lg border border-river-100 p-3" open>
            <summary className="cursor-pointer text-sm font-medium text-river-800">{group.label}</summary>
            <div className="mt-3 grid grid-cols-5 gap-2">
              {group.shades.map((shade) => (
                <label key={shade} className="flex flex-col items-center gap-1 text-xs text-river-500">
                  {shade}
                  <input
                    type="color"
                    className="h-8 w-full cursor-pointer rounded border border-river-200"
                    value={(colors[group.key] as Record<string, string>)[shade]}
                    onChange={(e) => setShade(group.key, shade, e.target.value)}
                  />
                </label>
              ))}
            </div>
          </details>
        ))}

        <details className="rounded-lg border border-river-100 p-3" open>
          <summary className="cursor-pointer text-sm font-medium text-river-800">Kort-baggrund</summary>
          <div className="mt-3">
            <input
              type="color"
              className="h-8 w-24 cursor-pointer rounded border border-river-200"
              value={colors.surface}
              onChange={(e) => setColors((prev) => ({ ...prev, surface: e.target.value }))}
            />
          </div>
        </details>

        <details className="rounded-lg border border-river-100 p-3" open>
          <summary className="cursor-pointer text-sm font-medium text-river-800">
            Tekstfarve på knapper og navigation
          </summary>
          <div className="mt-3 flex gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={colors.buttonTextMode === 'light'}
                onChange={() => setColors((prev) => ({ ...prev, buttonTextMode: 'light' }))}
              />
              Lys tekst
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={colors.buttonTextMode === 'dark'}
                onChange={() => setColors((prev) => ({ ...prev, buttonTextMode: 'dark' }))}
              />
              Mørk tekst
            </label>
          </div>
        </details>

        <div className="flex gap-2">
          <button
            className="btn-primary"
            disabled={busy || !name.trim()}
            onClick={() => onSave(name.trim(), colors)}
          >
            Gem tema
          </button>
          <button type="button" className="btn-secondary" onClick={onCancel}>
            Annuller
          </button>
        </div>
      </div>

      <div>
        <p className="label">Forhåndsvisning</p>
        <ThemeMockup colors={colors} />
      </div>
    </div>
  );
}
