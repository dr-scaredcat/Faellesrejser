import { FormEvent, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useGudenaaStops } from '../../hooks/useGudenaaStops';

export default function AdminGudenaaPage() {
  const { stops, reload } = useGudenaaStops();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [distance, setDistance] = useState('');
  const [sailTime, setSailTime] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    const nextOrder = stops.length > 0 ? Math.max(...stops.map((s) => s.sort_order)) + 1 : 1;
    const { data, error } = await supabase
      .from('gudenaa_stops')
      .insert({
        name,
        sort_order: nextOrder,
        distance_from_previous_km: Number(distance) || 0,
        sail_time_hours: Number(sailTime) || 0,
        description: description || null,
      })
      .select()
      .single();
    if (error || !data) return;

    const tagList = tags.split(',').map((t) => t.trim()).filter(Boolean);
    if (tagList.length > 0) {
      await supabase.from('gudenaa_stop_tags').insert(tagList.map((tag) => ({ stop_id: data.id, tag })));
    }
    setName('');
    setDistance('');
    setSailTime('');
    setDescription('');
    setTags('');
    setShowForm(false);
    reload();
  }

  async function updateStop(id: string, field: string, value: string | number) {
    await supabase.from('gudenaa_stops').update({ [field]: value }).eq('id', id);
    reload();
  }

  async function deleteStop(id: string) {
    if (!confirm('Slet dette stop? Det kan påvirke eksisterende ruteplaner.')) return;
    await supabase.from('gudenaa_stops').delete().eq('id', id);
    reload();
  }

  return (
    <section className="card p-5">
      <h2 className="mb-3 font-semibold text-river-800">Gudenå-stop</h2>
      <p className="mb-3 text-sm text-river-500">
        Rækkefølgen følger sejlretningen ned ad åen. Afstand og tid er fra det forrige stop.
      </p>

      <div className="space-y-2">
        {stops.map((s) => (
          <details key={s.id} className="rounded-lg border border-river-100 p-3">
            <summary className="cursor-pointer text-sm font-medium text-river-800">
              {s.sort_order}. {s.name}
            </summary>
            <div className="mt-3 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <input
                  className="input"
                  defaultValue={s.name}
                  onBlur={(e) => updateStop(s.id, 'name', e.target.value)}
                />
                <input
                  className="input"
                  type="number"
                  defaultValue={s.sort_order}
                  onBlur={(e) => updateStop(s.id, 'sort_order', Number(e.target.value))}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  className="input"
                  type="number"
                  step="0.1"
                  defaultValue={s.distance_from_previous_km}
                  onBlur={(e) => updateStop(s.id, 'distance_from_previous_km', Number(e.target.value))}
                />
                <input
                  className="input"
                  type="number"
                  step="0.1"
                  defaultValue={s.sail_time_hours}
                  onBlur={(e) => updateStop(s.id, 'sail_time_hours', Number(e.target.value))}
                />
              </div>
              <textarea
                className="input"
                placeholder="Kort beskrivelse"
                defaultValue={s.description ?? ''}
                onBlur={(e) => updateStop(s.id, 'description', e.target.value)}
              />
              <p className="text-xs text-river-400">Tags: {s.tags?.join(', ') || 'ingen'}</p>
              <button className="text-xs text-red-500 hover:underline" onClick={() => deleteStop(s.id)}>
                Slet stop
              </button>
            </div>
          </details>
        ))}
      </div>

      {!showForm && (
        <button className="btn-secondary mt-4" onClick={() => setShowForm(true)}>
          + Tilføj stop
        </button>
      )}

      {showForm && (
        <form onSubmit={handleAdd} className="mt-4 space-y-2 rounded-lg border border-river-100 p-3">
          <input className="input" placeholder="Navn" value={name} onChange={(e) => setName(e.target.value)} required />
          <div className="grid grid-cols-2 gap-2">
            <input
              className="input"
              type="number"
              step="0.1"
              placeholder="Afstand fra forrige (km)"
              value={distance}
              onChange={(e) => setDistance(e.target.value)}
            />
            <input
              className="input"
              type="number"
              step="0.1"
              placeholder="Sejltid fra forrige (t)"
              value={sailTime}
              onChange={(e) => setSailTime(e.target.value)}
            />
          </div>
          <textarea
            className="input"
            placeholder="Kort beskrivelse"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <input
            className="input"
            placeholder="Tags, adskilt af komma (fx Toilet, Bad, Butik)"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
          />
          <div className="flex gap-2">
            <button className="btn-primary">Gem</button>
            <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>
              Annuller
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
