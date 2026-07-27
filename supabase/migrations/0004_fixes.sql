-- =========================================================================
-- Fællesrejser 0004 — fejlrettelser, strammere adgangskontrol og afregninger
--
-- Kan køres ovenpå en eksisterende database. Filen er idempotent: den kan
-- køres flere gange uden at fejle.
--
-- INDHOLD
--   1. Hjælpefunktioner (search_path-fix, is_admin, is_editable_trip, opslag)
--   2. Profiler: manglende INSERT-policy + værn mod selvudnævnte admins
--   3. Rejser: created_by kan ikke overdrages ved et uheld
--   4. Par: en person kan kun indgå i ét par pr. rejse
--   5. Afregninger (ny tabel `settlements`)
--   6. Atomisk gem af udgift + deltagere (RPC)
--   7. Alle policies på indholdstabeller gendannes, nu med arkiv-håndhævelse
--   8. Rettigheder: anon får kun adgang til det, loginsiden har brug for
--
-- FØR DU KØRER: se afsnit 4 — hvis I allerede har en person i to par på
-- samme rejse, fejler trigger-oprettelsen ikke, men næste redigering af det
-- par vil blive afvist. Kør tjekket i afsnit 4 for at finde dem først.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. HJÆLPEFUNKTIONER
-- -------------------------------------------------------------------------

-- Genskabt med fast search_path. Uden det kan en `security definer`-funktion
-- narres til at kalde ind i et andet schema (kendt Supabase-advarsel).
create or replace function faellesrejser.is_trip_member(_trip_id uuid, _user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = faellesrejser, public
as $$
  select exists (
    select 1 from faellesrejser.trip_members tm
    where tm.trip_id = _trip_id and tm.user_id = _user_id
  ) or exists (
    select 1 from faellesrejser.profiles p
    where p.id = _user_id and p.is_admin
  );
$$;

create or replace function faellesrejser.is_admin(_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = faellesrejser, public
as $$
  select exists (
    select 1 from faellesrejser.profiles p where p.id = _user_id and p.is_admin
  );
$$;

-- Må brugeren *skrive* i rejsen? Medlem OG rejsen er ikke arkiveret.
-- Tidligere lå arkiv-spærringen kun i React (`isEditable`), så et direkte
-- API-kald kunne stadig ændre en arkiveret rejse.
create or replace function faellesrejser.is_editable_trip(_trip_id uuid, _user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = faellesrejser, public
as $$
  select faellesrejser.is_trip_member(_trip_id, _user_id)
     and exists (
       select 1 from faellesrejser.trips t
       where t.id = _trip_id and not t.is_archived
     );
$$;

-- Opslag brugt i policies på tabeller uden direkte trip_id.
create or replace function faellesrejser.trip_id_for_packing_category(_category_id uuid)
returns uuid language sql security definer stable
set search_path = faellesrejser, public
as $$ select c.trip_id from faellesrejser.packing_categories c where c.id = _category_id; $$;

create or replace function faellesrejser.trip_id_for_packing_item(_item_id uuid)
returns uuid language sql security definer stable
set search_path = faellesrejser, public
as $$
  select c.trip_id
  from faellesrejser.packing_items i
  join faellesrejser.packing_categories c on c.id = i.category_id
  where i.id = _item_id;
$$;

create or replace function faellesrejser.trip_id_for_expense(_expense_id uuid)
returns uuid language sql security definer stable
set search_path = faellesrejser, public
as $$ select e.trip_id from faellesrejser.expenses e where e.id = _expense_id; $$;

create or replace function faellesrejser.trip_id_for_route_plan(_plan_id uuid)
returns uuid language sql security definer stable
set search_path = faellesrejser, public
as $$ select p.trip_id from faellesrejser.gudenaa_route_plans p where p.id = _plan_id; $$;


-- -------------------------------------------------------------------------
-- 2. PROFILER
-- -------------------------------------------------------------------------
-- `profiles` havde RLS slået til, men kun policies for SELECT og UPDATE.
-- Fallback'en i AuthContext, der opretter en manglende profilrække, blev
-- derfor altid afvist — den kunne aldrig virke.
--
-- Desuden: den gamle UPDATE-policy tillod enhver at opdatere sin egen række
-- uden begrænsning på kolonner. Man kunne altså sætte is_admin = true på sig
-- selv. Det lukkes med en trigger nedenfor.

drop policy if exists "Alle loggede ind kan se profiler" on faellesrejser.profiles;
drop policy if exists "Man kan opdatere egen profil" on faellesrejser.profiles;
drop policy if exists "Man kan oprette sin egen profil" on faellesrejser.profiles;
drop policy if exists "Admins kan opdatere alle profiler" on faellesrejser.profiles;

create policy "Alle loggede ind kan se profiler"
  on faellesrejser.profiles for select to authenticated
  using (true);

create policy "Man kan oprette sin egen profil"
  on faellesrejser.profiles for insert to authenticated
  with check (id = auth.uid() and is_admin = false);

create policy "Man kan opdatere egen profil"
  on faellesrejser.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Admin-siden kan slå admin til/fra for andre brugere. Det virkede ikke før,
-- fordi den eneste UPDATE-policy krævede id = auth.uid().
create policy "Admins kan opdatere alle profiler"
  on faellesrejser.profiles for update to authenticated
  using (faellesrejser.is_admin(auth.uid()))
  with check (faellesrejser.is_admin(auth.uid()));

create or replace function faellesrejser.guard_profile_admin_flag()
returns trigger
language plpgsql
security definer
set search_path = faellesrejser, public
as $$
begin
  if new.is_admin is distinct from old.is_admin
     and not faellesrejser.is_admin(auth.uid()) then
    raise exception 'Kun administratorer kan ændre admin-status.';
  end if;
  -- id og email hører til auth-brugeren og må ikke skrives om herfra.
  new.id := old.id;
  return new;
end;
$$;

drop trigger if exists guard_profile_admin_flag on faellesrejser.profiles;
create trigger guard_profile_admin_flag
  before update on faellesrejser.profiles
  for each row execute function faellesrejser.guard_profile_admin_flag();


-- -------------------------------------------------------------------------
-- 3. REJSER
-- -------------------------------------------------------------------------
-- UPDATE-policy'en manglede `with check`, så en opretter kunne skrive
-- created_by om til en anden bruger og dermed miste adgangen selv.

create or replace function faellesrejser.guard_trip_created_by()
returns trigger
language plpgsql
set search_path = faellesrejser, public
as $$
begin
  if new.created_by is distinct from old.created_by then
    raise exception 'Rejsens opretter kan ikke ændres.';
  end if;
  -- Sæt/nulstil arkiveringstidspunktet automatisk, så det altid passer.
  if new.is_archived and not old.is_archived then
    new.archived_at := coalesce(new.archived_at, now());
  elsif not new.is_archived and old.is_archived then
    new.archived_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_trip_created_by on faellesrejser.trips;
create trigger guard_trip_created_by
  before update on faellesrejser.trips
  for each row execute function faellesrejser.guard_trip_created_by();


-- -------------------------------------------------------------------------
-- 4. PAR
-- -------------------------------------------------------------------------
-- Der var intet der forhindrede, at samme person indgik i to par på samme
-- rejse. I regnskabet vandt så det sidst indlæste par, og pengene endte det
-- forkerte sted uden nogen fejlmeddelelse.
--
-- FIND EKSISTERENDE PROBLEMER FØRST (kør denne, ret evt. data, kør så resten):
--
--   select trip_id, person_id, count(*)
--   from (
--     select trip_id, member1_id as person_id from faellesrejser.trip_pairs
--     union all
--     select trip_id, member2_id from faellesrejser.trip_pairs where member2_id is not null
--   ) x
--   group by trip_id, person_id
--   having count(*) > 1;

create or replace function faellesrejser.guard_trip_pair()
returns trigger
language plpgsql
security definer
set search_path = faellesrejser, public
as $$
begin
  if new.member2_id is not null and new.member1_id = new.member2_id then
    raise exception 'En person kan ikke danne par med sig selv.';
  end if;

  if not exists (
    select 1 from faellesrejser.trip_members tm
    where tm.trip_id = new.trip_id and tm.user_id = new.member1_id
  ) then
    raise exception 'Personen er ikke medlem af rejsen og kan derfor ikke indgå i et par.';
  end if;

  if new.member2_id is not null and not exists (
    select 1 from faellesrejser.trip_members tm
    where tm.trip_id = new.trip_id and tm.user_id = new.member2_id
  ) then
    raise exception 'Personen er ikke medlem af rejsen og kan derfor ikke indgå i et par.';
  end if;

  if exists (
    select 1 from faellesrejser.trip_pairs p
    where p.trip_id = new.trip_id
      and p.id is distinct from new.id
      and (
        p.member1_id = new.member1_id
        or p.member2_id = new.member1_id
        or (new.member2_id is not null and (p.member1_id = new.member2_id or p.member2_id = new.member2_id))
      )
  ) then
    raise exception 'Personen indgår allerede i et par på denne rejse.';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_trip_pair on faellesrejser.trip_pairs;
create trigger guard_trip_pair
  before insert or update on faellesrejser.trip_pairs
  for each row execute function faellesrejser.guard_trip_pair();


-- -------------------------------------------------------------------------
-- 5. AFREGNINGER
-- -------------------------------------------------------------------------
-- To forskellige måder at gøre op på, som dækker hver sit behov:
--
--   a) expenses.is_settled — hele posten er betalt uden om det løbende
--      regnskab. Bruges fx til rejsen selv, som én betaler, og som alle
--      overfører deres andel af inden afrejse. Posten tæller stadig med i
--      det samlede forbrug, men indgår slet ikke i "hvem skylder hvem".
--
--   b) settlements — en faktisk overførsel mellem to personer. Bruges når
--      man krydser en linje af under "hvem skylder hvem". Saldiene bliver
--      justeret med beløbet, og resten af gælden står tilbage.
--
-- Afregninger registreres altid mellem to *personer*, også når regnskabet
-- vises pr. par — for det er personer, der sender penge til hinanden.

create table if not exists faellesrejser.settlements (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references faellesrejser.trips(id) on delete cascade,
  from_user_id uuid not null references faellesrejser.profiles(id),
  to_user_id uuid not null references faellesrejser.profiles(id),
  amount numeric(10,2) not null check (amount > 0),
  settled_on date not null default current_date,
  note text,
  created_by uuid not null references faellesrejser.profiles(id),
  created_at timestamptz not null default now(),
  constraint settlements_different_parties check (from_user_id <> to_user_id)
);

create index if not exists settlements_trip_id_idx on faellesrejser.settlements (trip_id);

alter table faellesrejser.settlements enable row level security;


-- -------------------------------------------------------------------------
-- 6. ATOMISK GEM AF UDGIFT + DELTAGERE
-- -------------------------------------------------------------------------
-- Frontenden slettede først alle deltagere og indsatte dem så igen. Fejlede
-- indsættelsen, stod udgiften tilbage uden deltagere — og faldt dermed
-- tilbage til "kun betaleren", hvilket ændrer regnskabet.
--
-- `security invoker` er med vilje: RLS gælder stadig, så funktionen kan ikke
-- bruges til at komme uden om adgangskontrollen.

create or replace function faellesrejser.save_expense(
  _expense_id uuid,          -- null = opret ny
  _trip_id uuid,
  _description text,
  _category text,
  _amount numeric,
  _paid_by uuid,
  _expense_date date,
  _participants uuid[]
)
returns uuid
language plpgsql
security invoker
set search_path = faellesrejser, public
as $$
declare
  v_id uuid;
begin
  if _amount is null or _amount = 0 then
    raise exception 'Beløbet skal være forskelligt fra 0.';
  end if;

  if _participants is null or array_length(_participants, 1) is null then
    raise exception 'En udgift skal deles mellem mindst én person.';
  end if;

  if _expense_id is null then
    insert into faellesrejser.expenses
      (trip_id, description, category, amount, paid_by, expense_date)
    values
      (_trip_id, _description, _category, _amount, _paid_by, _expense_date)
    returning id into v_id;
  else
    update faellesrejser.expenses
       set description  = _description,
           category     = _category,
           amount       = _amount,
           paid_by      = _paid_by,
           expense_date = _expense_date
     where id = _expense_id
    returning id into v_id;

    if v_id is null then
      raise exception 'Udgiften findes ikke, eller rejsen er arkiveret.';
    end if;
  end if;

  delete from faellesrejser.expense_participants where expense_id = v_id;

  insert into faellesrejser.expense_participants (expense_id, user_id)
  select v_id, u from unnest(_participants) as u
  on conflict do nothing;

  return v_id;
end;
$$;


-- -------------------------------------------------------------------------
-- 7. POLICIES PÅ INDHOLDSTABELLER
-- -------------------------------------------------------------------------
-- Alle policies på tabellerne nedenfor fjernes og gendannes, så denne fil er
-- den ene autoritative kilde til dem. Mønsteret er nu konsekvent:
--
--   SELECT  → medlem af rejsen (læsning virker også i arkivet)
--   INSERT  → is_editable_trip (medlem OG rejsen er ikke arkiveret)
--   UPDATE  → is_editable_trip i både using og with check
--   DELETE  → is_editable_trip
--
-- Tidligere brugte flere tabeller `for all` med kun `using`, hvilket betød at
-- DELETE aldrig blev tjekket mod `with check`.

do $$
declare
  r record;
  tbl text;
  tables text[] := array[
    'trips', 'trip_members', 'trip_pairs',
    'packing_categories', 'packing_items', 'packing_item_status',
    'itinerary_items', 'expenses', 'expense_participants', 'driving_logs',
    'settlements',
    'gudenaa_route_plans', 'gudenaa_route_plan_days', 'gudenaa_sailing_times',
    'admin_settings'
  ];
begin
  foreach tbl in array tables loop
    for r in
      select policyname from pg_policies
      where schemaname = 'faellesrejser' and tablename = tbl
    loop
      execute format('drop policy %I on faellesrejser.%I', r.policyname, tbl);
    end loop;
  end loop;
end $$;

-- ---------- trips ----------
create policy "Medlemmer og admins kan se rejser de er inviteret til"
  on faellesrejser.trips for select to authenticated
  using (faellesrejser.is_trip_member(id, auth.uid()));

create policy "Alle loggede ind kan oprette rejser"
  on faellesrejser.trips for insert to authenticated
  with check (created_by = auth.uid());

-- Selve rejserækken skal stadig kunne opdateres i arkiveret tilstand, ellers
-- kan man ikke fortryde arkiveringen. Indholdet er spærret via policies
-- længere nede.
create policy "Opretter og admin kan redigere rejsen"
  on faellesrejser.trips for update to authenticated
  using (created_by = auth.uid() or faellesrejser.is_admin(auth.uid()))
  with check (created_by = auth.uid() or faellesrejser.is_admin(auth.uid()));

create policy "Opretter og admin kan slette rejsen"
  on faellesrejser.trips for delete to authenticated
  using (created_by = auth.uid() or faellesrejser.is_admin(auth.uid()));

-- ---------- trip_members ----------
create policy "Medlemmer kan se hinanden"
  on faellesrejser.trip_members for select to authenticated
  using (faellesrejser.is_trip_member(trip_id, auth.uid()));

create policy "Medlemmer kan invitere andre"
  on faellesrejser.trip_members for insert to authenticated
  with check (faellesrejser.is_editable_trip(trip_id, auth.uid()));

create policy "Man kan forlade rejsen, opretter og admin kan fjerne andre"
  on faellesrejser.trip_members for delete to authenticated
  using (
    user_id = auth.uid()
    or exists (select 1 from faellesrejser.trips t where t.id = trip_id and t.created_by = auth.uid())
    or faellesrejser.is_admin(auth.uid())
  );

-- ---------- trip_pairs ----------
create policy "Medlemmer kan se par"
  on faellesrejser.trip_pairs for select to authenticated
  using (faellesrejser.is_trip_member(trip_id, auth.uid()));

create policy "Medlemmer kan oprette par"
  on faellesrejser.trip_pairs for insert to authenticated
  with check (faellesrejser.is_editable_trip(trip_id, auth.uid()));

create policy "Medlemmer kan redigere par"
  on faellesrejser.trip_pairs for update to authenticated
  using (faellesrejser.is_editable_trip(trip_id, auth.uid()))
  with check (faellesrejser.is_editable_trip(trip_id, auth.uid()));

create policy "Medlemmer kan slette par"
  on faellesrejser.trip_pairs for delete to authenticated
  using (faellesrejser.is_editable_trip(trip_id, auth.uid()));

-- ---------- packing_categories ----------
create policy "Medlemmer kan se pakkekategorier"
  on faellesrejser.packing_categories for select to authenticated
  using (faellesrejser.is_trip_member(trip_id, auth.uid()));

create policy "Medlemmer kan oprette pakkekategorier"
  on faellesrejser.packing_categories for insert to authenticated
  with check (faellesrejser.is_editable_trip(trip_id, auth.uid()));

create policy "Medlemmer kan redigere pakkekategorier"
  on faellesrejser.packing_categories for update to authenticated
  using (faellesrejser.is_editable_trip(trip_id, auth.uid()))
  with check (faellesrejser.is_editable_trip(trip_id, auth.uid()));

create policy "Medlemmer kan slette pakkekategorier"
  on faellesrejser.packing_categories for delete to authenticated
  using (faellesrejser.is_editable_trip(trip_id, auth.uid()));

-- ---------- packing_items ----------
create policy "Medlemmer kan se pakkeliste-emner"
  on faellesrejser.packing_items for select to authenticated
  using (faellesrejser.is_trip_member(
    faellesrejser.trip_id_for_packing_category(category_id), auth.uid()));

create policy "Medlemmer kan oprette pakkeliste-emner"
  on faellesrejser.packing_items for insert to authenticated
  with check (faellesrejser.is_editable_trip(
    faellesrejser.trip_id_for_packing_category(category_id), auth.uid()));

create policy "Medlemmer kan redigere pakkeliste-emner"
  on faellesrejser.packing_items for update to authenticated
  using (faellesrejser.is_editable_trip(
    faellesrejser.trip_id_for_packing_category(category_id), auth.uid()))
  with check (faellesrejser.is_editable_trip(
    faellesrejser.trip_id_for_packing_category(category_id), auth.uid()));

create policy "Medlemmer kan slette pakkeliste-emner"
  on faellesrejser.packing_items for delete to authenticated
  using (faellesrejser.is_editable_trip(
    faellesrejser.trip_id_for_packing_category(category_id), auth.uid()));

-- ---------- packing_item_status ----------
-- UPDATE manglede `with check`, så en række kunne opdateres til at pege på
-- en anden bruger.
create policy "Medlemmer kan se alles pakkestatus"
  on faellesrejser.packing_item_status for select to authenticated
  using (faellesrejser.is_trip_member(
    faellesrejser.trip_id_for_packing_item(item_id), auth.uid()));

create policy "Man kan sætte sin egen pakkestatus"
  on faellesrejser.packing_item_status for insert to authenticated
  with check (
    user_id = auth.uid()
    and faellesrejser.is_editable_trip(
      faellesrejser.trip_id_for_packing_item(item_id), auth.uid())
  );

create policy "Man kan opdatere sin egen pakkestatus"
  on faellesrejser.packing_item_status for update to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and faellesrejser.is_editable_trip(
      faellesrejser.trip_id_for_packing_item(item_id), auth.uid())
  );

create policy "Man kan slette sin egen pakkestatus"
  on faellesrejser.packing_item_status for delete to authenticated
  using (user_id = auth.uid());

-- ---------- itinerary_items ----------
create policy "Medlemmer kan se rejseplanen"
  on faellesrejser.itinerary_items for select to authenticated
  using (faellesrejser.is_trip_member(trip_id, auth.uid()));

create policy "Medlemmer kan oprette punkter i rejseplanen"
  on faellesrejser.itinerary_items for insert to authenticated
  with check (faellesrejser.is_editable_trip(trip_id, auth.uid()));

create policy "Medlemmer kan redigere rejseplanen"
  on faellesrejser.itinerary_items for update to authenticated
  using (faellesrejser.is_editable_trip(trip_id, auth.uid()))
  with check (faellesrejser.is_editable_trip(trip_id, auth.uid()));

create policy "Medlemmer kan slette punkter i rejseplanen"
  on faellesrejser.itinerary_items for delete to authenticated
  using (faellesrejser.is_editable_trip(trip_id, auth.uid()));

-- ---------- expenses ----------
create policy "Medlemmer kan se udgifter"
  on faellesrejser.expenses for select to authenticated
  using (faellesrejser.is_trip_member(trip_id, auth.uid()));

create policy "Medlemmer kan oprette udgifter"
  on faellesrejser.expenses for insert to authenticated
  with check (faellesrejser.is_editable_trip(trip_id, auth.uid()));

create policy "Medlemmer kan redigere udgifter"
  on faellesrejser.expenses for update to authenticated
  using (faellesrejser.is_editable_trip(trip_id, auth.uid()))
  with check (faellesrejser.is_editable_trip(trip_id, auth.uid()));

create policy "Medlemmer kan slette udgifter"
  on faellesrejser.expenses for delete to authenticated
  using (faellesrejser.is_editable_trip(trip_id, auth.uid()));

-- ---------- expense_participants ----------
create policy "Medlemmer kan se deltagere på udgifter"
  on faellesrejser.expense_participants for select to authenticated
  using (faellesrejser.is_trip_member(
    faellesrejser.trip_id_for_expense(expense_id), auth.uid()));

create policy "Medlemmer kan tilføje deltagere på udgifter"
  on faellesrejser.expense_participants for insert to authenticated
  with check (faellesrejser.is_editable_trip(
    faellesrejser.trip_id_for_expense(expense_id), auth.uid()));

create policy "Medlemmer kan fjerne deltagere på udgifter"
  on faellesrejser.expense_participants for delete to authenticated
  using (faellesrejser.is_editable_trip(
    faellesrejser.trip_id_for_expense(expense_id), auth.uid()));

-- ---------- driving_logs ----------
create policy "Medlemmer kan se kørselslog"
  on faellesrejser.driving_logs for select to authenticated
  using (faellesrejser.is_trip_member(trip_id, auth.uid()));

create policy "Medlemmer kan registrere kørsel"
  on faellesrejser.driving_logs for insert to authenticated
  with check (faellesrejser.is_editable_trip(trip_id, auth.uid()));

create policy "Medlemmer kan redigere kørsel"
  on faellesrejser.driving_logs for update to authenticated
  using (faellesrejser.is_editable_trip(trip_id, auth.uid()))
  with check (faellesrejser.is_editable_trip(trip_id, auth.uid()));

create policy "Medlemmer kan slette kørsel"
  on faellesrejser.driving_logs for delete to authenticated
  using (faellesrejser.is_editable_trip(trip_id, auth.uid()));

-- ---------- settlements ----------
create policy "Medlemmer kan se afregninger"
  on faellesrejser.settlements for select to authenticated
  using (faellesrejser.is_trip_member(trip_id, auth.uid()));

create policy "Medlemmer kan registrere afregninger"
  on faellesrejser.settlements for insert to authenticated
  with check (
    created_by = auth.uid()
    and faellesrejser.is_editable_trip(trip_id, auth.uid())
  );

create policy "Medlemmer kan redigere afregninger"
  on faellesrejser.settlements for update to authenticated
  using (faellesrejser.is_editable_trip(trip_id, auth.uid()))
  with check (faellesrejser.is_editable_trip(trip_id, auth.uid()));

create policy "Medlemmer kan slette afregninger"
  on faellesrejser.settlements for delete to authenticated
  using (faellesrejser.is_editable_trip(trip_id, auth.uid()));

-- ---------- gudenaa_route_plans / _days ----------
-- BEMÆRK: læseadgang er bevidst åben for alle indloggede, fordi
-- Statistik-siden regner "længste/korteste planlagte dag" ud på tværs af
-- alle Gudenå-ture — også dem man ikke selv var med på. Vil I hellere
-- begrænse det til egne rejser, så byt `using (true)` ud med
-- `using (faellesrejser.is_trip_member(trip_id, auth.uid()))` herunder
-- (og tilsvarende via trip_id_for_route_plan for dagene).
create policy "Alle loggede ind kan se ruteplaner"
  on faellesrejser.gudenaa_route_plans for select to authenticated
  using (true);

create policy "Medlemmer kan oprette ruteplan"
  on faellesrejser.gudenaa_route_plans for insert to authenticated
  with check (faellesrejser.is_editable_trip(trip_id, auth.uid()));

create policy "Medlemmer kan redigere ruteplan"
  on faellesrejser.gudenaa_route_plans for update to authenticated
  using (faellesrejser.is_editable_trip(trip_id, auth.uid()))
  with check (faellesrejser.is_editable_trip(trip_id, auth.uid()));

create policy "Medlemmer kan slette ruteplan"
  on faellesrejser.gudenaa_route_plans for delete to authenticated
  using (faellesrejser.is_editable_trip(trip_id, auth.uid()));

create policy "Alle loggede ind kan se ruteplan-dage"
  on faellesrejser.gudenaa_route_plan_days for select to authenticated
  using (true);

create policy "Medlemmer kan oprette ruteplan-dage"
  on faellesrejser.gudenaa_route_plan_days for insert to authenticated
  with check (faellesrejser.is_editable_trip(
    faellesrejser.trip_id_for_route_plan(route_plan_id), auth.uid()));

create policy "Medlemmer kan redigere ruteplan-dage"
  on faellesrejser.gudenaa_route_plan_days for update to authenticated
  using (faellesrejser.is_editable_trip(
    faellesrejser.trip_id_for_route_plan(route_plan_id), auth.uid()))
  with check (faellesrejser.is_editable_trip(
    faellesrejser.trip_id_for_route_plan(route_plan_id), auth.uid()));

create policy "Medlemmer kan slette ruteplan-dage"
  on faellesrejser.gudenaa_route_plan_days for delete to authenticated
  using (faellesrejser.is_editable_trip(
    faellesrejser.trip_id_for_route_plan(route_plan_id), auth.uid()));

-- ---------- gudenaa_sailing_times ----------
-- Læsning er åben for alle indloggede: hele pointen er historiske
-- gennemsnit på tværs af ture.
create policy "Alle loggede ind kan se sejltider"
  on faellesrejser.gudenaa_sailing_times for select to authenticated
  using (true);

create policy "Man kan registrere egne sejltider"
  on faellesrejser.gudenaa_sailing_times for insert to authenticated
  with check (
    user_id = auth.uid()
    and (trip_id is null or faellesrejser.is_editable_trip(trip_id, auth.uid()))
  );

create policy "Man kan redigere egne sejltider"
  on faellesrejser.gudenaa_sailing_times for update to authenticated
  using (user_id = auth.uid() or faellesrejser.is_admin(auth.uid()))
  with check (user_id = auth.uid() or faellesrejser.is_admin(auth.uid()));

create policy "Man kan slette egne sejltider"
  on faellesrejser.gudenaa_sailing_times for delete to authenticated
  using (user_id = auth.uid() or faellesrejser.is_admin(auth.uid()));

-- ---------- admin_settings ----------
create policy "Alle loggede ind kan læse indstillinger"
  on faellesrejser.admin_settings for select to authenticated
  using (true);

-- Temaet hentes af ThemeProvider *før* login, altså som anon-rollen. Uden
-- denne policy ville loginsiden miste sine farver, når anon-rettighederne
-- strammes i afsnit 8.
create policy "Loginsiden kan læse tema og sidenavn"
  on faellesrejser.admin_settings for select to anon
  using (key in ('active_theme_id', 'site_name'));

create policy "Kun admins kan ændre indstillinger"
  on faellesrejser.admin_settings for all to authenticated
  using (faellesrejser.is_admin(auth.uid()))
  with check (faellesrejser.is_admin(auth.uid()));

-- Temaerne selv skal også kunne læses før login.
drop policy if exists "Loginsiden kan læse temaer" on faellesrejser.themes;
create policy "Loginsiden kan læse temaer"
  on faellesrejser.themes for select to anon
  using (true);


-- -------------------------------------------------------------------------
-- 8. RETTIGHEDER
-- -------------------------------------------------------------------------
-- anon havde `grant all` på alle tabeller. RLS holdt hånden under det, men
-- glemmer man `enable row level security` på en fremtidig tabel, ligger den
-- åben for internettet. anon får nu kun læseadgang til de to tabeller,
-- loginsiden faktisk bruger.

revoke all on all tables in schema faellesrejser from anon;
revoke all on all sequences in schema faellesrejser from anon;
revoke all on all routines in schema faellesrejser from anon;

alter default privileges in schema faellesrejser revoke all on tables from anon;
alter default privileges in schema faellesrejser revoke all on sequences from anon;
alter default privileges in schema faellesrejser revoke all on routines from anon;

grant usage on schema faellesrejser to anon;
grant select on faellesrejser.themes to anon;
grant select on faellesrejser.admin_settings to anon;

-- authenticated beholder sine rettigheder; adgangskontrollen ligger i RLS.
grant usage on schema faellesrejser to authenticated, service_role;
grant all on all tables in schema faellesrejser to authenticated, service_role;
grant all on all sequences in schema faellesrejser to authenticated, service_role;
grant all on all routines in schema faellesrejser to authenticated, service_role;

alter default privileges in schema faellesrejser
  grant all on tables to authenticated, service_role;
alter default privileges in schema faellesrejser
  grant all on sequences to authenticated, service_role;
alter default privileges in schema faellesrejser
  grant all on routines to authenticated, service_role;
