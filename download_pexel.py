import argparse
import json
import os
import re
import time
import unicodedata

import requests
import psycopg2
from PIL import Image, ImageFilter, ImageEnhance, ImageStat
from io import BytesIO
from dotenv import load_dotenv

from stock_image_score import pick_from_api

load_dotenv()

# --- Config ---
PEXELS_KEY = os.getenv("PEXELS_KEY")
HEADERS = {"Authorization": PEXELS_KEY}

DB_HOST = "aws-1-eu-west-1.pooler.supabase.com"
DB_PORT = 5432
DB_NAME = "postgres"
DB_USER = "postgres.skkkoxdobvimqpfqzbdx"
DB_PASS = os.getenv("SUPABASE_DB_PASSWORD")

OUT_DIR = "pexels_output"
os.makedirs(OUT_DIR, exist_ok=True)
META_PATH = os.path.join(OUT_DIR, "meta.json")

TARGET_W, TARGET_H = 800, 1200
TARGET_KB = 80
MAX_CANDIDATES = 5       # Pexels — unlimited API, Hauptquelle
SEARCH_PER_PAGE = 80     # Pexels-Maximum — größerer Pool, gleiche Anzahl Requests

# Fallback-Modifier, wenn die Ortssuche selbst nichts liefert
MODIFIERS = {
    "city":            "cityscape",
    "medium_town":     "old town",
    "small_town":      "town",
    "village":         "village",
    "beach":           "beach coast",
    "scenic_drive":    "scenic road",
    "nature_reserve":  "nature landscape",
    "natural_park":    "nature landscape",
    "national_park":   "national park landscape",
    "natural_feature": "landscape",
    "lake":            "lake",
    "mountain":        "mountain",
}

COUNTRY_NAMES = {
    "AD": "Andorra", "AL": "Albania", "AT": "Austria", "BA": "Bosnia", "BE": "Belgium",
    "BG": "Bulgaria", "BS": "Bahamas", "BY": "Belarus", "BZ": "Belize", "CA": "Canada",
    "CH": "Switzerland", "CU": "Cuba", "CY": "Cyprus", "CZ": "Czech Republic",
    "DE": "Germany", "DK": "Denmark", "DO": "Dominican Republic", "EE": "Estonia",
    "ES": "Spain", "FI": "Finland", "FR": "France", "GB": "United Kingdom",
    "GR": "Greece", "GT": "Guatemala", "HR": "Croatia", "HT": "Haiti", "HU": "Hungary",
    "IE": "Ireland", "IS": "Iceland", "IT": "Italy", "JM": "Jamaica",
    "LI": "Liechtenstein", "LT": "Lithuania", "LU": "Luxembourg", "LV": "Latvia",
    "MA": "Morocco", "MC": "Monaco", "MD": "Moldova", "ME": "Montenegro",
    "MK": "North Macedonia", "MT": "Malta", "MX": "Mexico", "NL": "Netherlands",
    "NO": "Norway", "PL": "Poland", "PT": "Portugal", "RO": "Romania", "RS": "Serbia",
    "SE": "Sweden", "SI": "Slovenia", "SK": "Slovakia", "SM": "San Marino",
    "TN": "Tunisia", "TR": "Turkey", "UA": "Ukraine", "US": "USA",
}

# Orts-Typen, bei denen ein generisches Foto fast immer daneben liegt (im Audit
# stellten sie die große Mehrheit der Fehltreffer). Natur-Typen wie beach oder
# lake funktionieren generisch dagegen meist gut.
STRICT_TYPES = {"city", "medium_town", "small_town", "village"}

# Hardcoded extras: (search_query, image_slug, place_type)
EXTRAS = [
    ("Fehmarn beach strand", "fehmarn_de", "beach"),
]

# Länder, für die keine neuen Stock-Bilder mehr geholt werden (bestehende
# Bilder bleiben unangetastet).
SKIP_COUNTRIES = ("UA", "BY", "GT", "HN")

# Nur Orte OHNE vorhandenes Stock-Bild (pexels/unsplash) — Cast-Bilder egal
QUERY = """
SELECT p.name_en, p.country_code, p.image_slug, p.place_type
FROM places p
WHERE p.image_slug IS NOT NULL
  AND COALESCE(p.country_code, '') NOT IN %(skip)s
  AND p.name_en NOT IN ('Jackson', 'Deadwood', 'Jasper')
  AND NOT EXISTS (
    SELECT 1 FROM place_hero_images phi
    WHERE phi.place_id = p.id
      AND (phi.character = 'pexels'
           OR phi.variant = 'pexels'
           OR phi.storage_path ILIKE '%%pexels%%'
           OR phi.storage_path ILIKE '%%unspl%%')
  )
ORDER BY p.attractiveness_score DESC NULLS LAST
"""


def ascii_fold(s):
    return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii")


def name_tokens(name):
    """Signifikante Tokens des Ortsnamens für den alt-Text-Abgleich."""
    folded = ascii_fold(name.lower())
    return [t for t in re.split(r"[^a-z0-9]+", folded) if len(t) >= 3]


# Gattungswörter aus Ortsnamen — die sagen nichts über den konkreten Ort und
# stehen selten im alt-Text, dürfen also nicht mitgefordert werden.
GENERIC_NAME_WORDS = {
    "plage", "playa", "praia", "spiaggia", "plaza", "plaza", "plazhi", "strand",
    "beach", "coast", "lake", "lago", "see", "mar", "mare", "island", "isla",
    "city", "town", "village", "national", "nationalpark", "park", "route",
    "road", "saint", "sankt", "santa", "santo", "sant", "san", "port", "porto",
    "puerto", "the", "los", "las", "del", "della", "valley", "mount", "monte",
}


def mentions_place(alt_text, name):
    """True wenn der alt-Text des Fotos den Ortsnamen nennt → echtes Foto vom Ort.

    Bei mehrteiligen Namen ("Saint-Étienne-de-Montluc", "Plage de la Baule")
    würde die Forderung, dass alle Tokens im alt-Text stehen, praktisch nie
    erfüllt. Es genügt das kennzeichnende Token — lang und selten genug, um
    eindeutig zu sein. Ist keins lang genug, müssen doch alle passen.
    """
    if not alt_text:
        return False
    alt = ascii_fold(alt_text.lower())
    tokens = name_tokens(name)
    if not tokens:
        return False

    core = [t for t in tokens if t not in GENERIC_NAME_WORDS] or tokens
    # Bei gleich langen Tokens gewinnt das hintere ("...-de-Montluc").
    key = max(reversed(core), key=len)
    if len(key) >= 5:
        return key in alt
    return all(t in alt for t in core)


def load_meta():
    if os.path.exists(META_PATH):
        with open(META_PATH) as f:
            return json.load(f)
    return {}


def save_meta(meta):
    with open(META_PATH, "w") as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)


def enhance_adaptive(img):
    hsv = img.convert("HSV")
    sat_mean = ImageStat.Stat(hsv).mean[1]
    gray = img.convert("L")
    std = ImageStat.Stat(gray).stddev[0]
    stat = ImageStat.Stat(img).mean
    brightness_mean = stat[0] * 0.299 + stat[1] * 0.587 + stat[2] * 0.114

    contrast_factor   = 1.0 + max(0, (60 - std) / 60) * 0.35
    color_factor      = 1.0 + max(0, (80 - sat_mean) / 80) * 0.4
    brightness_factor = 1.0 + (128 - brightness_mean) / 128 * 0.1

    img = ImageEnhance.Contrast(img).enhance(contrast_factor)
    img = ImageEnhance.Color(img).enhance(color_factor)
    img = ImageEnhance.Brightness(img).enhance(brightness_factor)
    return img


def process_and_save(img_bytes, out_path):
    with Image.open(BytesIO(img_bytes)) as img:
        img = img.convert("RGB")
        ratio = max(TARGET_W / img.width, TARGET_H / img.height)
        new_w, new_h = int(img.width * ratio), int(img.height * ratio)
        img = img.resize((new_w, new_h), Image.LANCZOS)
        left = (new_w - TARGET_W) // 2
        top  = (new_h - TARGET_H) // 2
        img = img.crop((left, top, left + TARGET_W, top + TARGET_H))
        img = enhance_adaptive(img)
        img = img.filter(ImageFilter.UnsharpMask(radius=1, percent=80, threshold=3))

        lo, hi, mid = 10, 95, 80
        while lo < hi - 1:
            mid = (lo + hi) // 2
            img.save(out_path, "webp", quality=mid)
            size_kb = os.path.getsize(out_path) / 1024
            if size_kb > TARGET_KB * 1.2:   hi = mid
            elif size_kb < TARGET_KB * 0.8: lo = mid
            else: break

        return os.path.getsize(out_path) / 1024


def pexels_search(query, per_page=15, orientation="portrait"):
    """Gibt nie auf (außer 403 = Key kaputt). Wartet Rate-Limits einfach ab."""
    attempt = 0
    while True:
        attempt += 1
        try:
            r = requests.get(
                "https://api.pexels.com/v1/search",
                headers=HEADERS,
                params={"query": query, "orientation": orientation, "per_page": per_page},
                timeout=15
            )

            if r.status_code == 429:
                wait = _retry_after(r) or min(60 * attempt, 900)
                print(f"  Rate limit (429) -> warte {wait}s (Versuch {attempt})...")
                time.sleep(wait)
                continue

            if r.status_code == 403:
                print("  403 Forbidden - API Key Problem, stoppe.")
                return None

            if r.status_code != 200 or not r.text.strip():
                wait = min(30 * attempt, 300)
                print(f"  Status {r.status_code} -> warte {wait}s (Versuch {attempt})...")
                time.sleep(wait)
                continue

            _throttle_if_needed(r)
            return r.json().get("photos", [])

        except Exception as e:
            wait = min(15 * attempt, 300)
            print(f"  {type(e).__name__}: {e} -> retry in {wait}s (Versuch {attempt})")
            time.sleep(wait)


def _retry_after(r):
    try:
        return int(r.headers.get("Retry-After", 0)) or None
    except (TypeError, ValueError):
        return None


def _throttle_if_needed(r):
    """Pexels liefert X-Ratelimit-Remaining/-Reset — proaktiv warten statt 429 kassieren."""
    try:
        remaining = int(r.headers.get("X-Ratelimit-Remaining", 999))
        reset_ts = int(r.headers.get("X-Ratelimit-Reset", 0))
    except (TypeError, ValueError):
        return
    if remaining <= 2 and reset_ts:
        wait = max(0, reset_ts - int(time.time())) + 5
        if wait > 0:
            print(f"  Ratelimit fast erreicht (remaining={remaining}) -> warte {wait}s bis Reset...")
            time.sleep(wait)


def download_bytes(url, tries=5):
    """Bild-Download mit Retries — ein Netzwerk-Hänger kostet nicht den Kandidaten."""
    for attempt in range(1, tries + 1):
        try:
            resp = requests.get(url, timeout=30)
            resp.raise_for_status()
            return resp.content
        except Exception as e:
            if attempt == tries:
                raise
            wait = min(10 * attempt, 60)
            print(f"    Download-Retry {attempt}/{tries} in {wait}s ({type(e).__name__})")
            time.sleep(wait)


def find_candidates(name_en, country_code, place_type):
    """API-Treffer per Alt-Text ranken, nur Top 5 downloaden."""
    country = COUNTRY_NAMES.get(country_code, country_code)
    seen_ids: set = set()
    ranked: list[tuple[float, dict]] = []

    def collect(photos, query, rel_fn):
        picked = pick_from_api(
            [p for p in (photos or []) if p.get("id") not in seen_ids],
            alt_getter=lambda p: p.get("alt", ""),
            relevant_getter=rel_fn,
            place_type=place_type,
            max_pick=MAX_CANDIDATES * 2,
        )
        for photo, rel, score in picked:
            seen_ids.add(photo["id"])
            ranked.append((score, {**photo, "_relevant": rel, "_query": query}))

    def is_rel(p):
        return mentions_place(p.get("alt", ""), name_en)

    query = f"{name_en} {country}"
    photos = pexels_search(query, per_page=SEARCH_PER_PAGE)
    if photos is None:
        return None, query

    collect(photos, query, is_rel)

    # Der Großteil der Reisefotos liegt im Querformat. Erst nachladen, wenn im
    # Hochformat kein Foto den Ort nennt — process_and_save beschneidet ohnehin.
    if not any(p.get("_relevant") for _, p in ranked):
        wide = pexels_search(query, per_page=SEARCH_PER_PAGE, orientation="landscape")
        if wide is None:
            return None, query
        collect(wide, query, is_rel)

    if len(ranked) < 2:
        modifier = MODIFIERS.get(place_type, "")
        fb_query = f"{name_en} {modifier}".strip()
        fb_photos = pexels_search(fb_query, per_page=SEARCH_PER_PAGE)
        if fb_photos is None:
            return None, fb_query
        collect(fb_photos, fb_query, lambda _p: False)

    ranked.sort(key=lambda x: -x[0])
    pool = [p for _, p in ranked[:MAX_CANDIDATES]]
    query_used = pool[0]["_query"] if pool else query
    return pool, query_used


def process_place(i, name_en, country_code, image_slug, place_type, meta, relevant_only=False):
    all_exist = all(
        os.path.exists(os.path.join(OUT_DIR, f"{image_slug}_pexels_{n}.webp"))
        for n in range(1, MAX_CANDIDATES + 1)
    )
    if all_exist:
        print(f"[{i:4}] SKIP: {image_slug}")
        return "skip"

    result = find_candidates(name_en, country_code, place_type)

    if result is None:
        return None  # hard stop

    photos, query = result
    if not photos:
        print(f"[{i:4}] NOT FOUND: {query}")
        return "not_found"

    any_relevant = any(p.get("_relevant") for p in photos)

    # Refill-Modus: bei Städten/Dörfern lieber gar kein Bild als ein generisches,
    # das den Ort nicht zeigt — der Ort bleibt dann beim generischen Hero.
    if relevant_only and place_type in STRICT_TYPES:
        photos = [p for p in photos if p.get("_relevant")]
        if not photos:
            print(f"[{i:4}] KEIN TREFFER (nur generisch): {query}")
            return "no_relevant"
    for n, photo in enumerate(photos, 1):
        fname    = f"{image_slug}_pexels_{n}.webp"
        out_path = os.path.join(OUT_DIR, fname)

        if os.path.exists(out_path):
            print(f"[{i:4}]   SKIP: {fname}")
            continue

        is_rel = photo.get("_relevant", False)
        tag = "REL" if is_rel else "gen"
        try:
            img_bytes = download_bytes(photo["src"]["large2x"])
            size_kb   = process_and_save(img_bytes, out_path)
            meta[fname] = {
                "relevant": is_rel,
                "alt": photo.get("alt", ""),
                "place_type": place_type,
                "query": query,
            }
            print(f"[{i:4}]   ok [{tag}] {fname} ({size_kb:.0f}kb) ['{query}']")
        except Exception as e:
            print(f"[{i:4}]   ERROR {fname}: {e}")

    return "ok" if any_relevant else "generic"


# --- Main ---
parser = argparse.ArgumentParser()
parser.add_argument("--limit", type=int, default=1000,
                    help="So viele NEUE Orte bearbeiten (lokal vorhandene/not-found zählen nicht)")
parser.add_argument("--retry-not-found", action="store_true",
                    help="Auch Orte erneut versuchen, die früher NOT FOUND waren")
parser.add_argument("--relevant-only", action="store_true",
                    help="Bei Städten/Dörfern nur Fotos laden, deren Alt-Text den "
                         "Ortsnamen nennt; Natur-Typen bleiben generisch erlaubt")
parser.add_argument("--slugs", metavar="DATEI",
                    help="Nur die image_slugs aus dieser Datei bearbeiten "
                         "(eine pro Zeile), statt aller Orte ohne Stock-Bild")
args = parser.parse_args()

slug_filter = None
if args.slugs:
    with open(args.slugs) as f:
        slug_filter = {line.strip() for line in f if line.strip()}
    print(f"Slug-Filter: {len(slug_filter)} Orte aus {args.slugs}")

conn = psycopg2.connect(host=DB_HOST, port=DB_PORT, dbname=DB_NAME,
                        user=DB_USER, password=DB_PASS)
cur = conn.cursor()
cur.execute(QUERY, {"skip": SKIP_COUNTRIES})
rows = cur.fetchall()
conn.close()

meta = load_meta()
not_found_slugs = set(meta.get("_not_found", []))
no_relevant_slugs = set(meta.get("_no_relevant", []))

from pexels_blacklist import load_blacklist
blacklisted = load_blacklist()
if blacklisted:
    print(f"Permanente Blacklist: {len(blacklisted)} Slugs (werden übersprungen)")

# Schon bearbeitete Orte zählen nicht gegen --limit:
# lokale Kandidaten vorhanden, als NOT FOUND gemerkt, oder (im --relevant-only
# Modus) schon ohne echten Treffer geprüft — sonst wählt die nach Attraktivität
# sortierte Query bei jedem Lauf wieder dieselben (erfolglosen) Top-Orte.
total_db = len(rows)
if slug_filter is not None:
    rows = [r for r in rows if r[2] in slug_filter]
    fehlend = slug_filter - {r[2] for r in rows}
    if fehlend:
        print(f"  {len(fehlend)} Slugs nicht in der DB-Auswahl (z.B. Skip-Land "
              f"oder Bild noch vorhanden): {', '.join(sorted(fehlend)[:5])} ...")
rows = [
    r for r in rows
    if r[2] not in blacklisted
    and not os.path.exists(os.path.join(OUT_DIR, f"{r[2]}_pexels_1.webp"))
    and (args.retry_not_found or r[2] not in not_found_slugs)
    and (args.retry_not_found or r[2] not in no_relevant_slugs)
]
rows = rows[: args.limit]
print(f"{total_db} Orte ohne Stock-Bild in DB, davon {len(rows)} neu zu bearbeiten + {len(EXTRAS)} extras\n")

ok, generic, skip, not_found, no_relevant = 0, 0, 0, 0, 0

try:
    for i, (name_en, country_code, image_slug, place_type) in enumerate(rows, 1):
        result = process_place(i, name_en, country_code, image_slug, place_type, meta,
                               relevant_only=args.relevant_only)

        if result is None:
            print("Hard stop.")
            break
        elif result == "skip":      skip += 1
        elif result == "not_found":
            not_found += 1
            if image_slug not in not_found_slugs:
                not_found_slugs.add(image_slug)
                meta.setdefault("_not_found", []).append(image_slug)
        elif result == "generic":   generic += 1
        elif result == "no_relevant":
            no_relevant += 1
            if image_slug not in no_relevant_slugs:
                no_relevant_slugs.add(image_slug)
                meta.setdefault("_no_relevant", []).append(image_slug)
        else:                       ok += 1

        if i % 25 == 0:
            save_meta(meta)
        time.sleep(0.5)

    # --- Extras ---
    extras = [] if slug_filter is not None else EXTRAS
    if extras:
        print("\n--- Extras ---")
    for j, (query, image_slug, place_type) in enumerate(extras, 1):
        photos = pexels_search(query, per_page=5)
        if photos:
            for n, photo in enumerate(photos[:MAX_CANDIDATES], 1):
                fname = f"{image_slug}_pexels_{n}.webp"
                out_path = os.path.join(OUT_DIR, fname)
                if os.path.exists(out_path):
                    continue
                try:
                    img_bytes = download_bytes(photo["src"]["large2x"])
                    process_and_save(img_bytes, out_path)
                    meta[fname] = {"relevant": True, "alt": photo.get("alt", ""),
                                   "place_type": place_type, "query": query}
                    print(f"[E{j}]   ok {fname}")
                except Exception as e:
                    print(f"[E{j}]   ERROR {fname}: {e}")
        time.sleep(0.5)
finally:
    save_meta(meta)

print(f"\nFertig: {ok} relevant / {generic} generic / {skip} skipped / "
      f"{not_found} not found / {no_relevant} ohne echten Treffer (gemerkt, "
      f"nächster Lauf macht bei den nächsten Orten weiter)")
