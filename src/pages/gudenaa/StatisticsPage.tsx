import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useTrip } from '../../context/TripContext';
import { useGudenaaStops } from '../../hooks/useGudenaaStops';
import { computeRoutePlanDaySegments, segmentBetween, sortStops } from '../../lib/gudenaa';
import { computeDedupedTotals } from '../../lib/gudenaaStats';
import { confidenceInterval95, formatHours, formatKmT } from '../../lib/stats';
import type { RoutePlan, RoutePlanDay, SailingTime, Trip } from '../../lib/types';

export default function StatisticsPage() {
  const { trip } = useTrip();
  const { stops, loading: stopsLoading } = useGudenaaStops();
  const [sailingTimes, setSailingTimes] = useState<SailingTime[]>([]);
  const [gudenaaTrips, setGudenaaTrips] = useState<Trip[]>([]);
  const [routePlans, setRoutePlans] = useState<RoutePlan[]>([]);
  const [routePlanDays, setRoutePlanDays] = useState<RoutePlanDay[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const [{ data: sailData }, { data: tripData }, { data: planData }, { data: dayData }] = await Promise.all([
      supabase.from('gudenaa_sailing_times').select('*, profile:profiles(*)'),
      supabase.from('trips').select('*').eq('trip_type', 'gudenaa'),
      supabase.from('gudenaa_route_plans').select('*'),
      supabase.from('gudenaa_route_plan_days').select('*'),
    ]);
    setSailingTimes((sailData as unknown as SailingTime[]) ?? []);
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

  // Rå per-registrering-data. Bruges til gennemsnitsfart og highlights — her
  // skal HVER registrering tælle for sig, uanset om flere har logget samme
  // (eller overlappende) stræk.
  const withDistance = useMemo(
    () =>
      sailingTimes.map((st) => ({
        ...st,
        km: segmentBetween(sorted, st.start_stop_id, st.end_stop_id).km,
      })),
    [sailingTimes, stops]
  );

  const currentTripSailingTimes = useMemo(
    () => sailingTimes.filter((st) => st.trip_id === trip?.id),
    [sailingTimes, trip?.id]
  );
  const currentTripWithDistance = useMemo(
    () => withDistance.filter((st) => st.trip_id === trip?.id),
    [withDistance, trip?.id]
  );
  const hasCurrentTripData = currentTripSailingTimes.length > 0;

  // Afdupliserede totaler — se lib/gudenaaStats.ts for forklaring af metoden.
  const historicalTotals = useMemo(() => computeDedupedTotals(stops, sailingTimes), [stops, sailingTimes]);
  const currentTripTotals = useMemo(
    () => computeDedupedTotals(stops, currentTripSailingTimes),
    [stops, currentTripSailingTimes]
  );

  function speedsFrom(list: typeof withDistance, field: 'sailing_time_hours' | 'total_time_hours') {
    return list.filter((st) => st.km > 0 && st[field] > 0).map((st) => st.km / st[field]);
  }

  const historicalSpeeds = speedsFrom(withDistance, 'sailing_time_hours');
  const historicalSpeedsWithPauses = speedsFrom(withDistance, 'total_time_hours');
  const currentSpeeds = speedsFrom(currentTripWithDistance, 'sailing_time_hours');
  const currentSpeedsWithPauses = speedsFrom(currentTripWithDistance, 'total_time_hours');

  const speedCI = confidenceInterval95(historicalSpeeds);
  const speedWithPausesCI = confidenceInterval95(historicalSpeedsWithPauses);
  const currentSpeedCI = confidenceInterval95(currentSpeeds);
  const currentSpeedWithPausesCI = confidenceInterval95(currentSpeedsWithPauses);

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

  const stopUsage = useMemo(() => {
    const usage = new Map<string, number>();
    for (const seg of daySegments) {
      usage.set(seg.fromStopId, (usage.get(seg.fromStopId) ?? 0) + 1);
      usage.set(seg.toStopId, (usage.get(seg.toStopId) ?? 0) + 1);
    }
    return [...usage.entries()].sort((a, b) => b[1] - a[1]);
  }, [daySegments]);
  const topStop = stopUsage[0];

  const fastestSegment = withDistance
    .filter((st) => st.km > 0 && st.sailing_time_hours > 0)
    .sort((a, b) => b.km / b.sailing_time_hours - a.km / a.sailing_time_hours)[0];
  const slowestSegment = withDistance
    .filter((st) => st.km > 0 && st.sailing_time_hours > 0)
    .sort((a, b) => a.km / a.sailing_time_hours - b.km / b.sailing_time_hours)[0];

  const stopName = (id: string) => stops.find((s) => s.id === id)?.name ?? '?';

  if (loading || stopsLoading) return <p className="text-river-500">Indlæser…</p>;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="mb-3 font-semibold text-river-800">Historiske data (alle Gudenå-ture)</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Samlet sejllængde" value={`${historicalTotals.totalKm.toFixed(1)} km`} />
          <StatCard label="Samlet sejltid (ren)" value={formatHours(historicalTotals.totalSailingHours)} />
          <StatCard label="Samlet tid inkl. pauser" value={formatHours(historicalTotals.totalWithPauseHours)} />
          <StatCard
            label="Gennemsnitshastighed"
            value={historicalSpeeds.length > 0 ? formatKmT(speedCI.mean) : '–'}
            sub={speedCI.n >= 2 ? `95% CI: [${formatKmT(speedCI.low)} : ${formatKmT(speedCI.high)}]` : undefined}
          />
          <StatCard
            label="Gennemsnitshastighed inkl. pauser"
            value={historicalSpeedsWithPauses.length > 0 ? formatKmT(speedWithPausesCI.mean) : '–'}
            sub={
              speedWithPausesCI.n >= 2
                ? `95% CI: [${formatKmT(speedWithPausesCI.low)} : ${formatKmT(speedWithPausesCI.high)}]`
                : undefined
            }
          />
          <StatCard
            label="Mest populære stop"
            value={topStop ? stopName(topStop[0]) : '–'}
            sub={topStop ? `Brugt som etape-endepunkt ${topStop[1]} gange` : undefined}
          />
          <StatCard label="Antal Gudenå-ture" value={`${gudenaaTrips.length}`} />
          <StatCard label="Antal loggede sejldage" value={`${sailingTimes.length}`} />
        </div>
        <p className="mt-2 text-xs text-river-400">
          "Samlet sejllængde" og "Samlet tid" tæller hvert stræk på en rejse med én gang, selv hvis flere har
          logget samme (eller overlappende) stræk. Gennemsnitshastighederne bruger derimod alle registreringer
          hver for sig.
        </p>
      </div>

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
              value={currentSpeeds.length > 0 ? formatKmT(currentSpeedCI.mean) : '–'}
              sub={
                currentSpeeds.length > 0 && speedCI.mean > 0
                  ? formatPercentDiff(percentDiff(currentSpeedCI.mean, speedCI.mean) ?? 0)
                  : undefined
              }
            />
            <StatCard
              label="Gennemsnitshastighed inkl. pauser"
              value={currentSpeedsWithPauses.length > 0 ? formatKmT(currentSpeedWithPausesCI.mean) : '–'}
              sub={
                currentSpeedsWithPauses.length > 0 && speedWithPausesCI.mean > 0
                  ? formatPercentDiff(
                      percentDiff(currentSpeedWithPausesCI.mean, speedWithPausesCI.mean) ?? 0
                    )
                  : undefined
              }
            />
            <StatCard label="Antal loggede sejldage" value={`${currentTripSailingTimes.length}`} />
          </div>
        ) : (
          <div className="card p-8 text-center text-river-400">
            Ingen sejltider er logget på denne rejse endnu. Tilføj data på "Sejltider"-siden for at se
            rejsens egne tal her, sammenlignet med de historiske.
          </div>
        )}
      </div>

      {(longestDay || shortestDay || stopUsage.length > 0 || fastestSegment) && (
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
            {fastestSegment && (
              <p>
                Hurtigste log: {stopName(fastestSegment.start_stop_id)} → {stopName(fastestSegment.end_stop_id)}{' '}
                ({formatKmT(fastestSegment.km / fastestSegment.sailing_time_hours)})
              </p>
            )}
            {slowestSegment && (
              <p>
                Roligste log: {stopName(slowestSegment.start_stop_id)} → {stopName(slowestSegment.end_stop_id)}{' '}
                ({formatKmT(slowestSegment.km / slowestSegment.sailing_time_hours)})
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
