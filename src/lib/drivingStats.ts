import type { DrivingLog, EnergyPurchase, Vehicle } from './types';

/**
 * Beregninger til kørselssiden.
 *
 * RÆKKEVIDDE ER TO REGNESTYKKER, IKKE ÉT
 *
 * Ladeprocenterne giver batteriets kapacitet: lader man fra 20% til 80% og
 * fylder 30 kWh på, svarer 60 procentpoint til 30 kWh, altså 50 kWh i alt.
 *
 * Kørslerne giver forbruget: km divideret med kWh.
 *
 * Rækkevidden er de to ganget sammen. De to tal kommer fra hver sin kilde og
 * skal derfor beregnes hver for sig — man kan ikke få rækkevidde ud af
 * ladninger alene, uanset hvor mange man registrerer.
 */

export interface VehicleStats {
  vehicle: Vehicle;

  /** Kørsel */
  totalKm: number;
  totalEnergy: number;
  /** km pr. kWh for el, km pr. liter for brændstof. Null hvis intet forbrug. */
  efficiency: number | null;
  drivingCount: number;

  /** Køb */
  purchasedAmount: number;
  totalCost: number | null;
  /** Gennemsnitlig pris pr. kWh eller liter, vægtet efter mængde. */
  averageUnitPrice: number | null;
  purchaseCount: number;

  /** Kr. pr. km, beregnet af forbrug og gennemsnitspris. */
  costPerKm: number | null;

  /** Målt batterikapacitet, medianen af de kvalificerede ladninger. */
  measuredCapacityKwh: number | null;
  capacitySampleCount: number;

  /** Kapacitet gange forbrug. Kun for el. */
  estimatedRangeKm: number | null;
}

/** Ladninger med for lille spring giver for upålidelige kapacitetsbud. */
export const MIN_SOC_DELTA = 20;

export function computeVehicleStats(
  vehicles: Vehicle[],
  drivingLogs: DrivingLog[],
  purchases: EnergyPurchase[]
): VehicleStats[] {
  return vehicles.map((vehicle) => {
    const koersler = drivingLogs.filter((d) => d.vehicle_id === vehicle.id);
    const koeb = purchases.filter((p) => p.vehicle_id === vehicle.id);

    const totalKm = sum(koersler.map((d) => Number(d.distance_km) || 0));
    const totalEnergy = sum(koersler.map((d) => Number(d.energy_amount) || 0));
    const efficiency = totalEnergy > 0 ? totalKm / totalEnergy : null;

    const purchasedAmount = sum(koeb.map((p) => Number(p.amount) || 0));

    const medPris = koeb.filter((p) => p.price_per_unit != null && Number(p.price_per_unit) >= 0);
    const totalCost = medPris.length
      ? sum(medPris.map((p) => Number(p.amount) * Number(p.price_per_unit)))
      : null;
    const prissatMaengde = sum(medPris.map((p) => Number(p.amount)));
    // Vægtet efter mængde: en stor ladning til lav pris skal veje tungere end
    // en lille til høj.
    const averageUnitPrice =
      totalCost != null && prissatMaengde > 0 ? totalCost / prissatMaengde : null;

    const costPerKm =
      efficiency != null && efficiency > 0 && averageUnitPrice != null
        ? averageUnitPrice / efficiency
        : null;

    const kapaciteter = capacityEstimates(koeb).map((e) => e.capacityKwh);
    const measuredCapacityKwh = kapaciteter.length ? median(kapaciteter) : null;

    const estimatedRangeKm =
      vehicle.energy_type === 'el' && measuredCapacityKwh != null && efficiency != null
        ? measuredCapacityKwh * efficiency
        : null;

    return {
      vehicle,
      totalKm,
      totalEnergy,
      efficiency,
      drivingCount: koersler.length,
      purchasedAmount,
      totalCost,
      averageUnitPrice,
      purchaseCount: koeb.length,
      costPerKm,
      measuredCapacityKwh,
      capacitySampleCount: kapaciteter.length,
      estimatedRangeKm,
    };
  });
}

export interface CapacityEstimate {
  purchaseId: string;
  date: string;
  capacityKwh: number;
  socDelta: number;
  measuredAtCharger: boolean;
}

/**
 * Ét kapacitetsbud pr. kvalificeret ladning, sorteret efter dato.
 *
 * Plottet over tid er det her, batteriets ældning bliver synlig — og det er
 * data, ingen bilproducent giver dig.
 */
export function capacityEstimates(purchases: EnergyPurchase[]): CapacityEstimate[] {
  return purchases
    .filter(
      (p) =>
        p.energy_type === 'el' &&
        p.start_soc_percent != null &&
        p.end_soc_percent != null &&
        p.end_soc_percent - p.start_soc_percent >= MIN_SOC_DELTA
    )
    .map((p) => {
      const delta = (p.end_soc_percent as number) - (p.start_soc_percent as number);
      return {
        purchaseId: p.id,
        date: p.purchased_on,
        capacityKwh: (Number(p.amount) * 100) / delta,
        socDelta: delta,
        measuredAtCharger: p.measured_at_charger,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Hvad en kørsel har kostet, beregnet ud fra bilens gennemsnitspris.
 *
 * Bruges af knappen, der lægger kørslen ind i rejsens regnskab. Er der ingen
 * prissatte køb på bilen, kan beløbet ikke beregnes, og knappen bør så bede
 * om en pris i stedet for at gætte.
 */
export function drivingCost(log: DrivingLog, stats: VehicleStats | undefined): number | null {
  if (!stats?.averageUnitPrice) return null;
  const maengde = Number(log.energy_amount);
  if (!isFinite(maengde) || maengde <= 0) return null;
  return maengde * stats.averageUnitPrice;
}

export interface PriceSpread {
  cheapest: EnergyPurchase | null;
  mostExpensive: EnergyPurchase | null;
  homeAverage: number | null;
  publicAverage: number | null;
  /** Hvad man kunne have sparet ved at lade alt hjemme til hjemmeprisen. */
  potentialSaving: number | null;
}

/**
 * Prisspredning på ladninger. Forskellen mellem hjemmeladning og lynlader er
 * ofte en faktor tre, og det er tit den største enkeltpost, man selv kan
 * gøre noget ved.
 */
export function priceSpread(purchases: EnergyPurchase[]): PriceSpread {
  const medPris = purchases.filter((p) => p.price_per_unit != null);
  if (medPris.length === 0) {
    return {
      cheapest: null,
      mostExpensive: null,
      homeAverage: null,
      publicAverage: null,
      potentialSaving: null,
    };
  }

  const sorteret = [...medPris].sort(
    (a, b) => Number(a.price_per_unit) - Number(b.price_per_unit)
  );

  const hjemme = medPris.filter((p) => p.location_type === 'hjemme');
  const offentlig = medPris.filter((p) => p.location_type === 'offentlig');

  const homeAverage = vaegtetPris(hjemme);
  const publicAverage = vaegtetPris(offentlig);

  const potentialSaving =
    homeAverage != null && offentlig.length > 0
      ? sum(
          offentlig.map((p) => Number(p.amount) * (Number(p.price_per_unit) - homeAverage))
        )
      : null;

  return {
    cheapest: sorteret[0],
    mostExpensive: sorteret[sorteret.length - 1],
    homeAverage,
    publicAverage,
    potentialSaving,
  };
}

function vaegtetPris(purchases: EnergyPurchase[]): number | null {
  const maengde = sum(purchases.map((p) => Number(p.amount)));
  if (maengde <= 0) return null;
  return sum(purchases.map((p) => Number(p.amount) * Number(p.price_per_unit))) / maengde;
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + (isFinite(b) ? b : 0), 0);
}

/** Median frem for gennemsnit: én fejlindtastning skal ikke flytte tallet. */
function median(values: number[]): number {
  const sorteret = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorteret.length / 2);
  return sorteret.length % 2 === 0
    ? (sorteret[mid - 1] + sorteret[mid]) / 2
    : sorteret[mid];
}
