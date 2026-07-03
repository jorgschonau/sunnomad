#!/usr/bin/env python3
"""
Sync place_hero_images activation + rotation order per place.

Storage: mirrors entire `dedicated` bucket (cast/, pexels/, goldie/, subfolders, …).
After upload:  python3 hero_publish.py --sync
Rules (per place):
  a) Activate all images for the primary cast character (auto = most cast rows, or override).
  b) Also activate ALL goldie rows, ALL arty rows, + exactly one pexels row.
  c) TEMP showcase places (`_goldie_only_showcase` in hero_char_overrides.json): one goldie only.
  d) Deactivate everything else; assign sort_order (rotation order in app).

Overrides (hero_char_overrides.json):
  "Rome": "sofia"     — force one char
  "Wacken": "*"       — activate ALL cast chars (+ goldie + 1 pexels)

Usage:
  python3 hero_publish.py --sync              # after cast/ upload (usual)
  python3 hero_publish.py --normalize       # fix local filenames only
  python3 sync_hero_activation.py --mirror-storage
  python3 sync_hero_activation.py --dry-run
  python3 sync_hero_activation.py --place Rome
  python3 sync_hero_activation.py --char sofia --place Berlin
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

from link_image import infer_character

load_dotenv()

OVERRIDES_PATH = Path(__file__).with_name("hero_char_overrides.json")

KNOWN_CHARACTERS = {
    "ana", "naomi", "valentina", "sofia", "yosra", "elena", "katja", "alessandra",
    "ingrid", "jade", "luca", "chad", "driver_pov", "driver_van", "regina", "maya",
    "diaz", "stacy", "kay", "charlotte", "thea", "tammy", "lyra", "werra", "olga",
    "nina", "mila", "sigrid", "quinn", "isabella", "maria", "rosa", "carmela", "yuki",
    "celine", "amber", "bianca", "camille", "cleo", "diana", "kelek", "terry", "vera",
    "goldie", "metka", "tasha", "zara", "djordje", "conrad",
}

SHOT_ORDER = [
    "main", "arrival", "activity", "exploit", "cinematic", "scenic", "farshot",
    "boost", "dayhike", "other",
]

def load_goldie_only_showcase() -> frozenset[str]:
    """TEMP — Goldie promo showcases; see hero_char_overrides.json `_goldie_only_showcase`."""
    if not OVERRIDES_PATH.exists():
        return frozenset()
    data = json.loads(OVERRIDES_PATH.read_text())
    return frozenset(str(x) for x in (data.get("_goldie_only_showcase") or []))


def get_supabase():
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_ANON_KEY")
    if not url or not key:
        sys.exit("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment / .env")
    return create_client(url, key)


def load_overrides() -> dict[str, str]:
    if not OVERRIDES_PATH.exists():
        return {}
    data = json.loads(OVERRIDES_PATH.read_text())
    return {
        str(k): str(v).lower()
        for k, v in data.items()
        if not str(k).startswith("_")
    }


def load_no_pexels() -> set[str]:
    if not OVERRIDES_PATH.exists():
        return set()
    data = json.loads(OVERRIDES_PATH.read_text())
    return {str(x) for x in (data.get("_no_pexels") or [])}


def classify_row(row: dict) -> tuple[str, str | None]:
    """Return (kind, character). cast/ goldie/ pexels/ arty/ from path + filename."""
    path = (row.get("storage_path") or "").lower()
    variant = (row.get("variant") or "").lower()
    char = (row.get("character") or "").lower().strip()
    head = path.split("/")[0] if "/" in path else ""

    if head == "arty" or variant == "arty":
        return "arty", None

    blob = f"_{path.replace('/', '_')}_"
    if char == "goldie" or "_goldie_" in blob:
        return "goldie", "goldie"
    if char == "pexels" or "_pexels_" in path or head == "pexels":
        return "pexels", None

    if char in KNOWN_CHARACTERS and char != "goldie":
        return "cast", char

    blob = path.replace("/", "_")
    found = [c for c in KNOWN_CHARACTERS if c != "goldie" and f"_{c}_" in f"_{blob}_"]
    if found:
        found.sort(key=len, reverse=True)
        return "cast", found[0]

    if variant in ("cast", "main"):
        return "cast", char or None

    return "other", None


def pick_single_goldie_row(rows: list[dict]) -> dict | None:
    """One goldie per showcase place — prefer goldie/ folder and _goldie_1."""
    goldies = [r for r in rows if classify_row(r)[0] == "goldie"]
    if not goldies:
        return None

    def rank(r: dict) -> tuple:
        path = (r.get("storage_path") or "").lower()
        in_goldie_folder = 0 if path.startswith("goldie/") else 1
        m = re.search(r"_goldie_(\d+)", path)
        n = int(m.group(1)) if m else 999
        return (in_goldie_folder, n, path)

    return sorted(goldies, key=rank)[0]


def infer_variant(storage_path: str, character: str | None) -> str:
    kind, _ = classify_row({
        "storage_path": storage_path,
        "variant": "",
        "character": character or "",
    })
    if kind == "goldie":
        return "goldie"
    if kind == "pexels":
        return "pexels"
    head = (storage_path or "").split("/")[0].lower()
    if head in ("arty", "chatgpt", "pexels", "goldie"):
        return head
    return "cast"


def shot_type(storage_path: str) -> str:
    p = (storage_path or "").lower()
    for key in SHOT_ORDER:
        if key == "other":
            continue
        if key in p:
            return key
    return "other"


def is_all_chars_override(value: str | None) -> bool:
    return (value or "").lower() in ("*", "all")


def pick_primary_char(rows: list[dict], override: str | None) -> str | None:
    if override and not is_all_chars_override(override):
        return override.lower()
    counts: Counter[str] = Counter()
    for row in rows:
        kind, char = classify_row(row)
        if kind == "cast" and char:
            counts[char] += 1
    if not counts:
        return None
    return counts.most_common(1)[0][0]


def pick_pexels_row(rows: list[dict]) -> dict | None:
    pexels = [r for r in rows if classify_row(r)[0] == "pexels"]
    if not pexels:
        return None

    def pexels_rank(r: dict) -> tuple:
        path = r.get("storage_path") or ""
        # unaccented/ holds re-downloaded duplicates (same filename, often a
        # different photo) — never let them win over the original
        dup = 1 if "/unaccented/" in path.lower() else 0
        sort = r.get("sort_order") or 999
        m = re.search(r"_pexels_(\d+)", path.lower())
        n = int(m.group(1)) if m else sort
        return (dup, n, sort, path)

    return sorted(pexels, key=pexels_rank)[0]


def build_rotation(rows: list[dict]) -> list[dict]:
    """Interleave cast shots; all arty; all goldie mid-deck; pexels last."""
    if len(rows) == 1 and classify_row(rows[0])[0] == "goldie":
        return rows

    cast = [r for r in rows if classify_row(r)[0] == "cast"]
    arties = sorted(
        [r for r in rows if classify_row(r)[0] == "arty"],
        key=lambda r: r.get("storage_path") or "",
    )
    goldies = sorted(
        [r for r in rows if classify_row(r)[0] == "goldie"],
        key=lambda r: r.get("storage_path") or "",
    )
    pexels = [r for r in rows if classify_row(r)[0] == "pexels"]

    buckets: dict[str, list[dict]] = defaultdict(list)
    for r in cast:
        buckets[shot_type(r.get("storage_path", ""))].append(r)
    for key in buckets:
        buckets[key].sort(key=lambda r: r.get("storage_path") or "")

    queues = [buckets[k] for k in SHOT_ORDER if buckets.get(k)]
    merged: list[dict] = []
    while any(queues):
        for q in queues:
            if q:
                merged.append(q.pop(0))

    merged.extend(arties)

    if goldies:
        insert_at = max(1, len(merged) // 2) if merged else 0
        merged[insert_at:insert_at] = goldies

    if pexels:
        merged.append(pexels[0])

    return merged


_DB_PAGE = 1000
_IN_BATCH = 100


def _paginate_table(table: str, columns: str) -> list[dict]:
    sb = get_supabase()
    rows: list[dict] = []
    offset = 0
    while True:
        res = (
            sb.table(table)
            .select(columns)
            .range(offset, offset + _DB_PAGE - 1)
            .execute()
        )
        batch = res.data or []
        rows.extend(batch)
        if len(batch) < _DB_PAGE:
            break
        offset += _DB_PAGE
    return rows


def fetch_places_by_ids(ids: list) -> list[dict]:
    if not ids:
        return []
    sb = get_supabase()
    places: list[dict] = []
    for i in range(0, len(ids), _IN_BATCH):
        chunk = ids[i : i + _IN_BATCH]
        res = (
            sb.table("places")
            .select("id, name_en, country_code")
            .in_("id", chunk)
            .execute()
        )
        places.extend(res.data or [])
    return sorted(places, key=lambda p: p.get("name_en") or "")


def resolve_places(place_filter: str | None) -> list[dict]:
    sb = get_supabase()
    if place_filter:
        res = (
            sb.table("places")
            .select("id, name_en, country_code")
            .ilike("name_en", f"%{place_filter}%")
            .execute()
        )
        return res.data or []

    ids = sorted(
        {
            r["place_id"]
            for r in _paginate_table("place_hero_images", "place_id")
            if r.get("place_id")
        }
    )
    return fetch_places_by_ids(ids)


STORAGE_BUCKET = "dedicated"
_STORAGE_PAGE = 1000
_IMAGE_EXTENSIONS = (".webp", ".jpg", ".jpeg", ".png")


def load_places_by_slug(place_filter: str | None) -> tuple[dict[str, dict], list[dict]]:
    if place_filter:
        sb = get_supabase()
        res = (
            sb.table("places")
            .select("id, name_en, country_code, image_slug")
            .ilike("name_en", f"%{place_filter}%")
            .not_.is_("image_slug", "null")
            .execute()
        )
        places = [p for p in (res.data or []) if p.get("image_slug")]
    else:
        places = [
            p
            for p in _paginate_table("places", "id, name_en, country_code, image_slug")
            if p.get("image_slug")
        ]
    by_slug = {p["image_slug"]: p for p in places}
    return by_slug, places


def _is_storage_file(name: str) -> bool:
    lower = name.lower()
    return lower.endswith(_IMAGE_EXTENSIONS) and not lower.startswith(".")


def list_storage_paths(bucket: str = STORAGE_BUCKET) -> list[str]:
    """Recursively list all image paths in a storage bucket."""
    sb = get_supabase()

    def walk(prefix: str) -> list[str]:
        paths: list[str] = []
        offset = 0
        while True:
            batch = sb.storage.from_(bucket).list(
                prefix,
                {
                    "limit": _STORAGE_PAGE,
                    "offset": offset,
                    "sortBy": {"column": "name", "order": "asc"},
                },
            )
            if not batch:
                break
            for item in batch:
                name = item.get("name") if isinstance(item, dict) else getattr(item, "name", None)
                if not name:
                    continue
                rel = f"{prefix}/{name}" if prefix else name
                if _is_storage_file(name):
                    paths.append(rel)
                else:
                    paths.extend(walk(rel))
            if len(batch) < _STORAGE_PAGE:
                break
            offset += _STORAGE_PAGE
        return paths

    return walk("")


def match_place_for_file(filename: str, by_slug: dict[str, dict]) -> dict | None:
    base = filename.rsplit(".", 1)[0]
    for slug in sorted(by_slug.keys(), key=len, reverse=True):
        if base.startswith(slug + "_") or base == slug:
            return by_slug[slug]
    return None


def mirror_storage(place_filter: str | None, dry_run: bool) -> dict:
    """Align place_hero_images with all files in the dedicated bucket."""
    sb = get_supabase()
    by_slug, places = load_places_by_slug(place_filter)
    allowed_ids = {p["id"] for p in places}

    storage_paths_list = list_storage_paths(STORAGE_BUCKET)
    storage_paths = set(storage_paths_list)

    db_rows = [
        r
        for r in _paginate_table(
            "place_hero_images", "id, place_id, storage_path, character, variant"
        )
        if not place_filter or r.get("place_id") in allowed_ids
    ]
    db_by_path = {r["storage_path"]: r for r in db_rows if r.get("storage_path")}

    stats = {"storage": len(storage_paths_list), "inserted": 0, "updated": 0, "deleted": 0, "skipped": 0}

    for path in sorted(storage_paths_list):
        basename = path.rsplit("/", 1)[-1]
        place = match_place_for_file(basename, by_slug)
        if not place:
            stats["skipped"] += 1
            continue
        if place_filter and place["id"] not in allowed_ids:
            continue

        char = infer_character(path)
        if not char:
            stats["skipped"] += 1
            print(f"  ⚠️  no character in {path}")
            continue

        variant = infer_variant(path, char)
        existing = db_by_path.get(path)
        if existing:
            updates = {}
            if existing.get("character") != char:
                updates["character"] = char
            if existing.get("variant") != variant:
                updates["variant"] = variant
            if updates:
                stats["updated"] += 1
                if not dry_run:
                    sb.table("place_hero_images").update(updates).eq("id", existing["id"]).execute()
            continue

        row = {
            "place_id": place["id"],
            "variant": variant,
            "storage_path": path,
            "character": char,
            "sort_order": 1,
            "is_active": False,
        }
        stats["inserted"] += 1
        if not dry_run:
            sb.table("place_hero_images").upsert(row, on_conflict="storage_path").execute()
        db_by_path[path] = row

    for row in db_rows:
        path = row.get("storage_path") or ""
        if path in storage_paths:
            continue
        stats["deleted"] += 1
        if not dry_run:
            sb.table("place_hero_images").delete().eq("id", row["id"]).execute()

    return stats


def sync_place(
    place: dict,
    overrides: dict[str, str],
    no_pexels: set[str],
    char_cli: str | None,
    dry_run: bool,
    goldie_only_showcase: frozenset[str] | None = None,
) -> dict:
    sb = get_supabase()
    pid = place["id"]
    name = place["name_en"]
    res = (
        sb.table("place_hero_images")
        .select("id, storage_path, variant, character, sort_order, is_active")
        .eq("place_id", pid)
        .execute()
    )
    rows = res.data or []
    if not rows:
        return {"place": name, "skipped": "no rows"}

    if name in (goldie_only_showcase or ()):
        single = pick_single_goldie_row(rows)
        active = [single] if single else []
    else:
        override = char_cli or overrides.get(name)
        all_chars = is_all_chars_override(override)
        primary = pick_primary_char(rows, override)

        active = []
        for row in rows:
            kind, char = classify_row(row)
            if kind == "cast" and char and (all_chars or (primary and char == primary)):
                active.append(row)
            elif kind in ("goldie", "arty"):
                active.append(row)

        pex = pick_pexels_row(rows)
        if pex and pex not in active and name not in no_pexels:
            active.append(pex)

    override = char_cli or overrides.get(name)
    all_chars = is_all_chars_override(override)
    primary = pick_primary_char(rows, override)

    if not active:
        deactivated = 0
        for row in rows:
            if row.get("is_active"):
                deactivated += 1
                if not dry_run:
                    sb.table("place_hero_images").update(
                        {"is_active": False}
                    ).eq("id", row["id"]).execute()
        return {
            "place": name,
            "skipped": "no matching active set",
            "primary": primary,
            "deactivated": deactivated,
        }

    rotation = build_rotation(active)
    active_ids = {r["id"] for r in active}

    changes = []
    for i, row in enumerate(rotation, start=1):
        new_sort = i
        new_active = True
        if row.get("sort_order") != new_sort or not row.get("is_active"):
            changes.append((row["id"], new_sort, True, row.get("storage_path")))
        if not dry_run:
            sb.table("place_hero_images").update(
                {"sort_order": new_sort, "is_active": True}
            ).eq("id", row["id"]).execute()

    for row in rows:
        if row["id"] not in active_ids and row.get("is_active"):
            changes.append((row["id"], row.get("sort_order"), False, row.get("storage_path")))
            if not dry_run:
                sb.table("place_hero_images").update(
                    {"is_active": False}
                ).eq("id", row["id"]).execute()

    cast_counts = Counter(
        classify_row(r)[1]
        for r in rows
        if classify_row(r)[0] == "cast" and classify_row(r)[1]
    )

    return {
        "place": name,
        "primary": "all" if all_chars else primary,
        "override": bool(override),
        "all_chars": all_chars,
        "counts": dict(cast_counts),
        "active": len(active),
        "deactivated": sum(1 for r in rows if r["id"] not in active_ids and r.get("is_active")),
        "rotation": [r.get("storage_path") for r in rotation],
        "changes": len(changes),
    }


def main():
    parser = argparse.ArgumentParser(description="Sync hero image activation + rotation per place")
    parser.add_argument("--dry-run", action="store_true", help="Print plan only, no DB writes")
    parser.add_argument("--place", help="Filter by place name (partial match)")
    parser.add_argument("--char", help="Force primary character for matched place(s)")
    parser.add_argument(
        "--mirror-storage",
        action="store_true",
        help="Sync entire dedicated bucket ↔ DB (insert/update/delete orphans), then activate",
    )
    args = parser.parse_args()

    overrides = load_overrides()
    no_pexels = load_no_pexels()
    goldie_only_showcase = load_goldie_only_showcase()

    if args.mirror_storage:
        print(f"{'DRY RUN — ' if args.dry_run else ''}Mirror bucket `{STORAGE_BUCKET}/` (recursive) → place_hero_images\n")
        stats = mirror_storage(args.place, dry_run=args.dry_run)
        print(
            f"\nStorage: {stats['storage']} files | "
            f"+{stats['inserted']} inserted | ~{stats['updated']} updated | "
            f"-{stats['deleted']} deleted | {stats['skipped']} unmatched\n"
        )

    places = resolve_places(args.place)

    if not places:
        print("No places found.")
        sys.exit(1)

    print(f"{'DRY RUN — ' if args.dry_run else ''}Sync hero activation for {len(places)} place(s)\n")

    synced = skipped = 0
    total = len(places)
    for i, place in enumerate(places, 1):
        result = sync_place(
            place, overrides, no_pexels, args.char,
            dry_run=args.dry_run, goldie_only_showcase=goldie_only_showcase,
        )
        if result.get("skipped"):
            skipped += 1
        else:
            synced += 1
        if i % 100 == 0 or i == total:
            print(f"  … {i}/{total} places processed", flush=True)

    print(f"Done: {synced} place(s) synced, {skipped} skipped.")


if __name__ == "__main__":
    main()
