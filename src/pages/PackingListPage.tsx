import { FormEvent, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useTrip } from '../context/TripContext';
import { useAuth } from '../context/AuthContext';
import type { PackingCategory, PackingItem, PackingItemStatus } from '../lib/types';

export default function PackingListPage() {
  const { trip, namesById, isEditable } = useTrip();
  const { profile } = useAuth();
  const [categories, setCategories] = useState<PackingCategory[]>([]);
  const [items, setItems] = useState<Record<string, PackingItem[]>>({});
  const [statuses, setStatuses] = useState<Record<string, PackingItemStatus[]>>({});
  const [newCategory, setNewCategory] = useState('');
  const [newItemName, setNewItemName] = useState<Record<string, string>>({});

  useEffect(() => {
    if (trip) load();
  }, [trip?.id]);

  async function load() {
    if (!trip) return;
    const { data: cats } = await supabase
      .from('packing_categories')
      .select('*')
      .eq('trip_id', trip.id)
      .order('sort_order');
    setCategories((cats as PackingCategory[]) ?? []);

    const catIds = (cats ?? []).map((c) => c.id);
    if (catIds.length === 0) {
      setItems({});
      setStatuses({});
      return;
    }

    const { data: allItems } = await supabase
      .from('packing_items')
      .select('*')
      .in('category_id', catIds);

    const itemsByCat: Record<string, PackingItem[]> = {};
    for (const item of (allItems as PackingItem[]) ?? []) {
      itemsByCat[item.category_id] = itemsByCat[item.category_id] ?? [];
      itemsByCat[item.category_id].push(item);
    }
    // Alfabetisk rækkefølge (dansk sortering), så nye genstande automatisk
    // havner det rigtige sted i listen.
    for (const catId of Object.keys(itemsByCat)) {
      itemsByCat[catId].sort((a, b) => a.name.localeCompare(b.name, 'da'));
    }
    setItems(itemsByCat);

    const itemIds = (allItems ?? []).map((i) => i.id);
    if (itemIds.length === 0) {
      setStatuses({});
      return;
    }

    const { data: statusData } = await supabase
      .from('packing_item_status')
      .select('*, profile:profiles(*)')
      .in('item_id', itemIds)
      .eq('packed', true);

    const statusByItem: Record<string, PackingItemStatus[]> = {};
    for (const s of (statusData as unknown as PackingItemStatus[]) ?? []) {
      statusByItem[s.item_id] = statusByItem[s.item_id] ?? [];
      statusByItem[s.item_id].push(s);
    }
    setStatuses(statusByItem);
  }

  async function addCategory(e: FormEvent) {
    e.preventDefault();
    if (!trip || !newCategory.trim()) return;
    await supabase.from('packing_categories').insert({
      trip_id: trip.id,
      name: newCategory.trim(),
      sort_order: categories.length,
    });
    setNewCategory('');
    load();
  }

  async function addItem(categoryId: string, e: FormEvent) {
    e.preventDefault();
    const name = newItemName[categoryId]?.trim();
    if (!name || !profile) return;
    await supabase.from('packing_items').insert({
      category_id: categoryId,
      name,
      created_by: profile.id,
    });
    setNewItemName((prev) => ({ ...prev, [categoryId]: '' }));
    load();
  }

  async function togglePacked(itemId: string, currentlyPacked: boolean) {
    if (!profile) return;
    if (currentlyPacked) {
      await supabase
        .from('packing_item_status')
        .delete()
        .eq('item_id', itemId)
        .eq('user_id', profile.id);
    } else {
      await supabase.from('packing_item_status').upsert({
        item_id: itemId,
        user_id: profile.id,
        packed: true,
        packed_at: new Date().toISOString(),
      });
    }
    load();
  }

  async function deleteItem(itemId: string) {
    if (!confirm('Slet denne genstand fra pakkelisten?')) return;
    await supabase.from('packing_items').delete().eq('id', itemId);
    load();
  }

  return (
    <div className="space-y-5">
      {categories.map((cat) => (
        <div key={cat.id} className="card p-5">
          <h2 className="mb-3 font-semibold text-river-800">{cat.name}</h2>
          <ul className="mb-3 space-y-0.5">
            {(items[cat.id] ?? []).map((item, index) => {
              const packedBy = statuses[item.id] ?? [];
              const iPacked = packedBy.some((s) => s.user_id === profile?.id);
              return (
                <li
                  key={item.id}
                  className={`flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm ${
                    index % 2 === 1 ? 'bg-river-50' : ''
                  }`}
                >
                  <label className="flex flex-1 items-center gap-2">
                    <input
                      type="checkbox"
                      checked={iPacked}
                      onChange={() => togglePacked(item.id, iPacked)}
                    />
                    <span
                      className="cursor-pointer select-none"
                      onClick={() => togglePacked(item.id, iPacked)}
                    >
                      {item.name}
                    </span>
                  </label>
                  <div className="flex shrink-0 items-center gap-2">
                    {packedBy.length > 0 && (
                      <span className="text-xs text-river-400">
                        Pakket af {packedBy.map((s) => namesById[s.user_id] ?? '?').join(', ')}
                      </span>
                    )}
                    {isEditable && (
                      <button
                        className="text-xs text-red-500 hover:underline"
                        onClick={() => deleteItem(item.id)}
                      >
                        Slet
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
            {(items[cat.id] ?? []).length === 0 && (
              <li className="px-2 text-sm text-river-400">Ingen genstande endnu.</li>
            )}
          </ul>
          {isEditable && (
            <form onSubmit={(e) => addItem(cat.id, e)} className="flex gap-2">
              <input
                className="input"
                placeholder="Ny genstand"
                value={newItemName[cat.id] ?? ''}
                onChange={(e) => setNewItemName((prev) => ({ ...prev, [cat.id]: e.target.value }))}
              />
              <button className="btn-secondary shrink-0">Tilføj</button>
            </form>
          )}
        </div>
      ))}

      {isEditable && (
        <form onSubmit={addCategory} className="card flex gap-2 p-5">
          <input
            className="input"
            placeholder="Ny kategori (fx 'Køkkengrej')"
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
          />
          <button className="btn-primary shrink-0">Opret kategori</button>
        </form>
      )}
    </div>
  );
}
