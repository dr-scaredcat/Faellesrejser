-- =========================================================================
-- Fællesrejser 0006 — normaliseret vandføring på sejltiderne
--
-- Erstatter viewet fra 0005. To ændringer:
--
--  1. Viewet leverer nu forholdet til medianen for årstiden, ikke kun den rå
--     vandføring. Det er det tal, statistikken kan regne på — rå m³/s kan
--     ikke sammenlignes mellem Åstedbro og Ulstrup.
--
--  2. Døgn med for få målinger kasseres. API'et leverer 144 målinger i
--     døgnet; er der væsentligt færre, er døgnmidlen upålidelig.
-- =========================================================================

-- Mindste antal 10-minutters-målinger før et døgnmiddel accepteres.
-- 100 af 144 svarer til, at der mangler højst ca. syv timer af døgnet.
create or replace function faellesrejser.min_flow_samples()
returns int language sql immutable as $$ select 100 $$;

drop view if exists faellesrejser.sailing_times_with_flow;

create view faellesrejser.sailing_times_with_flow
with (security_invoker = on)
as
select
  st.*,
  up.flow_m3s        as flow_upstream_m3s,
  up.ratio_to_median as flow_upstream_ratio,
  up.percentile      as flow_upstream_percentile,
  down.flow_m3s        as flow_downstream_m3s,
  down.ratio_to_median as flow_downstream_ratio,
  down.percentile      as flow_downstream_percentile,
  -- Redundans: falder en logger ud, kan den anden station bruges i stedet.
  -- Det kan man netop tillade sig, FORDI tallene er normaliserede — de rå
  -- værdier ville være ubrugelige på tværs.
  coalesce(up.ratio_to_median, down.ratio_to_median) as flow_ratio,
  case
    when up.ratio_to_median is not null then 'opstroems_tange'
    when down.ratio_to_median is not null then 'nedstroems_tange'
  end as flow_source
from faellesrejser.gudenaa_sailing_times st
left join lateral (
  select f.*
  from faellesrejser.hydro_stations h
  join faellesrejser.water_flow_daily w
    on w.station_id = h.id
   and w.measured_on = st.sail_date
   and w.sample_count >= faellesrejser.min_flow_samples()
  cross join lateral faellesrejser.flow_context(h.id, st.sail_date) f
  where h.position = 'opstroems_tange' and h.is_active
  order by h.sort_order
  limit 1
) up on true
left join lateral (
  select f.*
  from faellesrejser.hydro_stations h
  join faellesrejser.water_flow_daily w
    on w.station_id = h.id
   and w.measured_on = st.sail_date
   and w.sample_count >= faellesrejser.min_flow_samples()
  cross join lateral faellesrejser.flow_context(h.id, st.sail_date) f
  where h.position = 'nedstroems_tange' and h.is_active
  order by h.sort_order
  limit 1
) down on true;

grant select on faellesrejser.sailing_times_with_flow to authenticated;
