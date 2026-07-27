import { FormEvent, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useGudenaaStops } from '../../hooks/useGudenaaStops';
import { useMutate } from '../../hooks/useMutate';
import { COMPASS_DEGREES, COMPASS_POINTS, compassFromDegrees } from '../../lib/windEffect';

export default function AdminGudenaaPage() {
  const { stops, reload } = useGudenaaStops();
  const mutate = useMutate();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [distance, setDistance] = useState('');
  const [sailTime, setSailTime] = useState('');
  const [bearing, setBearing] = useState<number | null>(null);
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [newTagByStop, setNewTagByStop] = useState<Record<string, string>>({});

  const missingBearings = stops.filter((s) => s.bearing_degrees == null).length;

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    const nextOrder = stops.length > 0 ? Math.max(...stops.map((s) => s.sort_order)) + 1 : 1;

    const { data, ok } = await mutate(
      supabase
        .from('gudenaa_stops')
        .insert({
          name,
          sort_order: nextOrder,
          distance_from_previous_km: Number(distance) || 0,
          sail_time_hours: Number(sailTime) || 0,
          bearing_degrees: bearing,
          description: description || null,
        })
        .select()
        .single()
    );
    if (!ok || !data) return;

    const tagList = tags.split(',').map((t) => t.trim()).filter(Boolean);
    if (tagList.length > 0) {
      await mutate(
        supabase
          .from('gudenaa_stop_tags')
          .insert(tagList.map((tag) => ({ stop_id: (data as { id: string }).id, tag })))
      );
    }
    setName('');
    setDistance('');
    setSailTime('');
    setBearing(null);
    setDescription('');
    setTags('');
    setShowForm(false);
    reload();
  }

  async function updateStop(id: string, field: string, value: string | number | null) {
    const { ok } = await mutate(supabase.from('gudenaa_stops').update({ [field]: value }).eq('id', id));
    if (ok) reload();
  }

  async function deleteStop(id: string) {
    if (!confirm('Slet dette stop? Det kan påvirke eksisterende ruteplaner.')) return;
    const { ok } = await mutate(supabase.from('gudenaa_stops').delete().eq('id', id));
    if (ok) reload();
  }

  async function addTag(stopId: string) {
    const tag = (newTagByStop[stopId] ?? '').trim();
    if (!tag) return;
    const { ok } = await mutate(supabase.from('gudenaa_stop_tags').insert({ stop_id: stopId, tag }));
    if (!ok) return;
    setNewTagByStop((prev) => ({ ...prev, [stopId]: '' }));
    reload();
  }

  async function removeTag(stopId: string, tag: string) {
    const { ok } = await mutate(
      supabase.from('gudenaa_stop_tags').delete().eq('stop_id', stopId).eq('tag', tag)
    );
    if (ok) reload();
  }

  return (
    <section className="card p-5">
      <h2 className="mb-3 font-semibold text-river-800">Gudenå-stop</h2>
      <p className="mb-3 text-sm text-river-500">
        Rækkefølgen følger sejlretningen ned ad åen. Afstand, tid og retning er fra det forrige stop.
      </p>

      {stops.length > 0 && missingBearings > 0 && (
        <p className="mb-3 rounded-lg bg-sand-100 p-3 text-sm text-river-600">
          {missingBearings} af {stops.length} stop mangler en retning. Vindberegningen springer de stræk
          over, så udfyld dem gerne — også et groft skøn er bedre end ingenting.
        </p>
      )}

      <div className="space-y-2">
        {stops.map((s) => (
          <details key={s.id} className="rounded-lg border border-river-100 p-3">
            <summary className="cursor-pointer text-sm font-medium text-river-800">
              {s.sort_order}. {s.name}
              {s.bearing_degrees != null ? (
                <span className="ml-2 text-xs font-normal text-river-400">
                  {compassFromDegrees(s.bearing_degrees)}
                </span>
              ) : (
                <span className="ml-2 text-xs font-normal text-sand-600">retning mangler</span>
              )}
            </summary>
            <div className="mt-3 space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label">Navn</label>
                  <input
                    className="input"
                    defaultValue={s.name}
                    onBlur={(e) => updateStop(s.id, 'name', e.target.value)}
                  />
                </div>
                <div>
                  <label className="label">Nummer på ruten (rækkefølge)</label>
                  <input
                    className="input"
                    type="number"
                    defaultValue={s.sort_order}
                    onBlur={(e) => updateStop(s.id, 'sort_order', Number(e.target.value))}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label">Distance fra forrige stop (km)</label>
                  <input
                    className="input"
                    type="number"
                    step="0.1"
                    defaultValue={s.distance_from_previous_km}
                    onBlur={(e) => updateStop(s.id, 'distance_from_previous_km', Number(e.target.value))}
                  />
                </div>
                <div>
                  <label className="label">Sejltid fra forrige stop (t)</label>
                  <input
                    className="input"
                    type="number"
                    step="0.1"
                    defaultValue={s.sail_time_hours}
                    onBlur={(e) => updateStop(s.id, 'sail_time_hours', Number(e.target.value))}
                  />
                </div>
              </div>

              <BearingPicker
                value={s.bearing_degrees}
                onChange={(v) => updateStop(s.id, 'bearing_degrees', v)}
              />

              <div>
                <label className="label">Beskrivelse</label>
                <textarea
                  className="input"
                  placeholder="Kort beskrivelse"
                  defaultValue={s.description ?? ''}
                  onBlur={(e) => updateStop(s.id, 'description', e.target.value)}
                />
              </div>

              <div>
                <label className="label">Tags</label>
                <div className="mb-2 flex flex-wrap gap-1">
                  {(s.tags ?? []).map((tag) => (
                    <span
                      key={tag}
                      className="flex items-center gap-1 rounded-full bg-river-100 px-2 py-0.5 text-xs text-river-600"
                    >
                      {tag}
                      <button
                        type="button"
                        className="text-river-400 hover:text-red-500"
                        onClick={() => removeTag(s.id, tag)}
                        aria-label={`Fjern tag ${tag}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  {(s.tags ?? []).length === 0 && (
                    <span className="text-xs text-river-400">Ingen tags endnu</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <input
                    className="input"
                    placeholder="Nyt tag (fx 'Toilet')"
                    value={newTagByStop[s.id] ?? ''}
                    onChange={(e) => setNewTagByStop((prev) => ({ ...prev, [s.id]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addTag(s.id);
                      }
                    }}
                  />
                  <button type="button" className="btn-secondary shrink-0" onClick={() => addTag(s.id)}>
                    Tilføj tag
                  </button>
                </div>
              </div>

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
          <div>
            <label className="label">Navn</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">Distance fra forrige stop (km)</label>
              <input
                className="input"
                type="number"
                step="0.1"
                value={distance}
                onChange={(e) => setDistance(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Sejltid fra forrige stop (t)</label>
              <input
                className="input"
                type="number"
                step="0.1"
                value={sailTime}
                onChange={(e) => setSailTime(e.target.value)}
              />
            </div>
          </div>

          <BearingPicker value={bearing} onChange={setBearing} />

          <div>
            <label className="label">Beskrivelse</label>
            <textarea
              className="input"
              placeholder="Kort beskrivelse"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Tags ved oprettelse (adskilt af komma)</label>
            <input
              className="input"
              placeholder="fx Toilet, Bad, Butik"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
            />
          </div>
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

/**
 * Vælger for strækningens retning.
 *
 * Otte knapper, men værdien gemmes som grader — så et enkelt stræk kan
 * finjusteres senere uden at datamodellen skal laves om. Pilen peger den vej,
 * strækket går, så man kan se med det samme om det ser rigtigt ud.
 */
function BearingPicker({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  return (
    <div>
      <label className="label">Retning fra forrige stop</label>
      <p className="mb-2 text-xs text-river-400">
        Den retning strækket samlet set går. Åen bugter sig, så det er nødvendigvis et skøn — beregningen
        tager højde for, at retningen skifter undervejs.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {COMPASS_POINTS.map((point) => {
            const degrees = COMPASS_DEGREES[point];
            const active = value != null && Math.round(value) === degrees;
            return (
              <button
                key={point}
                type="button"
                onClick={() => onChange(degrees)}
                className={`rounded-lg border px-2.5 py-1 text-xs ${
                  active
                    ? 'border-river-500 bg-river-500 text-white'
                    : 'border-river-200 text-river-600 hover:border-river-400'
                }`}
              >
                {point}
              </button>
            );
          })}
        </div>

        {value != null && (
          <>
            <svg
              viewBox="0 0 24 24"
              className="h-7 w-7 shrink-0 text-river-600"
              style={{ transform: `rotate(${value}deg)` }}
              aria-hidden="true"
            >
              <path
                d="M12 3 L12 21 M12 3 L7 9 M12 3 L17 9"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <button
              type="button"
              className="text-xs text-river-400 hover:text-red-500 hover:underline"
              onClick={() => onChange(null)}
            >
              Ryd
            </button>
          </>
        )}
      </div>
    </div>
  );
}
