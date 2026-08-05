"""Upload output/*.webp in den dedicated-Bucket unter pexels/.

Einfacher API-Upload statt Dashboard-Drag&Drop (kein TUS, keine Lock-Fehler).
Überspringt bereits vorhandene Dateien, upsert mit --force.
"""

import argparse
import os
import time

from dotenv import load_dotenv
from supabase import create_client

from pexels_blacklist import load_blacklist, slug_from_filename

load_dotenv()

supabase = create_client(
    os.environ["SUPABASE_URL"],
    os.environ.get("SUPABASE_SERVICE_ROLE_KEY", os.environ["SUPABASE_ANON_KEY"]),
)

BUCKET = "dedicated"
PREFIX = "pexels"
OUT_DIR = "output"
BANNED = load_blacklist()

parser = argparse.ArgumentParser()
parser.add_argument("--force", action="store_true", help="Vorhandene Dateien überschreiben (upsert)")
args = parser.parse_args()

existing = set()
offset = 0
while True:
    page = supabase.storage.from_(BUCKET).list(PREFIX, {"limit": 1000, "offset": offset})
    existing.update(f["name"] for f in page)
    if len(page) < 1000:
        break
    offset += 1000
print(f"{len(existing)} Dateien bereits im Bucket unter {PREFIX}/")
if BANNED:
    print(f"{len(BANNED)} Slugs permanent blacklisted — werden nicht hochgeladen")

files = sorted(f for f in os.listdir(OUT_DIR) if f.endswith(".webp"))
uploaded, skipped, errors, banned_n = 0, 0, 0, 0

for i, fname in enumerate(files, 1):
    slug = slug_from_filename(fname)
    if slug and slug in BANNED:
        banned_n += 1
        continue
    if not args.force and fname in existing:
        skipped += 1
        continue

    try:
        with open(os.path.join(OUT_DIR, fname), "rb") as f:
            data = f.read()
    except FileNotFoundError:
        skipped += 1
        continue

    opts = {"content-type": "image/webp"}
    if args.force:
        opts["upsert"] = "true"

    for attempt in range(1, 4):
        try:
            supabase.storage.from_(BUCKET).upload(f"{PREFIX}/{fname}", data, opts)
            uploaded += 1
            print(f"[{i:4}/{len(files)}] ok {fname}")
            break
        except Exception as e:
            if "already exists" in str(e).lower():
                skipped += 1
                break
            if attempt == 3:
                errors += 1
                print(f"[{i:4}/{len(files)}] ERROR {fname}: {e}")
            else:
                time.sleep(5 * attempt)

print(f"\nFertig: {uploaded} hochgeladen, {skipped} übersprungen, "
      f"{banned_n} blacklisted, {errors} Fehler")
