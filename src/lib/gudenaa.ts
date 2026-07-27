import type { GudenaaStop, RoutePlan, RoutePlanDay } from './types';

/**
 * Beregner den skematiske distance (km) og sejltid (timer) mellem to stop,
 * baseret på deres position i den globale rækkefølge (sort_order) langs åen.
 * Returnerer 0 hvis stedet ikke findes, eller hvis "til" ligger før "fra".
 */
export function segmentBetween(
  sortedStops: GudenaaStop[],
  fromId: string,
  toId: string
): { km: number; hours: number } {
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

export function sortStops(stops: GudenaaStop[]): GudenaaStop[] {
  return [...stops].sort((a, b) => a.sort_order - b.sort_order);
}

export interface RoutePlanDaySegment {
  routePlanId: string;
  tripId: string;
  dayNumber: number;
  fromStopId: string;
  toStopId: string;
  km: number;
  hours: number;
}

/**
 * Brækker alle gemte ruteplaner ned i deres enkelte dags-etaper (fra ét stop
 * til det næste), med den skematiske distance/tid for hver etape. Bruges til
 * statistik som "længste/korteste dag" og "mest populære stop" på tværs af
 * alle Gudenå-ture — baseret på de PLANLAGTE ruter, ikke kun de faktisk
 * loggede sejltider.
 */
export function computeRoutePlanDaySegments(
  stops: GudenaaStop[],
  plans: RoutePlan[],
  days: RoutePlanDay[]
): RoutePlanDaySegment[] {
  const sorted = sortStops(stops);
  const daysByPlan = new Map<string, RoutePlanDay[]>();
  for (const d of days) {
    const list = daysByPlan.get(d.route_plan_id) ?? [];
    list.push(d);
    daysByPlan.set(d.route_plan_id, list);
  }

  const segments: RoutePlanDaySegment[] = [];
  for (const plan of plans) {
    const planDays = (daysByPlan.get(plan.id) ?? []).slice().sort((a, b) => a.day_number - b.day_number);
    let current = plan.start_stop_id;
    for (const day of planDays) {
      if (!day.end_stop_id) continue;
      const seg = segmentBetween(sorted, current, day.end_stop_id);
      if (seg.km > 0) {
        segments.push({
          routePlanId: plan.id,
          tripId: plan.trip_id,
          dayNumber: day.day_number,
          fromStopId: current,
          toStopId: day.end_stop_id,
          km: seg.km,
          hours: seg.hours,
        });
      }
      current = day.end_stop_id;
    }
  }
  return segments;
}
