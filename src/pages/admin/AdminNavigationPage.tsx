import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useMutate } from '../../hooks/useMutate';
import {
  DEFAULT_TRIP_NAV_ORDER,
  TRIP_NAV_PAGES,
  parseTripNavOrder,
  serializeTripNavOrder,
  type TripNavPageDef,
} from '../../lib/tripNav';

export default function AdminNavigationPage() {
  const mutate = useMutate();
  const [order, setOrder] = useState<string[]>(DEFAULT_TRIP_NAV_ORDER);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Bruges kun af museklik-træk-og-slip (se note nedenfor).
  const dragIndex = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

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

  function move(index: number, delta: number) {
    setOrder((prev) => {
      const target = index + delta;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setDirty(true);
  }

  // Museklik-træk-og-slip er bevidst et ekstra lag oven på op/ned-knapperne,
  // ikke en erstatning: HTML5's indbyggede drag-and-drop virker ikke med
  // touch i de fleste mobilbrowsere, og appen bruges primært på mobil. Så
  // her er begge dele — knapperne virker altid, trækket er en genvej for
  // dem med mus.
  function handleDragStart(index: number) {
    dragIndex.current = index;
  }

  function handleDragOver(e: React.DragEvent, index: number) {
    e.preventDefault();
    setDragOverIndex(index);
    if (dragIndex.current === null || dragIndex.current === index) return;

    setOrder((prev) => {
      const next = [...prev];
      const [moved] = next.splice(dragIndex.current!, 1);
      next.splice(index, 0, moved);
      return next;
    });
    dragIndex.current = index;
    setDirty(true);
  }

  function handleDragEnd() {
    dragIndex.current = null;
    setDragOverIndex(null);
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

  const pageByKey = new Map(TRIP_NAV_PAGES.map((p) => [p.key, p]));

  if (loading) return <p className="text-river-500">Indlæser…</p>;

  return (
    <section className="card space-y-4 p-5">
      <div>
        <h2 className="font-semibold text-river-800">Navigation</h2>
        <p className="mt-1 text-sm text-river-500">
          Rækkefølgen af faner på en rejse. Gælder alle rejser — de tre Gudenå-specifikke sider vises kun
          på Gudenå-ture, men deres placering i rækkefølgen bevares alligevel.
        </p>
      </div>

      <ul className="space-y-1">
        {order.map((key, index) => {
          const page = pageByKey.get(key) as TripNavPageDef | undefined;
          if (!page) return null;
          const isDragTarget = dragOverIndex === index;

          return (
            <li
              key={key}
              draggable
              onDragStart={() => handleDragStart(index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragEnd={handleDragEnd}
              className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${
                isDragTarget ? 'border-river-400 bg-river-50' : 'border-river-100'
              }`}
            >
              <span
                className="cursor-grab select-none text-river-300 hover:text-river-500 active:cursor-grabbing"
                aria-hidden="true"
                title="Træk for at flytte"
              >
                <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor">
                  <circle cx="7" cy="5" r="1.3" />
                  <circle cx="13" cy="5" r="1.3" />
                  <circle cx="7" cy="10" r="1.3" />
                  <circle cx="13" cy="10" r="1.3" />
                  <circle cx="7" cy="15" r="1.3" />
                  <circle cx="13" cy="15" r="1.3" />
                </svg>
              </span>

              <span className="flex-1 text-sm text-river-800">
                {page.label}
                {page.gudenaaOnly && (
                  <span className="ml-2 rounded-full bg-sand-100 px-2 py-0.5 text-xs font-medium text-sand-600">
                    Kun Gudenåen
                  </span>
                )}
              </span>

              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  className="rounded px-1.5 py-0.5 text-river-400 hover:bg-river-50 hover:text-river-700 disabled:opacity-30"
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                  aria-label={`Flyt ${page.label} op`}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="rounded px-1.5 py-0.5 text-river-400 hover:bg-river-50 hover:text-river-700 disabled:opacity-30"
                  onClick={() => move(index, 1)}
                  disabled={index === order.length - 1}
                  aria-label={`Flyt ${page.label} ned`}
                >
                  ↓
                </button>
              </div>
            </li>
          );
        })}
      </ul>

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
