import type { GudenaaStop } from './types';

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
