#!/usr/bin/env python3
"""
Link an existing hero image to a place in place_hero_images.

Bulk: use sync_hero_activation.py --mirror-storage (reads dedicated/cast/ automatically).

Manual single file:
  cast/rome_it_ingrid_main.webp
  cast/rome_it_goldie_continental_eu_activity_eat_local.webp
  cast/rome_it_pexels_1.webp

Usage:
  python3 link_image.py "Rome" cast/rome_it_ingrid_main.webp
  python3 link_image.py "Rome" ingrid cast/rome_it_ingrid_main.webp
  python3 link_image.py "Rome" --list
"""

import os
import sys
import argparse
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

KNOWN_CHARACTERS = (
    "driver_pov", "driver_van", "alessandra", "charlotte", "isabella", "valentina",
    "naomi", "ingrid", "alessandra", "regina", "sigrid", "camille", "bianca",
    "conrad", "djordje", "alessandra", "goldie", "pexels",
    "ana", "sofia", "yosra", "elena", "katja", "jade", "luca", "chad", "maya",
    "diaz", "stacy", "kay", "thea", "tammy", "lyra", "werra", "olga", "nina",
    "mila", "quinn", "maria", "rosa", "carmela", "yuki", "celine", "amber",
    "camille", "cleo", "diana", "kelek", "terry", "vera", "metka", "tasha", "zara",
)

def get_supabase():
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_ANON_KEY")
    if not url or not key:
        sys.exit("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env")
    return create_client(url, key)


def infer_character(storage_path: str) -> str | None:
    path = storage_path.lower()
    if "_goldie_" in f"_{path.replace('/', '_')}_":
        return "goldie"
    if "_pexels_" in path:
        return "pexels"
    blob = path.replace("/", "_")
    found = [c for c in KNOWN_CHARACTERS if c not in ("goldie", "pexels") and f"_{c}_" in f"_{blob}_"]
    if not found:
        return None
    found.sort(key=len, reverse=True)
    return found[0]

def find_place(name: str) -> dict:
    sb = get_supabase()
    result = sb.table("places").select("id, name_en, country_code").ilike("name_en", name).execute()
    if not result.data:
        print(f"No place found for '{name}'")
        sys.exit(1)
    if len(result.data) > 1:
        print(f"Multiple matches for '{name}':")
        for p in result.data:
            print(f"  {p['id']}  {p['name_en']} ({p['country_code']})")
        sys.exit(1)
    return result.data[0]

def list_images(place: dict):
    sb = get_supabase()
    result = sb.table("place_hero_images").select("*").eq("place_id", place["id"]).order("sort_order").execute()
    if not result.data:
        print(f"No images for {place['name_en']}")
        return
    print(f"{place['name_en']} ({place['country_code']}) — {len(result.data)} image(s):")
    for r in result.data:
        active = "✓" if r.get("is_active") else " "
        print(f"  [{active}] id={r['id']} variant={r['variant']} sort={r['sort_order']} char={r['character']}  {r['storage_path']}")

def link_image(place: dict, character: str, storage_path: str, variant: str, sort_order: int):
    sb = get_supabase()
    if not storage_path.startswith("cast/"):
        storage_path = f"cast/{storage_path.lstrip('/')}"
    row = {
        "place_id": place["id"],
        "variant": variant,
        "storage_path": storage_path,
        "character": character,
        "sort_order": sort_order,
        "is_active": False,
    }
    result = sb.table("place_hero_images").insert(row).execute()
    inserted = result.data[0]
    print(f"Linked: id={inserted['id']}  {place['name_en']} → {storage_path}  (char={character}, inactive until sync)")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("place", help="Place name (partial match ok)")
    parser.add_argument("character", nargs="?", help="Character key (optional — inferred from filename)")
    parser.add_argument("storage_path", nargs="?", help="cast/place_cc_char_....webp")
    parser.add_argument("--variant", default=None, help="Variant (default: derived from storage_path prefix)")
    parser.add_argument("--sort", type=int, default=1, help="sort_order (default: 1)")
    parser.add_argument("--list", action="store_true", help="List existing images for this place")
    args = parser.parse_args()

    place = find_place(args.place)

    if args.list:
        list_images(place)
        sys.exit(0)

    # Allow: link_image.py "Rome" cast/rome_it_ingrid_main.webp
    if not args.storage_path and args.character and ("/" in args.character or args.character.endswith(".webp")):
        args.storage_path = args.character
        args.character = None

    if not args.storage_path:
        parser.error("storage_path is required unless --list is used")

    storage_path = args.storage_path
    if not storage_path.startswith("cast/"):
        storage_path = f"cast/{storage_path.lstrip('/')}"

    character = args.character
    if not character:
        character = infer_character(storage_path)
    if not character:
        parser.error("could not infer character — pass explicitly, e.g. ingrid")

    variant = args.variant or "cast"
    link_image(place, character, storage_path, variant, args.sort)
