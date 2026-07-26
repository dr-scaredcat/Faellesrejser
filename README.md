# Fællesrejser

Webapp til at planlægge fællesrejser med venner: medlemmer, pakkeliste, rejseplan,
regnskab, kørsel — og et særligt modul til kanoture på Gudenåen (ruteplanlægger,
statistik og sejltider).

Bygget med **React + TypeScript + Vite + Tailwind** og **Supabase** som backend
(database, auth, Row Level Security).

## 1. Sæt Supabase op

Appen bruger sit eget database-schema, **`faellesrejser`**, i stedet for `public` —
så I trygt kan have flere apps i samme Supabase-projekt uden at data blandes sammen.

1. Åbn dit Supabase-projekt → **SQL Editor**.
2. Kør migrationerne i rækkefølge (de opretter selv `faellesrejser`-schemaet):
   - `supabase/migrations/0001_init.sql` (opretter schema, alle tabeller, RLS-policies mm.)
   - `supabase/migrations/0002_seed_gudenaa_stops.sql` (indsætter de 31 overnatningssteder fra jeres datark)
   - `supabase/migrations/0003_themes.sql` (opretter temamodul + standardtema, og slår Realtime til for temaskift)
3. **Vigtigt:** Under **Settings → API → Exposed schemas**, tilføj `faellesrejser` til listen
   (den indeholder som udgangspunkt kun `public` og `graphql_public`). Uden dette kan appen
   ikke tilgå sine tabeller via Supabases API.
4. Under **Authentication → Providers**, sørg for at "Email" er slået til.
   Du kan slå email-bekræftelse fra under **Authentication → Settings**, hvis I vil
   kunne logge ind med det samme efter oprettelse (praktisk til en lille vennegruppe).
5. Under **Project Settings → API**, kopiér "Project URL" og "anon public" key.

Den allerførste bruger der opretter sig **i denne app**, bliver automatisk admin — det
tælles ud fra `faellesrejser.profiles`, så det er upåvirket af brugere i jeres andre app.

> **Bemærk om delte brugerkonti:** Supabase Auth (login/adgangskoder) er fælles for hele
> projektet og hører ikke til noget bestemt schema. Hvis nogen allerede har oprettet en
> konto i jeres anden app med samme email, kan de logge ind her med samme adgangskode —
> men de får en helt ny, tom profil specifikt til denne app, og ser ingen data fra den
> anden app. Selve rejse-/bruger-*dataen* er fuldt adskilt; kun konto/login er fælles.

## 2. Kør lokalt

```bash
npm install
cp .env.example .env
# udfyld .env med jeres Supabase-URL og anon key
npm run dev
```

Appen kører herefter på http://localhost:5173

## 3. Deploy til Cloudflare Pages

1. Push dette repository til GitHub.
2. I Cloudflare dashboard: **Workers & Pages → Create → Pages → Connect to Git**.
3. Vælg repositoriet. Byggeindstillinger:
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
4. Under **Settings → Environment variables**, tilføj:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
5. Deploy. Cloudflare bygger og hoster automatisk ved fremtidige pushes til main-branchen.

`public/_redirects` sørger for at alle sider (fx `/rejser/123/pakkeliste`) virker
korrekt ved genindlæsning, da det er en single-page app.

## Projektstruktur

```
supabase/migrations/     SQL-skema og seed-data til Supabase
src/lib/                 Supabase-klient, typer, statistik- og gældsberegning
src/context/              Auth- og rejse-context (deles mellem sider)
src/pages/                Alle sider, inkl. undermappen gudenaa/ til Gudenå-specifikke sider
src/components/           Delte UI-komponenter (nav, route guards)
```

## Noter om forretningslogik

- **RLS**: Al adgangskontrol ligger i databasen (Row Level Security), ikke kun i
  frontend'en — så selv hvis nogen kalder Supabase API'et direkte, kan de kun se
  rejser de er inviteret til.
- **Regnskab**: Udgifter deles ligeligt mellem de valgte deltagere. "Hvem skylder
  hvem" beregnes med en grådig algoritme der minimerer antallet af overførsler,
  og kan vises grupperet pr. person eller pr. par.
- **Gudenå-estimater**: Historisk gennemsnitsfart beregnes ud fra alle loggede
  sejltider på tværs af alle Gudenå-ture, med 95%-konfidensintervaller baseret på
  t-fordelingen (se `src/lib/stats.ts`).
- **Temaer**: Alle farver i appen styres via CSS-variabler (se `src/index.css` og
  `tailwind.config.js`), som opdateres fra det aktive tema i databasen (`themes`-tabellen).
  Fra adminsiden kan man oprette nye temaer med fuld kontrol over alle nuancer, se en
  live mockup mens man redigerer, og aktivere et tema — det slår igennem med det samme
  for alle brugere via Supabase Realtime, uden at nogen skal genindlæse siden.
- **Schema-adskillelse**: Alle tabeller ligger i `faellesrejser`-schemaet i stedet for
  `public`, så flere apps kan dele samme Supabase-projekt uden at data blandes sammen.
  Supabase-klienten er sat op til dette i `src/lib/supabase.ts` (`db: { schema: 'faellesrejser' }`).
  Vil I omdøbe schemaet, skal I finde/erstatte `faellesrejser` i migrationerne samt i
  `src/lib/supabase.ts` og `src/context/ThemeContext.tsx`.
