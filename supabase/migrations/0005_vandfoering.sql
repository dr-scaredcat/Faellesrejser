-- =========================================================================
-- Fællesrejser 0005 — vandføring på Gudenåen
--
-- Data hentes automatisk fra Danmarks Miljøportals VanDa Hydro API
-- (https://vandah.miljoeportal.dk/api). Læsning kræver ikke login.
--
-- To ting er værd at vide om datagrundlaget:
--
--  1. API'et leverer målinger hvert 10. minut, altså 144 pr. døgn pr.
--     station. Vi gemmer kun døgnmidlen — resten er støj, når man skal
--     forklare, hvor hurtigt en kano sejler.
--
--  2. Vandføringen kan IKKE sammenlignes på tværs af stationer. Åstedbro
--     ligger højt oppe i systemet og fører omkring 1 m³/s en sommerdag;
--     Ulstrup ligger nedstrøms for både tilløb og Tangeværket og fører
--     ni gange så meget. Derfor normaliserer vi altid mod stationens egen
--     historik, før tallet bruges i en model — se flow_context() nederst.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. MÅLESTATIONER
-- -------------------------------------------------------------------------

create table if not exists faellesrejser.hydro_stations (
  -- VanDa's stationId. Bemærk: det er det, der på Miljøportalens hjemmeside
  -- hedder "Lokalt stnr", ikke "Observations stednr".
  id text primary key,
  station_uid uuid,
  name text not null,
  -- "Observations stednr" — ligger i API'et som oldStationNumber.
  old_station_number text,
  -- Gudenåen er reguleret ved Tangeværket, så vandføringen oven for og neden
  -- for værket hænger ikke tæt sammen. Derfor holdes de adskilt.
  position text not null check (position in ('opstroems_tange', 'nedstroems_tange')),
  sort_order int not null default 0,
  is_active boolean not null default true
);

insert into faellesrejser.hydro_stations
  (id, station_uid, name, old_station_number, position, sort_order)
values
  ('21006846', 'f78a0760-9500-4666-8bea-c61c8a584200', 'Gudenå, Åstedbro (21.02)', '21000085', 'opstroems_tange', 1),
  ('21006853', 'da70bc00-fa7c-4117-9ef4-6b06b525f106', 'Gudenå, Ulstrup (21.09)',  '21000461', 'nedstroems_tange', 2)
on conflict (id) do nothing;


-- -------------------------------------------------------------------------
-- 2. DØGNVÆRDIER
-- -------------------------------------------------------------------------
-- Værdier gemmes i m³/s, altså API'ets l/s divideret med 1000. sample_count
-- fortæller hvor mange 10-minutters-målinger døgnet er bygget på, så man kan
-- kende forskel på et fuldt døgn (144) og et med huller i.

create table if not exists faellesrejser.water_flow_daily (
  station_id text not null references faellesrejser.hydro_stations(id) on delete cascade,
  measured_on date not null,
  mean_flow_m3s numeric(10,3) not null,
  min_flow_m3s numeric(10,3),
  max_flow_m3s numeric(10,3),
  sample_count int not null default 0,
  fetched_at timestamptz not null default now(),
  primary key (station_id, measured_on)
);

create index if not exists water_flow_daily_date_idx
  on faellesrejser.water_flow_daily (measured_on);

alter table faellesrejser.hydro_stations enable row level security;
alter table faellesrejser.water_flow_daily enable row level security;

-- Alle indloggede må læse. Skrivning sker udelukkende fra Edge Function'en,
-- der bruger service_role og dermed går uden om RLS — der er bevidst ingen
-- skrive-policy her.
drop policy if exists "Alle loggede ind kan se målestationer" on faellesrejser.hydro_stations;
create policy "Alle loggede ind kan se målestationer"
  on faellesrejser.hydro_stations for select to authenticated
  using (true);

drop policy if exists "Alle loggede ind kan se vandføring" on faellesrejser.water_flow_daily;
create policy "Alle loggede ind kan se vandføring"
  on faellesrejser.water_flow_daily for select to authenticated
  using (true);


-- -------------------------------------------------------------------------
-- 3. NORMALISERING
-- -------------------------------------------------------------------------
-- Det rå tal siger ikke noget brugbart. Det, der betyder noget for farten,
-- er "hvor meget vand er der i åen i forhold til, hvad der plejer at være på
-- denne tid af året".
--
-- Funktionen sammenligner en given dag med stationens egne målinger inden for
-- ± et vindue af dage omkring samme dato i alle andre år, og returnerer både
-- forholdet til medianen (til regression) og percentilen (til visning).

create or replace function faellesrejser.flow_context(
  _station_id text,
  _date date,
  _window_days int default 21
)
returns table (
  flow_m3s numeric,
  median_m3s numeric,
  ratio_to_median numeric,
  percentile numeric,
  reference_days int
)
language sql
stable
set search_path = faellesrejser, public
as $$
  with target as (
    select w.mean_flow_m3s as v
    from faellesrejser.water_flow_daily w
    where w.station_id = _station_id and w.measured_on = _date
  ),
  reference as (
    select w.mean_flow_m3s as v
    from faellesrejser.water_flow_daily w
    where w.station_id = _station_id
      -- Afstand i dage til samme tid på året, med hensyn til årsskiftet.
      and least(
            abs(extract(doy from w.measured_on) - extract(doy from _date)),
            365 - abs(extract(doy from w.measured_on) - extract(doy from _date))
          ) <= _window_days
  )
  select
    (select v from target),
    percentile_cont(0.5) within group (order by r.v),
    case
      when percentile_cont(0.5) within group (order by r.v) > 0
      then round((select v from target) / percentile_cont(0.5) within group (order by r.v), 3)
    end,
    case
      when count(*) > 0
      then round(100.0 * count(*) filter (where r.v <= (select v from target)) / count(*), 1)
    end,
    count(*)::int
  from reference r;
$$;


-- -------------------------------------------------------------------------
-- 4. SEJLTIDER MED VANDFØRING
-- -------------------------------------------------------------------------
-- Bekvemmelighedsview, så statistikken kan hente sejltid og vandføring i ét
-- opslag. Begge stationer kommer med, så beregningen selv kan vælge den, der
-- passer til strækningen.

drop view if exists faellesrejser.sailing_times_with_flow;
create view faellesrejser.sailing_times_with_flow
with (security_invoker = on)
as
select
  st.*,
  up.mean_flow_m3s   as flow_upstream_m3s,
  down.mean_flow_m3s as flow_downstream_m3s
from faellesrejser.gudenaa_sailing_times st
left join lateral (
  select w.mean_flow_m3s
  from faellesrejser.water_flow_daily w
  join faellesrejser.hydro_stations h on h.id = w.station_id
  where h.position = 'opstroems_tange'
    and h.is_active
    and w.measured_on = st.sail_date
  order by h.sort_order
  limit 1
) up on true
left join lateral (
  select w.mean_flow_m3s
  from faellesrejser.water_flow_daily w
  join faellesrejser.hydro_stations h on h.id = w.station_id
  where h.position = 'nedstroems_tange'
    and h.is_active
    and w.measured_on = st.sail_date
  order by h.sort_order
  limit 1
) down on true;

grant select on faellesrejser.sailing_times_with_flow to authenticated;
grant select on faellesrejser.hydro_stations to authenticated;
grant select on faellesrejser.water_flow_daily to authenticated;
