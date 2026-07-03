# SunNomad Roadmap

Stand: Juni 2026 · Fokus 2026: testen, stabilisieren, Discovery — **kein Paywall dieses Jahr**

---

## ✅ Done

| Feature | Notizen |
|---------|---------|
| TestFlight / Beta | EAS, iOS native, Production-Builds |
| Map Search + Autocomplete | `hybridSearchService.js`, inline in MapScreen |
| Snap-to-nearest | Tap → `nearest_place` RPC → Detail |
| Stop & Stay UI | intro, vehicle_warning, seasonal, camping_links |
| Favourites | CRUD, Map-Pins, Supabase-Sync |
| Auth + Basic Profile | Login, username, radius, theme, language |
| Date Picker | Today → +10 Tage |
| Warm / Cold / All Mode | reverseMode |
| Onboarding (Goldie) | 4 Steps |
| Hero Images CDN | dedicated + generic aus Supabase |
| Mixpanel (Basis) | ~15 Events |
| Detail Screen | Drive there, Hero expand, state_name |
| Hero Image Pipeline | `generate_hero_images.py`, `--goldie-only`, Cast-Chars |

---

## 🔴 PRIO 1 — Jetzt (Beta-Phase)

| # | Task | Aufwand |
|---|------|---------|
| 1.1 | **getVisibleMarkers Rewrite** + Z7+ API-Refetch — Grid/Double-Filter raus, viewport-basiert | 2–3 Tage |
| 1.2 | **Bugfixes aus Beta-Feedback** | laufend |
| 1.3 | **Mixpanel Lücken** — hero_variant_index, user identify on login | 0.5 Tag |

---

## 🟠 PRIO 2 — Aug/Sep 2026

| # | Task | Aufwand |
|---|------|---------|
| 2.1 | **I'm Feeling Lucky** — weighted random, weather JOIN, RPC + UI (SQL neu schreiben, war nicht im Repo) | 3–5 Tage |
| 2.2 | **Stop & Stay Content** — Top-Destinations befüllen | parallel |
| 2.3 | **camping_link_1/2** auf ~90% | Content |
| 2.4 | **Terrain + Place-Type Filter** — beach, mountains, national park, scenic drive etc. | 2–3 Tage |

### I'm Feeling Lucky — Spec
- 1 Ort, weighted random (attractiveness^0.6 × LOG(sunshine+1))
- JOIN weather_forecast 3-Tage-Schnitt ≥ 4h
- Radius 150–1000km, population <300k, kein PPLC/PPLX/PPLF

---

## 🟡 PRIO 3 — Q4 2026

| # | Task | Aufwand |
|---|------|---------|
| 3.1 | **Route Builder** — Drag & Drop, Maps-Export, AsyncStorage V1 | 1 Woche |
| 3.2 | **User Profile Van-Felder** — vehicle, length, height, passengers, has_dog | 3–4 Tage |
| 3.3 | **Scenic Drives Detail-UI** + `scenic_drive_details` Tabelle | 1 Woche |
| 3.4 | **regional_content** — Stellplatzrecht, Jedermansrecht etc. | 3–4 Tage |
| 3.5 | **Feeling Lucky Nerfs** — „Seriously?“, „Goldie wählt“, „Letzte Chance“, „Völlig egal“ | 1–2 Tage |
| 3.6 | **Share Feature** — WhatsApp/Facebook mit Hero Preview | 3–5 Tage |
| 3.7 | **Hero Image Mode Picker** — Settings-Toggle, `getHeroImage` filtert nach `variant` | 2–3 Tage |

### Scenic Drives — Prio-Routen
PCH, Going-to-the-Sun, Transfăgărășan, Grossglockner, Stelvio, Amalfi, Atlantic Road Norway

### Hero Image Mode — Optionen
- Goldie Edition (only Goldies)
- Goldie Madness (everyone → Goldie)
- female / male edition
- no people · mixed (default) · naughty

### regional_content — Schema
```sql
CREATE TABLE regional_content (
    id              SERIAL PRIMARY KEY,
    scope_type      TEXT NOT NULL,  -- 'country' | 'region'
    scope_key       TEXT NOT NULL,  -- 'AL', 'PT', 'SE' | 'PT-08' (Algarve ISO)
    lang            TEXT NOT NULL,  -- 'en' | 'de' | 'fr'
    content_type    TEXT NOT NULL,  -- 'stay' | 'fact' | 'avoid' | 'when'
    text            TEXT NOT NULL,
    UNIQUE (scope_type, scope_key, lang, content_type)
);
```

---

## ⏸ On Hold

| Task | Grund |
|------|-------|
| **quotes.js / App Copy** | Konzept offen — Sets, Trigger, action-abhängig (siehe Copy-Sammlungen unten) |
| **Paywall / RevenueCat** | Erst 2027 — IAP, blur/teaser, Radius 200km / Today-only free, €3.99/€19.99/€34.99 |

---

## 📦 2027+ Backlog

| Task | Notizen |
|------|---------|
| Push Notifications | Favourites + Wochenend-Wetter |
| Your Sun Report | Spotify Wrapped-Stil, Instagram-shareable |
| Affiliate | Direct Ferries (ferry_minutes), Pitchup, Booking.com |
| AQI / Air Quality | Open-Meteo, 115°F+ US warning |
| Cluster Entity | island_id FK, place_type = region, zoom parent/child |
| PAD-US / near_blm_land | Python Script, einmalig |
| Weather Heatmap Overlay | Evaluate |
| lightweight CMS | Content im Browser statt DB |
| Android / Web | Evaluate |
| Historic Sites | battlegrounds, temples — DB-Insert |
| Weekend Escape Generator | Berlin, 5h, Van, Sonne → komplette Route |
| Community Tab | Stub „Coming Soon“ im Code |

---

## 🗄 Parallel — Content / DB (laufend)

| Task | Status |
|------|--------|
| Top 50 EU ohne Stop & Stay | ~30 offen |
| Top 30 US/CA/MX ohne Inhalt | ~15 offen |
| Scenic Drives Stop & Stay (5 EU + 5 US/CA) | alle leer |
| camping_link_1/2 | ~40% NULL |
| `ferry_minutes` befüllen | 0=bridge, ≤60=easy, 61–180=doable, 181–480=effort |
| `is_island` bounding-box EU/US | offen |
| Bundesstaat/Region in Descriptions | Detail done, Content alle Länder offen |
| Goldie Käffer | 1–2 Assets da, noch nicht verlinkt |

### Content Polish
- Ton vereinheitlichen
- intro, vehicle info kürzen/vereinheitlichen
- links für camping ergänzen
- stadtgebühren?
- übersetzungen weniger schrottig

---

## 📅 Zeitplan 2026

```
Jun–Jul 2026          Aug–Sep 2026          Q4 2026
────────────────────────────────────────────────────
[Markers Rewrite  ]
[Beta Bugfixes────→]
[Mixpanel         ]
                      [Feeling Lucky──]
                      [Content fill──────────→]
                      [Filters──]
                                            [Route Builder──]
                                            [Van Profile──]
                                            [Scenic Drives──]
                                            [regional_content──]
                                            [Share + Hero Mode──]
```

---

## 🎭 Personality & Viral Layer

*Nach PRIO 3 oder 2027 — kein Backend, größtenteils Copy + AsyncStorage*

### Core Vibe
- Goldie-Reaktionen je nach Wetter am Standort
- Bissige/witzige Copy überall (nicht nur Descriptions)

### „Zeig ich meinem Freund"-Features
- **Weather Shame** — Kommentar wenn Heimat-Wetter mies ist
- **Random Roast** — inaktivitäts-triggered
- **Fake Achievements** — absurd, selbstironisch
- **Naughty hidden text** — nur für die die weit scrollen

### Easter Eggs
- Geheime Locations — kein Filter, kein SEO, nur Zufall
- „Absurd weit"-Modus in I'm Feeling Lucky (Kirgisistan etc.)

### Viral Sharing (extra zu Share Feature PRIO 3)
- Retro-Reisepass Screenshot/Share
- „Das hättest du gewusst" — Post-Trip Wetter-Vergleich

### Gamification Paket (~1–2 Tage total, kein Backend)
| Feature | Aufwand | Beschreibung |
|---------|---------|--------------|
| Mission Unlocked | ~0.5 Tage | GTA-Persiflage, 3+ Spots gleiche Region, 15–20 Missions JSON |
| Ironic Badges | ~0.5 Tage | „Wrong Season Champion", „Certified Sun Chaser" |
| Fake Level System | ~2h | Level 1: „Sun Chaser" → Level 2: „Still a Sun Chaser" |
| Ironic Streak | ~2h | „Day 3 of looking for sun. Still haven't left the couch." |

---

## 🔍 Erweiterte Filter (nach PRIO 2.4)

- **by badge** — avoid heatwave, long rain, weather curse
- **by streak** — n days of sun, max n days rain (Slider?)
- **by territory** — cities, scenic drives, natural parks

---

## 🎨 Hero / Content-Strategie (Pipeline, kein App-Code)

### roadtrip multiverse — Stammbesetzung
- Goldie — roter Faden, nie im Vordergrund
- Der Retro-RV — Hintergrund, manchmal halb sichtbar
- 4–7 wiederkehrende Frauen — gleicher Style, nie namentlich
- Nebencharaktere: crypto bro, surfer dude, burner out
- Der namenlose Fahrer — nur Hände am Steuer, nie Gesicht

### time & saison dynamic hero images
- Discovery lore durch recurring motifs, rare heroes, expand-mode
- time-based mood variation (night/golden-hour pools)
- emotional travel realism: rain, fog, neon motels, ferries, empty roads, wind, exhaustion, freedom

---

## 💬 Copy-Sammlungen (On Hold — Konzept offen)

*Rohmaterial für quotes.js — action-abhängige Sets, z.B. Feeling Lucky Set B*

### Startup
- „Trained on 10 trillion tokens to tell you it's sunny in Spain. Cool."
- „No VC funding was harmed in making this app."
- „Series A not secured. Sun is."
- „Built by a human. Supervised by a dog."

### Loading / Search
- „Asking the algorithm which beach is prettiest… it said Malibu. We ignored it."
- „Querying 47 neural networks… just kidding. It's a SQL query."
- „ChatGPT would've suggested Paris."
- „Fetching weather data. Not your data. Chill."
- „Scanning for hidden gems before someone blogs about them."
- „No dark patterns loading. Just weather."
- „Checking if your ex is already there…"

### No Results
- „Even we're surprised. Try a bigger radius."
- „The algorithm is also sad."
- „Detroit in February vibes. Move the map."

### Daily One-Liner
- „Today's challenge: find somewhere warmer than your ex's personality."

### Profound Travel Insights™
- „No matter how far you travel, you'll still be you. Sorry."
- „Sunsets don't fix anything. But they help."
- „The wifi is worse here. You'll be fine."
- „This place won't change your life. Go anyway."
- „Nobody back home cares. Post it anyway."
- „You are not a digital nomad. You are a person with a laptop on a beach."

### Confessions of a Vibe Coder™
- „Update 1.0.4: fixed a bug Apple found. Introduced a bug Apple hasn't found yet."
- „I don't write code. I write prompts and pray."
- „This app works. I don't know why. I'm not asking."
- „There are no senior devs to ask. There is only the void. And Claude."
- „Annual performance review: Goldie gave me 4 paws out of 4. I'll take it."

### Hommage
- King Bücher (Hey ho, let's go) — bei Wartezeiten / Feeling Lucky

---

- Goldie Edition (only Goldies!)
- Goldie Madness (everyone turned into Goldie!)
- female edition
- male edition
- no people 
- mixed
- naugthy!

## insert historic sites
-- battle gorunds etc, temples

## moe filters
-- by badge: avoid: heatwave, long rain, weather vurse usw
-- by streak: n days of sun, max n days auf rain etc, maybe via sliders?
-- territory/ places: cities, scenic drives, natural parks etc

## add blobs

- merge regions etc to blobs
- can be small like islabd
- or bigger, certain regions, like algarve, or just lgarve beaches etc
- tap and expand


## newsfeed
-- alerts on weather, disatsers (fires, heatwaves, earth quakes etc)
-- maybe also price alerts on fuel? 
-- warning on traffic etc, also school holidays etc
 -- first not real time, maybe 1x day update
 -- dynamic, resposive on current radius/ region

 -- other messages: fuel prices, reminder for tools
 

 ## neuer trophy / award / badge: escape the heat
- escape the heat
 - current loc hotter than x (30 degs)
 - x cooler than current location
 - needs to by cooler by x for y days
 - (prob needs more mountains)

## overhaul hot / cool modes - done!
- wording: instead of best day, coolest or warmest day
- no heatwave places in cool mode, or only if x degs cooler
- while fetchinf data, conext image (goldie hot/ SPRING)

## chapters/ specials

-- bestimmte regionen
-- zum beispiel greek mythologie, ww1/ww2 spots, wüstenregionen usw

## promos

-- promos, z.b. july 4th (best of us, oder top national parks ...), halloween (castle rock etc), 
-- button mit den shortcuts zu markern, ja mach pronmo. können einzelne orte oder collections sein.
-- button oben rechts, mit history der der promos, evtl auto grey out/ delete after x days



