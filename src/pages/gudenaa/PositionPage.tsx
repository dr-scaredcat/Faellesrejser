import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useGudenaaStops } from '../../hooks/useGudenaaStops';
import { sortStops } from '../../lib/gudenaa';
import { groupSailingDays } from '../../lib/gudenaaStats';
import { describeModel, fitPaceModel, predictTime } from '../../lib/paceModel';
import { resultantCourse, windEffect } from '../../lib/windEffect';
import { formatHours } from '../../lib/stats';
import type { SailingTimeWithFlow } from '../../lib/types';

export default function PositionPage() {
  const { stops, loading: stopsLoading } = useGudenaaStops();
  const [sailingTimes, setSailingTimes] = useState<SailingTimeWithFlow[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentStopId, setCurrentStopId] = useState('');

  // Gårsdagens vandføring, hentet automatisk. Åen er grundvandsfødt og
  // reagerer langsomt, så i går er et solidt gæt på i dag — modsat vind, som
  // kan dreje og ændre styrke på få timer og derfor IKKE bruges her; se
  // forklaringen i bundteksten nedenfor.
  const [flowInfo, setFlowInfo] = useState<{ ratio: number; station: string; date: string } | null>(
    null
  );
  const [flowLoading, setFlowLoading] = useState(true);

  useEffect(() => {
    load();
    loadFlow();
  }, []);

  async function load() {
    setLoading(true);
    // Samme kilde som ruteplanlæggeren og statistiksiden — sejltider på
    // tværs af alle Gudenå-ture, beriget med dagens vandføring og vind.
    const { data } = await supabase.from('sailing_times_with_flow').select('*');
    setSailingTimes((data as unknown as SailingTimeWithFlow[]) ?? []);
    setLoading(false);
  }

  async function loadFlow() {
    setFlowLoading(true);
    const igaar = new Date();
    igaar.setUTCDate(igaar.getUTCDate() - 1);
    const dato = igaar.toISOString().slice(0, 10);

    // Prøver stationerne i samme rækkefølge, som viewet selv foretrækker dem
    // (opstrøms Tange først) — falder til den anden, hvis den første mangler
    // data for i går.
    const { data: stationer } = await supabase
      .from('hydro_stations')
      .select('id, name')
      .eq('is_active', true)
      .order('sort_order');

    for (const station of stationer ?? []) {
      const { data } = await supabase.rpc('flow_context', {
        _station_id: station.id,
        _date: dato,
      });
      const raekke = data?.[0];
      if (raekke?.ratio_to_median != null) {
        setFlowInfo({ ratio: Number(raekke.ratio_to_median), station: station.name, date: dato });
        setFlowLoading(false);
        return;
      }
    }
    setFlowInfo(null);
    setFlowLoading(false);
  }

  const sorted = useMemo(() => sortStops(stops), [stops]);

  // Samme retningsberegning som i ruteplanlæggeren og statistikken: lægger
  // delstrækkene sammen som distancevægtede vektorer, så en bugtet å ikke
  // giver et misvisende vindtal.
  function courseFor(startStopId: string, endStopId: string) {
    const fromIdx = sorted.findIndex((s) => s.id === startStopId);
    const toIdx = sorted.findIndex((s) => s.id === endStopId);
    if (fromIdx === -1 || toIdx === -1 || toIdx <= fromIdx) return null;
    const segments = [];
    for (let i = fromIdx + 1; i <= toIdx; i++) {
      segments.push({
        distanceKm: sorted[i].distance_from_previous_km,
        bearingDegrees: sorted[i].bearing_degrees,
      });
    }
    return resultantCourse(segments);
  }

  // Én linje pr. sejldag (ikke pr. registrering), så en dag flere har logget
  // sammen ikke tæller flere gange i modellen — se lib/gudenaaStats.ts.
  const sailingDays = useMemo(() => groupSailingDays(stops, sailingTimes), [stops, sailingTimes]);

  const observations = useMemo(
    () =>
      sailingDays.map((dag) => {
        const course = courseFor(dag.startStopId, dag.endStopId);
        const effect =
          course && dag.windSpeedMs != null && dag.windDirDegrees != null
            ? windEffect(course, dag.windSpeedMs, dag.windDirDegrees)
            : null;
        return {
          distanceKm: dag.km,
          sailing: dag.sailingHours,
          total: dag.totalHours,
          flowRatio: dag.flowRatio,
          tailwindMs: effect?.tailwindMs ?? null,
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sailingDays, sorted]
  );

  const pureModel = useMemo(
    () =>
      fitPaceModel(
        observations.map((o) => ({
          distanceKm: o.distanceKm,
          hours: o.sailing,
          flowRatio: o.flowRatio,
          tailwindMs: o.tailwindMs,
        }))
      ),
    [observations]
  );
  const pausesModel = useMemo(
    () =>
      fitPaceModel(
        observations.map((o) => ({
          distanceKm: o.distanceKm,
          hours: o.total,
          flowRatio: o.flowRatio,
          tailwindMs: o.tailwindMs,
        }))
      ),
    [observations]
  );

  const currentIndex = sorted.findIndex((s) => s.id === currentStopId);

  // Kumulativ distance, skematid og estimat for hvert stop fra den valgte
  // position og resten af vejen ned ad åen.
  const remaining = useMemo(() => {
    if (currentIndex === -1) return [];
    let km = 0;
    let scheduleHours = 0;
    const rows = [];
    for (let i = currentIndex + 1; i < sorted.length; i++) {
      km += sorted[i].distance_from_previous_km;
      scheduleHours += sorted[i].sail_time_hours;
      rows.push({
        stop: sorted[i],
        km,
        scheduleHours,
        pure: pureModel ? predictTime(pureModel, km, { flowRatio: flowInfo?.ratio ?? null }) : null,
        pauses: pausesModel
          ? predictTime(pausesModel, km, { flowRatio: flowInfo?.ratio ?? null })
          : null,
      });
    }
    return rows;
  }, [currentIndex, sorted, pureModel, pausesModel, flowInfo]);

  if (loading || stopsLoading) return <p className="text-river-500">Indlæser…</p>;

  return (
    <div className="space-y-6">
      <div className="card space-y-3 p-5">
        <h2 className="font-semibold text-river-800">Hvor er du på åen?</h2>
        <div>
          <label className="label">Du er lige nu ved</label>
          <select
            className="input"
            value={currentStopId}
            onChange={(e) => setCurrentStopId(e.target.value)}
          >
            <option value="">Vælg stop</option>
            {sorted.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        {!flowLoading && (
          <p className="text-xs text-river-400">
            {flowInfo ? (
              <>
                Bruger gårsdagens vandføring ved {flowInfo.station}:{' '}
                <span className={flowInfo.ratio >= 1 ? 'text-river-600' : 'text-sand-600'}>
                  {flowInfo.ratio >= 1 ? '+' : ''}
                  {((flowInfo.ratio - 1) * 100).toFixed(0)}% ift. normalt for årstiden
                </span>
                . Vind er ikke med i estimaterne herunder — se hvorfor nederst på siden.
              </>
            ) : (
              'Gårsdagens vandføring kunne ikke hentes — estimaterne regner derfor med normale forhold.'
            )}
          </p>
        )}
      </div>

      {currentStopId && remaining.length === 0 && (
        <div className="card p-8 text-center text-river-400">
          Der er ikke flere stop længere nede ad åen efter dette.
        </div>
      )}

      {remaining.length > 0 && (
        <div className="space-y-3">
          {remaining.map((row) => (
            <div key={row.stop.id} className="card p-5">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-river-800">{row.stop.name}</h3>
                <span className="text-sm text-river-500">{row.km.toFixed(1)} km</span>
              </div>

              <p className="mt-1 text-sm text-river-600">skematid ca. {formatHours(row.scheduleHours)}</p>

              {row.pure && (
                <p className="mt-1 text-xs text-river-500">
                  Forventet tid: ca. {formatHours(row.pure.hours)} [{formatHours(row.pure.low)} :{' '}
                  {formatHours(row.pure.high)}]
                </p>
              )}
              {row.pauses && (
                <p className="text-xs text-river-500">
                  Forventet tid inkl. pauser: ca. {formatHours(row.pauses.hours)} [
                  {formatHours(row.pauses.low)} : {formatHours(row.pauses.high)}]
                </p>
              )}

              {row.stop.description && <p className="mt-2 text-sm text-river-500">{row.stop.description}</p>}
              {row.stop.tags && row.stop.tags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {row.stop.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-river-100 px-2 py-0.5 text-xs text-river-600"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}

          {pureModel && (
            <p className="text-xs text-river-400">
              Estimaterne bygger på {describeModel(pureModel)}
              {flowInfo ? ', justeret for gårsdagens vandføring' : ''}. Prædiktionsintervallet [lav : høj]
              er, hvor en enkelt ny tur forventes at lande indenfor med 95% sikkerhed — ikke usikkerheden
              på et gennemsnit.
            </p>
          )}

          <p className="text-xs text-river-400">
            Vind indgår bevidst ikke automatisk her. Vandføring i går er et godt gæt på vandføring i dag,
            fordi åen reagerer langsomt — men vind kan dreje og ændre styrke på få timer, så gårsdagens
            vind ville ofte være et forkert gæt på lige nu. Skal vind med, kræver det en rigtig
            vejrudsigt for de kommende timer, ikke i går.
          </p>
        </div>
      )}
    </div>
  );
}
