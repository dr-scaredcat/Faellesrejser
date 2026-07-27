/**
 * Model til at forudsige, hvor lang tid en sejldag tager.
 *
 * HVORFOR IKKE BARE ET GENNEMSNIT AF FARTER
 *
 * Et gennemsnit af (km/time) på tværs af registreringer har to problemer:
 * det vægter et 3 km-stræk lige så tungt som et 25 km-stræk, og et
 * konfidensinterval om det beskriver kun, hvor præcist vi kender
 * gennemsnittet. Vi vil vide, hvad ÉN ny dag lander på, og den spredning
 * forsvinder ikke, uanset hvor meget data vi samler.
 *
 * MODELLEN
 *
 * Vi regner i tempo (timer pr. km) og fitter
 *
 *     tᵢ = dᵢ · (β + γ·ln fᵢ + δ·wᵢ) + εᵢ,     Var(εᵢ) = σ²·dᵢ
 *
 * hvor dᵢ er distancen, fᵢ er vandføringen i forhold til det normale for
 * årstiden, og wᵢ er medvindskomponenten langs ruten i m/s. Variansen vokser
 * med distancen, fordi fejl akkumulerer undervejs.
 *
 * Vandføringen indgår logaritmisk, fordi den er et positivt forholdstal og
 * tilnærmelsesvis log-normalfordelt — dobbelt og halvt så meget vand bør være
 * lige store afvigelser i hver sin retning. Vinden indgår lineært, fordi den
 * er fortegnsbestemt: medvind er positiv, modvind negativ, og en logaritme
 * ville være meningsløs.
 *
 * Uden nogen af de to led reducerer modellen til β̂ = Σtᵢ/Σdᵢ, altså samlet
 * tid over samlet distance. Den korrekte vægtning falder ud af modellen af
 * sig selv.
 *
 * HVAD DE EKSTRA LED FAKTISK GØR
 *
 * Når man planlægger en tur måneder ude i fremtiden, kender man hverken vind
 * eller vandføring, og estimatet regnes derfor på normale forhold. Leddene
 * flytter altså ikke midtpunktet — de forklarer en del af variationen, så σ̂
 * falder og prædiktionsintervallet bliver smallere. Man får et mere præcist
 * udsagn om en normal dag, ikke et andet gæt.
 *
 * Kender man derimod vejrudsigten få dage før afrejse, kan de faktiske
 * forhold sendes med, og så flytter estimatet sig også.
 */

export interface PaceObservation {
  distanceKm: number;
  hours: number;
  /** Vandføring divideret med medianen for årstiden. Null hvis ukendt. */
  flowRatio?: number | null;
  /** Medvindskomponent langs ruten i m/s. Positiv = medvind. Null hvis ukendt. */
  tailwindMs?: number | null;
}

export interface PaceConditions {
  flowRatio?: number | null;
  tailwindMs?: number | null;
}

export interface PaceModel {
  n: number;
  df: number;
  /** β — timer pr. km ved normale forhold. */
  paceHoursPerKm: number;
  /** γ — ændring i tempo pr. enhed ln(vandføringsforhold). Null hvis ikke med. */
  flowCoefficient: number | null;
  /** δ — ændring i tempo pr. m/s medvind. Null hvis ikke med. */
  windCoefficient: number | null;
  sigma: number;
  meanSpeedKmH: number;
  usesFlow: boolean;
  usesWind: boolean;
  /** Inverteret normalmatrix, brugt til prædiktionsvariansen. */
  inverse: number[][];
}

export interface PacePrediction {
  hours: number;
  low: number;
  high: number;
}

export interface FitOptions {
  /**
   * Hvor mange observationer med kendt vandføring der skal til, før den får
   * lov at indgå. Under grænsen bruges den enklere model — med få dage er en
   * ekstra variabel en genvej til at forklare støj.
   */
  minFlowObservations?: number;
  /** Tilsvarende for vind. */
  minWindObservations?: number;
}

const DEFAULT_MIN_OBSERVATIONS = 10;

export function fitPaceModel(
  observations: PaceObservation[],
  options: FitOptions = {}
): PaceModel | null {
  const minFlow = options.minFlowObservations ?? DEFAULT_MIN_OBSERVATIONS;
  const minWind = options.minWindObservations ?? DEFAULT_MIN_OBSERVATIONS;

  const valid = observations.filter(
    (o) => isFinite(o.distanceKm) && o.distanceKm > 0 && isFinite(o.hours) && o.hours > 0
  );
  if (valid.length < 2) return null;

  const harFlow = (o: PaceObservation) =>
    o.flowRatio != null && isFinite(o.flowRatio) && o.flowRatio > 0;
  const harVind = (o: PaceObservation) => o.tailwindMs != null && isFinite(o.tailwindMs);

  let brugFlow = valid.filter(harFlow).length >= minFlow;
  let brugVind = valid.filter(harVind).length >= minWind;

  // Bruges begge, skal modellen fittes på de dage der har BEGGE dele — ellers
  // ville nogle observationer bidrage til grundtempoet uden at bidrage til
  // koefficienterne, og det ville forvride dem alle tre.
  //
  // Er der ikke nok af dem, droppes vinden først: vandføringen er den mest
  // veletablerede af de to, og den er målt frem for beregnet ud fra et skøn
  // over rutens retning.
  for (;;) {
    const data = udvaelg(valid, brugFlow, brugVind, harFlow, harVind);
    const parametre = 1 + (brugFlow ? 1 : 0) + (brugVind ? 1 : 0);

    if (data.length >= parametre + 1) {
      const model = fitVaegtet(data, brugFlow, brugVind);
      if (model) return model;
    }

    if (brugVind) brugVind = false;
    else if (brugFlow) brugFlow = false;
    else return null;
  }
}

function udvaelg(
  data: PaceObservation[],
  brugFlow: boolean,
  brugVind: boolean,
  harFlow: (o: PaceObservation) => boolean,
  harVind: (o: PaceObservation) => boolean
): PaceObservation[] {
  return data.filter((o) => (!brugFlow || harFlow(o)) && (!brugVind || harVind(o)));
}

/**
 * Vægtet mindste kvadrat. Vi deler alt med √d, så residualerne får konstant
 * varians, og kan derefter bruge almindelig mindste kvadrat på det
 * transformerede system.
 */
function fitVaegtet(
  data: PaceObservation[],
  brugFlow: boolean,
  brugVind: boolean
): PaceModel | null {
  const p = 1 + (brugFlow ? 1 : 0) + (brugVind ? 1 : 0);
  const n = data.length;
  const df = n - p;
  if (df < 1) return null;

  const raekker = data.map((o) => {
    const rod = Math.sqrt(o.distanceKm);
    const x: number[] = [rod];
    if (brugFlow) x.push(rod * Math.log(o.flowRatio as number));
    if (brugVind) x.push(rod * (o.tailwindMs as number));
    return { x, y: o.hours / rod };
  });

  // Normalligningerne X'X b = X'y
  const xtx: number[][] = Array.from({ length: p }, () => new Array(p).fill(0));
  const xty: number[] = new Array(p).fill(0);

  for (const r of raekker) {
    for (let i = 0; i < p; i++) {
      xty[i] += r.x[i] * r.y;
      for (let j = 0; j < p; j++) xtx[i][j] += r.x[i] * r.x[j];
    }
  }

  const inverse = inverter(xtx);
  if (!inverse) return null;

  const b = inverse.map((raekke) => raekke.reduce((sum, v, j) => sum + v * xty[j], 0));
  if (!b.every((v) => isFinite(v))) return null;

  const beta = b[0];
  if (!isFinite(beta) || beta <= 0) return null;

  const rss = raekker.reduce((sum, r) => {
    const forudsagt = r.x.reduce((s, xi, i) => s + xi * b[i], 0);
    const residual = r.y - forudsagt;
    return sum + residual * residual;
  }, 0);

  let index = 1;
  const gamma = brugFlow ? b[index++] : null;
  const delta = brugVind ? b[index] : null;

  return {
    n,
    df,
    paceHoursPerKm: beta,
    flowCoefficient: gamma,
    windCoefficient: delta,
    sigma: Math.sqrt(rss / df),
    meanSpeedKmH: 1 / beta,
    usesFlow: brugFlow,
    usesWind: brugVind,
    inverse,
  };
}

/**
 * Forudsiger tidsforbruget for en dag på `distanceKm`.
 *
 * Udelades forholdene, regnes der på normal vandføring og vindstille — det
 * rigtige, når man planlægger en tur måneder ude i fremtiden.
 */
export function predictTime(
  model: PaceModel,
  distanceKm: number,
  conditions: PaceConditions = {}
): PacePrediction | null {
  if (!isFinite(distanceKm) || distanceKm <= 0) return null;

  const rod = Math.sqrt(distanceKm);
  const x: number[] = [rod];

  if (model.usesFlow) {
    const forhold =
      conditions.flowRatio != null && isFinite(conditions.flowRatio) && conditions.flowRatio > 0
        ? conditions.flowRatio
        : 1;
    x.push(rod * Math.log(forhold));
  }

  if (model.usesWind) {
    const vind =
      conditions.tailwindMs != null && isFinite(conditions.tailwindMs) ? conditions.tailwindMs : 0;
    x.push(rod * vind);
  }

  const koefficienter = [
    model.paceHoursPerKm,
    ...(model.usesFlow ? [model.flowCoefficient ?? 0] : []),
    ...(model.usesWind ? [model.windCoefficient ?? 0] : []),
  ];

  const yHat = x.reduce((sum, xi, i) => sum + xi * koefficienter[i], 0);
  const hours = rod * yHat;
  if (!isFinite(hours) || hours <= 0) return null;

  // Leverage: hvor langt denne dag ligger fra tyngdepunktet i vores data.
  let leverage = 0;
  for (let i = 0; i < x.length; i++) {
    for (let j = 0; j < x.length; j++) leverage += x[i] * model.inverse[i][j] * x[j];
  }

  const sePrediction = rod * model.sigma * Math.sqrt(1 + Math.max(0, leverage));
  const margin = tQuantile975(model.df) * sePrediction;

  return { hours, low: Math.max(0, hours - margin), high: hours + margin };
}

/** Beskrivelse til brugeren af, hvad modellen bygger på. */
export function describeModel(model: PaceModel): string {
  const grundlag = `${model.n} ${model.n === 1 ? 'registrering' : 'registreringer'}`;
  const justeringer: string[] = [];
  if (model.usesFlow) justeringer.push('vandføring');
  if (model.usesWind) justeringer.push('vind');
  if (justeringer.length === 0) return grundlag;
  return `${grundlag}, justeret for ${justeringer.join(' og ')}`;
}

// ---------------------------------------------------------------------------

/** Gauss-Jordan med delvis pivotering. Matricerne her er højst 3x3. */
function inverter(matrix: number[][]): number[][] | null {
  const n = matrix.length;
  const a = matrix.map((raekke, i) => [
    ...raekke,
    ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  ]);

  for (let kolonne = 0; kolonne < n; kolonne++) {
    let pivot = kolonne;
    for (let r = kolonne + 1; r < n; r++) {
      if (Math.abs(a[r][kolonne]) > Math.abs(a[pivot][kolonne])) pivot = r;
    }

    // Er pivoten nul, er der ingen variation i den variabel, og systemet kan
    // ikke løses. Kalderen falder så tilbage til en enklere model.
    if (Math.abs(a[pivot][kolonne]) < 1e-12) return null;

    [a[kolonne], a[pivot]] = [a[pivot], a[kolonne]];

    const divisor = a[kolonne][kolonne];
    for (let j = 0; j < 2 * n; j++) a[kolonne][j] /= divisor;

    for (let r = 0; r < n; r++) {
      if (r === kolonne) continue;
      const faktor = a[r][kolonne];
      if (faktor === 0) continue;
      for (let j = 0; j < 2 * n; j++) a[r][j] -= faktor * a[kolonne][j];
    }
  }

  return a.map((raekke) => raekke.slice(n));
}

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
      return t0 + ((df - df0) / (df1 - df0)) * (t1 - t0);
    }
  }
  return 1.96;
}
