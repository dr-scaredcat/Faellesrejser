// Simpel t-tabel for 95% konfidensintervaller ved lave frihedsgrader (df = n-1).
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

export interface ConfidenceInterval {
  mean: number;
  low: number;
  high: number;
  n: number;
}

/**
 * 95% konfidensinterval for middelværdien, baseret på t-fordelingen.
 * Med 0 eller 1 datapunkt kan der ikke beregnes et interval, så low/high = mean.
 */
export function confidenceInterval95(values: number[]): ConfidenceInterval {
  const n = values.length;
  const m = mean(values);
  if (n < 2) {
    return { mean: m, low: m, high: m, n };
  }
  const sd = sampleStdDev(values);
  const t = tValue95(n - 1);
  const margin = t * (sd / Math.sqrt(n));
  return { mean: m, low: Math.max(0, m - margin), high: m + margin, n };
}

export function formatHours(h: number): string {
  return `${h.toFixed(2)} timer`;
}

export function formatKmT(v: number): string {
  return `${v.toFixed(2)} km/t`;
}
