import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useTrip } from '../../context/TripContext';
import { useGudenaaStops } from '../../hooks/useGudenaaStops';
import { confidenceInterval95, formatHours } from '../../lib/stats';
import type { GudenaaStop, RoutePlan, RoutePlanDay, SailingTime } from '../../lib/types';

export default function RoutePlannerPage() {
  const { trip, isEditable } = useTrip();
  const { stops, loading: stopsLoading } = useGudenaaStops();
  const [plan, setPlan] = useState<RoutePlan | null>(null);
  const [days, setDays] = useState<RoutePlanDay[]>([]);
  const [sailingTimes, setSailingTimes] = useState<SailingTime[]>([]);
  const [numDays, setNumDays] = useState(3);
  const [startStopId, setStartStopId] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (trip) load();
  }, [trip?.id]);

  async function load() {
    if (!trip) return;
    setLoading(true);
    const { data: planData } = await supabase
      .from('gudenaa_route_plans')
      .select('*')
      .eq('trip_id', trip.id)
      .maybeSingle();

    if (planData) {
      setPlan(planData as RoutePlan);
      setNumDays((planData as RoutePlan).num_days);
      setStartStopId((planData as RoutePlan).start_stop_id);
      const { data: dayData } = await supabase
        .from('gudenaa_route_plan_days')
        .select('*')
        .eq('route_plan_id', (planData as RoutePlan).id)
        .order('day_number');
      setDays((dayData as RoutePlanDay[]) ?? []);
    }

    const { data: sailData } = await supabase.from('gudenaa_sailing_times').select('*');
    setSailingTimes((sailData as SailingTime[]) ?? []);

    setLoading(false);
  }

  async function createOrUpdatePlan() {
    if (!trip || !startStopId) return;

    let planId = plan?.id;
    if (!planId) {
      const { data, error } = await supabase
        .from('gudenaa_route_plans')
        .insert({ trip_id: trip.id, start_stop_id: startStopId, num_days: numDays })
        .select()
        .single();
      if (error || !data) return;
      planId = data.id;
      setPlan(data as RoutePlan);
    } else {
      await supabase
        .from('gudenaa_route_plans')
        .update({ start_stop_id: startStopId, num_days: numDays })
        .eq('id', planId);
    }

    // Sørg for at der findes en dag-række for hver dag 1..numDays.
    const existingDayNumbers = new Set(days.map((d) => d.day_number));
    const toInsert = [];
    for (let i = 1; i <= numDays; i++) {
      if (!existingDayNumbers.has(i)) toInsert.push({ route_plan_id: planId, day_number: i, end_stop_id: null });
    }
    if (toInsert.length > 0) await supabase.from('gudenaa_route_plan_days').insert(toInsert);

    // Fjern overskydende dage hvis antallet blev sat ned.
    await supabase
      .from('gudenaa_route_plan_days')
      .delete()
      .eq('route_plan_id', planId)
      .gt('day_number', numDays);

    load();
  }

  async function setDayEndStop(dayNumber: number, endStopId: string) {
    const day = days.find((d) => d.day_number === dayNumber);
    if (!day) return;
    await supabase.from('gudenaa_route_plan_days').update({ end_stop_id: endStopId || null }).eq('id', day.id);
    load();
  }

  const stopById = useMemo(() => {
    const map: Record<string, GudenaaStop> = {};
    for (const s of stops) map[s.id] = s;
    return map;
  }, [stops]);

  const sortedStops = [...stops].sort((a, b) => a.sort_order - b.sort_order);

  // Beregner distance/tid mellem to stop ud fra kumulativ position i den globale rækkefølge.
  function segmentBetween(fromId: string, toId: string) {
    const from = stopById[fromId];
    const to = stopById[toId];
    if (!from || !to) return { km: 0, hours: 0 };
    const fromIdx = sortedStops.findIndex((s) => s.id === fromId);
    const toIdx = sortedStops.findIndex((s) => s.id === toId);
    if (fromIdx === -1 || toIdx === -1 || toIdx < fromIdx) return { km: 0, hours: 0 };
    let km = 0;
    let hours = 0;
    for (let i = fromIdx + 1; i <= toIdx; i++) {
      km += sortedStops[i].distance_from_previous_km;
      hours += sortedStops[i].sail_time_hours;
    }
    return { km, hours };
  }

  const dayResults = useMemo(() => {
    if (!startStopId) return [];
    let current = startStopId;
    const results: { day: number; from: string; to: string | null; km: number; hours: number }[] = [];
    for (let i = 1; i <= numDays; i++) {
      const day = days.find((d) => d.day_number === i);
      const to = day?.end_stop_id ?? null;
      const seg = to ? segmentBetween(current, to) : { km: 0, hours: 0 };
      results.push({ day: i, from: current, to, km: seg.km, hours: seg.hours });
      if (to) current = to;
    }
    return results;
  }, [startStopId, numDays, days, stops]);

  const totalKm = dayResults.reduce((s, d) => s + d.km, 0);
  const totalHours = dayResults.reduce((s, d) => s + d.hours, 0);

  // Historisk hastighed baseret på alle loggede sejltider (km / sejltid uden pauser).
  const historicalSpeeds = useMemo(() => {
    return sailingTimes
      .map((st) => {
        const seg = segmentBetween(st.start_stop_id, st.end_stop_id);
        if (seg.km === 0 || st.sailing_time_hours === 0) return null;
        return seg.km / st.sailing_time_hours;
      })
      .filter((v): v is number => v !== null && isFinite(v) && v > 0);
  }, [sailingTimes, stops]);

  const historicalSpeedsWithPauses = useMemo(() => {
    return sailingTimes
      .map((st) => {
        const seg = segmentBetween(st.start_stop_id, st.end_stop_id);
        if (seg.km === 0 || st.total_time_hours === 0) return null;
        return seg.km / st.total_time_hours;
      })
      .filter((v): v is number => v !== null && isFinite(v) && v > 0);
  }, [sailingTimes, stops]);

  const speedCI = confidenceInterval95(historicalSpeeds);
  const speedWithPausesCI = confidenceInterval95(historicalSpeedsWithPauses);

  function estimateFromSpeed(ci: ReturnType<typeof confidenceInterval95>, distanceKm: number) {
    if (ci.mean === 0) return null;
    return {
      mean: distanceKm / ci.mean,
      low: ci.high > 0 ? distanceKm / ci.high : 0,
      high: ci.low > 0 ? distanceKm / ci.low : Infinity,
    };
  }

  const pureEstimate = estimateFromSpeed(speedCI, totalKm);
  const withPausesEstimate = estimateFromSpeed(speedWithPausesCI, totalKm);

  if (loading || stopsLoading) return <p className="text-river-500">Indlæser…</p>;

  return (
    <div className="space-y-6">
      <div className="card space-y-4 p-5">
        <h2 className="font-semibold text-river-800">Planlæg ruten</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Antal dage</label>
            <input
              type="number"
              min={1}
              max={14}
              className="input"
              value={numDays}
              onChange={(e) => setNumDays(Number(e.target.value))}
              disabled={!isEditable}
            />
          </div>
          <div>
            <label className="label">Startsted</label>
            <select
              className="input"
              value={startStopId}
              onChange={(e) => setStartStopId(e.target.value)}
              disabled={!isEditable}
            >
              <option value="">Vælg startsted</option>
              {sortedStops.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        {isEditable && (
          <button className="btn-primary" onClick={createOrUpdatePlan} disabled={!startStopId}>
            Gem ruteplan
          </button>
        )}
      </div>

      {startStopId && plan && (
        <div className="space-y-4">
          {dayResults.map((d) => {
            const toStop = d.to ? stopById[d.to] : null;
            const fromIdx = sortedStops.findIndex((s) => s.id === d.from);
            const options = sortedStops.slice(fromIdx + 1);
            return (
              <div key={d.day} className="card p-5">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="font-semibold text-river-800">Dag {d.day}</h3>
                  <span className="text-sm text-river-500">
                    fra {stopById[d.from]?.name ?? '—'}
                  </span>
                </div>
                <select
                  className="input mb-2"
                  value={d.to ?? ''}
                  onChange={(e) => setDayEndStop(d.day, e.target.value)}
                  disabled={!isEditable}
                >
                  <option value="">Vælg slutsted</option>
                  {options.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                {toStop && (
                  <>
                    <p className="text-sm text-river-600">
                      {d.km.toFixed(1)} km · ca. {formatHours(d.hours)}
                    </p>
                    {toStop.description && <p className="mt-1 text-sm text-river-500">{toStop.description}</p>}
                    {toStop.tags && toStop.tags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {toStop.tags.map((tag) => (
                          <span key={tag} className="rounded-full bg-river-100 px-2 py-0.5 text-xs text-river-600">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}

          <div className="card p-5">
            <h3 className="mb-2 font-semibold text-river-800">Samlet tur</h3>
            <p className="text-sm text-river-600">
              {totalKm.toFixed(1)} km i alt · skematid ca. {formatHours(totalHours)}
            </p>

            {pureEstimate && speedCI.n >= 2 ? (
              <p className="mt-2 text-sm text-river-600">
                Estimeret ren sejltid ud fra historisk gennemsnitsfart ({speedCI.n} datapunkter):{' '}
                <strong>{formatHours(pureEstimate.mean)}</strong> [{formatHours(pureEstimate.low)} :{' '}
                {formatHours(pureEstimate.high)}] (95% konfidensinterval)
              </p>
            ) : (
              <p className="mt-2 text-xs text-river-400">
                For få loggede sejltider endnu til at beregne et pålideligt estimat (kræver mindst 2 relevante
                registreringer på "Sejltider"-siden).
              </p>
            )}

            {withPausesEstimate && speedWithPausesCI.n >= 2 && (
              <p className="mt-1 text-sm text-river-600">
                Estimeret tid inkl. pauser: <strong>{formatHours(withPausesEstimate.mean)}</strong> [
                {formatHours(withPausesEstimate.low)} : {formatHours(withPausesEstimate.high)}]
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
