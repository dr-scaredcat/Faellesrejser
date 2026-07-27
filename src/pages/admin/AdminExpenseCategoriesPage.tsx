import { FormEvent, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { ExpenseCategory } from '../../lib/types';

export default function AdminExpenseCategoriesPage() {
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [newName, setNewName] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from('expense_categories').select('*').order('sort_order');
    setCategories((data as ExpenseCategory[]) ?? []);
    setLoading(false);
  }

  async function addCategory(e: FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    const nextOrder = categories.length > 0 ? Math.max(...categories.map((c) => c.sort_order)) + 1 : 0;
    await supabase.from('expense_categories').insert({ name: newName.trim(), sort_order: nextOrder });
    setNewName('');
    load();
  }

  async function renameCategory(id: string, name: string) {
    if (!name.trim()) return;
    await supabase.from('expense_categories').update({ name: name.trim() }).eq('id', id);
    load();
  }

  async function deleteCategory(id: string, name: string) {
    if (
      !confirm(
        `Slet kategorien "${name}"? Eksisterende udgifter i denne kategori beholder navnet som fritekst, men kategorien vil ikke længere kunne vælges til nye udgifter.`
      )
    )
      return;
    await supabase.from('expense_categories').delete().eq('id', id);
    load();
  }

  async function moveCategory(id: string, direction: -1 | 1) {
    const idx = categories.findIndex((c) => c.id === id);
    const swapIdx = idx + direction;
    if (idx === -1 || swapIdx < 0 || swapIdx >= categories.length) return;
    const a = categories[idx];
    const b = categories[swapIdx];
    await Promise.all([
      supabase.from('expense_categories').update({ sort_order: b.sort_order }).eq('id', a.id),
      supabase.from('expense_categories').update({ sort_order: a.sort_order }).eq('id', b.id),
    ]);
    load();
  }

  if (loading) return null;

  return (
    <section className="card p-5">
      <h2 className="mb-1 font-semibold text-river-800">Udgiftskategorier</h2>
      <p className="mb-4 text-sm text-river-500">
        Disse kategorier kan vælges når man opretter en udgift på en rejse, og bruges til at fordele
        forbruget i regnskabsoverblikket.
      </p>

      <ul className="mb-4 divide-y divide-river-100">
        {categories.map((cat, i) => (
          <li key={cat.id} className="flex items-center gap-2 py-2 text-sm">
            <div className="flex flex-col text-xs leading-none">
              <button
                type="button"
                className="text-river-300 hover:text-river-600 disabled:opacity-30"
                disabled={i === 0}
                onClick={() => moveCategory(cat.id, -1)}
                aria-label="Flyt op"
              >
                ▲
              </button>
              <button
                type="button"
                className="text-river-300 hover:text-river-600 disabled:opacity-30"
                disabled={i === categories.length - 1}
                onClick={() => moveCategory(cat.id, 1)}
                aria-label="Flyt ned"
              >
                ▼
              </button>
            </div>
            <input
              className="input flex-1"
              defaultValue={cat.name}
              onBlur={(e) => renameCategory(cat.id, e.target.value)}
            />
            <button
              type="button"
              className="text-xs text-red-500 hover:underline"
              onClick={() => deleteCategory(cat.id, cat.name)}
            >
              Slet
            </button>
          </li>
        ))}
        {categories.length === 0 && <p className="py-2 text-sm text-river-400">Ingen kategorier endnu.</p>}
      </ul>

      <form onSubmit={addCategory} className="flex gap-2">
        <input
          className="input"
          placeholder="Ny kategori (fx 'Aktiviteter')"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <button className="btn-primary shrink-0">Tilføj</button>
      </form>
    </section>
  );
}
