-- =========================================================================
-- Fællesrejser-app: Fuldt databaseskema
-- Kør denne fil i Supabase SQL Editor (eller via `supabase db push`)
-- =========================================================================

-- Alt for denne app ligger i sit eget schema, adskilt fra andre apps i
-- samme Supabase-projekt.
create schema if not exists faellesrejser;

-- ---------- PROFILES ----------------------------------------------------
create table faellesrejser.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text not null,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

alter table faellesrejser.profiles enable row level security;

create policy "Alle loggede ind kan se profiler"
  on faellesrejser.profiles for select
  to authenticated
  using (true);

create policy "Man kan opdatere egen profil"
  on faellesrejser.profiles for update
  to authenticated
  using (auth.uid() = id);

-- Opret automatisk en profil når en bruger registrerer sig.
-- Den allerførste bruger i systemet bliver automatisk admin.
create or replace function faellesrejser.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = faellesrejser, public
as $$
declare
  is_first boolean;
begin
  select not exists(select 1 from faellesrejser.profiles) into is_first;

  insert into faellesrejser.profiles (id, email, name, is_admin)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    is_first
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure faellesrejser.handle_new_user();

-- ---------- ADMIN SETTINGS ----------------------------------------------
-- Simpel key/value-tabel til globale admin-indstillinger.
create table faellesrejser.admin_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references faellesrejser.profiles(id)
);

alter table faellesrejser.admin_settings enable row level security;

create policy "Alle loggede ind kan læse indstillinger"
  on faellesrejser.admin_settings for select
  to authenticated
  using (true);

create policy "Kun admins kan ændre indstillinger"
  on faellesrejser.admin_settings for all
  to authenticated
  using (exists (select 1 from faellesrejser.profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from faellesrejser.profiles p where p.id = auth.uid() and p.is_admin));

insert into faellesrejser.admin_settings (key, value) values
  ('allow_self_registration', 'true'),
  ('require_admin_approval_for_new_trips', 'false'),
  ('default_currency', '"DKK"'),
  ('site_name', '"Fællesrejser"');

-- ---------- TRIPS ---------------------------------------------------------
create table faellesrejser.trips (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  destination text not null,
  start_date date,
  end_date date,
  trip_type text not null default 'standard' check (trip_type in ('standard', 'gudenaa')),
  created_by uuid not null references faellesrejser.profiles(id),
  is_archived boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

alter table faellesrejser.trips enable row level security;

create table faellesrejser.trip_members (
  trip_id uuid not null references faellesrejser.trips(id) on delete cascade,
  user_id uuid not null references faellesrejser.profiles(id) on delete cascade,
  invited_by uuid references faellesrejser.profiles(id),
  joined_at timestamptz not null default now(),
  primary key (trip_id, user_id)
);

alter table faellesrejser.trip_members enable row level security;

-- Hjælpefunktion: er bruger medlem af rejsen (eller admin)?
create or replace function faellesrejser.is_trip_member(_trip_id uuid, _user_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from faellesrejser.trip_members tm where tm.trip_id = _trip_id and tm.user_id = _user_id
  ) or exists (
    select 1 from faellesrejser.profiles p where p.id = _user_id and p.is_admin
  );
$$;

create policy "Medlemmer og admins kan se rejser de er inviteret til"
  on faellesrejser.trips for select
  to authenticated
  using (faellesrejser.is_trip_member(id, auth.uid()));

create policy "Alle loggede ind kan oprette rejser"
  on faellesrejser.trips for insert
  to authenticated
  with check (created_by = auth.uid());

create policy "Kun opretter/admin kan redigere rejsen, og kun hvis den ikke er arkiveret"
  on faellesrejser.trips for update
  to authenticated
  using (
    (created_by = auth.uid() or exists (select 1 from faellesrejser.profiles p where p.id = auth.uid() and p.is_admin))
  );

create policy "Kun opretter/admin kan slette rejsen"
  on faellesrejser.trips for delete
  to authenticated
  using (created_by = auth.uid() or exists (select 1 from faellesrejser.profiles p where p.id = auth.uid() and p.is_admin));

create policy "Medlemmer kan se hinanden på en rejse"
  on faellesrejser.trip_members for select
  to authenticated
  using (faellesrejser.is_trip_member(trip_id, auth.uid()));

create policy "Medlemmer kan invitere andre til rejsen"
  on faellesrejser.trip_members for insert
  to authenticated
  with check (faellesrejser.is_trip_member(trip_id, auth.uid()));

create policy "Medlemmer kan forlade rejsen, opretter/admin kan fjerne andre"
  on faellesrejser.trip_members for delete
  to authenticated
  using (
    user_id = auth.uid()
    or exists (select 1 from faellesrejser.trips t where t.id = trip_id and t.created_by = auth.uid())
    or exists (select 1 from faellesrejser.profiles p where p.id = auth.uid() and p.is_admin)
  );

-- ---------- PAR (PAIRS) ----------------------------------------------------
create table faellesrejser.trip_pairs (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references faellesrejser.trips(id) on delete cascade,
  member1_id uuid not null references faellesrejser.profiles(id),
  member2_id uuid references faellesrejser.profiles(id),
  label text,
  created_at timestamptz not null default now()
);

alter table faellesrejser.trip_pairs enable row level security;

create policy "Medlemmer kan se par på rejsen"
  on faellesrejser.trip_pairs for select
  to authenticated
  using (faellesrejser.is_trip_member(trip_id, auth.uid()));

create policy "Medlemmer kan oprette/redigere par de selv er en del af"
  on faellesrejser.trip_pairs for all
  to authenticated
  using (faellesrejser.is_trip_member(trip_id, auth.uid()))
  with check (faellesrejser.is_trip_member(trip_id, auth.uid()));

-- ---------- PAKKELISTE ----------------------------------------------------
create table faellesrejser.packing_categories (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references faellesrejser.trips(id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table faellesrejser.packing_items (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references faellesrejser.packing_categories(id) on delete cascade,
  name text not null,
  created_by uuid references faellesrejser.profiles(id),
  created_at timestamptz not null default now()
);

-- Hver bruger kan markere sin egen pakning af en genstand (flere kan pakke "en sovepose" hver).
create table faellesrejser.packing_item_status (
  item_id uuid not null references faellesrejser.packing_items(id) on delete cascade,
  user_id uuid not null references faellesrejser.profiles(id) on delete cascade,
  packed boolean not null default false,
  packed_at timestamptz,
  primary key (item_id, user_id)
);

alter table faellesrejser.packing_categories enable row level security;
alter table faellesrejser.packing_items enable row level security;
alter table faellesrejser.packing_item_status enable row level security;

create policy "Medlemmer kan se og redigere pakkekategorier"
  on faellesrejser.packing_categories for all
  to authenticated
  using (faellesrejser.is_trip_member(trip_id, auth.uid()))
  with check (faellesrejser.is_trip_member(trip_id, auth.uid()));

create policy "Medlemmer kan se og redigere pakkeliste-emner"
  on faellesrejser.packing_items for all
  to authenticated
  using (faellesrejser.is_trip_member((select trip_id from faellesrejser.packing_categories c where c.id = category_id), auth.uid()))
  with check (faellesrejser.is_trip_member((select trip_id from faellesrejser.packing_categories c where c.id = category_id), auth.uid()));

create policy "Medlemmer kan se alles pakkestatus"
  on faellesrejser.packing_item_status for select
  to authenticated
  using (
    faellesrejser.is_trip_member(
      (select c.trip_id from faellesrejser.packing_items i join faellesrejser.packing_categories c on c.id = i.category_id where i.id = item_id),
      auth.uid()
    )
  );

create policy "Man kan sætte sin egen pakkestatus"
  on faellesrejser.packing_item_status for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "Man kan opdatere sin egen pakkestatus"
  on faellesrejser.packing_item_status for update
  to authenticated
  using (user_id = auth.uid());

create policy "Man kan slette sin egen pakkestatus"
  on faellesrejser.packing_item_status for delete
  to authenticated
  using (user_id = auth.uid());

-- ---------- REJSEPLAN ------------------------------------------------------
create table faellesrejser.itinerary_items (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references faellesrejser.trips(id) on delete cascade,
  title text not null,
  address text,
  starts_at timestamptz,
  ends_at timestamptz,
  info text,
  booking_reference text,
  contact_info text,
  cost numeric(10,2),
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table faellesrejser.itinerary_items enable row level security;

create policy "Medlemmer kan se og redigere rejseplan"
  on faellesrejser.itinerary_items for all
  to authenticated
  using (faellesrejser.is_trip_member(trip_id, auth.uid()))
  with check (faellesrejser.is_trip_member(trip_id, auth.uid()));

-- ---------- REGNSKAB --------------------------------------------------------
create table faellesrejser.expenses (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references faellesrejser.trips(id) on delete cascade,
  description text not null,
  category text not null default 'Diverse',
  amount numeric(10,2) not null,
  paid_by uuid not null references faellesrejser.profiles(id),
  expense_date date not null default current_date,
  is_settled boolean not null default false,
  created_at timestamptz not null default now()
);

-- Hvem en udgift skal deles mellem (default: alle medlemmer, men kan justeres).
create table faellesrejser.expense_participants (
  expense_id uuid not null references faellesrejser.expenses(id) on delete cascade,
  user_id uuid not null references faellesrejser.profiles(id) on delete cascade,
  primary key (expense_id, user_id)
);

alter table faellesrejser.expenses enable row level security;
alter table faellesrejser.expense_participants enable row level security;

create policy "Medlemmer kan se og redigere udgifter"
  on faellesrejser.expenses for all
  to authenticated
  using (faellesrejser.is_trip_member(trip_id, auth.uid()))
  with check (faellesrejser.is_trip_member(trip_id, auth.uid()));

create policy "Medlemmer kan se og redigere deltagere på udgifter"
  on faellesrejser.expense_participants for all
  to authenticated
  using (faellesrejser.is_trip_member((select trip_id from faellesrejser.expenses e where e.id = expense_id), auth.uid()))
  with check (faellesrejser.is_trip_member((select trip_id from faellesrejser.expenses e where e.id = expense_id), auth.uid()));

-- ---------- KØRSEL -----------------------------------------------------------
create table faellesrejser.driving_logs (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references faellesrejser.trips(id) on delete cascade,
  user_id uuid not null references faellesrejser.profiles(id),
  vehicle_label text,
  distance_km numeric(10,2) not null,
  energy_type text not null check (energy_type in ('benzin', 'diesel', 'el')),
  energy_amount numeric(10,3) not null, -- liter eller kWh
  log_date date not null default current_date,
  notes text,
  created_at timestamptz not null default now()
);

alter table faellesrejser.driving_logs enable row level security;

create policy "Medlemmer kan se og redigere kørselslog"
  on faellesrejser.driving_logs for all
  to authenticated
  using (faellesrejser.is_trip_member(trip_id, auth.uid()))
  with check (faellesrejser.is_trip_member(trip_id, auth.uid()));

-- =========================================================================
-- GUDENÅ-SPECIFIKKE TABELLER
-- =========================================================================

-- Global liste over overnatningssteder langs Gudenåen (redigeres af admin).
create table faellesrejser.gudenaa_stops (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sort_order int not null,
  distance_from_previous_km numeric(6,2) not null default 0,
  sail_time_hours numeric(6,2) not null default 0,
  description text,
  created_at timestamptz not null default now()
);

create table faellesrejser.gudenaa_stop_tags (
  stop_id uuid not null references faellesrejser.gudenaa_stops(id) on delete cascade,
  tag text not null,
  primary key (stop_id, tag)
);

alter table faellesrejser.gudenaa_stops enable row level security;
alter table faellesrejser.gudenaa_stop_tags enable row level security;

create policy "Alle loggede ind kan se stop"
  on faellesrejser.gudenaa_stops for select to authenticated using (true);

create policy "Kun admin kan redigere stop"
  on faellesrejser.gudenaa_stops for insert to authenticated
  with check (exists (select 1 from faellesrejser.profiles p where p.id = auth.uid() and p.is_admin));
create policy "Kun admin kan opdatere stop"
  on faellesrejser.gudenaa_stops for update to authenticated
  using (exists (select 1 from faellesrejser.profiles p where p.id = auth.uid() and p.is_admin));
create policy "Kun admin kan slette stop"
  on faellesrejser.gudenaa_stops for delete to authenticated
  using (exists (select 1 from faellesrejser.profiles p where p.id = auth.uid() and p.is_admin));

create policy "Alle loggede ind kan se tags"
  on faellesrejser.gudenaa_stop_tags for select to authenticated using (true);
create policy "Kun admin kan redigere tags"
  on faellesrejser.gudenaa_stop_tags for all to authenticated
  using (exists (select 1 from faellesrejser.profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from faellesrejser.profiles p where p.id = auth.uid() and p.is_admin));

-- Ruteplan for en konkret Gudenå-rejse.
create table faellesrejser.gudenaa_route_plans (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null unique references faellesrejser.trips(id) on delete cascade,
  start_stop_id uuid not null references faellesrejser.gudenaa_stops(id),
  num_days int not null,
  created_at timestamptz not null default now()
);

create table faellesrejser.gudenaa_route_plan_days (
  id uuid primary key default gen_random_uuid(),
  route_plan_id uuid not null references faellesrejser.gudenaa_route_plans(id) on delete cascade,
  day_number int not null,
  end_stop_id uuid references faellesrejser.gudenaa_stops(id),
  unique (route_plan_id, day_number)
);

alter table faellesrejser.gudenaa_route_plans enable row level security;
alter table faellesrejser.gudenaa_route_plan_days enable row level security;

create policy "Medlemmer kan se og redigere ruteplan"
  on faellesrejser.gudenaa_route_plans for all
  to authenticated
  using (faellesrejser.is_trip_member(trip_id, auth.uid()))
  with check (faellesrejser.is_trip_member(trip_id, auth.uid()));

create policy "Medlemmer kan se og redigere rutedage"
  on faellesrejser.gudenaa_route_plan_days for all
  to authenticated
  using (faellesrejser.is_trip_member((select trip_id from faellesrejser.gudenaa_route_plans r where r.id = route_plan_id), auth.uid()))
  with check (faellesrejser.is_trip_member((select trip_id from faellesrejser.gudenaa_route_plans r where r.id = route_plan_id), auth.uid()));

-- Sejltider: logges pr. bruger og indgår i historiske gennemsnitsberegninger på tværs af alle ture.
create table faellesrejser.gudenaa_sailing_times (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid references faellesrejser.trips(id) on delete set null,
  user_id uuid not null references faellesrejser.profiles(id),
  start_stop_id uuid not null references faellesrejser.gudenaa_stops(id),
  end_stop_id uuid not null references faellesrejser.gudenaa_stops(id),
  total_time_hours numeric(6,2) not null,
  sailing_time_hours numeric(6,2) not null,
  sail_date date not null default current_date,
  created_at timestamptz not null default now()
);

alter table faellesrejser.gudenaa_sailing_times enable row level security;

-- Sejltider bruges til statistik på tværs af alle ture, så alle loggede ind kan se dem.
create policy "Alle loggede ind kan se sejltider"
  on faellesrejser.gudenaa_sailing_times for select to authenticated using (true);

create policy "Man kan oprette egne sejltider"
  on faellesrejser.gudenaa_sailing_times for insert to authenticated
  with check (user_id = auth.uid());

create policy "Man kan redigere/slette egne sejltider (eller admin)"
  on faellesrejser.gudenaa_sailing_times for update to authenticated
  using (user_id = auth.uid() or exists (select 1 from faellesrejser.profiles p where p.id = auth.uid() and p.is_admin));
create policy "Man kan slette egne sejltider (eller admin)"
  on faellesrejser.gudenaa_sailing_times for delete to authenticated
  using (user_id = auth.uid() or exists (select 1 from faellesrejser.profiles p where p.id = auth.uid() and p.is_admin));

-- ---------- INDEKSER ---------------------------------------------------------
create index on faellesrejser.trip_members (user_id);
create index on faellesrejser.packing_items (category_id);
create index on faellesrejser.packing_item_status (user_id);
create index on faellesrejser.expenses (trip_id);
create index on faellesrejser.expense_participants (user_id);
create index on faellesrejser.gudenaa_sailing_times (start_stop_id, end_stop_id);
create index on faellesrejser.gudenaa_stops (sort_order);

-- ---------- RETTIGHEDER -------------------------------------------------------
-- Supabases API-roller (anon/authenticated) har som udgangspunkt ikke adgang til
-- et nyt schema, sådan som de har til "public". Disse grants giver dem lov til at
-- forsøge at læse/skrive — selve adgangskontrollen sker stadig via RLS-policies
-- ovenfor. Husk desuden at tilføje "faellesrejser" under
-- Supabase Dashboard → Settings → API → Exposed schemas.
grant usage on schema faellesrejser to anon, authenticated, service_role;

grant all on all tables in schema faellesrejser to anon, authenticated, service_role;
grant all on all sequences in schema faellesrejser to anon, authenticated, service_role;
grant all on all routines in schema faellesrejser to anon, authenticated, service_role;

alter default privileges in schema faellesrejser
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema faellesrejser
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema faellesrejser
  grant all on routines to anon, authenticated, service_role;
