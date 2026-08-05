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
  { key: 'kort', label: 'Kort', segment: 'kort', gudenaaOnly: true },
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

// ---------------------------------------------------------------------------
// Rejsespecifik overstyring af rækkefølge og synlighed
// ---------------------------------------------------------------------------

export interface TripNavOverride {
  /** Fuld rækkefølge af ALLE kendte sider, ikke kun de synlige. */
  order: string[];
  /** Hvilke af siderne der er slået fra for netop denne rejse. */
  disabled: string[];
}

/**
 * Fortolker rå data fra trip_nav_overrides. Robust på samme måde som
 * parseTripNavOrder: ukendte nøgler frasorteres, og nye sider, som ingen har
 * taget stilling til endnu, tilføjes automatisk (og forbliver synlige, da de
 * ikke er eksplicit slået fra).
 */
export function parseTripNavOverride(raw: { nav_order?: unknown; disabled_pages?: unknown } | null | undefined): TripNavOverride | null {
  if (!raw || !Array.isArray(raw.nav_order)) return null;

  const order = raw.nav_order.filter(
    (k): k is string => typeof k === 'string' && KNOWN_KEYS.has(k)
  );
  const disabled = Array.isArray(raw.disabled_pages)
    ? raw.disabled_pages.filter((k): k is string => typeof k === 'string' && KNOWN_KEYS.has(k))
    : [];

  const manglende = DEFAULT_TRIP_NAV_ORDER.filter((k) => !order.includes(k));
  return { order: [...order, ...manglende], disabled };
}

/**
 * De sider der reelt skal vises på en given rejse, i den rigtige rækkefølge.
 * Er der ingen rejsespecifik overstyring, bruges admin-standarden fuldt ud —
 * uændret opførsel fra før denne funktion fandtes.
 *
 * "Overblik" kan aldrig slås fra, og listen er aldrig tom — begge dele er
 * en sikkerhedsforanstaltning, så man ikke kan navigere sig selv ud i en
 * rejse uden nogen sider overhovedet.
 */
export function resolveTripPages(
  adminOrder: string[],
  override: TripNavOverride | null,
  isGudenaa: boolean
): TripNavPageDef[] {
  const baseOrder = override ? override.order : adminOrder;
  const disabledSet = new Set(override?.disabled ?? []);
  disabledSet.delete('overblik');

  const pages = orderedTripPages(baseOrder, isGudenaa).filter((p) => !disabledSet.has(p.key));

  if (pages.length > 0) return pages;

  // Sikkerhedsnet: skulle alt andet være slået fra, vis i det mindste
  // Overblik, så rejsen ikke ender uden nogen sider overhovedet.
  const overblik = TRIP_NAV_PAGES.find((p) => p.key === 'overblik');
  return overblik ? [overblik] : [];
}
