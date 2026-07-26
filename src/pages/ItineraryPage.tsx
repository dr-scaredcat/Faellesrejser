import { FormEvent, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useTrip } from '../context/TripContext';
import type { ItineraryItem } from '../lib/types';

const emptyForm = {
  title: '',
  address: '',
  starts_at: '',
  ends_at: '',
  info: '',
  booking_reference: '',
  contact_info: '',
  cost: '',
};

export default function ItineraryPage() {
  const { trip, isEditable } = useTrip();
  const [items, setItems] = useState<ItineraryItem[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);

  useEffect(() => {
    if (trip) load();
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

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!trip) return;
    await supabase.from('itinerary_items').insert({
      trip_id: trip.id,
      title: form.title,
      address: form.address || null,
      starts_at: form.starts_at || null,
      ends_at: form.ends_at || null,
      info: form.info || null,
      booking_reference: form.booking_reference || null,
      contact_info: form.contact_info || null,
      cost: form.cost ? Number(form.cost) : null,
      sort_order: items.length,
    });
    setForm(emptyForm);
    setShowForm(false);
    load();
  }

  async function handleDelete(id: string) {
    if (!confirm('Slet dette punkt fra rejseplanen?')) return;
    await supabase.from('itinerary_items').delete().eq('id', id);
    load();
  }

  return (
    <div className="space-y-4">
      {items.map((item) => (
        <div key={item.id} className="card p-5">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="font-semibold text-river-800">{item.title}</h3>
              {item.address && <p className="text-sm text-river-500">{item.address}</p>}
            </div>
            {isEditable && (
              <button className="text-xs text-red-500 hover:underline" onClick={() => handleDelete(item.id)}>
                Slet
              </button>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-river-500">
            {item.starts_at && <span>Start: {new Date(item.starts_at).toLocaleString('da-DK')}</span>}
            {item.ends_at && <span>Slut: {new Date(item.ends_at).toLocaleString('da-DK')}</span>}
            {item.booking_reference && <span>Booking-ref: {item.booking_reference}</span>}
            {item.contact_info && <span>Kontakt: {item.contact_info}</span>}
            {item.cost != null && <span>Pris: {item.cost} kr.</span>}
          </div>
          {item.info && <p className="mt-2 text-sm text-river-600">{item.info}</p>}
        </div>
      ))}

      {items.length === 0 && (
        <div className="card p-8 text-center text-river-400">Ingen punkter i rejseplanen endnu.</div>
      )}

      {isEditable && !showForm && (
        <button className="btn-primary" onClick={() => setShowForm(true)}>
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
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Starttidspunkt</label>
              <input
                type="datetime-local"
                className="input"
                value={form.starts_at}
                onChange={(e) => setForm({ ...form, starts_at: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Sluttidspunkt</label>
              <input
                type="datetime-local"
                className="input"
                value={form.ends_at}
                onChange={(e) => setForm({ ...form, ends_at: e.target.value })}
              />
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
            placeholder="Yderligere info"
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
