/**
 * Fælles definition af rejsens faner — delt mellem TripLayout (som viser
 * dem) og admin-siden "Navigation" (hvor rækkefølgen redigeres), så de to
 * ikke kan gå i utakt med hinanden.
 */

export interface TripNavPageDef {
  /** Stabil nøgle, gemt i databasen. Ændres denne, skal migrationen også rettes. */
  key: string;
  label: string;
  /** Sti-segment under /rejser/:tripId — tom streng for selve overblikket. */
  segment: string;
  end?: boolean;
  /** Vises kun på ture med trip_type = 'gudenaa'. */
  gudenaaOnly?: boolean;
}

export const TRIP_NAV_PAGES: TripNavPageDef[] = [
  { key: 'overblik', label: 'Overblik', segment: 'overblik', end: true },
  { key: 'pakkeliste', label: 'Pakkeliste', segment: 'pakkeliste' },
  { key: 'rejseplan', label: 'Rejseplan', segment: 'rejseplan' },
  { key: 'regnskab', label: 'Regnskab', segment: 'regnskab' },
  { key: 'koersel', label: 'Kørsel', segment: 'koersel' },
  { key: 'ruteplanlaegger', label: 'Ruteplanlægger', segment: 'ruteplanlaegger', gudenaaOnly: true },
  { key: 'position', label: 'Position', segment: 'position', gudenaaOnly: true },
  { key: 'statistik', label: 'Statistik', segment: 'statistik', gudenaaOnly: true },
  { key: 'sejltider', label: 'Sejltider', segment: 'sejltider', gudenaaOnly: true },
];

export const DEFAULT_TRIP_NAV_ORDER: string[] = TRIP_NAV_PAGES.map((p) => p.key);

const KNOWN_KEYS = new Set(TRIP_NAV_PAGES.map((p) => p.key));

/**
 * Fortolker den gemte rækkefølge til en liste af nøgler. Robust over for at
 * blive kaldt, før noget er gemt (rå værdi er null), og over for at der på
 * et tidspunkt tilføjes en ny side, som ingen har fået gemt en placering
 * til endnu — den dukker i så fald op til sidst, i stedet for at forsvinde.
 */
export function parseTripNavOrder(raw: string | null | undefined): string[] {
  if (!raw) return DEFAULT_TRIP_NAV_ORDER;

  const gemte = raw
    .split(',')
    .map((k) => k.trim())
    .filter((k) => KNOWN_KEYS.has(k));

  const manglende = DEFAULT_TRIP_NAV_ORDER.filter((k) => !gemte.includes(k));
  return [...gemte, ...manglende];
}

export function serializeTripNavOrder(order: string[]): string {
  return order.join(',');
}

/** Sider i den gemte rækkefølge, filtreret til dem der gælder for rejsetypen. */
export function orderedTripPages(order: string[], isGudenaa: boolean): TripNavPageDef[] {
  const byKey = new Map(TRIP_NAV_PAGES.map((p) => [p.key, p]));
  return order
    .map((k) => byKey.get(k))
    .filter((p): p is TripNavPageDef => !!p && (!p.gudenaaOnly || isGudenaa));
}

export function tripPageHref(tripId: string, page: TripNavPageDef): string {
  return page.segment ? `/rejser/${tripId}/${page.segment}` : `/rejser/${tripId}`;
}
