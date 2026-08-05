import { FormEvent, useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useGudenaaStops } from '../../hooks/useGudenaaStops';
import { useMutate } from '../../hooks/useMutate';
import { useToast } from '../../components/Toast';
import { useStorageImageUrl } from '../../hooks/useStorageImageUrl';
import { COMPASS_DEGREES, COMPASS_POINTS, compassFromDegrees } from '../../lib/windEffect';
import type { GudenaaMapSection } from '../../lib/types';

const MAP_BUCKET = 'gudenaa-maps';

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
    <div className="space-y-6">
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

      <MapEditor />
    </div>
  );
}

/**
 * Vælger for strækningens retning.
 *
 * Otte knapper, men værdien gemmes som grader — så et enkelt stræk kan
 * finjusteres senere uden at datamodellen skal laves om. Pilen peger den vej,
 * strækket går, så man kan se med det samme om det ser rigtigt ud.
 */
/**
 * Kortstyring: upload af oversigtskortet, og markering af de rektangler på
 * det, der åbner et mere detaljeret udsnit.
 *
 * Selve tegningen af et rektangel foregår med musen/fingeren direkte på
 * oversigtsbilledet: tryk ned, træk, slip. Koordinaterne regnes ud som
 * procent af billedets bredde/højde ud fra billedets egen boks
 * (getBoundingClientRect), ikke skærmens — det er derfor afgørende, at
 * billedet her vises i sin naturlige størrelse UDEN zoom/panorering, som
 * ellers ville gøre regnestykket forkert. Det er samme grund til, at
 * ZoomableImage ikke bruges her, kun på selve visningssiden.
 */
function MapEditor() {
  const mutate = useMutate();
  const { showToast } = useToast();
  const imgRef = useRef<HTMLImageElement>(null);
  const { stops, reload: reloadStops } = useGudenaaStops();

  const [overviewPath, setOverviewPath] = useState<string | null>(null);
  const [sections, setSections] = useState<GudenaaMapSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadingOverview, setUploadingOverview] = useState(false);

  const [drawing, setDrawing] = useState(false);
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);
  const [current, setCurrent] = useState<{ x: number; y: number } | null>(null);
  const [pendingRect, setPendingRect] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const [sectionLabel, setSectionLabel] = useState('');
  const [sectionFile, setSectionFile] = useState<File | null>(null);
  const [savingSection, setSavingSection] = useState(false);

  // Placering af stop på kortet. Er der valgt et stop her, sætter et klik på
  // kortet dets position i stedet for at tegne et rektangel.
  const [placingStopId, setPlacingStopId] = useState<string | null>(null);
  const [computingBearings, setComputingBearings] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const [{ data: setting }, { data: sectionData }] = await Promise.all([
      supabase
        .from('admin_settings')
        .select('value')
        .eq('key', 'gudenaa_map_overview_path')
        .maybeSingle(),
      supabase.from('gudenaa_map_sections').select('*').order('sort_order'),
    ]);
    setOverviewPath((setting?.value as string | undefined) ?? null);
    setSections((sectionData as GudenaaMapSection[]) ?? []);
    setLoading(false);
  }

  // Bucketten er privat, så billedet skal hentes via download() (respekterer
  // login og adgangsregler) i stedet for getPublicUrl(), som kun virker på
  // offentlige buckets og ellers giver et knækket billede.
  const overviewUrl = useStorageImageUrl(MAP_BUCKET, overviewPath);

  async function handleOverviewUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setUploadingOverview(true);
    const path = `oversigt.${file.name.split('.').pop() ?? 'png'}`;

    const { error: uploadError } = await supabase.storage
      .from(MAP_BUCKET)
      .upload(path, file, { upsert: true });

    if (uploadError) {
      showToast(`Kunne ikke uploade billedet: ${uploadError.message}`, 'error');
      setUploadingOverview(false);
      return;
    }

    const { ok } = await mutate(
      supabase
        .from('admin_settings')
        .upsert({ key: 'gudenaa_map_overview_path', value: path }, { onConflict: 'key' }),
      { success: 'Oversigtskortet er opdateret.' }
    );
    setUploadingOverview(false);
    if (ok) load();
  }

  function percentFromEvent(e: React.PointerEvent<HTMLDivElement>) {
    const rect = imgRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    return { x: Math.min(100, Math.max(0, x)), y: Math.min(100, Math.max(0, y)) };
  }

  async function placeStop(stopId: string, p: { x: number; y: number }) {
    const { ok } = await mutate(
      supabase
        .from('gudenaa_stops')
        .update({ map_x_percent: p.x, map_y_percent: p.y })
        .eq('id', stopId)
    );
    if (!ok) return;
    setPlacingStopId(null);
    reloadStops();
  }

  /**
   * Regner retningen mellem hvert par af på-hinanden-følgende stop ud af
   * deres placering på kortet, og skriver resultatet til bearing_degrees.
   *
   * To ting er afgørende for at det bliver rigtigt:
   *
   *  - Kortet skal være nord-op, hvilket det er. Derfor er "op" på billedet
   *    lig nord, og et almindeligt atan2 giver kompasretningen direkte.
   *
   *  - Positionerne er gemt som procent af henholdsvis bredde og højde, som
   *    IKKE er samme enhed, medmindre billedet er kvadratisk. De ganges
   *    derfor op med billedets faktiske pixelmål, før retningen beregnes —
   *    ellers ville et aflangt kort give systematisk skæve retninger.
   */
  async function computeBearingsFromMap() {
    const img = imgRef.current;
    if (!img || !img.naturalWidth || !img.naturalHeight) {
      showToast('Kortet er ikke indlæst endnu — prøv igen om et øjeblik.', 'error');
      return;
    }

    const sorted = [...stops].sort((a, b) => a.sort_order - b.sort_order);
    const opdateringer: { id: string; bearing: number }[] = [];

    for (let i = 1; i < sorted.length; i++) {
      const fra = sorted[i - 1];
      const til = sorted[i];
      if (
        fra.map_x_percent == null ||
        fra.map_y_percent == null ||
        til.map_x_percent == null ||
        til.map_y_percent == null
      ) {
        continue;
      }

      const dx = ((til.map_x_percent - fra.map_x_percent) / 100) * img.naturalWidth;
      // Billedets y-akse vokser nedad, mens nord er opad — derfor det
      // omvendte fortegn.
      const dy = ((til.map_y_percent - fra.map_y_percent) / 100) * img.naturalHeight;
      const nord = -dy;

      if (Math.abs(dx) < 1e-6 && Math.abs(nord) < 1e-6) continue;

      const grader = (((Math.atan2(dx, nord) * 180) / Math.PI) % 360 + 360) % 360;
      opdateringer.push({ id: til.id, bearing: Math.round(grader) });
    }

    if (opdateringer.length === 0) {
      showToast(
        'Ingen retninger kunne beregnes. Placér mindst to på-hinanden-følgende stop på kortet først.',
        'error'
      );
      return;
    }

    setComputingBearings(true);
    for (const u of opdateringer) {
      const { ok } = await mutate(
        supabase.from('gudenaa_stops').update({ bearing_degrees: u.bearing }).eq('id', u.id),
        { toastOnError: false }
      );
      if (!ok) {
        setComputingBearings(false);
        showToast('Noget gik galt undervejs — ikke alle retninger blev opdateret.', 'error');
        reloadStops();
        return;
      }
    }
    setComputingBearings(false);
    showToast(
      `${opdateringer.length} retning${opdateringer.length === 1 ? '' : 'er'} beregnet ud fra kortet.`,
      'success'
    );
    reloadStops();
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const p = percentFromEvent(e);
    if (!p) return;

    if (placingStopId) {
      placeStop(placingStopId, p);
      return;
    }

    if (!drawing) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setStart(p);
    setCurrent(p);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!drawing || !start) return;
    const p = percentFromEvent(e);
    if (p) setCurrent(p);
  }

  function handlePointerUp() {
    if (!drawing || !start || !current) return;

    const rect = {
      x: Math.min(start.x, current.x),
      y: Math.min(start.y, current.y),
      width: Math.abs(current.x - start.x),
      height: Math.abs(current.y - start.y),
    };

    setStart(null);
    setCurrent(null);
    setDrawing(false);

    if (rect.width < 1 || rect.height < 1) {
      showToast('Rektanglet er for lille — prøv at trække en større firkant.', 'error');
      return;
    }
    setPendingRect(rect);
  }

  async function handleSaveSection(e: FormEvent) {
    e.preventDefault();
    if (!pendingRect || !sectionFile || !sectionLabel.trim()) return;

    setSavingSection(true);
    const filename = `sektioner/${crypto.randomUUID()}.${sectionFile.name.split('.').pop() ?? 'png'}`;

    const { error: uploadError } = await supabase.storage
      .from(MAP_BUCKET)
      .upload(filename, sectionFile);

    if (uploadError) {
      showToast(`Kunne ikke uploade billedet: ${uploadError.message}`, 'error');
      setSavingSection(false);
      return;
    }

    const { ok } = await mutate(
      supabase.from('gudenaa_map_sections').insert({
        label: sectionLabel.trim(),
        storage_path: filename,
        x_percent: pendingRect.x,
        y_percent: pendingRect.y,
        width_percent: pendingRect.width,
        height_percent: pendingRect.height,
        sort_order: sections.length,
      }),
      { success: 'Kortudsnittet er tilføjet.' }
    );

    setSavingSection(false);
    if (!ok) return;

    setPendingRect(null);
    setSectionLabel('');
    setSectionFile(null);
    load();
  }

  async function handleDeleteSection(section: GudenaaMapSection) {
    if (!confirm(`Slet kortudsnittet "${section.label}"?`)) return;
    const { ok } = await mutate(supabase.from('gudenaa_map_sections').delete().eq('id', section.id));
    if (!ok) return;
    // Selve billedfilen ryddes også op, men fejler dette af en eller anden
    // grund, er det ikke kritisk — den ligger bare og fylder lidt i Storage.
    await supabase.storage.from(MAP_BUCKET).remove([section.storage_path]);
    load();
  }

  if (loading) return null;

  const previewRect =
    drawing && start && current
      ? {
          x: Math.min(start.x, current.x),
          y: Math.min(start.y, current.y),
          width: Math.abs(current.x - start.x),
          height: Math.abs(current.y - start.y),
        }
      : null;

  return (
    <section className="card space-y-4 p-5">
      <div>
        <h2 className="font-semibold text-river-800">Kort</h2>
        <p className="mt-1 text-sm text-river-500">
          Oversigtskortet vises på "Kort"-siden på Gudenå-ture, med klikbare områder der åbner et mere
          detaljeret udsnit.
        </p>
      </div>

      <div>
        <label className="label">Oversigtskort (PNG eller JPG)</label>
        <input
          type="file"
          accept="image/png,image/jpeg"
          onChange={handleOverviewUpload}
          disabled={uploadingOverview}
          className="input"
        />
        {uploadingOverview && <p className="mt-1 text-xs text-river-400">Uploader…</p>}
      </div>

      {overviewPath && !overviewUrl && (
        <p className="text-sm text-river-400">Henter forhåndsvisning…</p>
      )}

      {overviewUrl && (
        <>
          <div>
            {placingStopId ? (
              <p className="text-sm text-river-600">
                Tryk på kortet der, hvor{' '}
                <strong>{stops.find((s) => s.id === placingStopId)?.name ?? 'stoppet'}</strong> ligger.{' '}
                <button
                  type="button"
                  className="text-river-500 underline"
                  onClick={() => setPlacingStopId(null)}
                >
                  Annuller
                </button>
              </p>
            ) : !drawing ? (
              <button type="button" className="btn-secondary" onClick={() => setDrawing(true)}>
                + Tilføj kortudsnit
              </button>
            ) : (
              <p className="text-sm text-river-600">
                Træk en firkant på kortet omkring det område, det detaljerede udsnit dækker.{' '}
                <button
                  type="button"
                  className="text-river-500 underline"
                  onClick={() => {
                    setDrawing(false);
                    setStart(null);
                    setCurrent(null);
                  }}
                >
                  Annuller
                </button>
              </p>
            )}
          </div>

          <div
            className="relative touch-none select-none"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          >
            <img
              ref={imgRef}
              src={overviewUrl}
              alt="Oversigtskort over Gudenåen"
              className="block w-full select-none"
              draggable={false}
            />

            {sections.map((s) => (
              <div
                key={s.id}
                className="absolute flex items-center justify-center border-2 border-river-500 bg-river-500/15"
                style={{
                  left: `${s.x_percent}%`,
                  top: `${s.y_percent}%`,
                  width: `${s.width_percent}%`,
                  height: `${s.height_percent}%`,
                }}
              >
                <span className="rounded bg-river-800/80 px-1.5 py-0.5 text-xs text-white">
                  {s.label}
                </span>
              </div>
            ))}

            {/* Placerede stop, som prikker med nummer. Nummeret er stoppets
                plads i sejlretningen, så man kan se om kæden følger åen. */}
            {[...stops]
              .sort((a, b) => a.sort_order - b.sort_order)
              .map((s, index) =>
                s.map_x_percent != null && s.map_y_percent != null ? (
                  <span
                    key={s.id}
                    title={s.name}
                    className="pointer-events-none absolute flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-sand-600 text-[10px] font-medium text-white shadow"
                    style={{ left: `${s.map_x_percent}%`, top: `${s.map_y_percent}%` }}
                  >
                    {index + 1}
                  </span>
                ) : null
              )}

            {previewRect && (
              <div
                className="absolute border-2 border-dashed border-sand-500 bg-sand-300/25"
                style={{
                  left: `${previewRect.x}%`,
                  top: `${previewRect.y}%`,
                  width: `${previewRect.width}%`,
                  height: `${previewRect.height}%`,
                }}
              />
            )}
          </div>
        </>
      )}

      {pendingRect && (
        <form
          onSubmit={handleSaveSection}
          className="space-y-3 rounded-lg border border-river-100 p-3"
        >
          <p className="text-sm font-medium text-river-800">Nyt kortudsnit</p>
          <div>
            <label className="label">Navn (fx "Tørring – Klostermølle")</label>
            <input
              className="input"
              value={sectionLabel}
              onChange={(e) => setSectionLabel(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="label">Detaljeret kort (PNG eller JPG)</label>
            <input
              type="file"
              accept="image/png,image/jpeg"
              onChange={(e) => setSectionFile(e.target.files?.[0] ?? null)}
              className="input"
              required
            />
          </div>
          <div className="flex gap-2">
            <button className="btn-primary" disabled={savingSection}>
              {savingSection ? 'Gemmer…' : 'Gem udsnit'}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setPendingRect(null);
                setSectionLabel('');
                setSectionFile(null);
              }}
              disabled={savingSection}
            >
              Annuller
            </button>
          </div>
        </form>
      )}

      {overviewUrl && stops.length > 0 && (
        <div className="border-t border-river-100 pt-4">
          <h3 className="font-medium text-river-800">Stop på kortet</h3>
          <p className="mt-1 text-sm text-river-500">
            Placér hvert stop på kortet, så kan retningen mellem dem beregnes præcist i stedet for at
            skulle vælges blandt otte kompasretninger. Kortet er nord-op, så beregningen bliver lige så
            nøjagtig, som prikkerne er sat.
          </p>

          <ul className="mt-3 divide-y divide-river-100 text-sm">
            {[...stops]
              .sort((a, b) => a.sort_order - b.sort_order)
              .map((s, index) => {
                const placeret = s.map_x_percent != null && s.map_y_percent != null;
                return (
                  <li key={s.id} className="flex items-center justify-between gap-3 py-2">
                    <span className={placeret ? 'text-river-700' : 'text-river-400'}>
                      {index + 1}. {s.name}
                      {!placeret && <span className="ml-2 text-xs">ikke placeret</span>}
                      {placeret && s.bearing_degrees != null && (
                        <span className="ml-2 text-xs text-river-400">
                          {s.bearing_degrees}° ({compassFromDegrees(s.bearing_degrees)})
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      className="shrink-0 text-xs text-river-600 hover:underline"
                      onClick={() => {
                        setPlacingStopId(s.id);
                        setDrawing(false);
                        setPendingRect(null);
                      }}
                    >
                      {placeret ? 'Flyt' : 'Placér'}
                    </button>
                  </li>
                );
              })}
          </ul>

          <div className="mt-3">
            <button
              type="button"
              className="btn-secondary"
              onClick={computeBearingsFromMap}
              disabled={computingBearings}
            >
              {computingBearings ? 'Beregner…' : 'Beregn retninger ud fra kortet'}
            </button>
            <p className="mt-2 text-xs text-river-400">
              Overskriver de retninger, der er valgt i hånden under "Gudenå-stop" ovenfor. Stop uden en
              prik på kortet springes over og beholder deres nuværende retning.
            </p>
          </div>
        </div>
      )}

      {sections.length > 0 && (
        <div>
          <p className="mb-1 text-xs uppercase tracking-wide text-river-400">Kortudsnit</p>
          <ul className="divide-y divide-river-100 text-sm">
            {sections.map((s) => (
              <li key={s.id} className="flex items-center justify-between py-2">
                <span className="text-river-700">{s.label}</span>
                <button
                  className="text-xs text-red-500 hover:underline"
                  onClick={() => handleDeleteSection(s)}
                >
                  Slet
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-river-400">
            Et udsnits placering kan ikke redigeres direkte — slet det og tegn det igen, hvis det skal
            flyttes eller ændre størrelse.
          </p>
        </div>
      )}
    </section>
  );
}
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
