# App Store Connect — paste checklist (iOS)

Do **not** submit until smoke-test on the production build passes.

## App Review Information

- **Demo account email:** `apple-review@sunnomad.app`
- **Demo account password:** (see chat / password manager — not stored in git)
- **Notes for reviewer:**
  - Map and weather work without login.
  - Login is optional (favourites sync, profile, account deletion).
  - Location permission is used only while using the app to center the map.
  - Account deletion: Profile → Delete account.
  - Privacy Policy: https://sunnomad.app/privacy
  - Support: hola@sunnomad.app

## Privacy Nutrition Labels (suggested)

| Data type | Linked to user | Used for tracking | Purpose |
|-----------|----------------|-------------------|---------|
| Email Address | Yes | No | App Functionality |
| Name (username / display name) | Yes | No | App Functionality |
| Precise Location | No | No | App Functionality |
| Product Interaction | Yes (after login) | No | Analytics, App Functionality |
| Crash Data | No | No | App Functionality |
| Other User Content (feedback, favourites) | Yes | No | App Functionality |

Tracking: **No** (no ATT / no advertising ID for ads).

## Listing copy — English

**Subtitle (30):** Sunny spots for road trips

**Promotional text (170, optional):** Find warmer, sunnier destinations near you — built for vanlife and spontaneous escapes.

**Description:**
SunNomad helps you find sunny places to drive to — map, weather, and destination intel for road trips and vanlife.

Browse destinations on the map, compare forecasts, and open place details with practical stay notes where available. Save favourites when you sign in so they sync across devices.

Features:
• Interactive map of sunny destinations
• Weather-aware browsing
• Optional account for favourites and profile
• Stop & Stay notes for selected places
• Light, travel-first design

Weather data by Open-Meteo. Maps by Google Maps.

Support: hola@sunnomad.app
Privacy: https://sunnomad.app/privacy
Terms: https://sunnomad.app/terms

**Keywords (100):** sun,weather,vanlife,roadtrip,camping,travel,map,forecast,camper,sunshine

**Support URL:** https://sunnomad.app
**Marketing URL:** https://sunnomad.app
**Privacy Policy URL:** https://sunnomad.app/privacy

## Listing copy — German

**Subtitle (30):** Sonnige Ziele für Roadtrips

**Promotional text:** Finde wärmere, sonnigere Ziele in deiner Nähe — für Vanlife und spontane Ausflüge.

**Description:**
SunNomad hilft dir, sonnige Orte zum Hinfahren zu finden — Karte, Wetter und Zielinfos für Roadtrips und Vanlife.

Entdecke Ziele auf der Karte, vergleiche Wettermodelle und öffne Ortsdetails mit praktischen Stay-Hinweisen, wo vorhanden. Mit Account kannst du Favourites speichern und geräteübergreifend synchronisieren.

Features:
• Interaktive Karte sonniger Ziele
• Wetterbasiertes Stöbern
• Optionaler Account für Favourites und Profil
• Stop & Stay für ausgewählte Orte
• Leichtes Travel-Design

Wetterdaten: Open-Meteo. Karten: Google Maps.

Support: hola@sunnomad.app
Datenschutz: https://sunnomad.app/privacy
Nutzungsbedingungen: https://sunnomad.app/terms

**Keywords:** Sonne,Wetter,Vanlife,Roadtrip,Camping,Reisen,Karte,Vorhersage,Wohnmobil,Sonnenschein

## Screenshots (you still need to capture)

Required sizes (typical):
- iPhone 6.7" (e.g. 15 Pro Max): 1290×2796
- iPhone 6.5" (e.g. 11 Pro Max): 1284×2778

Suggested frames (5):
1. Map with sunny markers
2. Destination detail + hero
3. Forecast / weather strip
4. Favourites
5. Profile / settings (privacy + account)

## Age Rating

Likely 4+ / no unrestricted web, no gambling. Answer questionnaires honestly (location, user-generated content = no for v1 community-off).

## Export compliance

Already `ITSAppUsesNonExemptEncryption: false` in the app — answer accordingly in ASC.
