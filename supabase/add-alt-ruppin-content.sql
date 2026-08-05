-- Alt Ruppin: user_search place, no place_content row → Stop & Stay card empty.
-- place_id: 57f79c78-0417-4bc7-b80c-951c9647d6ef

INSERT INTO place_content (
  place_id,
  stay_de,
  stay_en,
  fact_de,
  fact_en,
  when_de,
  when_en,
  camping_link_1,
  camping_link_2
) VALUES (
  '57f79c78-0417-4bc7-b80c-951c9647d6ef',
  E'Beste Option: Camping & Ferienpark Ruppiner See – Strom/Wasser, See-Nähe, sanitäre Anlagen
Alternative: Wohnmobilstellplatz Neuruppin (Fontane-Therme) – ca. 10 km, Entsorgung vor Ort
Freistehen: nicht erlaubt – Seenlandschaft kontrolliert, nur ausgewiesene Plätze',
  E'Best option: Camping & Ferienpark Ruppiner See – hookups, lakeside, full facilities
Alternative: Neuruppin motorhome pitch (Fontane Therme) – ~10 km, disposal on site
Freestanding: not permitted – lakeside patrolled, designated sites only',
  'Älteste Stadt Brandenburgs (1238) und Geburtsort Theodor Fontanes – gut erhaltene Altstadt direkt am Ruppiner See.',
  'Brandenburg''s oldest town (1238) and birthplace of Theodor Fontane – well-preserved old town on Lake Ruppin.',
  'Mai–September für See und Altstadt; Fontane-Fest im Sommer. Winter ruhig – Therme in Neuruppin als Ausweichziel.',
  'May–September for lake and old town; Fontane festival in summer. Quiet in winter – Fontane Therme in Neuruppin nearby.',
  'https://www.camping-ruppinersee.de/',
  NULL
)
ON CONFLICT (place_id) DO UPDATE SET
  stay_de = EXCLUDED.stay_de,
  stay_en = EXCLUDED.stay_en,
  fact_de = EXCLUDED.fact_de,
  fact_en = EXCLUDED.fact_en,
  when_de = EXCLUDED.when_de,
  when_en = EXCLUDED.when_en,
  camping_link_1 = EXCLUDED.camping_link_1,
  camping_link_2 = EXCLUDED.camping_link_2;
