import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useTrip } from '../../context/TripContext';
import { useGudenaaStops } from '../../hooks/useGudenaaStops';
import { segmentBetween, sortStops } from '../../lib/gudenaa';
import { computeDedupedTotals } from '../../lib/gudenaaStats';
import { confidenceInterval95, formatHours, formatKmT } from '../../lib/stats';
import type { SailingTime, Trip } from '../../lib/types';

export default function StatisticsPage() {
  const { trip } = useTrip();
  const { stops, loading: stopsLoading } = useGudenaaStops();
  const [sailingTimes, setSailingTimes] = useState<SailingTime[]>([]);
  const [gudenaaTrips, setGudenaaTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const [{ data: sailData }, { data: tripData }] = await Promise.all([
      supabase.from('gudenaa_sailing_times').select('*, profile:profiles(*)'),
      supabase.from('trips').select('*').eq('trip_type', 'gudenaa'),
    ]);
    setSailingTimes((sailData as unknown as SailingTime[]) ?? []);
    setGudenaaTrips((tripData as Trip[]) ?? []);
    setLoading(false);
  }

  const sorted = sortStops(stops);

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
    return list
      .filter((st) => st.km > 0 && st[field] > 0)
      .map((st) => st.km / st[field]);
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
          <StatCard label="Gudenå-ture" value={`${gudenaaTrips.length}`} />
          <StatCard label="Samlet sejllængde" value={`${historicalTotals.totalKm.toFixed(1)} km`} />
          <StatCard label="Samlet sejltid (ren)" value={formatHours(historicalTotals.totalSailingHours)} />
          <StatCard label="Samlet tid inkl. pauser" value={formatHours(historicalTotals.totalWithPauseHours)} />
          <StatCard label="Antal loggede sejlture" value={`${sailingTimes.length}`} />
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
            <StatCard label="Antal loggede sejlture" value={`${currentTripSailingTimes.length}`} />
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
          </div>
        ) : (
          <div className="card p-8 text-center text-river-400">
            Ingen sejltider er logget på denne rejse endnu. Tilføj data på "Sejltider"-siden for at se
            rejsens egne tal her, sammenlignet med de historiske.
          </div>
        )}
      </div>

      {fastestSegment && (
        <div className="card p-5">
          <h3 className="mb-2 font-semibold text-river-800">Highlights (alle ture)</h3>
          <p className="text-sm text-river-600">
            Hurtigste log: {stopName(fastestSegment.start_stop_id)} → {stopName(fastestSegment.end_stop_id)} (
            {formatKmT(fastestSegment.km / fastestSegment.sailing_time_hours)})
          </p>
          {slowestSegment && (
            <p className="text-sm text-river-600">
              Roligste log: {stopName(slowestSegment.start_stop_id)} → {stopName(slowestSegment.end_stop_id)} (
              {formatKmT(slowestSegment.km / slowestSegment.sailing_time_hours)})
            </p>
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
