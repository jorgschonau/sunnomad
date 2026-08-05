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
UNSPLASH_KEY = os.getenv("UNSPLASH_KEY")
HEADERS = {"Authorization": f"Client-ID {UNSPLASH_KEY}"}

DB_HOST = "aws-1-eu-west-1.pooler.supabase.com"
DB_PORT = 5432
DB_NAME = "postgres"
DB_USER = "postgres.skkkoxdobvimqpfqzbdx"
DB_PASS = os.getenv("SUPABASE_DB_PASSWORD")

OUT_DIR = "unsplash_output"
os.makedirs(OUT_DIR, exist_ok=True)
META_PATH = os.path.join(OUT_DIR, "meta.json")

TARGET_W, TARGET_H = 800, 1200
TARGET_KB = 80
MAX_CANDIDATES = 3       # Unsplash — 50 req/h, nur Ergänzung zu Pexels
SEARCH_PER_PAGE = 15

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
    folded = ascii_fold(name.lower())
    return [t for t in re.split(r"[^a-z0-9]+", folded) if len(t) >= 3]


def mentions_place(text, name):
    if not text:
        return False
    blob = ascii_fold(text.lower())
    tokens = name_tokens(name)
    if not tokens:
        return False
    return all(t in blob for t in tokens)


def photo_relevance(photo, name_en):
    """True wenn Beschreibung/alt/Tags/Location den Ortsnamen nennen."""
    parts = [
        photo.get("description") or "",
        photo.get("alt_description") or "",
        " ".join(t.get("title", "") for t in (photo.get("tags") or [])),
    ]
    return mentions_place(" ".join(parts), name_en)


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


# --- Stunden-Pacing: Unsplash free = 50 Requests/h. Wir bleiben bei 45 und
# --- warten dann bis das Fenster um ist, statt 429er zu kassieren.
HOURLY_BUDGET = 45
_window_start = None
_window_requests = 0


def _pace_hourly():
    global _window_start, _window_requests
    now = time.time()
    if _window_start is None or now - _window_start >= 3600:
        _window_start = now
        _window_requests = 0
    if _window_requests >= HOURLY_BUDGET:
        wait = int(3600 - (now - _window_start)) + 10
        print(f"  Stunden-Budget ({HOURLY_BUDGET} Requests) aufgebraucht -> warte {wait}s ({wait // 60}min)...")
        time.sleep(wait)
        _window_start = time.time()
        _window_requests = 0
    _window_requests += 1


def unsplash_search(name_en, country_code):
    """Gibt nie auf (außer 403 = Key kaputt). Pacing + Rate-Limits abwarten."""
    country = COUNTRY_NAMES.get(country_code, country_code)
    attempt = 0
    while True:
        attempt += 1
        _pace_hourly()
        try:
            r = requests.get(
                "https://api.unsplash.com/search/photos",
                headers=HEADERS,
                params={"query": f"{name_en} {country}", "orientation": "portrait", "per_page": SEARCH_PER_PAGE},
                timeout=15
            )

            if r.status_code == 429:
                wait = _retry_after(r) or min(300 * attempt, 1800)
                print(f"  Rate limit (429) -> warte {wait}s ({wait // 60}min, Versuch {attempt})...")
                time.sleep(wait)
                continue

            if r.status_code == 403:
                # Unsplash schickt bei erschöpftem Kontingent teils 403 statt 429
                body = (r.text or "").lower()
                if "rate limit" in body:
                    print(f"  403 Rate Limit -> warte 600s (Versuch {attempt})...")
                    time.sleep(600)
                    continue
                print("  403 Forbidden - API Key Problem, stoppe.")
                return None  # hard stop signal

            if r.status_code != 200 or not r.text.strip():
                wait = min(60 * attempt, 600)
                print(f"  Status {r.status_code} -> warte {wait}s (Versuch {attempt})...")
                time.sleep(wait)
                continue

            return r.json().get("results", [])

        except Exception as e:
            wait = min(15 * attempt, 300)
            print(f"  {type(e).__name__}: {e} -> retry in {wait}s (Versuch {attempt})")
            time.sleep(wait)


def _retry_after(r):
    try:
        return int(r.headers.get("Retry-After", 0)) or None
    except (TypeError, ValueError):
        return None


def download_bytes(url, tries=5):
    """Bild-Download mit Retries — zählt nicht gegen das API-Limit (CDN)."""
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


# --- Main ---
parser = argparse.ArgumentParser()
parser.add_argument("--limit", type=int, default=1000,
                    help="So viele NEUE Orte bearbeiten (lokal vorhandene/not-found zählen nicht)")
parser.add_argument("--retry-not-found", action="store_true",
                    help="Auch Orte erneut versuchen, die früher NOT FOUND waren")
parser.add_argument("--only-missing", action="store_true",
                    help="Nur Orte, für die Pexels nichts geliefert hat (kein Kandidat in pexels_output/)")
args = parser.parse_args()

conn = psycopg2.connect(host=DB_HOST, port=DB_PORT, dbname=DB_NAME,
                        user=DB_USER, password=DB_PASS)
cur = conn.cursor()
cur.execute(QUERY, {"skip": SKIP_COUNTRIES})
rows = cur.fetchall()
conn.close()

meta = load_meta()
not_found_slugs = set(meta.get("_not_found", []))

from pexels_blacklist import load_blacklist
blacklisted = load_blacklist()
if blacklisted:
    print(f"Permanente Blacklist: {len(blacklisted)} Slugs (werden übersprungen)")

total_db = len(rows)
rows = [
    r for r in rows
    if r[2] not in blacklisted
    and not os.path.exists(os.path.join(OUT_DIR, f"{r[2]}_unspl_1.webp"))
    and (args.retry_not_found or r[2] not in not_found_slugs)
]
if args.only_missing:
    before = len(rows)
    rows = [
        r for r in rows
        if not os.path.exists(os.path.join("pexels_output", f"{r[2]}_pexels_1.webp"))
    ]
    print(f"--only-missing: {before - len(rows)} Orte mit Pexels-Kandidaten übersprungen")
rows = rows[: args.limit]
print(f"{total_db} Orte ohne Stock-Bild in DB, davon {len(rows)} neu zu bearbeiten\n")

ok, generic, skip, not_found, err = 0, 0, 0, 0, 0

try:
    for i, (name_en, country_code, image_slug, place_type) in enumerate(rows, 1):
        all_exist = all(
            os.path.exists(os.path.join(OUT_DIR, f"{image_slug}_unspl_{n}.webp"))
            for n in range(1, MAX_CANDIDATES + 1)
        )
        if all_exist:
            print(f"[{i:4}] SKIP: {image_slug}")
            skip += 1
            continue

        results = unsplash_search(name_en, country_code)

        if results is None:
            print("Hard stop.")
            break

        if not results:
            print(f"[{i:4}] NOT FOUND: {name_en} ({country_code})")
            not_found += 1
            if image_slug not in not_found_slugs:
                not_found_slugs.add(image_slug)
                meta.setdefault("_not_found", []).append(image_slug)
            time.sleep(2)
            continue

        alt_getter = lambda p: p.get("description") or p.get("alt_description") or ""
        pool = pick_from_api(
            results,
            alt_getter=alt_getter,
            relevant_getter=lambda p: photo_relevance(p, name_en),
            place_type=place_type,
            max_pick=MAX_CANDIDATES,
        )

        downloaded = 0
        for n, (photo, is_rel, _score) in enumerate(pool, 1):
            fname    = f"{image_slug}_unspl_{n}.webp"
            out_path = os.path.join(OUT_DIR, fname)
            if os.path.exists(out_path):
                continue
            try:
                img_bytes = download_bytes(photo["urls"]["regular"])
                size_kb   = process_and_save(img_bytes, out_path)
                meta[fname] = {
                    "relevant": is_rel,
                    "alt": alt_getter(photo),
                    "place_type": place_type,
                }
                tag = "REL" if is_rel else "gen"
                print(f"[{i:4}]   ok [{tag}] {fname} ({size_kb:.0f}kb, {photo.get('likes', 0)} likes)")
                downloaded += 1
            except Exception as e:
                print(f"[{i:4}]   ERROR {fname}: {e}")
                err += 1

        if downloaded:
            if any(rel for _, rel, _ in pool):
                ok += 1
            else:
                generic += 1

        if i % 25 == 0:
            save_meta(meta)
        time.sleep(2)
finally:
    save_meta(meta)

print(f"\nFertig: {ok} relevant / {generic} generic / {skip} skipped / {not_found} not found / {err} errors")
