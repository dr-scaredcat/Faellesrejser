import type { GudenaaStop, SailingTime, SailingTimeWithFlow } from './types';
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
  const indexById = byId(sorted);

  const grupper = new Map<string, SailingTime[]>();
  for (const st of sailingTimes) {
    const key = st.trip_id ? `trip:${st.trip_id}` : `solo:${st.id}`;
    const liste = grupper.get(key) ?? [];
    liste.push(st);
    grupper.set(key, liste);
  }

  let totalKm = 0;
  let totalSailingHours = 0;
  let totalWithPauseHours = 0;

  for (const registreringer of grupper.values()) {
    const samlet = aggreger(sorted, indexById, registreringer);
    if (!samlet) continue;
    totalKm += samlet.km;
    totalSailingHours += samlet.sailingHours;
    totalWithPauseHours += samlet.totalHours;
  }

  return { totalKm, totalSailingHours, totalWithPauseHours };
}

export interface SailingDay {
  /** Entydig nøgle til React-lister. */
  key: string;
  tripId: string | null;
  sailDate: string;
  startStopId: string;
  endStopId: string;
  km: number;
  sailingHours: number;
  totalHours: number;
  /** Hvor mange registreringer dagen er bygget af. */
  registrationCount: number;
  /** Hvor mange forskellige personer der loggede den. */
  loggerCount: number;

  flowRatio: number | null;
  flowSource: string | null;
  windSpeedMs: number | null;
  windDirDegrees: number | null;
  windSteadiness: number | null;
}

/**
 * Samler registreringer til én linje pr. sejldag.
 *
 * To ting samles her:
 *
 *  1. Flere personer der logger den samme dag. Sejler I sammen, og logger
 *     tre af jer hver sit ur, er det stadig én dag på åen — ikke tre.
 *
 *  2. Én person der logger dagen i etaper. Har nogen logget A→B, B→C og C→D
 *     med pauser imellem, mens en anden loggede A→D i ét hug, dækker de to
 *     det samme, og dagen skal vises som A→D.
 *
 * Metoden er den samme som i computeDedupedTotals: hver registrering brækkes
 * ned i atomare del-stræk, tiden fordeles efter distance, og bidrag til samme
 * del-stræk gennemsnittes. Distancen tælles én gang. Derfor bliver etaperne
 * lagt sammen og dubletterne midlet, uden at det kræver særbehandling af de
 * to tilfælde.
 *
 * Dagens stræk angives som det samlede spænd fra det tidligste startstop til
 * det seneste slutstop. Har to loggere dækket helt adskilte stykker samme
 * dag — hvilket ikke burde ske i praksis — vil spændet også dække hullet
 * imellem dem, mens distancen kun tæller det faktisk loggede.
 *
 * Vandføring og vind hører til datoen og er derfor ens for alle
 * registreringer i gruppen; første ikke-tomme værdi bruges.
 */
export function groupSailingDays(
  stops: GudenaaStop[],
  sailingTimes: SailingTimeWithFlow[]
): SailingDay[] {
  const sorted = sortStops(stops);
  const indexById = byId(sorted);

  const grupper = new Map<string, SailingTimeWithFlow[]>();
  for (const st of sailingTimes) {
    // Uden trip_id kan vi ikke vide, om to registreringer hører til samme
    // tur, så de står alene.
    const key = st.trip_id ? `${st.trip_id}::${st.sail_date}` : `solo:${st.id}`;
    const liste = grupper.get(key) ?? [];
    liste.push(st);
    grupper.set(key, liste);
  }

  const dage: SailingDay[] = [];

  for (const [key, registreringer] of grupper) {
    const samlet = aggreger(sorted, indexById, registreringer);
    if (!samlet) continue;

    const foerste = registreringer[0];
    const loggere = new Set(registreringer.map((r) => r.user_id));

    dage.push({
      key,
      tripId: foerste.trip_id,
      sailDate: foerste.sail_date,
      startStopId: sorted[samlet.minIndex].id,
      endStopId: sorted[samlet.maxIndex].id,
      km: samlet.km,
      sailingHours: samlet.sailingHours,
      totalHours: samlet.totalHours,
      registrationCount: registreringer.length,
      loggerCount: loggere.size,

      flowRatio: foersteVaerdi(registreringer, (r) => r.flow_ratio),
      flowSource: foersteVaerdi(registreringer, (r) => r.flow_source),
      windSpeedMs: foersteVaerdi(registreringer, (r) => r.wind_speed_ms),
      windDirDegrees: foersteVaerdi(registreringer, (r) => r.wind_dir_degrees),
      windSteadiness: foersteVaerdi(registreringer, (r) => r.wind_steadiness),
    });
  }

  return dage.sort((a, b) => a.sailDate.localeCompare(b.sailDate));
}

// ---------------------------------------------------------------------------

interface Aggregat {
  km: number;
  sailingHours: number;
  totalHours: number;
  minIndex: number;
  maxIndex: number;
}

/**
 * Brækker en gruppe registreringer ned i atomare del-stræk og lægger dem
 * sammen, så hvert del-stræk kun tæller én gang.
 */
function aggreger(
  sorted: GudenaaStop[],
  indexById: Map<string, number>,
  registreringer: { start_stop_id: string; end_stop_id: string; sailing_time_hours: number; total_time_hours: number }[]
): Aggregat | null {
  const segmentKm = new Map<number, number>();
  const sailingBidrag = new Map<number, number[]>();
  const totalBidrag = new Map<number, number[]>();

  let minIndex = Number.POSITIVE_INFINITY;
  let maxIndex = Number.NEGATIVE_INFINITY;

  for (const st of registreringer) {
    const fromIdx = indexById.get(st.start_stop_id);
    const toIdx = indexById.get(st.end_stop_id);
    if (fromIdx === undefined || toIdx === undefined || toIdx <= fromIdx) continue;

    minIndex = Math.min(minIndex, fromIdx);
    maxIndex = Math.max(maxIndex, toIdx);

    const indices: number[] = [];
    let spanKm = 0;
    for (let i = fromIdx + 1; i <= toIdx; i++) {
      indices.push(i);
      spanKm += sorted[i].distance_from_previous_km;
    }
    if (indices.length === 0) continue;

    for (const i of indices) {
      const segKm = sorted[i].distance_from_previous_km;
      const vaegt = spanKm > 0 ? segKm / spanKm : 1 / indices.length;

      segmentKm.set(i, segKm);

      const sailing = sailingBidrag.get(i) ?? [];
      sailing.push(st.sailing_time_hours * vaegt);
      sailingBidrag.set(i, sailing);

      const total = totalBidrag.get(i) ?? [];
      total.push(st.total_time_hours * vaegt);
      totalBidrag.set(i, total);
    }
  }

  if (!isFinite(minIndex) || !isFinite(maxIndex)) return null;

  let km = 0;
  let sailingHours = 0;
  let totalHours = 0;

  for (const [i, segKm] of segmentKm) {
    km += segKm;
    sailingHours += gennemsnit(sailingBidrag.get(i) ?? []);
    totalHours += gennemsnit(totalBidrag.get(i) ?? []);
  }

  return { km, sailingHours, totalHours, minIndex, maxIndex };
}

function byId(sorted: GudenaaStop[]): Map<string, number> {
  const map = new Map<string, number>();
  sorted.forEach((s, i) => map.set(s.id, i));
  return map;
}

function foersteVaerdi<T>(
  registreringer: SailingTimeWithFlow[],
  vaelg: (r: SailingTimeWithFlow) => T | null | undefined
): T | null {
  for (const r of registreringer) {
    const v = vaelg(r);
    if (v != null) return v;
  }
  return null;
}

function gennemsnit(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
