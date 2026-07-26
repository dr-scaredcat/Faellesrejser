import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useGudenaaStops } from '../../hooks/useGudenaaStops';
import { segmentBetween, sortStops } from '../../lib/gudenaa';
import { confidenceInterval95, formatHours, formatKmT } from '../../lib/stats';
import type { SailingTime, Trip } from '../../lib/types';

export default function StatisticsPage() {
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

  const withDistance = useMemo(
    () =>
      sailingTimes.map((st) => ({
        ...st,
        km: segmentBetween(sorted, st.start_stop_id, st.end_stop_id).km,
      })),
    [sailingTimes, stops]
  );

  const totalKm = withDistance.reduce((s, st) => s + st.km, 0);
  const totalSailingHours = withDistance.reduce((s, st) => s + st.sailing_time_hours, 0);
  const totalWithPauseHours = withDistance.reduce((s, st) => s + st.total_time_hours, 0);

  const speeds = withDistance
    .filter((st) => st.km > 0 && st.sailing_time_hours > 0)
    .map((st) => st.km / st.sailing_time_hours);
  const speedCI = confidenceInterval95(speeds);

  const fastestSegment = withDistance
    .filter((st) => st.km > 0 && st.sailing_time_hours > 0)
    .sort((a, b) => b.km / b.sailing_time_hours - a.km / a.sailing_time_hours)[0];
  const slowestSegment = withDistance
    .filter((st) => st.km > 0 && st.sailing_time_hours > 0)
    .sort((a, b) => a.km / a.sailing_time_hours - b.km / b.sailing_time_hours)[0];

  const stopName = (id: string) => stops.find((s) => s.id === id)?.name ?? '?';

  if (loading || stopsLoading) return <p className="text-river-500">Indlæser…</p>;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Gudenå-ture" value={`${gudenaaTrips.length}`} />
        <StatCard label="Samlet sejllængde" value={`${totalKm.toFixed(1)} km`} />
        <StatCard label="Samlet sejltid (ren)" value={formatHours(totalSailingHours)} />
        <StatCard label="Samlet tid inkl. pauser" value={formatHours(totalWithPauseHours)} />
        <StatCard label="Antal loggede sejlture" value={`${sailingTimes.length}`} />
        <StatCard
          label="Gennemsnitshastighed"
          value={speeds.length > 0 ? formatKmT(speedCI.mean) : '–'}
          sub={
            speedCI.n >= 2 ? `95% CI: [${formatKmT(speedCI.low)} : ${formatKmT(speedCI.high)}]` : undefined
          }
        />
      </div>

      {fastestSegment && (
        <div className="card p-5">
          <h3 className="mb-2 font-semibold text-river-800">Highlights</h3>
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
