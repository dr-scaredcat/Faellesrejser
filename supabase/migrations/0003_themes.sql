-- =========================================================================
-- Temaer: fuld farvestyring af appen, valgbar fra adminsiden
-- =========================================================================

create table faellesrejser.themes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  colors jsonb not null,
  is_default boolean not null default false,
  created_by uuid references faellesrejser.profiles(id),
  created_at timestamptz not null default now()
);

alter table faellesrejser.themes enable row level security;

create policy "Alle loggede ind kan se temaer"
  on faellesrejser.themes for select
  to authenticated
  using (true);

create policy "Kun admin kan oprette temaer"
  on faellesrejser.themes for insert
  to authenticated
  with check (exists (select 1 from faellesrejser.profiles p where p.id = auth.uid() and p.is_admin));

create policy "Kun admin kan opdatere temaer"
  on faellesrejser.themes for update
  to authenticated
  using (exists (select 1 from faellesrejser.profiles p where p.id = auth.uid() and p.is_admin));

create policy "Kun admin kan slette ikke-standard temaer"
  on faellesrejser.themes for delete
  to authenticated
  using (
    not is_default
    and exists (select 1 from faellesrejser.profiles p where p.id = auth.uid() and p.is_admin)
  );

-- Standardtema, der matcher det oprindelige design.
insert into faellesrejser.themes (name, is_default, colors) values (
  'Standard',
  true,
  '{
    "river": {
      "50": "#eef5f5", "100": "#d3e6e5", "200": "#a7cdca", "300": "#79b2ac", "400": "#4d968f",
      "500": "#2f7a73", "600": "#22615c", "700": "#1b4c48", "800": "#153a38", "900": "#0f2928"
    },
    "sand": {
      "50": "#fbf7ef", "100": "#f3e9d3", "200": "#e6d1a3", "300": "#d7b671", "400": "#c99e4a", "500": "#b6862f"
    },
    "danger": {
      "100": "#fee2e2", "500": "#ef4444", "600": "#dc2626", "700": "#b91c1c"
    },
    "surface": "#ffffff",
    "buttonTextMode": "light"
  }'::jsonb
);

-- Sæt det nye standardtema som aktivt tema.
insert into faellesrejser.admin_settings (key, value)
select 'active_theme_id', to_jsonb(id) from faellesrejser.themes where is_default = true
on conflict (key) do update set value = excluded.value;

-- Slå realtime til for admin_settings, så et temaskift slår igennem med det
-- samme hos alle brugere uden at de skal genindlæse siden.
alter publication supabase_realtime add table faellesrejser.admin_settings;
