import { FormEvent, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useTrip } from '../context/TripContext';
import { useMutate } from '../hooks/useMutate';
import { useToast } from '../components/Toast';
import { DateTimePicker } from '../components/DateTimePicker';
import type { ItineraryItem } from '../lib/types';

function emptyFormFor(startDate: string | null) {
  return {
    title: '',
    address: '',
    starts_at: startDate ? `${startDate}T` : '',
    ends_at: '',
    info: '',
    booking_reference: '',
    contact_info: '',
    cost: '',
  };
}

// Lægger præcis 1 time til et 'YYYY-MM-DDTHH:mm'-tidspunkt, ved udelukkende
// at regne på tallene selv (via Date.UTC) — helt uden om browserens lokale
// tidszone, så beregningen aldrig påvirkes af sommer-/vintertid.
function addOneHour(value: string): string {
  const [datePart, timePart] = value.split('T');
  if (!datePart || !timePart) return value;
  const [y, m, d] = datePart.split('-').map(Number);
  const [h, min] = timePart.split(':').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, h, min));
  dt.setUTCHours(dt.getUTCHours() + 1);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}T${pad(
    dt.getUTCHours()
  )}:${pad(dt.getUTCMinutes())}`;
}

// Gemmes med et fast '+00:00'-suffiks, så databasen aldrig selv omregner
// tidspunktet ud fra en tidszone — de indtastede cifre er dem der gemmes,
// uændret.
function toStorageValue(value: string): string | null {
  if (!value || !value.includes('T') || value.endsWith('T')) return null;
  return `${value}:00+00:00`;
}

// Læser cifrene direkte ud af den gemte streng i stedet for at oprette et
// Date-objekt (som ellers ville konvertere til browserens lokale tid og
// dermed skifte med sommer-/vintertid).
function formatStoredDateTime(iso: string): string {
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) return iso;
  const [, y, m, d, h, min] = match;
  return `${d}/${m}/${y} kl. ${h}:${min}`;
}

/** Datodelen ('YYYY-MM-DD') af et gemt tidspunkt, eller null hvis intet er sat. */
function dateKeyOf(item: ItineraryItem): string | null {
  if (!item.starts_at) return null;
  const match = item.starts_at.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

/** "15/08/2026" ud fra en 'YYYY-MM-DD'-nøgle, uden om Date-objekters tidszone. */
function formatDateKey(dateKey: string): string {
  const [y, m, d] = dateKey.split('-');
  return `${d}/${m}/${y}`;
}

/** "fredag" — regnet i UTC, så det aldrig kan glide en dag pga. tidszone. */
function weekdayOf(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat('da-DK', { weekday: 'long', timeZone: 'UTC' }).format(date);
}

/** Hvilken rejsedag en dato falder på, hvis rejsens startdato er kendt. */
function dayNumberFor(dateKey: string, tripStartDate: string | null): number | null {
  if (!tripStartDate) return null;
  const [y1, m1, d1] = dateKey.split('-').map(Number);
  const [y0, m0, d0] = tripStartDate.split('-').map(Number);
  const diffDays = Math.round(
    (Date.UTC(y1, m1 - 1, d1) - Date.UTC(y0, m0 - 1, d0)) / 86_400_000
  );
  return diffDays + 1;
}

interface DayGroup {
  dateKey: string | null;
  dayNumber: number | null;
  items: ItineraryItem[];
}

export default function ItineraryPage() {
  const { trip, isEditable } = useTrip();
  const mutate = useMutate();
  const { showToast } = useToast();

  const [items, setItems] = useState<ItineraryItem[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyFormFor(null));

  useEffect(() => {
    if (trip) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip?.id]);

  async function load() {
    if (!trip) return;
    const { data } = await supabase
      .from('itinerary_items')
      .select('*')
      .eq('trip_id', trip.id)
      .order('starts_at', { ascending: true, nullsFirst: false })
      .order('sort_order');
    setItems((data as ItineraryItem[]) ?? []);
  }

  // Grupperer i dag-for-dag-blokke i stedet for en flad liste. Punkter er
  // allerede hentet i kronologisk rækkefølge med udaterede punkter sidst
  // (nullsFirst: false), så Map'en bevarer den rækkefølge af sig selv — den
  // udaterede gruppe ender derfor naturligt til sidst.
  const groups = useMemo<DayGroup[]>(() => {
    const map = new Map<string | null, ItineraryItem[]>();
    for (const item of items) {
      const key = dateKeyOf(item);
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    }
    return [...map.entries()].map(([dateKey, groupItems]) => ({
      dateKey,
      dayNumber: dateKey ? dayNumberFor(dateKey, trip?.start_date ?? null) : null,
      items: groupItems,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, trip?.start_date]);

  function openForm(prefillDateKey?: string) {
    const base = emptyFormFor(trip?.start_date ?? null);
    setForm(prefillDateKey ? { ...base, starts_at: `${prefillDateKey}T` } : base);
    setShowForm(true);
  }

  function handleStartsAtChange(value: string) {
    setForm((prev) => {
      const next = { ...prev, starts_at: value };
      // Sluttidspunkt skal altid ligge efter starttidspunktet. Hvis det
      // nuværende sluttidspunkt ikke gør det (eller mangler), rykkes det
      // automatisk til én time efter det nye starttidspunkt.
      if (value && (!prev.ends_at || prev.ends_at <= value)) {
        next.ends_at = addOneHour(value);
      }
      return next;
    });
  }

  function handleEndsAtChange(value: string) {
    setForm((prev) => {
      if (prev.starts_at && value && value <= prev.starts_at) {
        // Ignorér forsøg på at sætte sluttidspunkt før eller lig med
        // starttidspunktet.
        return prev;
      }
      return { ...prev, ends_at: value };
    });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!trip) return;
    if (form.starts_at && form.ends_at && form.ends_at <= form.starts_at) {
      showToast('Sluttidspunktet skal ligge efter starttidspunktet.', 'error');
      return;
    }
    const { ok } = await mutate(
      supabase.from('itinerary_items').insert({
        trip_id: trip.id,
        title: form.title,
        address: form.address || null,
        starts_at: toStorageValue(form.starts_at),
        ends_at: toStorageValue(form.ends_at),
        info: form.info || null,
        booking_reference: form.booking_reference || null,
        contact_info: form.contact_info || null,
        cost: form.cost ? Number(form.cost) : null,
        sort_order: items.length,
      })
    );
    if (!ok) return;
    setForm(emptyFormFor(trip?.start_date ?? null));
    setShowForm(false);
    load();
  }

  async function handleDelete(id: string) {
    if (!confirm('Slet dette punkt fra rejseplanen?')) return;
    const { ok } = await mutate(supabase.from('itinerary_items').delete().eq('id', id));
    if (ok) load();
  }

  function dayHeading(group: DayGroup): string {
    if (!group.dateKey) return 'Uden tidspunkt';
    const dato = formatDateKey(group.dateKey);
    const ugedag = weekdayOf(group.dateKey);
    const ugedagKapital = ugedag.charAt(0).toUpperCase() + ugedag.slice(1);
    return group.dayNumber != null
      ? `Dag ${group.dayNumber} · ${ugedagKapital} ${dato}`
      : `${ugedagKapital} ${dato}`;
  }

  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <div key={group.dateKey ?? 'uden-tidspunkt'} className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-river-800">{dayHeading(group)}</h2>
            {isEditable && group.dateKey && (
              <button
                className="text-xs text-river-500 hover:underline"
                onClick={() => openForm(group.dateKey!)}
              >
                + Tilføj punkt denne dag
              </button>
            )}
          </div>

          <div className="space-y-4">
            {group.items.map((item) => (
              <div key={item.id} className="card p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-river-800">{item.title}</h3>
                    {item.address && <p className="text-sm text-river-500">{item.address}</p>}
                  </div>
                  {isEditable && (
                    <button
                      className="text-xs text-red-500 hover:underline"
                      onClick={() => handleDelete(item.id)}
                    >
                      Slet
                    </button>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-river-500">
                  {item.starts_at && <span>Start: {formatStoredDateTime(item.starts_at)}</span>}
                  {item.ends_at && <span>Slut: {formatStoredDateTime(item.ends_at)}</span>}
                  {item.booking_reference && <span>Booking-ref: {item.booking_reference}</span>}
                  {item.contact_info && <span>Kontakt: {item.contact_info}</span>}
                  {item.cost != null && <span>Pris: {item.cost} kr.</span>}
                </div>
                {item.info && <p className="mt-2 text-sm text-river-600">{item.info}</p>}
              </div>
            ))}
          </div>
        </div>
      ))}

      {items.length === 0 && (
        <div className="card p-8 text-center text-river-400">Ingen punkter i rejseplanen endnu.</div>
      )}

      {isEditable && !showForm && (
        <button className="btn-primary" onClick={() => openForm()}>
          + Tilføj punkt
        </button>
      )}

      {isEditable && showForm && (
        <form onSubmit={handleSubmit} className="card space-y-3 p-5">
          <input
            className="input"
            placeholder="Titel (fx 'Check-in campingplads')"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            required
          />
          <input
            className="input"
            placeholder="Adresse"
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Starttidspunkt</label>
              <DateTimePicker value={form.starts_at} onChange={handleStartsAtChange} />
            </div>
            <div>
              <label className="label">Sluttidspunkt</label>
              <DateTimePicker value={form.ends_at} onChange={handleEndsAtChange} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <input
              className="input"
              placeholder="Booking-reference"
              value={form.booking_reference}
              onChange={(e) => setForm({ ...form, booking_reference: e.target.value })}
            />
            <input
              className="input"
              placeholder="Kontaktinfo"
              value={form.contact_info}
              onChange={(e) => setForm({ ...form, contact_info: e.target.value })}
            />
          </div>
          <input
            type="number"
            step="0.01"
            className="input"
            placeholder="Pris (kr.)"
            value={form.cost}
            onChange={(e) => setForm({ ...form, cost: e.target.value })}
          />
          <textarea
            className="input"
            placeholder="Info/noter"
            value={form.info}
            onChange={(e) => setForm({ ...form, info: e.target.value })}
          />
          <div className="flex gap-2">
            <button className="btn-primary">Gem</button>
            <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>
              Annuller
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
