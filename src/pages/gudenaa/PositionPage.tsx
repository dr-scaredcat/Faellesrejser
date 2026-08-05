import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useGudenaaStops } from '../../hooks/useGudenaaStops';
import { sortStops } from '../../lib/gudenaa';
import { groupSailingDays } from '../../lib/gudenaaStats';
import { describeModel, fitPaceModel, predictTime } from '../../lib/paceModel';
import { compassFromDegrees, describeWindEffect, resultantCourse, windEffect } from '../../lib/windEffect';
import { formatHours } from '../../lib/stats';
import type { SailingTimeWithFlow } from '../../lib/types';

export default function PositionPage() {
  const { stops, loading: stopsLoading } = useGudenaaStops();
  const [sailingTimes, setSailingTimes] = useState<SailingTimeWithFlow[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentStopId, setCurrentStopId] = useState('');

  // Vandføring for BEGGE stationer. Valget mellem dem træffes først ved
  // visning, hvor vi kender den valgte position — vandføringen neden for
  // Tange er en helt anden størrelse end oven for, så det er ikke
  // ligegyldigt hvilken der bruges.
  const [flowResults, setFlowResults] = useState<
    { position: string; station: string; ratio: number }[]
  >([]);
  const [flowLoading, setFlowLoading] = useState(true);

  // Den senest MÅLTE vind — en enkelt observation, ikke et døgnmiddel.
  // Modsat vandføring reagerer vinden hurtigt, så et gennemsnit fra i går
  // ville ofte være forkert. En helt frisk enkeltmåling er stadig kun et
  // øjebliksbillede, men det er det bedste, der er at få uden en rigtig
  // vejrudsigt (som vi har vurderet er for stor en opgave lige nu).
  //
  // Begge stationer hentes uafhængigt af hvilket stop der er valgt — hvilken
  // af dem der bruges, afgøres først ved visning, se windInfo nedenfor.
  const [windResults, setWindResults] = useState<
    { stationId: string; station: string; measuredAt: string | null; speedMs?: number; dirDegrees?: number }[]
  >([]);
  const [windLoading, setWindLoading] = useState(true);

  useEffect(() => {
    load();
    loadFlow();
    loadWind();
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

    const { data: stationer } = await supabase
      .from('hydro_stations')
      .select('id, name, position')
      .eq('is_active', true)
      .order('sort_order');

    const resultater: { position: string; station: string; ratio: number }[] = [];
    for (const station of stationer ?? []) {
      const { data } = await supabase.rpc('flow_context', {
        _station_id: station.id,
        _date: dato,
      });
      const raekke = data?.[0];
      if (raekke?.ratio_to_median != null) {
        resultater.push({
          position: station.position,
          station: station.name,
          ratio: Number(raekke.ratio_to_median),
        });
      }
    }

    setFlowResults(resultater);
    setFlowLoading(false);
  }

  /**
   * Henter blot begge stationers seneste måling, uden at vælge mellem dem —
   * det sker i windInfo nedenfor, hvor vi kender det valgte stop.
   */
  async function loadWind() {
    setWindLoading(true);
    const { data, error } = await supabase.functions.invoke('hent-nyeste-vind', { body: {} });
    setWindResults(error || !data?.resultat ? [] : data.resultat);
    setWindLoading(false);
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

  /**
   * Vandføringen oven for og neden for Tangeværket er vidt forskellige
   * størrelser — Ulstrup fører mange gange så meget vand som Åstedbro — så
   * det er afgørende at bruge den station, der hører til dér, hvor man er.
   *
   * Tangeværket er selv et stop på ruten og flytter sig ikke, så grænsen
   * findes ud fra stoppets navn frem for en indstilling. Omdøbes stoppet, så
   * "Tange" ikke længere indgår, falder siden stille tilbage til den
   * opstrøms station — den samme opførsel som før dette blev bygget.
   */
  const tangeIndex = useMemo(
    () => sorted.findIndex((s) => /tange/i.test(s.name)),
    [sorted]
  );

  const flowInfo = useMemo(() => {
    if (flowResults.length === 0) return null;

    // Selve Tangeværket regnes med til den nedstrøms side: passerer man
    // værket, er det den store vandføring, der gælder derfra og videre.
    const erNedstroems = tangeIndex >= 0 && currentIndex >= tangeIndex;
    const oensket = erNedstroems ? 'nedstroems_tange' : 'opstroems_tange';

    // Mangler den ønskede station data for i går, er den anden stadig bedre
    // end ingenting — tallet er jo normaliseret mod stationens egen median.
    const valgt = flowResults.find((r) => r.position === oensket) ?? flowResults[0];
    return valgt ? { ...valgt, erNedstroems } : null;
  }, [flowResults, tangeIndex, currentIndex]);

  /**
   * Vejrstationerne er ikke normaliseret som vandføringens (der er ingen
   * Tangeværk-lignende asymmetri for vind), så valget mellem dem er
   * geografisk: Isenvad (06068) ligger ved rutens start, Hald Vest (06049)
   * ved dens slutning. Uden koordinater på stoppene bruger vi et enkelt,
   * billigt gæt — er man i første halvdel af ruten, er Isenvad tættest på;
   * ellers Hald Vest. Falder den foretrukne fra, bruges den anden.
   */
  const windInfo = useMemo(() => {
    if (windResults.length === 0) return null;
    const foretrukketId = currentIndex >= 0 && currentIndex < sorted.length / 2 ? '06068' : '06049';

    const valgt =
      windResults.find((r) => r.stationId === foretrukketId && r.measuredAt) ??
      windResults.find((r) => r.measuredAt);

    if (!valgt || valgt.speedMs == null || valgt.dirDegrees == null || !valgt.measuredAt) return null;
    return {
      station: valgt.station,
      measuredAt: valgt.measuredAt,
      speedMs: valgt.speedMs,
      dirDegrees: valgt.dirDegrees,
    };
  }, [windResults, currentIndex, sorted.length]);

  const windAgeHours = windInfo
    ? (Date.now() - new Date(windInfo.measuredAt).getTime()) / 3_600_000
    : null;

  // Til opsummeringen: vindens effekt på netop det næste stræk, som et
  // konkret eksempel på, hvad "medvind"/"modvind" betyder lige nu — resten
  // af strækkerne får hver deres egen beregning nedenfor, ud fra deres egen
  // retning.
  const nextLegWindEffect = useMemo(() => {
    if (!windInfo || currentIndex === -1 || currentIndex + 1 >= sorted.length) return null;
    const course = courseFor(sorted[currentIndex].id, sorted[currentIndex + 1].id);
    if (!course || course.bearingDegrees == null) return null;
    return windEffect(course, windInfo.speedMs, windInfo.dirDegrees);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windInfo, currentIndex, sorted]);

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

      const tailwindMs =
        windInfo != null
          ? (() => {
              const course = courseFor(sorted[currentIndex].id, sorted[i].id);
              const effect =
                course && course.bearingDegrees != null
                  ? windEffect(course, windInfo.speedMs, windInfo.dirDegrees)
                  : null;
              return effect?.tailwindMs ?? null;
            })()
          : null;

      const conditions = { flowRatio: flowInfo?.ratio ?? null, tailwindMs };

      rows.push({
        stop: sorted[i],
        km,
        scheduleHours,
        pure: pureModel ? predictTime(pureModel, km, conditions) : null,
        pauses: pausesModel ? predictTime(pausesModel, km, conditions) : null,
      });
    }
    return rows;
  }, [currentIndex, sorted, pureModel, pausesModel, flowInfo, windInfo]);

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
                Vandføring (i går) ved {flowInfo.station}:{' '}
                <span className={flowInfo.ratio >= 1 ? 'text-river-600' : 'text-sand-600'}>
                  {flowInfo.ratio >= 1 ? '+' : ''}
                  {((flowInfo.ratio - 1) * 100).toFixed(0)}% ift. normalt for årstiden
                </span>
              </>
            ) : (
              'Gårsdagens vandføring kunne ikke hentes.'
            )}
          </p>
        )}

        {!windLoading && (
          <p className="text-xs text-river-400">
            {windInfo ? (
              <>
                Vind (senest målt, {windAgeHours != null ? `${windAgeHours.toFixed(1)} t. gammel` : ''})
                ved {windInfo.station}: {windInfo.speedMs.toFixed(1)} m/s fra{' '}
                {compassFromDegrees(windInfo.dirDegrees) ?? '?'}
                {nextLegWindEffect && (
                  <>
                    {' — '}
                    {describeWindEffect(nextLegWindEffect)} på det næste stræk
                  </>
                )}
                {windAgeHours != null && windAgeHours > 3 && (
                  <span className="text-sand-600">
                    {' '}
                    (måling er over 3 timer gammel — vinden kan have ændret sig)
                  </span>
                )}
              </>
            ) : (
              'Seneste vindmåling kunne ikke hentes.'
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
              {flowInfo ? ', justeret for gårsdagens vandføring' : ''}
              {windInfo ? ' og for den senest målte vind' : ''}. Prædiktionsintervallet [lav : høj] er,
              hvor en enkelt ny tur forventes at lande indenfor med 95% sikkerhed — ikke usikkerheden på
              et gennemsnit.
            </p>
          )}

          <p className="text-xs text-river-400">
            Vinden regnes for hvert stræk ud fra strækkets egen samlede retning, så medvind ét sted og
            modvind et andet udligner hinanden af sig selv. Bemærk at det er den{' '}
            <em>senest målte</em> vind, ikke en vejrudsigt — den siger mest om de nærmeste stop og bliver
            et løsere gæt, jo længere ned ad åen man kigger. Vandføring holder sig derimod stabil over
            dage, fordi åen er grundvandsfødt og reagerer langsomt.
          </p>
        </div>
      )}
    </div>
  );
}
