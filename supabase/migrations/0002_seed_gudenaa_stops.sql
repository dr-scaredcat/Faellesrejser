-- =========================================================================
-- Seed: Overnatningssteder langs Gudenåen (fra "Data ark")
-- distance_from_previous_km og sail_time_hours er afstand/tid fra FORRIGE stop.
-- =========================================================================

insert into faellesrejser.gudenaa_stops (name, sort_order, distance_from_previous_km, sail_time_hours) values
  ('Tørring Camping', 1, 0, 0),
  ('Åle Teltplads', 2, 10, 3.5),
  ('Åstedbro Teltplads', 3, 4, 1),
  ('Gudenå Camping Brestenbro', 4, 7, 2),
  ('Vestbirk Camping', 5, 7, 2),
  ('Voervadsbro Teltplads', 6, 6, 1.5),
  ('Klostermølle Teltplads', 7, 6, 1.5),
  ('Gammel Rye Teltplads', 8, 3, 1),
  ('Emborg Bro', 9, 1.5, 0.5),
  ('Holmens Camping', 10, 4.5, 1.5),
  ('Ry / Skimminghøj Teltplads', 11, 2, 0.75),
  ('Alling Vest Teltplads', 12, 2, 0.5),
  ('Ludvigslyst/Skyttehusets Outdoor Camp', 13, 8, 2.5),
  ('De Små Fisk Teltplads', 14, 5, 1.5),
  ('Indelukket/Ly Outdoor Camp', 15, 2, 0.5),
  ('Silkeborg Havn/Silkeborg Kanocenter', 16, 2, 0.5),
  ('Silkeborg Sø Camping', 17, 2, 0.5),
  ('Sminge Rasteplads/Sminge Teltplads', 18, 9, 2.5),
  ('Svostrup Kro', 19, 0.8, 0.25),
  ('Tvilum Kirke', 20, 3, 0.5),
  ('Søhøjlandets Camping', 21, 5, 1),
  ('Kongensbro Teltplads', 22, 2, 0.5),
  ('Ans Teltplads', 23, 8, 2.5),
  ('Tangeværket / Energimuseet', 24, 6, 2.5),
  ('Bjerringbro Rasteplads', 25, 3, 1),
  ('Kjællinghøl Teltplads', 26, 2, 0.5),
  ('Bamsebo Camping', 27, 6, 2),
  ('Ulstrup / Dannebrogpladsen', 28, 2, 0.5),
  ('Langå Camping', 29, 9, 2.5),
  ('Johannesberg Lejr- og Shelterplads', 30, 3, 1),
  ('Fladbro Rasteplads/Randers City Camp', 31, 6, 2);

-- Eksempel-tags baseret på stedernes navne (camping/kro/rasteplads antyder faciliteter).
-- Kan frit redigeres senere fra adminsiden.
insert into faellesrejser.gudenaa_stop_tags (stop_id, tag)
select id, 'Toilet' from faellesrejser.gudenaa_stops where name ilike '%camping%';
insert into faellesrejser.gudenaa_stop_tags (stop_id, tag)
select id, 'Bad' from faellesrejser.gudenaa_stops where name ilike '%camping%';
insert into faellesrejser.gudenaa_stop_tags (stop_id, tag)
select id, 'Café/Restaurant' from faellesrejser.gudenaa_stops where name ilike '%kro%';
