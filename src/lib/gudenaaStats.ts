import type { GudenaaStop, SailingTime } from './types';
import { sortStops } from './gudenaa';

export interface DedupedTotals {
  totalKm: number;
  totalSailingHours: number;
  totalWithPauseHours: number;
}

/**
 * Beregner de "afdupliserede" totaler for sejlet distance og tid på tværs af
 * alle loggede sejltider.
 *
 * Baggrund: Flere personer på samme rejse kan registrere sejltid for samme
 * (eller overlappende) stræk, fordi de sejler sammen og hver logger sit eget
 * GPS-ur. Det skal ikke tælle som at have sejlet strækket flere gange.
 *
 * Metode: Hver registrering brækkes ned i de mindste "atomare" del-stræk
 * mellem to på-hinanden-følgende officielle stop (dem der er sat op i
 * admin). En registrering fra A til B, hvor der ligger et stop C imellem,
 * dækker altså del-strækkerne "A→C" og "C→B". Registreringens samlede tid
 * fordeles ud på del-strækkerne i forhold til, hvor stor en andel af den
 * samlede (officielle) distance hvert del-stræk udgør — dvs. ligeligt efter
 * distance, under antagelse af nogenlunde konstant fart undervejs.
 *
 * Herefter grupperes alle registreringers bidrag til samme del-stræk **på
 * samme rejse** (samme trip_id) sammen: distancen for del-strækket tælles
 * kun én gang, mens tiden bliver gennemsnittet af de tidsbidrag, der er
 * registreret for det del-stræk på den rejse. To forskellige rejser, der
 * sejler samme del-stræk, holdes adskilt og tælles hver for sig, da det er
 * to forskellige ture.
 *
 * Registreringer uden en rejse tilknyttet (trip_id er tom) dedupliceres ikke
 * med andre registreringer, da vi ikke kan vide om de hører sammen.
 */
export function computeDedupedTotals(stops: GudenaaStop[], sailingTimes: SailingTime[]): DedupedTotals {
  const sorted = sortStops(stops);
  const indexById = new Map<string, number>();
  sorted.forEach((s, i) => indexById.set(s.id, i));

  const segmentKm = new Map<string, number>(); // "gruppe::segmentindeks" -> km (samme for alle bidrag)
  const sailingContribs = new Map<string, number[]>();
  const totalContribs = new Map<string, number[]>();

  for (const st of sailingTimes) {
    const fromIdx = indexById.get(st.start_stop_id);
    const toIdx = indexById.get(st.end_stop_id);
    if (fromIdx === undefined || toIdx === undefined || toIdx <= fromIdx) continue;

    const segmentIndices: number[] = [];
    let spanKm = 0;
    for (let i = fromIdx + 1; i <= toIdx; i++) {
      segmentIndices.push(i);
      spanKm += sorted[i].distance_from_previous_km;
    }
    if (segmentIndices.length === 0) continue;

    // Registreringer uden trip_id dedupliceres kun med sig selv.
    const groupKey = st.trip_id ? `trip:${st.trip_id}` : `solo:${st.id}`;

    for (const i of segmentIndices) {
      const segKm = sorted[i].distance_from_previous_km;
      const weight = spanKm > 0 ? segKm / spanKm : 1 / segmentIndices.length;
      const key = `${groupKey}::${i}`;

      segmentKm.set(key, segKm);

      const sailingArr = sailingContribs.get(key) ?? [];
      sailingArr.push(st.sailing_time_hours * weight);
      sailingContribs.set(key, sailingArr);

      const totalArr = totalContribs.get(key) ?? [];
      totalArr.push(st.total_time_hours * weight);
      totalContribs.set(key, totalArr);
    }
  }

  let totalKm = 0;
  let totalSailingHours = 0;
  let totalWithPauseHours = 0;

  for (const [key, km] of segmentKm.entries()) {
    totalKm += km;
    totalSailingHours += average(sailingContribs.get(key) ?? []);
    totalWithPauseHours += average(totalContribs.get(key) ?? []);
  }

  return { totalKm, totalSailingHours, totalWithPauseHours };
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
