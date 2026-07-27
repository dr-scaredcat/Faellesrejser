// supabase/functions/hent-vandfoering/index.ts
//
// Henter vandføring fra Danmarks Miljøportals VanDa Hydro API og gemmer
// døgnmiddelværdier i faellesrejser.water_flow_daily.
//
// Hvorfor en Edge Function og ikke bare et fetch fra browseren:
//   1. CORS — VanDa er ikke sat op til at blive kaldt fra en fremmed webside.
//   2. Datamængde — API'et leverer 144 målinger pr. døgn pr. station. Det
//      skal aggregeres ét sted, ikke hos hver enkelt bruger.
//   3. Skriverettigheder — kun service_role må skrive i tabellen.
//
// KALD
//   POST /functions/v1/hent-vandfoering
//   { "from": "2019-05-01", "to": "2026-07-27", "stationIds": ["21006846"] }
//
//   Alle felter er valgfri. Uden dem hentes de seneste 7 dage for alle
//   aktive stationer, hvilket er det, en daglig cron skal bruge.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const VANDA_BASE = 'https://vandah.miljoeportal.dk/api';

// API'et leverer 10-minutters-værdier. 30 dage ad gangen giver ca. 4.300
// målinger pr. kald — stort nok til at være effektivt, lille nok til ikke at
// vælte hukommelsen ved et flerårigt backfill.
const CHUNK_DAGE = 30;

interface VandaMaaling {
  measurementDateTime: string;
  result: number;
  unit: string;
}

interface DagsAggregat {
  sum: number;
  antal: number;
  min: number;
  max: number;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return svar({ error: 'Brug POST.' }, 405);
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  let body: { from?: string; to?: string; stationIds?: string[] } = {};
  try {
    body = await req.json();
  } catch {
    // Tomt kald er tilladt — så bruges standardværdierne.
  }

  const til = body.to ?? iDag();
  const fra = body.from ?? datoMinusDage(til, 7);

  if (!erDato(fra) || !erDato(til) || fra > til) {
    return svar({ error: 'Ugyldigt datointerval. Brug ÅÅÅÅ-MM-DD, og fra før til.' }, 400);
  }

  let query = supabase
    .from('hydro_stations')
    .select('id, name')
    .eq('is_active', true);
  if (body.stationIds?.length) query = query.in('id', body.stationIds);

  const { data: stationer, error: stationFejl } = await query;
  if (stationFejl) return svar({ error: stationFejl.message }, 500);
  if (!stationer?.length) return svar({ error: 'Ingen aktive målestationer fundet.' }, 404);

  const rapport: Record<string, unknown>[] = [];

  for (const station of stationer) {
    let gemteDage = 0;
    let hentedeMaalinger = 0;
    const fejl: string[] = [];

    for (const [chunkFra, chunkTil] of chunks(fra, til, CHUNK_DAGE)) {
      const url =
        `${VANDA_BASE}/water-flows?stationId=${encodeURIComponent(station.id)}` +
        `&from=${chunkFra}T00:00Z&to=${chunkTil}T00:00Z&format=json`;

      let maalinger: VandaMaaling[] = [];
      try {
        const respons = await fetch(url, { headers: { accept: 'application/json' } });
        if (!respons.ok) {
          fejl.push(`${chunkFra}–${chunkTil}: HTTP ${respons.status}`);
          continue;
        }
        const data = await respons.json();
        // Svaret er en liste af stationer, hver med et results-array.
        maalinger = (Array.isArray(data) ? data : [data])
          .flatMap((s: { results?: VandaMaaling[] }) => s.results ?? []);
      } catch (e) {
        fejl.push(`${chunkFra}–${chunkTil}: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }

      hentedeMaalinger += maalinger.length;
      const perDag = aggregerPrDag(maalinger);

      const raekker = Object.entries(perDag).map(([dato, a]) => ({
        station_id: station.id,
        measured_on: dato,
        // API'et leverer l/s. Vi gemmer m³/s.
        mean_flow_m3s: rund(a.sum / a.antal / 1000, 3),
        min_flow_m3s: rund(a.min / 1000, 3),
        max_flow_m3s: rund(a.max / 1000, 3),
        sample_count: a.antal,
        fetched_at: new Date().toISOString(),
      }));

      if (raekker.length === 0) continue;

      const { error: skrivFejl } = await supabase
        .from('water_flow_daily')
        .upsert(raekker, { onConflict: 'station_id,measured_on' });

      if (skrivFejl) fejl.push(`${chunkFra}–${chunkTil}: ${skrivFejl.message}`);
      else gemteDage += raekker.length;
    }

    rapport.push({
      station: station.name,
      stationId: station.id,
      hentedeMaalinger,
      gemteDage,
      fejl: fejl.length ? fejl : undefined,
    });
  }

  return svar({ fra, til, resultat: rapport });
});

// ---------------------------------------------------------------------------

/**
 * Grupperer 10-minutters-målinger på dato.
 *
 * Bemærk: tidsstemplerne er UTC, og vi bucketter på UTC-dato. Dansk tid er 1-2
 * timer foran, så et døgnmiddel indeholder de sidste par timer af "dagen før"
 * dansk tid. For et døgnmiddel af vandføring er det uden praktisk betydning —
 * åen ændrer sig ikke nævneværdigt på to timer — men det er værd at kende, hvis
 * tallene en dag skal sammenholdes med noget timebaseret.
 */
function aggregerPrDag(maalinger: VandaMaaling[]): Record<string, DagsAggregat> {
  const perDag: Record<string, DagsAggregat> = {};

  for (const m of maalinger) {
    if (typeof m.result !== 'number' || !isFinite(m.result)) continue;
    const dato = m.measurementDateTime?.slice(0, 10);
    if (!dato) continue;

    const eksisterende = perDag[dato];
    if (eksisterende) {
      eksisterende.sum += m.result;
      eksisterende.antal += 1;
      eksisterende.min = Math.min(eksisterende.min, m.result);
      eksisterende.max = Math.max(eksisterende.max, m.result);
    } else {
      perDag[dato] = { sum: m.result, antal: 1, min: m.result, max: m.result };
    }
  }

  return perDag;
}

function* chunks(fra: string, til: string, dage: number): Generator<[string, string]> {
  let start = fra;
  while (start <= til) {
    const slut = minDato(datoPlusDage(start, dage), til);
    yield [start, slut];
    if (slut === til) return;
    start = datoPlusDage(slut, 1);
  }
}

function iDag(): string {
  return new Date().toISOString().slice(0, 10);
}

function datoPlusDage(dato: string, dage: number): string {
  const d = new Date(`${dato}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dage);
  return d.toISOString().slice(0, 10);
}

function datoMinusDage(dato: string, dage: number): string {
  return datoPlusDage(dato, -dage);
}

function minDato(a: string, b: string): string {
  return a < b ? a : b;
}

function erDato(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(`${v}T00:00:00Z`));
}

function rund(v: number, decimaler: number): number {
  const f = 10 ** decimaler;
  return Math.round(v * f) / f;
}

function svar(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
