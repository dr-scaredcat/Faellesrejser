import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useMutate } from '../../hooks/useMutate';
import { DraggableNavList } from '../../components/DraggableNavList';
import {
  DEFAULT_TRIP_NAV_ORDER,
  TRIP_NAV_PAGES,
  parseTripNavOrder,
  serializeTripNavOrder,
} from '../../lib/tripNav';

export default function AdminNavigationPage() {
  const mutate = useMutate();
  const [order, setOrder] = useState<string[]>(DEFAULT_TRIP_NAV_ORDER);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from('admin_settings')
      .select('value')
      .eq('key', 'trip_nav_order')
      .maybeSingle();
    setOrder(parseTripNavOrder(data?.value as string | undefined));
    setDirty(false);
    setLoading(false);
  }

  function handleOrderChange(next: string[]) {
    setOrder(next);
    setDirty(true);
  }

  async function handleSave() {
    setSaving(true);
    const { ok } = await mutate(
      supabase
        .from('admin_settings')
        .upsert({ key: 'trip_nav_order', value: serializeTripNavOrder(order) }, { onConflict: 'key' }),
      { success: 'Rækkefølgen er gemt.' }
    );
    setSaving(false);
    if (ok) setDirty(false);
  }

  function handleReset() {
    setOrder(DEFAULT_TRIP_NAV_ORDER);
    setDirty(true);
  }

  const items = TRIP_NAV_PAGES.map((p) => ({
    key: p.key,
    label: p.label,
    badge: p.gudenaaOnly ? 'Kun Gudenåen' : undefined,
  }));

  if (loading) return <p className="text-river-500">Indlæser…</p>;

  return (
    <section className="card space-y-4 p-5">
      <div>
        <h2 className="font-semibold text-river-800">Navigation</h2>
        <p className="mt-1 text-sm text-river-500">
          Standardrækkefølgen af faner på en rejse. Gælder alle rejser, medmindre en rejse selv har sat
          sin egen rækkefølge fra Overblik-siden — de tre Gudenå-specifikke sider vises altid kun på
          Gudenå-ture, men deres placering i rækkefølgen bevares alligevel.
        </p>
      </div>

      <DraggableNavList items={items} order={order} onOrderChange={handleOrderChange} />

      <div className="flex gap-2 border-t border-river-100 pt-4">
        <button className="btn-primary" onClick={handleSave} disabled={!dirty || saving}>
          {saving ? 'Gemmer…' : 'Gem rækkefølge'}
        </button>
        <button type="button" className="btn-secondary" onClick={handleReset} disabled={saving}>
          Nulstil til standard
        </button>
      </div>
    </section>
  );
}
