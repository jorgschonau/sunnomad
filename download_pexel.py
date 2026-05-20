import os
import time
import requests
import psycopg2
from PIL import Image, ImageFilter, ImageEnhance, ImageStat
from io import BytesIO
from dotenv import load_dotenv

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

TARGET_W, TARGET_H = 800, 1200
TARGET_KB = 80

MODIFIERS = {
    "city":         "cityscape",
    "medium_town":  "town",
    "small_town":   "village",
    "beach":        "beach",
    "scenic_drive": "scenic road",
    "village":      "village",
}

# Hardcoded extras: (search_query, image_slug, place_type)
EXTRAS = [
    ("Fehmarn beach strand", "fehmarn_de", "beach"),
]

QUERY = """
SELECT p.name_en, p.country_code, p.image_slug, p.place_type
FROM place_hero_images phi
FULL JOIN places p ON p.id = phi.place_id
WHERE p.name_en NOT IN ('Jackson', 'Deadwood', 'Jasper')
  AND phi.storage_path IS NULL
  AND p.image_slug IS NOT NULL
ORDER BY p.attractiveness_score DESC
LIMIT 1000
"""


def build_query(name_en, country_code, place_type):
    modifier = MODIFIERS.get(place_type, "")
    if len(name_en.split()) == 1 and len(name_en) <= 6:
        return f"{name_en} {country_code} {modifier}".strip()
    return f"{name_en} {modifier}".strip()


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


def pexels_search(query):
    for attempt in range(5):
        try:
            r = requests.get(
                "https://api.pexels.com/v1/search",
                headers=HEADERS,
                params={"query": query, "orientation": "portrait", "per_page": 3},
                timeout=10
            )

            if r.status_code == 429:
                wait = 60 * (attempt + 1)
                print(f"  Rate limit (429) -> warte {wait}s...")
                time.sleep(wait)
                continue

            if r.status_code == 403:
                print("  403 Forbidden - API Key Problem, stoppe.")
                return None

            if r.status_code != 200 or not r.text.strip():
                wait = 60 * (attempt + 1)
                print(f"  Leere Response (status {r.status_code}) -> warte {wait}s...")
                time.sleep(wait)
                continue

            return r.json().get("photos", [])

        except requests.exceptions.Timeout:
            print(f"  Timeout -> retry {attempt + 1}")
            time.sleep(15)
        except Exception as e:
            print(f"  Request error: {e} -> retry {attempt + 1}")
            time.sleep(10)

    return []


def process_place(i, query, image_slug):
    all_exist = all(
        os.path.exists(os.path.join(OUT_DIR, f"{image_slug}_pexels_{n}.webp"))
        for n in range(1, 4)
    )
    if all_exist:
        print(f"[{i:4}] SKIP: {image_slug}")
        return "skip"

    photos = pexels_search(query)

    if photos is None:
        return None  # hard stop

    if not photos:
        print(f"[{i:4}] NOT FOUND: {query}")
        return "not_found"

    for n, photo in enumerate(photos, 1):
        fname    = f"{image_slug}_pexels_{n}.webp"
        out_path = os.path.join(OUT_DIR, fname)

        if os.path.exists(out_path):
            print(f"[{i:4}]   SKIP: {fname}")
            continue

        try:
            img_bytes = requests.get(photo["src"]["large2x"], timeout=15).content
            size_kb   = process_and_save(img_bytes, out_path)
            print(f"[{i:4}]   ok {fname} ({size_kb:.0f}kb) ['{query}']")
        except Exception as e:
            print(f"[{i:4}]   ERROR {fname}: {e}")

    return "ok"


# --- Main ---
conn = psycopg2.connect(host=DB_HOST, port=DB_PORT, dbname=DB_NAME,
                        user=DB_USER, password=DB_PASS)
cur = conn.cursor()
cur.execute(QUERY)
rows = cur.fetchall()
conn.close()

print(f"{len(rows)} Orte aus DB + {len(EXTRAS)} extras\n")

ok, skip, not_found, err = 0, 0, 0, 0

for i, (name_en, country_code, image_slug, place_type) in enumerate(rows, 1):
    query  = build_query(name_en, country_code, place_type)
    result = process_place(i, query, image_slug)

    if result is None:
        print("Hard stop.")
        break
    elif result == "skip":   skip += 1
    elif result == "not_found": not_found += 1
    else: ok += 1

    time.sleep(0.5)

# --- Extras ---
print("\n--- Extras ---")
for j, (query, image_slug, place_type) in enumerate(EXTRAS, 1):
    result = process_place(f"E{j}", query, image_slug)
    time.sleep(0.5)

print(f"\nFertig: {ok} ok / {skip} skipped / {not_found} not found / {err} errors")