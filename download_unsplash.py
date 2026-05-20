import os
import time
import requests
import psycopg2
from PIL import Image, ImageFilter, ImageEnhance, ImageStat
from io import BytesIO
from dotenv import load_dotenv

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

TARGET_W, TARGET_H = 800, 1200
TARGET_KB = 80

QUERY = """
SELECT p.name_en, p.country_code, p.image_slug
FROM place_hero_images phi
FULL JOIN places p ON p.id = phi.place_id
WHERE p.name_en NOT IN ('Jackson', 'Deadwood', 'Jasper')
  AND phi.storage_path IS NULL
  AND p.image_slug IS NOT NULL
ORDER BY p.attractiveness_score DESC
LIMIT 1000
"""


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


def unsplash_search(name_en, country_code):
    for attempt in range(5):
        try:
            r = requests.get(
                "https://api.unsplash.com/search/photos",
                headers=HEADERS,
                params={"query": f"{name_en} {country_code}", "orientation": "portrait", "per_page": 10},
                timeout=10
            )

            if r.status_code == 429:
                wait = 90 * (attempt + 1)
                print(f"  Rate limit (429) -> warte {wait}s...")
                time.sleep(wait)
                continue

            if r.status_code == 403:
                print("  403 Forbidden - API Key Problem, stoppe.")
                return None  # hard stop signal

            if r.status_code != 200 or not r.text.strip():
                wait = 90 * (attempt + 1)
                print(f"  Leere/unerwartete Response (status {r.status_code}) -> warte {wait}s...")
                time.sleep(wait)
                continue

            return r.json().get("results", [])

        except requests.exceptions.Timeout:
            print(f"  Timeout -> retry {attempt + 1}")
            time.sleep(15)
        except Exception as e:
            print(f"  Request error: {e} -> retry {attempt + 1}")
            time.sleep(10)

    return []


# --- Main ---
conn = psycopg2.connect(host=DB_HOST, port=DB_PORT, dbname=DB_NAME,
                        user=DB_USER, password=DB_PASS)
cur = conn.cursor()
cur.execute(QUERY)
rows = cur.fetchall()
conn.close()

print(f"{len(rows)} Orte geladen\n")

ok, skip, not_found, err = 0, 0, 0, 0

for i, (name_en, country_code, image_slug) in enumerate(rows, 1):
    fname    = f"{image_slug}_unspl.webp"
    out_path = os.path.join(OUT_DIR, fname)

    if os.path.exists(out_path):
        print(f"[{i:4}] SKIP: {fname}")
        skip += 1
        continue

    results = unsplash_search(name_en, country_code)

    if results is None:
        print("Hard stop.")
        break

    if not results:
        print(f"[{i:4}] NOT FOUND: {name_en} ({country_code})")
        not_found += 1
        time.sleep(2)
        continue

    try:
        best      = max(results, key=lambda x: x["likes"])
        img_bytes = requests.get(best["urls"]["regular"], timeout=15).content
        size_kb   = process_and_save(img_bytes, out_path)
        print(f"[{i:4}] ok {fname} ({size_kb:.0f}kb, {best['likes']} likes)")
        ok += 1

    except Exception as e:
        print(f"[{i:4}] ERROR {name_en}: {e}")
        err += 1

    time.sleep(2)

print(f"\nFertig: {ok} ok / {skip} skipped / {not_found} not found / {err} errors")