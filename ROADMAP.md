# SunNomad Post-Launch Roadmap

## PRIO 1 — Sofort nach Launch

### getVisibleMarkers Rewrite (done already?)
- Aktuelle Phase1/2 + minDistance + grid Double-Filter Logik raus
- Sauberer viewport-basierter Ansatz
- Zoom Z7+ triggert neuen API-Call mit kleinerem Radius + höherem Limit


### Map Search mit Autocomplete
- Suchfeld auf der Karte
- Grid/Snap-to-nearest (Tap auf Karte → nächster DB-Punkt)

---

## PRIO 2 — Q3 2026

### Monetization (RevenueCat)
- IAP + AB Testing
- Paywall A: blur/teaser auf dedicated Hero Images
- Paywall B: Radius max 200km free, Datum = "Today" only free
- Pricing: €3.99/Monat, €19.99/Jahr, €34.99 Lifetime


### Stop & Stay — Erweiterungen (started, needs to be expanded)
- vehicle_warning + seasonal + intro Felder für alle Top-Destinations befüllen
- camping_link_1/2 für alle wichtigen Orte vervollständigen

### "I'm Feeling Lucky"
- 1 Ort, weighted random (attractiveness^0.6 × LOG(sunshine+1))
- JOIN weather_forecast 3-Tage-Schnitt ≥ 4h
- Radius 150–1000km, population <300k, kein PPLC/PPLX/PPLF
- SQL bereits fertig


---

## PRIO 3 — Q4 2026

### Your Sun Report
- Spotify Wrapped-Stil, jährliche Statistiken
- Shareable auf Instagram
- Hohe Viral-Potenzial für Boomer/GenX Zielgruppe

### Route Builder
- Destinations sammeln (ähnlich Favouriten)
- Reihenfolge per Drag & Drop
- Export als Wegpunkte → Google Maps / Apple Maps Deep Link
- V1: lokal AsyncStorage, kein Backend nötig

### User Profile
- vehicle_type, length, height, passengers, has_dog
- V1: AsyncStorage lokal, kein Backend
- Enables: Direct Ferries Deeplinks mit prefilled params, Höhenwarnungen, Hunde-Highlights

### Scenic Drives Feature (partly done)
- `scenic_drive_details` Tabelle: length_km, duration_hours, terrain_type[], max_elevation, road_quality, seasonal_closure, best_months[], iconic_landmark
- Prio: PCH, Going-to-the-Sun, Transfăgărășan, Grossglockner, Stelvio, Amalfi, Atlantic Road Norway


---

## PRIO 4 — Backlog / Evaluate

### Affiliate
- Direct Ferries (Prio 1, triggered by ferry_minutes)
- Pitchup/Camping.info (contextual only)
- Booking.com (Plan B only)

### Android / Web Version

### Mixpanel Analytics
- Event tracking
- hero_variant_index tracking
- Paywall conversion tracking

### AQI / Air Quality
- Open-Meteo, kein extra API-Call
- Extreme heat warning 115°F+ für US Boomer Audience


### Cluster Entity Feature
- island_id FK, place_type = 'region'
- Zoom-basierte parent/child Marker

### PAD-US Integration (US BLM Land)
- Python Script → `near_blm_land` Spalte in places
- Einmalig ausführen, analog zu terrain_type Pipeline

### Weather Heatmap Overlay

### Share Feature
- WhatsApp/Facebook mit Hero Image Preview

---

## DB Outstanding

- `ferry_minutes` Spalte befüllen (0=bridge, ≤60=easy, 61–180=doable, 181–480=effort, NULL=unknown)
- `is_island` bounding-box Updates für EU/US Inseln
- Bundesstaat in Descriptions anzeigen (US/MX/CA) — alle Länder

---

## Content Outstanding (place_content)

- Top 50 EU Vanlife Destinations: ~30 noch ohne Stay & Stop Inhalte
- Top 30 US/CA/MX: ~15 noch ohne Inhalte
- Scenic Drives (5 EU + 5 US/CA): alle noch leer
- camping_link_1/2: ~60% befüllt, 40% noch NULL

## Zitate/ Songtexte bei Wartezeiten

- Hommage an King Bücher (Hey ho, let's go)
- Irgenwo haben wir schon ne Sammlung, und zwar quotes.js, muss in claude sein, die Logik
- Zum Teil an Action abhängig, zum Beispiel bei "Feeling Lucky" Set B usw

## Push Notifications
"🌞 Málaga hitting 32°C this weekend" — für Orte in den Favourites zb. zieht Leute zurück in den Loop

## More FIlters
- filter by terrain (beach, mountains etc)
- filter by type (national park, scenic drive etc)

