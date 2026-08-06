/**
 * Dansk formatering af beløb, tal og datoer.
 *
 * Baggrund: appen brugte `.toFixed(2) + ' kr.'`, hvilket giver "1234.50 kr."
 * i stedet for "1.234,50 kr.". Samtidig lå der en `default_currency` i
 * admin_settings, som ingen læste.
 */

const LOCALE = 'da-DK';

let defaultCurrency = 'DKK';

/**
 * Sættes én gang når admin_settings er hentet. Kald den fx fra ThemeProvider
 * eller et lille useSettings-hook, så resten af appen bare kan kalde
 * formatCurrency() uden at kende valutaen.
 */
export function setDefaultCurrency(currency: string | null | undefined) {
  if (currency && /^[A-Za-z]{3}$/.test(currency)) {
    defaultCurrency = currency.toUpperCase();
  }
}

export function getDefaultCurrency(): string {
  return defaultCurrency;
}

/** "1.234,50 kr." */
export function formatCurrency(amount: number | string, currency = defaultCurrency): string {
  const value = Number(amount);
  if (!isFinite(value)) return '–';
  try {
    return new Intl.NumberFormat(LOCALE, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    // Ukendt valutakode — vis beløbet pænt alligevel.
    return `${formatNumber(value, 2)} ${currency}`;
  }
}

/** Beløb uden valuta, fx til inputfelter og tabeller: "1.234,50" */
export function formatNumber(value: number | string, decimals = 2): string {
  const n = Number(value);
  if (!isFinite(n)) return '–';
  return new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}

/** "12,4 km" */
export function formatKm(km: number, decimals = 1): string {
  return `${formatNumber(km, decimals)} km`;
}

/** "27/07/2026" ud fra en ISO-dato ('2026-07-27') — uden tidszoneomregning. */
export function formatDate(isoDate: string | null | undefined): string {
  if (!isoDate) return '';
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return isoDate;
  const [, y, m, d] = match;
  return `${d}/${m}/${y}`;
}

/** "27. juli 2026" */
export function formatDateLong(isoDate: string | null | undefined): string {
  if (!isoDate) return '';
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return isoDate;
  const [, y, m, d] = match;
  return new Intl.DateTimeFormat(LOCALE, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(Number(y), Number(m) - 1, Number(d)));
}
