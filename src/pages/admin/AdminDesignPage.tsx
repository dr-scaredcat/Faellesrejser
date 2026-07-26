import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { ThemeEditor } from '../../components/ThemeEditor';
import type { ThemeColors } from '../../lib/color';
import type { ThemeRow } from '../../context/ThemeContext';

export default function AdminDesignPage() {
  const { profile } = useAuth();
  const { themes, activeThemeId, activateTheme, refresh } = useTheme();
  const [mode, setMode] = useState<'idle' | 'create' | 'edit'>('idle');
  const [editingTheme, setEditingTheme] = useState<ThemeRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startCreate() {
    setEditingTheme(null);
    setMode('create');
  }

  function startEdit(theme: ThemeRow) {
    setEditingTheme(theme);
    setMode('edit');
  }

  async function handleSave(name: string, colors: ThemeColors) {
    setBusy(true);
    setError(null);

    const { error } =
      mode === 'edit' && editingTheme
        ? await supabase.from('themes').update({ name, colors }).eq('id', editingTheme.id)
        : await supabase.from('themes').insert({ name, colors, created_by: profile?.id });

    if (error) setError(error.message);
    setBusy(false);
    if (!error) {
      setMode('idle');
      refresh();
    }
  }

  async function handleDelete(theme: ThemeRow) {
    if (theme.is_default) return;
    if (theme.id === activeThemeId) {
      alert('Du kan ikke slette det tema der er aktivt lige nu. Aktivér et andet tema først.');
      return;
    }
    if (!confirm(`Slet temaet "${theme.name}"?`)) return;
    await supabase.from('themes').delete().eq('id', theme.id);
    refresh();
  }

  return (
    <section className="card p-5">
      <h2 className="mb-1 font-semibold text-river-800">Temaer</h2>
      <p className="mb-4 text-sm text-river-500">
        Det aktive tema gælder for alle brugere med det samme. Opret gerne flere temaer og skift mellem dem
        når som helst.
      </p>

      {mode === 'idle' && (
        <>
          <ul className="mb-4 space-y-2">
            {themes.map((theme) => (
              <li
                key={theme.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-river-100 p-3"
              >
                <div className="flex items-center gap-3">
                  <span className="flex gap-0.5">
                    {['300', '500', '700'].map((s) => (
                      <span
                        key={s}
                        className="h-5 w-5 rounded-full border border-river-200"
                        style={{ backgroundColor: theme.colors.river[s] }}
                      />
                    ))}
                    <span
                      className="h-5 w-5 rounded-full border border-river-200"
                      style={{ backgroundColor: theme.colors.sand['400'] }}
                    />
                  </span>
                  <span className="text-sm font-medium text-river-800">
                    {theme.name}
                    {theme.is_default && <span className="ml-2 text-xs text-river-400">(standard)</span>}
                  </span>
                  {theme.id === activeThemeId && (
                    <span className="rounded-full bg-sand-100 px-2 py-0.5 text-xs font-medium text-sand-500">
                      Aktiv
                    </span>
                  )}
                </div>
                <div className="flex gap-3 text-xs">
                  {theme.id !== activeThemeId && (
                    <button className="text-river-600 hover:underline" onClick={() => activateTheme(theme.id)}>
                      Aktivér
                    </button>
                  )}
                  <button className="text-river-600 hover:underline" onClick={() => startEdit(theme)}>
                    Redigér
                  </button>
                  {!theme.is_default && (
                    <button className="text-red-500 hover:underline" onClick={() => handleDelete(theme)}>
                      Slet
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <button className="btn-secondary" onClick={startCreate}>
            + Opret nyt tema
          </button>
        </>
      )}

      {mode !== 'idle' && (
        <>
          {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
          <ThemeEditor
            initialColors={editingTheme?.colors}
            initialName={editingTheme?.name}
            busy={busy}
            onCancel={() => setMode('idle')}
            onSave={handleSave}
          />
        </>
      )}
    </section>
  );
}
