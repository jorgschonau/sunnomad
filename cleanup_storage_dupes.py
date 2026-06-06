#!/usr/bin/env python3
"""Delete Supabase storage files with browser duplicate suffix: ' (1).webp', ' (2).webp', …"""

from __future__ import annotations

import argparse
import os
import re
import sys

from dotenv import load_dotenv
from supabase import create_client

from sync_hero_activation import STORAGE_BUCKET, list_storage_paths

DUPE_RE = re.compile(r" \(\d+\)\.webp$", re.I)


def get_supabase():
    load_dotenv()
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_ANON_KEY")
    if not url or not key:
        sys.exit("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env")
    return create_client(url, key)


def find_dupes() -> list[str]:
    return sorted(p for p in list_storage_paths(STORAGE_BUCKET) if DUPE_RE.search(p))


def main():
    parser = argparse.ArgumentParser(description="Remove (1)/(2)/… duplicate files from dedicated bucket")
    parser.add_argument("--apply", action="store_true", help="Actually delete (default: dry-run)")
    args = parser.parse_args()

    dupes = find_dupes()
    print(f"Found {len(dupes)} duplicate-suffix files in `{STORAGE_BUCKET}/`")
    for path in dupes:
        print(f"  {'DEL' if args.apply else '??'} {path}")

    if not dupes:
        return
    if not args.apply:
        print("\nDry-run only. Re-run with --apply to delete, then: python3 hero_publish.py --sync")
        return

    sb = get_supabase()
    bucket = sb.storage.from_(STORAGE_BUCKET)
    ok = fail = 0
    for path in dupes:
        try:
            bucket.remove([path])
            ok += 1
        except Exception as e:
            fail += 1
            print(f"  ✗ {path}: {e}")
    print(f"\nDeleted {ok}, failed {fail}. Run: python3 hero_publish.py --sync")


if __name__ == "__main__":
    main()
