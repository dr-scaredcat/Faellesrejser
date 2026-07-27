import type { GudenaaStop } from './types';

/**
 * Foreslår en dagsopdeling af en rute på Gudenåen.
 *
 * Manuelt valg af slutstop pr. dag bliver ved med at være det primære — planen
 * ændrer sig alligevel undervejs, når vejret driller. Det her er en startknap,
 * ikke en tvangstrøje.
 *
 * Algoritmen er dynamisk programmering over (stop, antal dage brugt). Med ~40
 * stop og op til 14 dage er det nogle få tusinde operationer, så den kan køre
 * direkte i browseren uden at nogen når at opdage det.
 */

export type RouteObjective =
  /** Gør dagene så ens som muligt (minimerer summen af kvadrerede dagstider). */
  | 'even'
  /** Gør den længste dag så kort som muligt. Jævner dagene ud som andet hensyn. */
  | 'minimax';

export interface SuggestRouteOptions {
  /**
   * Kun stop med dette tag må bruges som overnatningssted. Har kun betydning
   * hvis requireOvernight sættes til true.
   */
  overnightTag?: string;
  /**
   * Som udgangspunkt false: alle stop kan afslutte en dag. Får I på et
   * tidspunkt markeret hvilke stop der reelt kan overnattes på, kan den
   * sættes til true uden andre ændringer.
   */
  requireOvernight?: boolean;
  /** Hård grænse for en enkelt dags sejltid. Ingen grænse hvis null. */
  maxHoursPerDay?: number | null;
  objective?: RouteObjective;
}

export interface SuggestedDay {
  dayNumber: number;
  startStopId: string;
  startStopName: string;
  endStopId: string;
  endStopName: string;
  distanceKm: number;
  sailTimeHours: number;
}

export interface RouteSuggestion {
  days: SuggestedDay[];
  totalDistanceKm: number;
  totalSailTimeHours: number;
  longestDayHours: number;
  shortestDayHours: number;
  /** Spredningen mellem dagene. Lavere er mere ensartet. */
  spreadHours: number;
}

export type SuggestRouteResult =
  | { ok: true; suggestion: RouteSuggestion }
  | { ok: false; reason: string };

const DEFAULTS: Required<Omit<SuggestRouteOptions, 'maxHoursPerDay'>> & {
  maxHoursPerDay: number | null;
} = {
  overnightTag: 'overnatning',
  requireOvernight: false,
  maxHoursPerDay: null,
  objective: 'even',
};

interface Cell {
  cost: number; // sum af kvadrerede dagstider
  maxDay: number; // længste dag på ruten hertil
  from: number | null; // indeks på foregående overnatningsstop
}

export function suggestRoute(
  stops: GudenaaStop[],
  startStopId: string,
  endStopId: string,
  numDays: number,
  options: SuggestRouteOptions = {}
): SuggestRouteResult {
  const opts = { ...DEFAULTS, ...options };

  if (numDays < 1) return { ok: false, reason: 'Antal dage skal være mindst 1.' };

  const ordered = [...stops].sort((a, b) => a.sort_order - b.sort_order);
  const startIdx = ordered.findIndex((s) => s.id === startStopId);
  const endIdx = ordered.findIndex((s) => s.id === endStopId);

  if (startIdx === -1 || endIdx === -1) {
    return { ok: false, reason: 'Start- eller slutstop findes ikke på ruten.' };
  }
  if (endIdx <= startIdx) {
    return { ok: false, reason: 'Slutstoppet skal ligge nedstrøms for startstoppet.' };
  }

  // distance_from_previous_km og sail_time_hours hører til strækningen ind til
  // stoppet, så kumulativ tid/distance fra startstoppet regnes fra startIdx+1.
  const cumTime: number[] = new Array(ordered.length).fill(0);
  const cumDist: number[] = new Array(ordered.length).fill(0);
  for (let i = startIdx + 1; i <= endIdx; i++) {
    cumTime[i] = cumTime[i - 1] + Number(ordered[i].sail_time_hours ?? 0);
    cumDist[i] = cumDist[i - 1] + Number(ordered[i].distance_from_previous_km ?? 0);
  }

  // Alle stop kan afslutte en dag, medmindre requireOvernight slås til.
  // Slutstoppet kan altid, uanset tags — man skal jo kunne komme i mål.
  const canEndDay = (i: number) => {
    if (i === endIdx) return true;
    if (!opts.requireOvernight) return true;
    return (ordered[i].tags ?? []).includes(opts.overnightTag);
  };

  const dayTime = (from: number, to: number) => cumTime[to] - cumTime[from];
  const dayDist = (from: number, to: number) => cumDist[to] - cumDist[from];

  const INF = Number.POSITIVE_INFINITY;
  // table[d][i] = bedste måde at nå stop i på præcis d dage.
  const table: Cell[][] = Array.from({ length: numDays + 1 }, () =>
    Array.from({ length: ordered.length }, () => ({ cost: INF, maxDay: INF, from: null }))
  );
  table[0][startIdx] = { cost: 0, maxDay: 0, from: null };

  for (let d = 1; d <= numDays; d++) {
    for (let to = startIdx + 1; to <= endIdx; to++) {
      // Undervejs skal dagen slutte et sted, man kan overnatte. På sidste dag
      // skal den slutte præcis i mål.
      if (d < numDays && !canEndDay(to)) continue;
      if (d === numDays && to !== endIdx) continue;

      let best: Cell = { cost: INF, maxDay: INF, from: null };

      for (let from = startIdx; from < to; from++) {
        const prev = table[d - 1][from];
        if (prev.cost === INF) continue;

        const t = dayTime(from, to);
        if (t <= 0) continue;
        if (opts.maxHoursPerDay != null && t > opts.maxHoursPerDay) continue;

        const cost = prev.cost + t * t;
        const maxDay = Math.max(prev.maxDay, t);

        const better =
          opts.objective === 'minimax'
            ? maxDay < best.maxDay || (maxDay === best.maxDay && cost < best.cost)
            : cost < best.cost || (cost === best.cost && maxDay < best.maxDay);

        if (better) best = { cost, maxDay, from };
      }

      table[d][to] = best;
    }
  }

  const final = table[numDays][endIdx];
  if (final.cost === INF) {
    return {
      ok: false,
      reason:
        opts.maxHoursPerDay != null
          ? `Ruten kan ikke deles i ${numDays} dage med højst ${opts.maxHoursPerDay} timers sejlads. Prøv flere dage eller en højere grænse.`
          : `Ruten kan ikke deles i ${numDays} dage — der er kun ${endIdx - startIdx} stop på strækningen. Prøv færre dage.`,
    };
  }

  // Følg kæden tilbage og vend den om.
  const boundaries: number[] = [endIdx];
  let cursor = endIdx;
  for (let d = numDays; d >= 1; d--) {
    const cell = table[d][cursor];
    if (cell.from == null) break;
    boundaries.unshift(cell.from);
    cursor = cell.from;
  }

  const days: SuggestedDay[] = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const from = boundaries[i];
    const to = boundaries[i + 1];
    days.push({
      dayNumber: i + 1,
      startStopId: ordered[from].id,
      startStopName: ordered[from].name,
      endStopId: ordered[to].id,
      endStopName: ordered[to].name,
      distanceKm: round(dayDist(from, to), 1),
      sailTimeHours: round(dayTime(from, to), 2),
    });
  }

  const times = days.map((d) => d.sailTimeHours);
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  const spread =
    times.length > 1
      ? Math.sqrt(times.reduce((sum, t) => sum + (t - mean) ** 2, 0) / (times.length - 1))
      : 0;

  return {
    ok: true,
    suggestion: {
      days,
      totalDistanceKm: round(cumDist[endIdx], 1),
      totalSailTimeHours: round(cumTime[endIdx], 2),
      longestDayHours: round(Math.max(...times), 2),
      shortestDayHours: round(Math.min(...times), 2),
      spreadHours: round(spread, 2),
    },
  };
}

function round(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
