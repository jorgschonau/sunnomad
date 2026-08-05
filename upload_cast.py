#!/usr/bin/env python3
"""Upload ~/sunnomad_output/*.webp → dedicated/cast/ with upsert (overwrite, no (1) dupes).

Nicht per Supabase-Dashboard drag&drop — Browser legt bei existierendem Namen ' (1).webp' an.
"""

from __future__ import annotations

import argparse
import os
import re
import time
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

BUCKET = "dedicated"
PREFIX = "cast"
OUT_DIR = Path.home() / "sunnomad_output"
BROWSER_DUPE = re.compile(r" \(\d+\)\.webp$", re.I)
UPLOAD_OPTS = {"content-type": "image/webp", "upsert": "true"}


def get_supabase():
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_ANON_KEY")
    if not url or not key:
        raise SystemExit("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env")
    return create_client(url, key)


def main():
    parser = argparse.ArgumentParser(description="Upload cast images with overwrite (no browser dupes)")
    parser.add_argument("--dir", type=Path, default=OUT_DIR, help="Local folder (default: ~/sunnomad_output)")
    args = parser.parse_args()

    folder = args.dir.expanduser()
    if not folder.is_dir():
        raise SystemExit(f"Not a directory: {folder}")

    files = sorted(f for f in folder.glob("*.webp") if f.is_file())
    skip = [f.name for f in files if BROWSER_DUPE.search(f.name)]
    if skip:
        print(f"⚠️  {len(skip)} file(s) with ' (1).webp' — run normalize first:")
        for name in skip[:10]:
            print(f"    {name}")
        if len(skip) > 10:
            print(f"    … +{len(skip) - 10} more")
        raise SystemExit(1)

    if not files:
        print(f"No .webp in {folder}")
        return

    supabase = get_supabase()
    uploaded = errors = 0

    for i, path in enumerate(files, 1):
        storage_path = f"{PREFIX}/{path.name}"
        data = path.read_bytes()
        for attempt in range(1, 4):
            try:
                supabase.storage.from_(BUCKET).upload(storage_path, data, UPLOAD_OPTS)
                uploaded += 1
                print(f"[{i:4}/{len(files)}] ok {storage_path}")
                break
            except Exception as e:
                if attempt == 3:
                    errors += 1
                    print(f"[{i:4}/{len(files)}] ERROR {path.name}: {e}")
                else:
                    time.sleep(5 * attempt)

    print(f"\nFertig: {uploaded} hochgeladen, {errors} Fehler")
    if uploaded:
        print("Danach: python3 hero_publish.py --sync")


if __name__ == "__main__":
    main()
