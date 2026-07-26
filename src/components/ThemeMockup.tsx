import type { CSSProperties } from 'react';
import { themeToCssVars, type ThemeColors } from '../lib/color';

/**
 * Viser et repræsentativt udsnit af appens UI-elementer med et givent sæt
 * temafarver. Farverne sættes som CSS-variabler på wrapper-elementet, så de
 * lokalt overskriver de globale variabler for alt inde i mockuppen — uden at
 * påvirke resten af siden. Det gør at mockuppen opdaterer sig selv live, mens
 * man redigerer farverne i editoren, uden at gemme eller aktivere temaet.
 */
export function ThemeMockup({ colors }: { colors: ThemeColors }) {
  const style = themeToCssVars(colors) as CSSProperties;

  return (
    <div style={style} className="overflow-hidden rounded-xl border border-river-200">
      {/* Navigation */}
      <div className="flex items-center justify-between bg-river-700 px-4 py-2.5 text-buttontext">
        <span className="font-display text-sm font-semibold">Fællesrejser</span>
        <div className="flex gap-2 text-xs">
          <span>Rejser</span>
          <span>Arkiv</span>
          <button className="rounded-md bg-river-600 px-2 py-1">Log ud</button>
        </div>
      </div>

      <div className="space-y-4 bg-river-50 p-4">
        {/* Faner */}
        <div className="flex gap-1">
          <span className="tab tab-active">Overblik</span>
          <span className="tab tab-inactive">Pakkeliste</span>
          <span className="tab tab-inactive">Regnskab</span>
        </div>

        {/* Kort med badge, tekst, checkbox og knapper */}
        <div className="card space-y-3 p-4">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-sand-100 px-2 py-0.5 text-xs font-medium text-sand-500">
              Gudenåen
            </span>
            <span className="rounded-full bg-river-100 px-2 py-0.5 text-xs font-medium text-river-500">
              Arkiveret
            </span>
          </div>
          <h3 className="font-display text-base font-semibold text-river-800">Sommertur 2027</h3>
          <p className="text-sm text-river-500">Et eksempel på brødtekst i den sekundære tekstfarve.</p>

          <label className="flex items-center gap-2 text-sm text-river-700">
            <input type="checkbox" defaultChecked readOnly />
            Sovepose pakket af Mikkel
          </label>

          <input className="input" placeholder="Eksempel på et tekstfelt" readOnly />

          <div className="flex flex-wrap gap-2 pt-1">
            <button className="btn-primary" type="button">
              Primær knap
            </button>
            <button className="btn-secondary" type="button">
              Sekundær knap
            </button>
            <button className="btn-danger" type="button">
              Slet
            </button>
          </div>

          <p className="text-sm text-red-600">Eksempel på en fejlbesked i fejlfarven.</p>
        </div>
      </div>
    </div>
  );
}
