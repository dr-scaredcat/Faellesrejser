// supabase/functions/hent-nyeste-vind/index.ts
//
// Henter den senest tilgængelige ENKELTMÅLING af vind — ikke et døgnmiddel.
// Bruges af Position-siden til at vise et "lige nu"-billede.
//
// Forskellen til wind_daily (fra hent-vind): den tabel gemmer et
// vektormiddel over et helt døgn, og et døgn der endnu ikke er gået,
// aggregeres kun over de timer der er tilgængelige — det er stadig et
// gennemsnit "i dag så langt", ikke "lige nu". Denne funktion finder i
// stedet den nyeste enkelte time, hvor både hastighed og retning er målt,
// og bruger den rå — ingen midling nødvendig med kun ét datapunkt.
//
// KALD
//   POST /functions/v1/hent-nyeste-vind
//   {} — alle aktive stationer
//   { "stationIds": ["06068"] } — begræns til bestemte stationer

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const DMI_BASE = 'https://opendataapi.dmi.dk/v2/climateData/collections/stationValue/items';

// Denne funktion kaldes fra BROWSEREN (Position-siden), modsat
// hent-vandfoering og hent-vind, der kun kaldes fra cron på serversiden.
// Browserkald kræver CORS-headere, og browseren sender først en OPTIONS-
// forespørgsel for at spørge om lov. Uden begge dele afvises kaldet, før
// funktionen overhovedet kører — og det sker kun i browseren, ikke i
// dashboardets testværktøj, som går uden om CORS.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Vinduet vi kigger tilbage i for at finde den seneste måling. Seks timer er
// rigeligt til at overleve almindelige forsinkelser i DMI's indlæsning uden
// at hente mere data end nødvendigt.
const LOOKBACK_HOURS = 6;

interface DmiFeature {
  properties?: {
    from?: string;
    value?: number;
    validity?: boolean;
  };
}

interface StationResult {
  stationId: string;
  station: string;
  measuredAt: string | null;
  speedMs?: number;
  dirDegrees?: number;
  error?: string;
}

Deno.serve(async (req) => {
  // Browserens preflight-forespørgsel. Skal besvares før alt andet.
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return svar({ error: 'Brug POST.' }, 405);
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { db: { schema: 'faellesrejser' } }
  );

  let body: { stationIds?: string[] } = {};
  try {
    body = await req.json();
  } catch {
    // Tomt kald er tilladt.
  }

  let query = supabase.from('weather_stations').select('id, name').eq('is_active', true);
  if (body.stationIds?.length) query = query.in('id', body.stationIds);

  const { data: stationer, error } = await query;
  if (error) return svar({ error: error.message }, 500);
  if (!stationer?.length) return svar({ error: 'Ingen aktive vejrstationer fundet.' }, 404);

  const nu = new Date();
  const fra = new Date(nu.getTime() - LOOKBACK_HOURS * 3_600_000);
  // Sekundpræcision uden millisekunder — samme format som i hent-vind, der
  // beviseligt virker mod DMI. toISOString() giver millisekunder med, og det
  // afviser API'et.
  const interval = `${fra.toISOString().slice(0, 19)}Z/${nu.toISOString().slice(0, 19)}Z`;

  const resultat: StationResult[] = [];

  for (const station of stationer) {
    try {
      const [hastigheder, retninger] = await Promise.all([
        hentParameter(station.id, 'mean_wind_speed', interval),
        hentParameter(station.id, 'mean_wind_dir', interval),
      ]);

      const hastighedPrTid = new Map<string, number>();
      for (const f of hastigheder) {
        const p = f.properties;
        if (p?.from && p.validity !== false && typeof p.value === 'number') {
          hastighedPrTid.set(p.from, p.value);
        }
      }

      // Retning er styrende for hvilket tidspunkt vi vælger — vi skal bruge
      // begge dele fra samme time for at kunne danne én måling.
      let nyeste: { tidspunkt: string; speed: number; dir: number } | null = null;
      for (const f of retninger) {
        const p = f.properties;
        if (!p?.from || p.validity === false || typeof p.value !== 'number') continue;
        const speed = hastighedPrTid.get(p.from);
        if (speed == null) continue;
        if (!nyeste || p.from > nyeste.tidspunkt) {
          nyeste = { tidspunkt: p.from, speed, dir: p.value };
        }
      }

      resultat.push(
        nyeste
          ? {
              stationId: station.id,
              station: station.name,
              measuredAt: nyeste.tidspunkt,
              speedMs: nyeste.speed,
              dirDegrees: nyeste.dir,
            }
          : { stationId: station.id, station: station.name, measuredAt: null }
      );
    } catch (e) {
      resultat.push({
        stationId: station.id,
        station: station.name,
        measuredAt: null,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return svar({ resultat });
});

async function hentParameter(
  stationId: string,
  parameterId: string,
  interval: string
): Promise<DmiFeature[]> {
  const url =
    `${DMI_BASE}?stationId=${encodeURIComponent(stationId)}` +
    `&parameterId=${parameterId}&timeResolution=hour` +
    `&datetime=${encodeURIComponent(interval)}&limit=50`;

  const respons = await fetch(url, { headers: { accept: 'application/json' } });
  if (!respons.ok) throw new Error(`${parameterId}: HTTP ${respons.status}`);
  const data = await respons.json();
  return (data?.features ?? []) as DmiFeature[];
}

function svar(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json; charset=utf-8' },
  });
}
