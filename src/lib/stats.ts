// Simpel t-tabel for 95% intervaller ved lave frihedsgrader (df = n-1).
// Falder tilbage til z = 1,96 (normalfordeling) ved større stikprøver.
const T_TABLE_95: Record<number, number> = {
  1: 12.71, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571,
  6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228,
  11: 2.201, 12: 2.179, 13: 2.16, 14: 2.145, 15: 2.131,
  16: 2.12, 17: 2.11, 18: 2.101, 19: 2.093, 20: 2.086,
  25: 2.06, 30: 2.042, 40: 2.021, 60: 2.0,
};

function tValue95(df: number): number {
  if (df <= 0) return 0;
  if (T_TABLE_95[df]) return T_TABLE_95[df];
  const keys = Object.keys(T_TABLE_95).map(Number).sort((a, b) => a - b);
  const closest = keys.find((k) => k >= df);
  return closest ? T_TABLE_95[closest] : 1.96;
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function sampleStdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export function weightedMean(values: number[], weights: number[]): number {
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (totalWeight === 0) return 0;
  return values.reduce((sum, v, i) => sum + v * weights[i], 0) / totalWeight;
}

/**
 * Effektiv stikprøvestørrelse (Kish). Ti registreringer, hvor én er på 30 km og
 * resten på 2 km, indeholder reelt mindre information end ti lige lange — det
 * fanger dette tal.
 */
export function effectiveSampleSize(weights: number[]): number {
  const v1 = weights.reduce((a, b) => a + b, 0);
  const v2 = weights.reduce((a, b) => a + b * b, 0);
  if (v2 === 0) return 0;
  return (v1 * v1) / v2;
}

export function weightedSampleStdDev(values: number[], weights: number[]): number {
  const v1 = weights.reduce((a, b) => a + b, 0);
  const v2 = weights.reduce((a, b) => a + b * b, 0);
  const denominator = v1 - v2 / v1;
  if (!isFinite(denominator) || denominator <= 0) return 0;
  const m = weightedMean(values, weights);
  const numerator = values.reduce((sum, v, i) => sum + weights[i] * (v - m) ** 2, 0);
  return Math.sqrt(numerator / denominator);
}

export interface Interval {
  mean: number;
  low: number;
  high: number;
  n: number;
}

/** Bagudkompatibelt alias — flere sider importerer stadig dette navn. */
export type ConfidenceInterval = Interval;

/**
 * 95% konfidensinterval for MIDDELVÆRDIEN.
 *
 * Svarer på "hvor præcist kender vi gennemsnittet?" og bliver smallere, jo mere
 * data vi samler. Brug det til at beskrive de historiske tal — ikke til at
 * forudsige en enkelt ny dag.
 */
export function confidenceInterval95(values: number[]): Interval {
  const n = values.length;
  const m = mean(values);
  if (n < 2) return { mean: m, low: m, high: m, n };

  const sd = sampleStdDev(values);
  const margin = tValue95(n - 1) * (sd / Math.sqrt(n));
  return { mean: m, low: Math.max(0, m - margin), high: m + margin, n };
}

/**
 * 95% prædiktionsinterval for EN NY OBSERVATION.
 *
 * Svarer på "hvad lander den næste dag på?". Det ekstra 1-tal under
 * kvadratroden er dagens egen spredning, som ikke forsvinder uanset hvor meget
 * data vi samler — derfor bliver intervallet aldrig smallere end selve
 * variationen mellem dage, hvilket er præcis pointen.
 *
 * Kan vægtes, fx med distance, så et 30 km-stræk tæller mere end et 2 km-stræk.
 */
export function predictionInterval95(values: number[], weights?: number[]): Interval {
  const n = values.length;
  if (n === 0) return { mean: 0, low: 0, high: 0, n: 0 };

  const w = weights ?? values.map(() => 1);
  const m = weightedMean(values, w);
  const nEff = effectiveSampleSize(w);

  if (n < 2 || nEff < 2) return { mean: m, low: m, high: m, n };

  const sd = weightedSampleStdDev(values, w);
  const margin = tValue95(Math.max(1, Math.round(nEff) - 1)) * sd * Math.sqrt(1 + 1 / nEff);
  return { mean: m, low: Math.max(0, m - margin), high: m + margin, n };
}

// ---------------------------------------------------------------------------
// Fart og tempo
// ---------------------------------------------------------------------------

export interface Leg {
  km: number;
  hours: number;
}

export interface PaceStats {
  /** Timer pr. km — det tal vi regner i. */
  paceHoursPerKm: number;
  /** Samme tal vendt om, til visning: km/t. */
  speedKmPerHour: number;
  /** Antal registreringer bag tallet. */
  n: number;
  /** Effektiv stikprøvestørrelse efter distancevægtning. */
  nEffective: number;
  /** Spredning på tempoet mellem registreringer (timer pr. km). */
  paceStdDev: number;
}

/**
 * Beregner tempo i stedet for fart, og vægter med distancen.
 *
 * Hvorfor tempo (t/km) og ikke fart (km/t)? Fordi tid er det, vi vil forudsige,
 * og tid = distance × tempo er en lige linje. Fart skal inverteres for at give
 * en tid, og et interval overlever ikke en invertering: [3 ; 6] km/t bliver til
 * et skævt tidsinterval, hvor midtpunktet ikke længere er midtpunktet.
 *
 * Vægtningen med distance gør samtidig, at punktestimatet bliver præcis
 * "samlet tid / samlet distance" — altså det pooled estimat. Et 2 km-stræk med
 * sjusket tidtagning trækker ikke længere lige så meget som en hel dag på 25 km.
 */
export function paceStats(legs: Leg[]): PaceStats {
  const valid = legs.filter((l) => l.km > 0 && l.hours > 0 && isFinite(l.km) && isFinite(l.hours));
  if (valid.length === 0) {
    return { paceHoursPerKm: 0, speedKmPerHour: 0, n: 0, nEffective: 0, paceStdDev: 0 };
  }

  const paces = valid.map((l) => l.hours / l.km);
  const weights = valid.map((l) => l.km);
  const pace = weightedMean(paces, weights);

  return {
    paceHoursPerKm: pace,
    speedKmPerHour: pace > 0 ? 1 / pace : 0,
    n: valid.length,
    nEffective: effectiveSampleSize(weights),
    paceStdDev: weightedSampleStdDev(paces, weights),
  };
}

/**
 * Forventet tid for et stræk af en given længde, med et 95%
 * prædiktionsinterval — altså hvor en enkelt ny dag med rimelighed lander.
 *
 * Forbehold: intervallet skalerer lineært med distancen. I virkeligheden
 * udjævner en lang dag noget af variationen (medvind i en time, modvind i den
 * næste), så intervallet er formentlig en anelse for bredt på de længste dage.
 * Det er den konservative fejl at lave.
 */
export function predictTimeForDistance(legs: Leg[], distanceKm: number): Interval {
  const valid = legs.filter((l) => l.km > 0 && l.hours > 0 && isFinite(l.km) && isFinite(l.hours));
  const paces = valid.map((l) => l.hours / l.km);
  const weights = valid.map((l) => l.km);

  const interval = predictionInterval95(paces, weights);

  return {
    mean: interval.mean * distanceKm,
    low: interval.low * distanceKm,
    high: interval.high * distanceKm,
    n: interval.n,
  };
}

// ---------------------------------------------------------------------------
// Formatering
// ---------------------------------------------------------------------------

/**
 * "1 t 30 min" — langt lettere at forholde sig til end "1,50 timer", især
 * når man står med telefonen på vandet og skal omsætte det til noget
 * konkret. Bruges overalt hvor en varighed vises.
 */
export function formatHours(h: number): string {
  if (!isFinite(h) || h < 0) return '–';

  let hours = Math.floor(h);
  let minutes = Math.round((h - hours) * 60);

  // Afrunding kan give 60 minutter — det skal blive til en hel time.
  if (minutes === 60) {
    hours += 1;
    minutes = 0;
  }

  if (hours === 0 && minutes === 0) return '0 min';
  if (hours === 0) return `${minutes} min`;
  if (minutes === 0) return `${hours} t`;
  return `${hours} t ${minutes} min`;
}

/** Kortere variant til trange pladser: "4t 12m". */
export function formatHoursShort(h: number): string {
  if (!isFinite(h) || h < 0) return '–';

  let hours = Math.floor(h);
  let minutes = Math.round((h - hours) * 60);
  if (minutes === 60) {
    hours += 1;
    minutes = 0;
  }

  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}t`;
  return `${hours}t ${minutes}m`;
}

export function formatKmT(v: number): string {
  return `${v.toFixed(2)} km/t`;
}
