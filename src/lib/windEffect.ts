/**
 * Vindens påvirkning af sejladsen.
 *
 * HVORFOR VEKTORER
 *
 * Retninger kan ikke gennemsnittes som almindelige tal. Nord er 0° og
 * nordvest er 315°, og gennemsnittet af de to bliver 157,5° — syd-sydøst,
 * altså stik modsat det rigtige svar. Retninger skal derfor lægges sammen
 * som vektorer.
 *
 * DEN PRAKTISKE GEVINST
 *
 * Åen bugter sig, og på et langt logget stræk sejler man i mange retninger.
 * Man skulle tro, det krævede en særskilt korrektion for, at modvind det ene
 * sted udlignes af medvind det andet. Det gør det ikke:
 *
 *     distancevægtet gennemsnit af medvindskomponenten
 *       = Σ dᵢ (w · ûᵢ) / Σ dᵢ
 *       = w · (Σ dᵢ ûᵢ / Σ dᵢ)
 *       = w · (resulterende enhedsvektor)
 *
 * Udligningen ligger altså allerede i den resulterende vektor. Sejler man
 * lige langt nordpå og sydpå, bliver summen nul, og vindens nettoeffekt
 * bliver nul — helt af sig selv.
 *
 * Længden af den resulterende vektor divideret med den samlede distance er
 * samtidig et mål for, hvor entydig retningen er: 1 betyder snorlige, 0
 * betyder at strækket ender, hvor det startede.
 *
 * KONVENTIONER
 *
 *  - Kurser og vindretninger angives i grader med uret fra nord.
 *    Nord = 0, øst = 90, syd = 180, vest = 270.
 *  - Vindretning følger den meteorologiske konvention og angiver, hvor
 *    vinden kommer FRA. En vestenvind (270°) blæser altså mod øst.
 *  - Medvindskomponenten er positiv, når vinden skubber på.
 */

export type CompassPoint = 'N' | 'NØ' | 'Ø' | 'SØ' | 'S' | 'SV' | 'V' | 'NV';

export const COMPASS_DEGREES: Record<CompassPoint, number> = {
  N: 0,
  NØ: 45,
  Ø: 90,
  SØ: 135,
  S: 180,
  SV: 225,
  V: 270,
  NV: 315,
};

export const COMPASS_POINTS: CompassPoint[] = ['N', 'NØ', 'Ø', 'SØ', 'S', 'SV', 'V', 'NV'];

/** Nærmeste af de otte kompasretninger. Til visning. */
export function compassFromDegrees(degrees: number | null | undefined): CompassPoint | null {
  if (degrees == null || !isFinite(degrees)) return null;
  const normaliseret = ((degrees % 360) + 360) % 360;
  const index = Math.round(normaliseret / 45) % 8;
  return COMPASS_POINTS[index];
}

export interface CourseSegment {
  distanceKm: number;
  /** Retning fra forrige stop til dette. Null hvis den ikke er angivet endnu. */
  bearingDegrees: number | null;
}

export interface ResultantCourse {
  /** Samlet retning for hele strækket, eller null hvis den ikke kan bestemmes. */
  bearingDegrees: number | null;
  /**
   * Hvor entydig retningen er, fra 0 til 1. Et snorlige stræk giver 1; et
   * stræk der vender tilbage til udgangspunktet giver 0. Bruges ikke som en
   * separat korrektion — den er allerede indbygget i medvindskomponenten —
   * men er nyttig at vise, så man ved hvor meget tallet er værd.
   */
  coherence: number;
  /** Samlet distance for de delstræk der havde en retning. */
  distanceKm: number;
  /** Hvor mange delstræk der manglede en retning og derfor blev sprunget over. */
  missingBearings: number;
  /** Enhedsvektorens komposanter mod øst og nord. Bruges til vindberegningen. */
  east: number;
  north: number;
}

const GRADER = Math.PI / 180;

/**
 * Lægger delstrækkene sammen som distancevægtede enhedsvektorer og finder den
 * samlede retning.
 */
export function resultantCourse(segments: CourseSegment[]): ResultantCourse {
  let east = 0;
  let north = 0;
  let distance = 0;
  let missing = 0;

  for (const segment of segments) {
    const km = Number(segment.distanceKm);
    if (!isFinite(km) || km <= 0) continue;

    if (segment.bearingDegrees == null || !isFinite(segment.bearingDegrees)) {
      missing += 1;
      continue;
    }

    const vinkel = segment.bearingDegrees * GRADER;
    east += km * Math.sin(vinkel);
    north += km * Math.cos(vinkel);
    distance += km;
  }

  if (distance === 0) {
    return {
      bearingDegrees: null,
      coherence: 0,
      distanceKm: 0,
      missingBearings: missing,
      east: 0,
      north: 0,
    };
  }

  const enhedEast = east / distance;
  const enhedNorth = north / distance;
  const laengde = Math.hypot(enhedEast, enhedNorth);

  // Er resultatet tæt på nul, peger strækket ingen steder, og en retning ville
  // være ren støj.
  const bearing =
    laengde < 1e-6
      ? null
      : (((Math.atan2(enhedEast, enhedNorth) / GRADER) % 360) + 360) % 360;

  return {
    bearingDegrees: bearing,
    coherence: laengde,
    distanceKm: distance,
    missingBearings: missing,
    east: enhedEast,
    north: enhedNorth,
  };
}

export interface WindEffect {
  /** Positiv = medvind, negativ = modvind. Samme enhed som vindhastigheden. */
  tailwindMs: number;
  /** Vinden på tværs af kursen. Mest til information. */
  crosswindMs: number;
  /** Vinklen mellem kurs og vindens bevægelsesretning, 0-180 grader. */
  angleDegrees: number;
}

/**
 * Beregner vindens komponent langs sejlretningen.
 *
 * `windFromDegrees` er den meteorologiske vindretning, altså hvor vinden
 * kommer fra. DMI's `wind-dir-10m` følger den konvention.
 */
export function windEffect(
  course: ResultantCourse,
  windSpeedMs: number,
  windFromDegrees: number
): WindEffect | null {
  if (!isFinite(windSpeedMs) || windSpeedMs < 0) return null;
  if (!isFinite(windFromDegrees)) return null;
  if (course.distanceKm === 0) return null;

  // Vinden kommer FRA windFromDegrees, altså bevæger den sig i den modsatte
  // retning. Derfor minus foran.
  const vinkel = windFromDegrees * GRADER;
  const vindEast = -windSpeedMs * Math.sin(vinkel);
  const vindNorth = -windSpeedMs * Math.cos(vinkel);

  // Prikprodukt med den resulterende enhedsvektor. Udligningen undervejs på
  // strækket er allerede indbygget, fordi vektoren er kortere end 1, når
  // retningen skifter.
  const tailwind = vindEast * course.east + vindNorth * course.north;
  const crosswind = vindEast * course.north - vindNorth * course.east;

  const angle =
    course.bearingDegrees == null
      ? 0
      : Math.abs(
          ((((windFromDegrees + 180 - course.bearingDegrees) % 360) + 540) % 360) - 180
        );

  return { tailwindMs: tailwind, crosswindMs: crosswind, angleDegrees: angle };
}

/** Kort beskrivelse til visning: "Modvind 4,2 m/s". */
export function describeWindEffect(effect: WindEffect): string {
  const styrke = Math.abs(effect.tailwindMs);
  if (styrke < 0.5) return 'Ingen effekt langs ruten';
  const retning = effect.tailwindMs > 0 ? 'Medvind' : 'Modvind';
  return `${retning} ${styrke.toFixed(1)} m/s`;
}
