/**
 * Model til at forudsige, hvor lang tid en sejldag tager.
 *
 * HVORFOR IKKE BARE ET GENNEMSNIT AF FARTER
 *
 * Den tidligere metode tog gennemsnittet af (km/time) på tværs af
 * registreringer og lagde et 95% konfidensinterval om det. Det havde to
 * problemer:
 *
 *  1. Et konfidensinterval beskriver, hvor præcist vi kender *gennemsnittet*.
 *     Det bliver smallere og smallere, jo mere data vi samler — men vi vil
 *     vide, hvad ÉN ny dag lander på, og den spredning forsvinder ikke.
 *     Det kræver et prædiktionsinterval.
 *
 *  2. Et gennemsnit af farter vægter et 3 km-stræk lige så tungt som et
 *     25 km-stræk.
 *
 * MODELLEN
 *
 * Vi regner i tempo (timer pr. km) i stedet for fart, og fitter
 *
 *     tᵢ = dᵢ · (β + γ·ln fᵢ) + εᵢ,     Var(εᵢ) = σ²·dᵢ
 *
 * hvor dᵢ er distancen, fᵢ er vandføringen i forhold til det normale for
 * årstiden, og variansen vokser med distancen — fejl akkumulerer undervejs.
 *
 * Vægtet mindste kvadrat med vægte 1/dᵢ giver i den simple model (uden
 * vandføring) præcis β̂ = Σtᵢ/Σdᵢ, altså samlet tid over samlet distance. Den
 * korrekte vægtning falder ud af modellen af sig selv.
 *
 * Prædiktionsintervallet for en ny dag på d km bliver
 *
 *     t̂ ± t₀.₉₇₅,df · σ̂ · √d · √(1 + q)
 *
 * hvor q afhænger af, hvor langt dagen ligger fra det, vi har data på. Det
 * betyder blandt andet, at en lang dag får et bredere interval end en kort —
 * hvilket den gamle metode ikke fangede.
 *
 * VANDFØRING
 *
 * Vandføringen indgår som ln af forholdet til medianen for årstiden, ikke som
 * rå m³/s. Dels fordi rå værdier ikke kan sammenlignes mellem målestationer,
 * dels fordi vandføring er tilnærmelsesvis log-normalfordelt: "dobbelt så
 * meget vand" og "halvt så meget vand" bør være lige store afvigelser i hver
 * sin retning.
 */

export interface PaceObservation {
  distanceKm: number;
  hours: number;
  /** Vandføring divideret med medianen for årstiden. Null hvis ukendt. */
  flowRatio?: number | null;
}

export interface PaceModel {
  /** Antal observationer modellen er fittet på. */
  n: number;
  /** Frihedsgrader: n minus antal parametre. */
  df: number;
  /** β — timer pr. km ved normal vandføring. */
  paceHoursPerKm: number;
  /** γ — ændring i tempo pr. enhed ln(vandføringsforhold). Null i den flade model. */
  flowCoefficient: number | null;
  /** Residualspredning på den vægtede skala. */
  sigma: number;
  /** Til visning: 1/β. */
  meanSpeedKmH: number;
  usesFlow: boolean;
  /** Mellemregninger til prædiktionsvariansen. */
  s11: number;
  s12: number;
  s22: number;
  det: number;
}

export interface PacePrediction {
  hours: number;
  low: number;
  high: number;
}

export interface FitOptions {
  /**
   * Hvor mange observationer med kendt vandføring der skal til, før den får
   * lov at indgå. Under grænsen bruges den flade model — med få dage er en
   * ekstra variabel en genvej til at forklare støj.
   */
  minFlowObservations?: number;
}

const DEFAULT_MIN_FLOW_OBSERVATIONS = 10;

export function fitPaceModel(
  observations: PaceObservation[],
  options: FitOptions = {}
): PaceModel | null {
  const minFlow = options.minFlowObservations ?? DEFAULT_MIN_FLOW_OBSERVATIONS;

  const valid = observations.filter(
    (o) =>
      isFinite(o.distanceKm) && o.distanceKm > 0 && isFinite(o.hours) && o.hours > 0
  );
  if (valid.length < 2) return null;

  const withFlow = valid.filter(
    (o) => o.flowRatio != null && isFinite(o.flowRatio) && o.flowRatio > 0
  );

  // Bruger vi vandføring, fitter vi kun på de dage der faktisk har den — ellers
  // ville halvdelen af observationerne bidrage til β uden at bidrage til γ.
  const useFlow = withFlow.length >= minFlow && withFlow.length >= 3;
  const data = useFlow ? withFlow : valid;

  if (useFlow) {
    const model = fitTwoParameter(data);
    // Er der ingen variation i vandføringen, er systemet singulært. Så falder
    // vi tilbage til den flade model frem for at dividere med nul.
    if (model) return model;
  }

  return fitOneParameter(valid);
}

function fitOneParameter(data: PaceObservation[]): PaceModel | null {
  const n = data.length;
  const df = n - 1;
  if (df < 1) return null;

  const sumHours = data.reduce((s, o) => s + o.hours, 0);
  const sumKm = data.reduce((s, o) => s + o.distanceKm, 0);
  if (sumKm <= 0) return null;

  const beta = sumHours / sumKm;

  // σ² = Σ (tᵢ − β dᵢ)² / dᵢ / (n − 1)
  const rss = data.reduce((s, o) => {
    const residual = o.hours - beta * o.distanceKm;
    return s + (residual * residual) / o.distanceKm;
  }, 0);
  const sigma = Math.sqrt(rss / df);

  return {
    n,
    df,
    paceHoursPerKm: beta,
    flowCoefficient: null,
    sigma,
    meanSpeedKmH: beta > 0 ? 1 / beta : 0,
    usesFlow: false,
    s11: sumKm,
    s12: 0,
    s22: 0,
    det: sumKm,
  };
}

function fitTwoParameter(data: PaceObservation[]): PaceModel | null {
  const n = data.length;
  const df = n - 2;
  if (df < 1) return null;

  // Vi deler alt med √d, så residualerne får konstant varians og vi kan bruge
  // almindelig mindste kvadrat på det transformerede system.
  let s11 = 0;
  let s12 = 0;
  let s22 = 0;
  let t1 = 0;
  let t2 = 0;

  const rows = data.map((o) => {
    const root = Math.sqrt(o.distanceKm);
    const x1 = root;
    const x2 = root * Math.log(o.flowRatio as number);
    const y = o.hours / root;
    s11 += x1 * x1;
    s12 += x1 * x2;
    s22 += x2 * x2;
    t1 += x1 * y;
    t2 += x2 * y;
    return { x1, x2, y };
  });

  const det = s11 * s22 - s12 * s12;
  // Ingen reel variation i vandføringen — systemet kan ikke løses meningsfuldt.
  if (!isFinite(det) || Math.abs(det) < 1e-9 * Math.max(1, s11 * s22)) return null;

  const beta = (s22 * t1 - s12 * t2) / det;
  const gamma = (s11 * t2 - s12 * t1) / det;

  const rss = rows.reduce((sum, r) => {
    const residual = r.y - beta * r.x1 - gamma * r.x2;
    return sum + residual * residual;
  }, 0);
  const sigma = Math.sqrt(rss / df);

  if (!isFinite(beta) || beta <= 0) return null;

  return {
    n,
    df,
    paceHoursPerKm: beta,
    flowCoefficient: gamma,
    sigma,
    meanSpeedKmH: 1 / beta,
    usesFlow: true,
    s11,
    s12,
    s22,
    det,
  };
}

/**
 * Forudsiger tidsforbruget for en dag på `distanceKm`.
 *
 * `flowRatio` er vandføringen i forhold til det normale for årstiden. Udelades
 * den, regnes der på normale forhold (forhold = 1), hvilket er det rigtige når
 * man planlægger en tur, der ligger måneder ude i fremtiden.
 */
export function predictTime(
  model: PaceModel,
  distanceKm: number,
  flowRatio?: number | null
): PacePrediction | null {
  if (!isFinite(distanceKm) || distanceKm <= 0) return null;

  const root = Math.sqrt(distanceKm);
  const ratio = model.usesFlow && flowRatio != null && flowRatio > 0 ? flowRatio : 1;
  const logRatio = Math.log(ratio);

  const x1 = root;
  const x2 = model.usesFlow ? root * logRatio : 0;

  const hours =
    distanceKm * (model.paceHoursPerKm + (model.usesFlow ? (model.flowCoefficient ?? 0) * logRatio : 0));

  // Leverage: hvor langt ligger denne dag fra tyngdepunktet i vores data.
  const leverage = model.usesFlow
    ? (model.s22 * x1 * x1 - 2 * model.s12 * x1 * x2 + model.s11 * x2 * x2) / model.det
    : (x1 * x1) / model.s11;

  const sePrediction = root * model.sigma * Math.sqrt(1 + Math.max(0, leverage));
  const margin = tQuantile975(model.df) * sePrediction;

  return {
    hours,
    low: Math.max(0, hours - margin),
    high: hours + margin,
  };
}

/** Beskrivelse til brugeren af, hvad modellen bygger på. */
export function describeModel(model: PaceModel): string {
  const grundlag = `${model.n} ${model.n === 1 ? 'registrering' : 'registreringer'}`;
  return model.usesFlow
    ? `${grundlag}, justeret for vandføring`
    : `${grundlag}`;
}

// ---------------------------------------------------------------------------

const T_TABLE: Record<number, number> = {
  1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571,
  6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228,
  11: 2.201, 12: 2.179, 13: 2.16, 14: 2.145, 15: 2.131,
  16: 2.12, 17: 2.11, 18: 2.101, 19: 2.093, 20: 2.086,
  21: 2.08, 22: 2.074, 23: 2.069, 24: 2.064, 25: 2.06,
  26: 2.056, 27: 2.052, 28: 2.048, 29: 2.045, 30: 2.042,
};

const T_COARSE: [number, number][] = [
  [30, 2.042],
  [40, 2.021],
  [60, 2.0],
  [120, 1.98],
  [Infinity, 1.96],
];

/** Tosidet 95%-fraktil i t-fordelingen. */
export function tQuantile975(df: number): number {
  if (df < 1) return T_TABLE[1];
  if (df <= 30) return T_TABLE[Math.floor(df)];

  for (let i = 0; i < T_COARSE.length - 1; i++) {
    const [df0, t0] = T_COARSE[i];
    const [df1, t1] = T_COARSE[i + 1];
    if (df <= df1) {
      if (!isFinite(df1)) return t1;
      const andel = (df - df0) / (df1 - df0);
      return t0 + andel * (t1 - t0);
    }
  }
  return 1.96;
}
