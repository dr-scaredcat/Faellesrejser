import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useTrip } from '../../context/TripContext';
import { useGudenaaStops } from '../../hooks/useGudenaaStops';
import { computeRoutePlanDaySegments, sortStops } from '../../lib/gudenaa';
import { computeDedupedTotals, groupSailingDays, type SailingDay } from '../../lib/gudenaaStats';
import { formatHours, formatKmT } from '../../lib/stats';
import { fitPaceModel, predictTime, type PaceModel } from '../../lib/paceModel';
import {
  compassFromDegrees,
  describeWindEffect,
  resultantCourse,
  windEffect,
  type ResultantCourse,
} from '../../lib/windEffect';
import type { RoutePlan, RoutePlanDay, SailingTimeWithFlow, Trip } from '../../lib/types';

export default function StatisticsPage() {
  const { trip } = useTrip();
  const { stops, loading: stopsLoading } = useGudenaaStops();
  const [sailingTimes, setSailingTimes] = useState<SailingTimeWithFlow[]>([]);
  const [gudenaaTrips, setGudenaaTrips] = useState<Trip[]>([]);
  const [routePlans, setRoutePlans] = useState<RoutePlan[]>([]);
  const [routePlanDays, setRoutePlanDays] = useState<RoutePlanDay[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const [{ data: sailData }, { data: tripData }, { data: planData }, { data: dayData }] =
      await Promise.all([
        // Viewet leverer sejltiderne sammen med dagens vandføring, normaliseret
        // mod hvad der er normalt for årstiden på den enkelte målestation.
        // Bemærk: ingen profil-join her. Den var der før, men blev aldrig brugt,
        // og PostgREST kan ikke altid udlede relationer henover et view.
        supabase.from('sailing_times_with_flow').select('*'),
        supabase.from('trips').select('*').eq('trip_type', 'gudenaa'),
        supabase.from('gudenaa_route_plans').select('*'),
        supabase.from('gudenaa_route_plan_days').select('*'),
      ]);
    setSailingTimes((sailData as unknown as SailingTimeWithFlow[]) ?? []);
    setGudenaaTrips((tripData as Trip[]) ?? []);
    setRoutePlans((planData as RoutePlan[]) ?? []);
    setRoutePlanDays((dayData as RoutePlanDay[]) ?? []);
    setLoading(false);
  }

  const sorted = sortStops(stops);
  const tripNameById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const t of gudenaaTrips) map[t.id] = t.name;
    return map;
  }, [gudenaaTrips]);

  const currentTripSailingTimes = useMemo(
    () => sailingTimes.filter((st) => st.trip_id === trip?.id),
    [sailingTimes, trip?.id]
  );
  const hasCurrentTripData = currentTripSailingTimes.length > 0;

  // Afdupliserede totaler — se lib/gudenaaStats.ts for forklaring af metoden.
  const historicalTotals = useMemo(() => computeDedupedTotals(stops, sailingTimes), [stops, sailingTimes]);
  const currentTripTotals = useMemo(
    () => computeDedupedTotals(stops, currentTripSailingTimes),
    [stops, currentTripSailingTimes]
  );

  // Én linje pr. sejldag i stedet for én pr. registrering: flere loggere af
  // samme dag samles, og etaper logget hver for sig lægges sammen.
  //
  // Modellerne fittes på DISSE og ikke på de rå registreringer. Logger tre
  // personer den samme dag, er det stadig én observation af, hvor lang tid en
  // dag på åen tager — ikke tre. Talte man dem hver for sig, ville n blive
  // kunstigt oppustet, σ̂ for lille, og prædiktionsintervallerne for smalle.
  const historicalDays = useMemo(() => groupSailingDays(stops, sailingTimes), [stops, sailingTimes]);
  const currentTripDays = useMemo(
    () => groupSailingDays(stops, currentTripSailingTimes),
    [stops, currentTripSailingTimes]
  );

  function modelFrom(days: SailingDay[], field: 'sailingHours' | 'totalHours'): PaceModel | null {
    return fitPaceModel(
      days.map((dag) => {
        const course = courseFor(dag.startStopId, dag.endStopId);
        const effect =
          course && dag.windSpeedMs != null && dag.windDirDegrees != null
            ? windEffect(course, dag.windSpeedMs, dag.windDirDegrees)
            : null;
        return {
          distanceKm: dag.km,
          hours: dag[field],
          flowRatio: dag.flowRatio,
          tailwindMs: effect?.tailwindMs ?? null,
        };
      })
    );
  }

  const historicalModel = useMemo(() => modelFrom(historicalDays, 'sailingHours'), [historicalDays]);
  const historicalPauseModel = useMemo(() => modelFrom(historicalDays, 'totalHours'), [historicalDays]);
  const currentModel = useMemo(() => modelFrom(currentTripDays, 'sailingHours'), [currentTripDays]);
  const currentPauseModel = useMemo(() => modelFrom(currentTripDays, 'totalHours'), [currentTripDays]);

  // Referencedistance til prædiktionseksemplet. Bruger rejsens egne dage,
  // hvis der er logget nogen — så eksemplet rent faktisk siger noget om
  // netop denne tur, i stedet for at være et vilkårligt historisk gennemsnit.
  const referenceKm = useMemo(() => {
    const kilde = currentTripDays.length > 0 ? currentTripDays : historicalDays;
    const distances = kilde.map((d) => d.km).filter((km) => km > 0).sort((a, b) => a - b);
    if (distances.length === 0) return 0;
    const mid = Math.floor(distances.length / 2);
    return distances.length % 2 === 0 ? (distances[mid - 1] + distances[mid]) / 2 : distances[mid];
  }, [currentTripDays, historicalDays]);

  const referencePrediction =
    historicalModel && referenceKm > 0 ? predictTime(historicalModel, referenceKm) : null;

  function percentDiff(current: number, historical: number): number | null {
    if (!historical) return null;
    return ((current - historical) / historical) * 100;
  }

  function formatPercentDiff(pct: number): string {
    const sign = pct > 0 ? '+' : '';
    return `${sign}${pct.toFixed(1)}% ift. historisk`;
  }

  // Længste/korteste planlagte dag, og stop-popularitet — baseret på alle
  // gemte ruteplaner på tværs af alle Gudenå-ture.
  const daySegments = useMemo(
    () => computeRoutePlanDaySegments(stops, routePlans, routePlanDays),
    [stops, routePlans, routePlanDays]
  );
  const longestDay = [...daySegments].sort((a, b) => b.km - a.km)[0];
  const shortestDay = [...daySegments].sort((a, b) => a.km - b.km)[0];

  // Kun slutstedet for hver dag tælles. Et stop der bruges som startsted for
  // næste dag er jo det samme fysiske ophold, som allerede blev talt som
  // slutsted dagen før — ellers ville næsten alle stop tælles dobbelt.
  const stopUsage = useMemo(() => {
    const usage = new Map<string, number>();
    for (const seg of daySegments) {
      usage.set(seg.toStopId, (usage.get(seg.toStopId) ?? 0) + 1);
    }
    return [...usage.entries()].sort((a, b) => b[1] - a[1]);
  }, [daySegments]);
  const topStop = stopUsage[0];

  // Hurtigste og roligste dag — også her pr. sejldag, ikke pr. logning. Ellers
  // ville en dag, som tre personer loggede, kunne fylde hele listen.
  const fastestDay = [...historicalDays]
    .filter((d) => d.km > 0 && d.sailingHours > 0)
    .sort((a, b) => b.km / b.sailingHours - a.km / a.sailingHours)[0];
  const slowestDay = [...historicalDays]
    .filter((d) => d.km > 0 && d.sailingHours > 0)
    .sort((a, b) => a.km / a.sailingHours - b.km / b.sailingHours)[0];

  const stopName = (id: string) => stops.find((s) => s.id === id)?.name ?? '?';

  /**
   * Den samlede retning for et stræk, lagt sammen som distancevægtede
   * vektorer. Skifter ruten retning undervejs, bliver den resulterende vektor
   * kortere — og vindens beregnede effekt tilsvarende mindre, hvilket er
   * netop det rigtige.
   */
  function courseFor(startStopId: string, endStopId: string): ResultantCourse | null {
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

  if (loading || stopsLoading) return <p className="text-river-500">Indlæser…</p>;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="mb-3 font-semibold text-river-800">Denne rejse</h2>
        {hasCurrentTripData ? (
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Samlet sejllængde" value={`${currentTripTotals.totalKm.toFixed(1)} km`} />
            <StatCard label="Samlet sejltid (ren)" value={formatHours(currentTripTotals.totalSailingHours)} />
            <StatCard
              label="Samlet tid inkl. pauser"
              value={formatHours(currentTripTotals.totalWithPauseHours)}
            />
            <StatCard
              label="Gennemsnitshastighed"
              value={currentModel ? formatKmT(currentModel.meanSpeedKmH) : '–'}
              sub={
                currentModel && historicalModel
                  ? formatPercentDiff(
                      percentDiff(currentModel.meanSpeedKmH, historicalModel.meanSpeedKmH) ?? 0
                    )
                  : undefined
              }
            />
            <StatCard
              label="Gennemsnitshastighed inkl. pauser"
              value={currentPauseModel ? formatKmT(currentPauseModel.meanSpeedKmH) : '–'}
              sub={
                currentPauseModel && historicalPauseModel
                  ? formatPercentDiff(
                      percentDiff(currentPauseModel.meanSpeedKmH, historicalPauseModel.meanSpeedKmH) ?? 0
                    )
                  : undefined
              }
            />
            <StatCard
              label="Antal sejldage"
              value={`${currentTripDays.length}`}
              sub={
                currentTripSailingTimes.length !== currentTripDays.length
                  ? `${currentTripSailingTimes.length} logninger i alt`
                  : undefined
              }
            />
          </div>
        ) : (
          <div className="card p-8 text-center text-river-400">
            Ingen sejltider er logget på denne rejse endnu. Tilføj data på "Sejltider"-siden for at se
            rejsens egne tal her, sammenlignet med de historiske.
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-3 font-semibold text-river-800">Historiske data (alle Gudenå-ture)</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Samlet sejllængde" value={`${historicalTotals.totalKm.toFixed(1)} km`} />
          <StatCard label="Samlet sejltid (ren)" value={formatHours(historicalTotals.totalSailingHours)} />
          <StatCard label="Samlet tid inkl. pauser" value={formatHours(historicalTotals.totalWithPauseHours)} />
          <StatCard
            label="Gennemsnitshastighed"
            value={historicalModel ? formatKmT(historicalModel.meanSpeedKmH) : '–'}
            sub={
              historicalModel
                ? `Samlet distance delt med samlet tid · ${historicalModel.n} registreringer`
                : undefined
            }
          />
          <StatCard
            label="Gennemsnitshastighed inkl. pauser"
            value={historicalPauseModel ? formatKmT(historicalPauseModel.meanSpeedKmH) : '–'}
            sub={
              historicalPauseModel
                ? `Samlet distance delt med samlet tid · ${historicalPauseModel.n} registreringer`
                : undefined
            }
          />
          <StatCard
            label={referenceKm > 0 ? `Forventet tid, ${referenceKm.toFixed(1)} km` : 'Forventet tid'}
            value={referencePrediction ? formatHours(referencePrediction.hours) : '–'}
            sub={
              referencePrediction
                ? `95% prædiktion: [${formatHours(referencePrediction.low)} : ${formatHours(
                    referencePrediction.high
                  )}]`
                : undefined
            }
          />
          <StatCard
            label="Mest populære stop"
            value={topStop ? stopName(topStop[0]) : '–'}
            sub={topStop ? `Brugt som etape-endepunkt ${topStop[1]} gange` : undefined}
          />
          <StatCard label="Antal Gudenå-ture" value={`${gudenaaTrips.length}`} />
          <StatCard
            label="Antal sejldage"
            value={`${historicalDays.length}`}
            sub={
              sailingTimes.length !== historicalDays.length
                ? `${sailingTimes.length} logninger i alt`
                : undefined
            }
          />
        </div>
        <p className="mt-2 text-xs text-river-400">
          "Samlet sejllængde" og "Samlet tid" tæller hvert stræk på en rejse med én gang, selv hvis flere har
          logget samme (eller overlappende) stræk. Hastighed og tidsestimater bruger derimod alle
          registreringer hver for sig, vægtet efter hvor langt hvert stræk er.
        </p>
      </div>

      {hasCurrentTripData && (
        <div className="card p-5">
          <h3 className="mb-2 font-semibold text-river-800">Forhold pr. sejldag</h3>
          <p className="mb-3 text-sm text-river-500">
            Én linje pr. sejldag. Har flere logget den samme dag, eller er dagen logget i etaper, er det
            samlet til én. Vandføring og vind er sammenholdt med farten, så I selv kan se sammenhængen.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-sm">
              <thead>
                <tr className="border-b border-river-100 text-left text-xs uppercase tracking-wide text-river-400">
                  <th className="pb-1 pr-3 font-normal">Dato</th>
                  <th className="pb-1 pr-3 font-normal">Stræk</th>
                  <th className="pb-1 pr-3 font-normal">Vandføring</th>
                  <th className="pb-1 pr-3 font-normal">Vind</th>
                  <th className="pb-1 pr-3 font-normal">Fart</th>
                  <th className="pb-1 font-normal">Ift. historisk snit</th>
                </tr>
              </thead>
              <tbody>
                {currentTripDays.map((dag) => {
                  const speed = dag.km > 0 && dag.sailingHours > 0 ? dag.km / dag.sailingHours : null;
                  const pct = dag.flowRatio != null ? (dag.flowRatio - 1) * 100 : null;
                  const speedDiff =
                    speed != null && historicalModel && historicalModel.meanSpeedKmH > 0
                      ? ((speed - historicalModel.meanSpeedKmH) / historicalModel.meanSpeedKmH) * 100
                      : null;

                  const course = courseFor(dag.startStopId, dag.endStopId);
                  const effect =
                    course && dag.windSpeedMs != null && dag.windDirDegrees != null
                      ? windEffect(course, dag.windSpeedMs, dag.windDirDegrees)
                      : null;

                  // To uafhængige forbehold: bugtede ruten sig meget, eller
                  // drejede vinden rundt, er tallet mindre værd.
                  const usikker =
                    (course != null && course.coherence < 0.5) ||
                    (dag.windSteadiness != null && dag.windSteadiness < 0.5);

                  return (
                    <tr key={dag.key} className="border-b border-river-50 last:border-0">
                      <td className="py-1.5 pr-3 text-river-600">{dag.sailDate}</td>
                      <td className="py-1.5 pr-3 text-river-600">
                        {stopName(dag.startStopId)} → {stopName(dag.endStopId)}
                        <span className="block text-xs text-river-400">
                          {dag.km.toFixed(1)} km
                          {dag.registrationCount > 1 && (
                            <>
                              {' · '}
                              {dag.registrationCount} logninger
                              {dag.loggerCount > 1 && ` fra ${dag.loggerCount} personer`}
                            </>
                          )}
                        </span>
                      </td>
                      <td className="py-1.5 pr-3">
                        {pct != null ? (
                          <span className={pct >= 0 ? 'text-river-700' : 'text-sand-600'}>
                            {pct >= 0 ? '+' : ''}
                            {pct.toFixed(0)}% ift. normalt
                            {dag.flowSource === 'nedstroems_tange' && (
                              <span className="text-river-400"> (Ulstrup)</span>
                            )}
                            {dag.flowSource === 'opstroems_tange' && (
                              <span className="text-river-400"> (Åstedbro)</span>
                            )}
                          </span>
                        ) : (
                          <span className="text-river-400">ukendt</span>
                        )}
                      </td>
                      <td className="py-1.5 pr-3">
                        {effect ? (
                          <div className="flex items-center gap-2">
                            <Arrow
                              degrees={course?.bearingDegrees ?? 0}
                              className="text-river-600"
                              title={`Ruten gik mod ${compassFromDegrees(course?.bearingDegrees) ?? '?'}`}
                            />
                            <Arrow
                              degrees={(dag.windDirDegrees ?? 0) + 180}
                              className="text-sand-600"
                              title={`Vinden kom fra ${compassFromDegrees(dag.windDirDegrees) ?? '?'}`}
                            />
                            <span
                              className={usikker ? 'text-river-400' : 'text-river-700'}
                              title={
                                usikker
                                  ? 'Ruten skiftede meget retning, eller vinden drejede i løbet af dagen. Tallet er derfor usikkert.'
                                  : undefined
                              }
                            >
                              {usikker && '~'}
                              {describeWindEffect(effect)}
                            </span>
                          </div>
                        ) : course && course.missingBearings > 0 ? (
                          <span className="text-river-400">retning mangler</span>
                        ) : (
                          <span className="text-river-400">ukendt</span>
                        )}
                      </td>
                      <td className="py-1.5 pr-3 text-river-600">
                        {speed != null ? formatKmT(speed) : '–'}
                      </td>
                      <td className="py-1.5">
                        {speedDiff != null ? (
                          <span className={speedDiff >= 0 ? 'text-river-700' : 'text-sand-600'}>
                            {speedDiff >= 0 ? '+' : ''}
                            {speedDiff.toFixed(0)}%
                          </span>
                        ) : (
                          <span className="text-river-400">–</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-river-400">
            "Ift. normalt" er dagens vandføring delt med medianen for samme tid af året på den enkelte
            målestation — de rå tal kan ikke sammenlignes mellem Åstedbro og Ulstrup. Pilene viser rutens
            samlede retning og den vej vinden blæste; en tilde foran vindtallet betyder, at ruten bugtede
            sig meget, eller at vinden drejede i løbet af dagen, så nettoeffekten er usikker.
            "Ift. historisk snit" er dagens fart sammenlignet med den samlede gennemsnitsfart øverst på
            siden ({historicalModel ? formatKmT(historicalModel.meanSpeedKmH) : '–'}).
            {historicalModel && !historicalModel.usesFlow && (
              <>
                {' '}
                Estimaterne ovenfor bruger endnu ikke vandføringen — det kræver mindst 10 sejldage med kendt
                vandføring, og der er kun {historicalModel.n} registreringer med data indtil videre.
              </>
            )}
            {historicalModel && historicalModel.usesFlow && !historicalModel.usesWind && (
              <>
                {' '}
                Estimaterne ovenfor er justeret for vandføring, men endnu ikke for vind — det kræver mindst
                10 sejldage med både kendt vandføring og en udfyldt retning på hele strækket.
              </>
            )}
          </p>
        </div>
      )}

      {(longestDay || shortestDay || stopUsage.length > 0 || fastestDay) && (
        <div className="card p-5">
          <h3 className="mb-2 font-semibold text-river-800">Highlights</h3>
          <div className="space-y-1 text-sm text-river-600">
            {longestDay && (
              <p>
                Længste planlagte dag: {stopName(longestDay.fromStopId)} → {stopName(longestDay.toStopId)} (
                {longestDay.km.toFixed(1)} km, {tripNameById[longestDay.tripId] ?? '—'})
              </p>
            )}
            {shortestDay && (
              <p>
                Korteste planlagte dag: {stopName(shortestDay.fromStopId)} → {stopName(shortestDay.toStopId)} (
                {shortestDay.km.toFixed(1)} km, {tripNameById[shortestDay.tripId] ?? '—'})
              </p>
            )}
            {fastestDay && (
              <p>
                Hurtigste dag: {stopName(fastestDay.startStopId)} → {stopName(fastestDay.endStopId)} (
                {formatKmT(fastestDay.km / fastestDay.sailingHours)}, {fastestDay.sailDate})
              </p>
            )}
            {slowestDay && (
              <p>
                Roligste dag: {stopName(slowestDay.startStopId)} → {stopName(slowestDay.endStopId)} (
                {formatKmT(slowestDay.km / slowestDay.sailingHours)}, {slowestDay.sailDate})
              </p>
            )}
          </div>

          {stopUsage.length > 0 && (
            <div className="mt-4">
              <p className="mb-1 text-xs uppercase tracking-wide text-river-400">Mest brugte stop</p>
              <ul className="space-y-0.5 text-sm text-river-600">
                {stopUsage.slice(0, 5).map(([stopId, count]) => (
                  <li key={stopId}>
                    {stopName(stopId)} — {count} {count === 1 ? 'gang' : 'gange'}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {sailingTimes.length === 0 && (
        <div className="card p-8 text-center text-river-400">
          Ingen sejltider er logget endnu. Tilføj data på "Sejltider"-siden for at se statistik her.
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card p-5">
      <p className="text-xs uppercase tracking-wide text-river-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-river-800">{value}</p>
      {sub && <p className="mt-1 text-xs text-river-400">{sub}</p>}
    </div>
  );
}

/**
 * Pil der peger i en given kompasretning. 0 grader er op (nord), og den
 * drejer med uret — samme konvention som resten af beregningen.
 */
function Arrow({
  degrees,
  className,
  title,
}: {
  degrees: number;
  className?: string;
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-4 w-4 shrink-0 ${className ?? ''}`}
      style={{ transform: `rotate(${degrees}deg)` }}
      role="img"
      aria-label={title}
    >
      {title && <title>{title}</title>}
      <path
        d="M12 3 L12 21 M12 3 L7.5 8.5 M12 3 L16.5 8.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
