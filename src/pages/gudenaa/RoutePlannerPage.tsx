import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useTrip } from '../../context/TripContext';
import { useToast } from '../../components/Toast';
import { useMutate } from '../../hooks/useMutate';
import { useGudenaaStops } from '../../hooks/useGudenaaStops';
import { formatHours } from '../../lib/stats';
import { groupSailingDays } from '../../lib/gudenaaStats';
import { describeModel, fitPaceModel, predictTime, type PaceModel } from '../../lib/paceModel';
import { resultantCourse, windEffect } from '../../lib/windEffect';
import { suggestRoute, type RouteObjective } from '../../lib/routeSuggestion';
import type { GudenaaStop, RoutePlan, RoutePlanDay, SailingTimeWithFlow } from '../../lib/types';

export default function RoutePlannerPage() {
  const { trip, isEditable } = useTrip();
  const { stops, loading: stopsLoading } = useGudenaaStops();
  const { showToast } = useToast();
  const mutate = useMutate();

  const [plan, setPlan] = useState<RoutePlan | null>(null);
  const [days, setDays] = useState<RoutePlanDay[]>([]);
  const [sailingTimes, setSailingTimes] = useState<SailingTimeWithFlow[]>([]);
  const [numDays, setNumDays] = useState(3);
  const [startStopId, setStartStopId] = useState('');
  const [loading, setLoading] = useState(true);

  // Kun til forslagsknappen. Slutstedet gemmes ikke på planen — det er
  // dag-rækkerne der er sandheden, netop fordi ruten ofte laves om undervejs.
  const [targetStopId, setTargetStopId] = useState('');
  const [objective, setObjective] = useState<RouteObjective>('even');
  const [maxHours, setMaxHours] = useState('');
  const [suggesting, setSuggesting] = useState(false);

  useEffect(() => {
    if (trip) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

    // Viewet leverer sejltiderne sammen med vandføringen for dagen,
    // normaliseret i forhold til hvad der er normalt for årstiden.
    const { data: sailData } = await supabase.from('sailing_times_with_flow').select('*');
    setSailingTimes((sailData as unknown as SailingTimeWithFlow[]) ?? []);

    setLoading(false);
  }

  /**
   * Sørger for at der findes en plan med præcis numDays dag-rækker, og
   * returnerer de friske rækker. Bruges både af "Gem ruteplan" og af
   * forslagsknappen.
   */
  async function ensurePlan(): Promise<{ planId: string; days: RoutePlanDay[] } | null> {
    if (!trip || !startStopId) return null;

    let planId = plan?.id;

    if (!planId) {
      const { data, ok } = await mutate(
        supabase
          .from('gudenaa_route_plans')
          .insert({ trip_id: trip.id, start_stop_id: startStopId, num_days: numDays })
          .select()
          .single()
      );
      if (!ok || !data) return null;
      planId = (data as RoutePlan).id;
      setPlan(data as RoutePlan);
    } else {
      const { ok } = await mutate(
        supabase
          .from('gudenaa_route_plans')
          .update({ start_stop_id: startStopId, num_days: numDays })
          .eq('id', planId)
      );
      if (!ok) return null;
    }

    const existingDayNumbers = new Set(days.map((d) => d.day_number));
    const toInsert = [];
    for (let i = 1; i <= numDays; i++) {
      if (!existingDayNumbers.has(i)) {
        toInsert.push({ route_plan_id: planId, day_number: i, end_stop_id: null });
      }
    }
    if (toInsert.length > 0) {
      const { ok } = await mutate(supabase.from('gudenaa_route_plan_days').insert(toInsert));
      if (!ok) return null;
    }

    // Fjern overskydende dage hvis antallet blev sat ned.
    await mutate(
      supabase
        .from('gudenaa_route_plan_days')
        .delete()
        .eq('route_plan_id', planId)
        .gt('day_number', numDays)
    );

    const { data: dayData } = await supabase
      .from('gudenaa_route_plan_days')
      .select('*')
      .eq('route_plan_id', planId)
      .order('day_number');

    return { planId, days: (dayData as RoutePlanDay[]) ?? [] };
  }

  async function createOrUpdatePlan() {
    const result = await ensurePlan();
    if (result) load();
  }

  async function setDayEndStop(dayNumber: number, endStopId: string) {
    const day = days.find((d) => d.day_number === dayNumber);
    if (!day) return;
    const { ok } = await mutate(
      supabase
        .from('gudenaa_route_plan_days')
        .update({ end_stop_id: endStopId || null })
        .eq('id', day.id)
    );
    if (ok) load();
  }

  async function applySuggestion() {
    if (!startStopId || !targetStopId) return;

    const cap = maxHours.trim() ? Number(maxHours) : null;
    if (cap != null && (!isFinite(cap) || cap <= 0)) {
      showToast('Grænsen for timer pr. dag skal være et positivt tal.', 'error');
      return;
    }

    const result = suggestRoute(stops, startStopId, targetStopId, numDays, {
      objective,
      maxHoursPerDay: cap,
    });

    if (!result.ok) {
      showToast(result.reason, 'error');
      return;
    }

    setSuggesting(true);
    const planResult = await ensurePlan();
    if (!planResult) {
      setSuggesting(false);
      return;
    }

    for (const suggested of result.suggestion.days) {
      const row = planResult.days.find((d) => d.day_number === suggested.dayNumber);
      if (!row) continue;
      const { ok } = await mutate(
        supabase
          .from('gudenaa_route_plan_days')
          .update({ end_stop_id: suggested.endStopId })
          .eq('id', row.id)
      );
      if (!ok) {
        setSuggesting(false);
        return;
      }
    }

    setSuggesting(false);
    showToast(
      `Ruten er delt i ${result.suggestion.days.length} dage. Længste dag er ${formatHours(
        result.suggestion.longestDayHours
      )}. Du kan stadig rette hver dag manuelt.`,
      'success'
    );
    load();
  }

  const stopById = useMemo(() => {
    const map: Record<string, GudenaaStop> = {};
    for (const s of stops) map[s.id] = s;
    return map;
  }, [stops]);

  const sortedStops = useMemo(() => [...stops].sort((a, b) => a.sort_order - b.sort_order), [stops]);

  // Beregner distance/tid mellem to stop ud fra kumulativ position i den globale rækkefølge.
  function segmentBetween(fromId: string, toId: string) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startStopId, numDays, days, sortedStops]);

  const totalKm = dayResults.reduce((s, d) => s + d.km, 0);
  const totalHours = dayResults.reduce((s, d) => s + d.hours, 0);

  // Modellerne fittes på grupperede sejldage, ikke på de rå registreringer.
  // Logger tre personer den samme dag, er det stadig én observation af, hvor
  // lang tid en dag på åen tager. Talte man dem hver for sig, ville
  // prædiktionsintervallerne blive for smalle.
  function courseFor(startStopId: string, endStopId: string) {
    const fromIdx = sortedStops.findIndex((s) => s.id === startStopId);
    const toIdx = sortedStops.findIndex((s) => s.id === endStopId);
    if (fromIdx === -1 || toIdx === -1 || toIdx <= fromIdx) return null;
    const segments = [];
    for (let i = fromIdx + 1; i <= toIdx; i++) {
      segments.push({
        distanceKm: sortedStops[i].distance_from_previous_km,
        bearingDegrees: sortedStops[i].bearing_degrees,
      });
    }
    return resultantCourse(segments);
  }

  const sailingDays = useMemo(
    () => groupSailingDays(stops, sailingTimes),
    [stops, sailingTimes]
  );

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
    [sailingDays, sortedStops]
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

  function estimate(model: PaceModel | null, km: number) {
    if (!model || km <= 0) return null;
    return predictTime(model, km);
  }

  const pureEstimate = estimate(pureModel, totalKm);
  const withPausesEstimate = estimate(pausesModel, totalKm);

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

      {isEditable && (
        <div className="card space-y-4 p-5">
          <div>
            <h2 className="font-semibold text-river-800">Foreslå rute</h2>
            <p className="mt-1 text-sm text-river-500">
              Fordeler strækningen på dine dage. Forslaget skriver slutstederne ind, og du kan rette hver
              enkelt dag bagefter — ruten laver sig alligevel om, når vejret driller.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Slutsted</label>
              <select
                className="input"
                value={targetStopId}
                onChange={(e) => setTargetStopId(e.target.value)}
              >
                <option value="">Vælg slutsted</option>
                {sortedStops
                  .filter((s) => {
                    if (!startStopId) return true;
                    const startIdx = sortedStops.findIndex((x) => x.id === startStopId);
                    const idx = sortedStops.findIndex((x) => x.id === s.id);
                    return idx > startIdx;
                  })
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label className="label">Fordeling</label>
              <select
                className="input"
                value={objective}
                onChange={(e) => setObjective(e.target.value as RouteObjective)}
              >
                <option value="even">Så ensartede dage som muligt</option>
                <option value="minimax">Så kort en længste dag som muligt</option>
              </select>
            </div>
          </div>

          <div className="sm:w-1/2">
            <label className="label">Højst timer pr. dag (valgfrit)</label>
            <input
              type="number"
              step="0.5"
              min="0.5"
              className="input"
              placeholder="fx 6"
              value={maxHours}
              onChange={(e) => setMaxHours(e.target.value)}
            />
          </div>

          <button
            className="btn-secondary"
            onClick={applySuggestion}
            disabled={!startStopId || !targetStopId || suggesting}
          >
            {suggesting ? 'Beregner…' : 'Foreslå rute'}
          </button>
        </div>
      )}

      {startStopId && plan && (
        <div className="space-y-4">
          {dayResults.map((d) => {
            const toStop = d.to ? stopById[d.to] : null;
            const fromIdx = sortedStops.findIndex((s) => s.id === d.from);
            const options = sortedStops.slice(fromIdx + 1);
            const dayPure = estimate(pureModel, d.km);
            const dayPauses = estimate(pausesModel, d.km);
            return (
              <div key={d.day} className="card p-5">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="font-semibold text-river-800">Dag {d.day}</h3>
                  <span className="text-sm text-river-500">fra {stopById[d.from]?.name ?? '—'}</span>
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
                      {d.km.toFixed(1)} km · skematid ca. {formatHours(d.hours)}
                    </p>
                    {dayPure && (
                      <p className="mt-1 text-xs text-river-500">
                        Forventet sejltid: ca. {formatHours(dayPure.hours)} [{formatHours(dayPure.low)} :{' '}
                        {formatHours(dayPure.high)}]
                      </p>
                    )}
                    {dayPauses && (
                      <p className="text-xs text-river-500">
                        Forventet tid inkl. pauser: ca. {formatHours(dayPauses.hours)} [
                        {formatHours(dayPauses.low)} : {formatHours(dayPauses.high)}]
                      </p>
                    )}
                    {toStop.description && <p className="mt-1 text-sm text-river-500">{toStop.description}</p>}
                    {toStop.tags && toStop.tags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {toStop.tags.map((tag) => (
                          <span
                            key={tag}
                            className="rounded-full bg-river-100 px-2 py-0.5 text-xs text-river-600"
                          >
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

            {pureEstimate && pureModel ? (
              <p className="mt-2 text-sm text-river-600">
                Forventet ren sejltid: <strong>{formatHours(pureEstimate.hours)}</strong> [
                {formatHours(pureEstimate.low)} : {formatHours(pureEstimate.high)}]
              </p>
            ) : (
              <p className="mt-2 text-xs text-river-400">
                For få loggede sejltider endnu til at beregne et pålideligt estimat (kræver mindst 2
                registreringer på "Sejltider"-siden).
              </p>
            )}

            {withPausesEstimate && (
              <p className="mt-1 text-sm text-river-600">
                Forventet tid inkl. pauser: <strong>{formatHours(withPausesEstimate.hours)}</strong> [
                {formatHours(withPausesEstimate.low)} : {formatHours(withPausesEstimate.high)}]
              </p>
            )}

            {pureModel && (
              <p className="mt-3 text-xs text-river-400">
                Intervallet er et 95% prædiktionsinterval: det er spændet, en enkelt ny tur forventes at
                lande indenfor — ikke usikkerheden på gennemsnittet. Bygger på {describeModel(pureModel)}.
                {(pureModel.usesFlow || pureModel.usesWind) &&
                  ' Estimatet gælder ved normale forhold for årstiden.'}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
