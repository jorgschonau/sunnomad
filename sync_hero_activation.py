#!/usr/bin/env python3
"""
Sync place_hero_images activation + rotation order per place.

Storage: mirrors entire `dedicated` bucket (cast/, pexels/, goldie/, subfolders, …).
After upload:  python3 hero_publish.py --sync
Rules (per place):
  a) Activate all images for the primary cast character (auto = most cast rows, or override).
  b) Also activate ALL goldie/arty/chatgpt, all unsplash + one preferred pexels.
  c) TEMP showcase places (`_goldie_only_showcase` in hero_char_overrides.json): one goldie only.
  d) Deactivate everything else; assign sort_order (rotation order in app).
     Cast order: group by character (most images first); within char:
       surfing → freestyle_swim → arrival → harbour_walk → hiking_back → newspaper_cafe
       → everything else → farshot last.
     Pexels/Unsplash stock: woven into the middle of the cast deck (not first, not after farshot).
     Shot variants: DELETE numbered siblings (`main_1`) and Finder `name (1)` —
     keep bare; if only numbered, keep lowest. DB row + storage object removed.
     Same for arrival/farshot/activity_*/exploit_*/cinematic_*/road.

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
import time
from collections import Counter, defaultdict
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

from link_image import infer_character

try:
    from generate_hero_images import DISABLED_CHARACTERS as _DISABLED_CAST
    from generate_hero_images import _image_file_slug
except Exception:
    _DISABLED_CAST = set()

    def _image_file_slug(place: dict) -> str:
        raise KeyError("country_code")

load_dotenv()

OVERRIDES_PATH = Path(__file__).with_name("hero_char_overrides.json")

KNOWN_CHARACTERS = {
    "ana", "naomi", "valentina", "sofia", "yosra", "elena", "katja", "alessandra",
    "ingrid", "jade", "luca", "chad", "driver_pov", "driver_van", "regina", "maya",
    "diaz", "stacy", "kay", "charlotte", "thea", "tammy", "lyra", "werra", "olga",
    "nina", "mila", "sigrid", "quinn", "isabella", "maria", "rosa", "carmela", "yuki",
    "celine", "amber", "bianca", "camille", "cleo", "diana", "kelek", "terry", "vera",
    "goldie", "metka", "tasha", "zara", "djordje", "conrad",
    # US cast + dog cast (must match filename _char_ for sync/mirror)
    "dale", "tyler", "skyler",
    "karl", "vlad", "boone", "soca", "roki", "zeus", "dio", "bass", "morana",
    "anubis", "elvis", "lupo", "zorro", "atlas", "kilo", "hank", "flocke",
    "juniper", "benji", "nacho",
}

# Cast rotation priority (within each character block). Farshot always last.
SHOT_PRIORITY_FRONT = [
    "surfing",           # 1
    "freestyle_swim",    # 2 swimming
    "arrival",           # 3
    "harbour_walk",      # 4
    "hiking_back",       # 5 ★★★★☆
    "newspaper_cafe",    # 6 ★★★★☆
]
# Soft order inside "everything else" (still before farshot)
SHOT_PRIORITY_MID = [
    "main", "activity", "exploit", "cinematic", "scenic",
    "dayhike", "boost", "other",
]
SHOT_PRIORITY_BACK = ["farshot"]

# Legacy alias — prefer shot_rank() / build_rotation()
SHOT_ORDER = SHOT_PRIORITY_FRONT + SHOT_PRIORITY_MID + SHOT_PRIORITY_BACK


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
    """Return (kind, character). cast/ goldie/ pexels/ arty/ chatgpt/ from path + filename."""
    path = (row.get("storage_path") or "").lower()
    variant = (row.get("variant") or "").lower()
    char = (row.get("character") or "").lower().strip()
    head = path.split("/")[0] if "/" in path else ""

    if head == "arty" or variant == "arty":
        return "arty", None

    if head == "chatgpt" or variant == "chatgpt" or "_chatgpt" in path:
        return "chatgpt", None

    blob = f"_{path.replace('/', '_')}_"
    if char == "goldie" or "_goldie_" in blob:
        return "goldie", "goldie"
    if char == "pexels" or "_pexels_" in path or head == "pexels":
        return "pexels", None
    if (
        char == "unsplash"
        or "_unsplash_" in path
        or head == "unsplash"
        or variant == "unsplash"
    ):
        return "unsplash", None

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
    if kind == "unsplash":
        return "unsplash"
    if kind == "arty":
        return "arty"
    if kind == "chatgpt":
        return "chatgpt"
    head = (storage_path or "").split("/")[0].lower()
    if head in ("arty", "chatgpt", "pexels", "unsplash", "goldie"):
        return head
    return "cast"


def _path_base(storage_path: str) -> str:
    return (storage_path or "").lower().rsplit("/", 1)[-1]


# Bare `_main.webp` beats `_main_1.webp`; among numbered, lowest wins.
# Finder copies `name (1).webp` lose to bare `name.webp` (same stem+shot).
# Parse in two steps so `_activity_harbour_walk_1` → shot=activity_harbour_walk, num=1
# (a single greedy regex would eat `_1` into the shot name).
# Tagged stems stay separate: `regina_hotel_main` ≠ `regina_main`.
_SHOT_CORE_RE = re.compile(
    r"^(?P<stem>.+)_(?P<shot>"
    r"main|arrival|farshot|road|"
    r"activity_[a-z0-9_]+|"
    r"exploit_[a-z0-9_]+|"
    r"cinematic_[a-z0-9_]+"
    r")$",
    re.I,
)
# macOS / Finder duplicate: "foo (1)", "foo (2)"
_COPY_SUFFIX_RE = re.compile(r"\s*\((\d+)\)$")


def _strip_ext_base(storage_path: str) -> str:
    base = _path_base(storage_path)
    return re.sub(r"\.(webp|jpg|jpeg|png)$", "", base, flags=re.I)


def _split_copy_suffix(base: str) -> tuple[str, int | None]:
    """`…sunset_wine (1)` → (`…sunset_wine`, 1); bare → (base, None)."""
    m = _COPY_SUFFIX_RE.search(base)
    if not m:
        return base, None
    return base[: m.start()].rstrip(), int(m.group(1))


def parse_shot_variant(storage_path: str) -> tuple[str, str, int | None] | None:
    """Return (stem, shot, num) where num is None for bare `_main.webp` / `_arrival.webp`.
    Finder `(1)` suffixes are stripped before matching so they share a dedupe key with bare.
    """
    base, _copy_n = _split_copy_suffix(_strip_ext_base(storage_path))
    mnum = re.search(r"_(\d+)$", base)
    if mnum:
        candidate = base[: mnum.start()]
        m = _SHOT_CORE_RE.match(candidate)
        if m:
            return (
                m.group("stem").lower(),
                m.group("shot").lower(),
                int(mnum.group(1)),
            )
    m = _SHOT_CORE_RE.match(base)
    if not m:
        return None
    return (m.group("stem").lower(), m.group("shot").lower(), None)


def _variant_keep_rank(row: dict) -> tuple:
    """Lower = keep. Prefer non-unaccented, no Finder (N), bare (no _N), then lowest N."""
    path = row.get("storage_path") or ""
    _base, copy_n = _split_copy_suffix(_strip_ext_base(path))
    parsed = parse_shot_variant(path)
    num = parsed[2] if parsed else None
    unaccented = 1 if "/unaccented/" in path.lower() else 0
    copy_penalty = 0 if copy_n is None else 1
    cn = 0 if copy_n is None else copy_n
    bare_penalty = 0 if num is None else 1
    n = 0 if num is None else num
    sort = row.get("sort_order") if row.get("sort_order") is not None else 999
    return (unaccented, copy_penalty, cn, bare_penalty, n, sort, path.lower())


def dedupe_shot_variants(rows: list[dict]) -> list[dict]:
    """Keep winners only — see partition_shot_variant_dupes."""
    kept, _dropped = partition_shot_variant_dupes(rows)
    return kept


def partition_shot_variant_dupes(rows: list[dict]) -> tuple[list[dict], list[dict]]:
    """Split into keep vs drop.

    Dedupe is per character + stem + shot:
      rome_it_regina_main  vs  rome_it_regina_main_1   → drop _1
      rome_it_regina_main  vs  rome_it_naomi_main      → both keep (different char)
      rome_it_regina_main  vs  rome_it_regina_hotel_main → both keep (different stem)
      name.webp           vs  name (1).webp           → drop Finder copy

    Excluded from dedupe (all kept): water_exit exploits (_1/_2/_3 are intentional variants).
    """
    winners: dict[tuple, dict] = {}
    passthrough: list[dict] = []
    contested: list[dict] = []
    for row in rows:
        path = row.get("storage_path") or ""
        # Keep every water_exit take — numbered variants are intentional, not dupes
        if "water_exit" in path.lower():
            passthrough.append(row)
            continue
        parsed = parse_shot_variant(path)
        if not parsed:
            passthrough.append(row)
            continue
        contested.append(row)
        stem, shot, _num = parsed
        _kind, char = classify_row(row)
        # Char first so different cast never collide (even if stems ever matched)
        key = ((char or "").lower(), stem, shot)
        prev = winners.get(key)
        if prev is None or _variant_keep_rank(row) < _variant_keep_rank(prev):
            winners[key] = row
    keep_ids = {r["id"] for r in winners.values()} | {r["id"] for r in passthrough}
    kept = [r for r in rows if r["id"] in keep_ids]
    dropped = [r for r in contested if r["id"] not in keep_ids]
    return kept, dropped


_FINDER_DUPE_RE = re.compile(r" \(\d+\)\.webp$", re.I)


def delete_hero_rows(sb, rows: list[dict], *, dry_run: bool) -> int:
    """Delete place_hero_images rows + storage objects. Returns count."""
    if not rows:
        return 0
    for row in rows:
        path = row.get("storage_path") or ""
        print(f"  🗑️  dupe delete: {path}")
        if dry_run:
            continue
        try:
            sb.table("place_hero_images").delete().eq("id", row["id"]).execute()
        except Exception as e:
            print(f"     DB delete failed: {e}")
            continue
        if path:
            try:
                sb.storage.from_(STORAGE_BUCKET).remove([path])
            except Exception as e:
                print(f"     storage remove failed ({path}): {e}")
    return len(rows)


def purge_finder_storage_orphans(*, dry_run: bool) -> int:
    """Delete dedicated/* ' (N).webp' files even when no DB row exists.

    Sync only drops dupes that still have place_hero_images rows — Finder copies
    left in storage alone survive otherwise (and reappear after --mirror-storage).
    """
    paths = sorted(p for p in list_storage_paths(STORAGE_BUCKET) if _FINDER_DUPE_RE.search(p))
    if not paths:
        return 0
    print(f"\n🗑️  storage Finder orphans: {len(paths)}")
    for path in paths:
        print(f"  🗑️  storage orphan: {path}")
    if dry_run:
        return len(paths)
    sb = get_supabase()
    bucket = sb.storage.from_(STORAGE_BUCKET)
    for i in range(0, len(paths), 50):
        chunk = paths[i : i + 50]
        try:
            bucket.remove(chunk)
        except Exception as e:
            print(f"     storage orphan remove failed: {e}")
    return len(paths)


def _is_arrival_path(base: str) -> bool:
    return bool(re.search(r"_arrival(?:_\d+)?(?:\.|$)", base))


def _matches_front_key(base: str, key: str) -> bool:
    if key == "arrival":
        return _is_arrival_path(base)
    return (
        f"activity_{key}" in base
        or f"_{key}_" in f"_{base}_"
        or base.endswith(f"_{key}")
    )


def shot_type(storage_path: str) -> str:
    """Coarse shot label for logging — prefer specific activity keys."""
    base = _path_base(storage_path)
    for key in SHOT_PRIORITY_FRONT:
        if _matches_front_key(base, key):
            return key
    if "farshot" in base:
        return "farshot"
    if re.search(r"_main(?:_\d+)?(?:\.|$)", base):
        return "main"
    for key in ("activity", "exploit", "cinematic", "scenic", "dayhike", "boost"):
        if key in base:
            return key
    return "other"


def shot_rank(storage_path: str) -> tuple:
    """Sort key: front (surf→swim→arrival→…) → mid → farshot last."""
    base = _path_base(storage_path)
    path = (storage_path or "").lower()
    if "farshot" in base:
        return (2, 0, path)
    for i, key in enumerate(SHOT_PRIORITY_FRONT):
        if _matches_front_key(base, key):
            return (0, i, path)
    # mid bucket
    if re.search(r"_main(?:_\d+)?(?:\.|$)", base):
        return (1, 0, path)
    for i, key in enumerate(SHOT_PRIORITY_MID):
        if key in ("main", "other", "farshot"):
            continue
        if key in base:
            return (1, i, path)
    return (1, len(SHOT_PRIORITY_MID), path)


def is_all_chars_override(value: str | None) -> bool:
    return (value or "").lower() in ("*", "all")


def pick_primary_char(rows: list[dict], override: str | None) -> str | None:
    if override and not is_all_chars_override(override):
        return override.lower()
    counts: Counter[str] = Counter()
    for row in rows:
        kind, char = classify_row(row)
        if kind == "cast" and char and char not in _DISABLED_CAST:
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


def pick_stock_rows(rows: list[dict]) -> list[dict]:
    """Active stock for mid-deck weave: all unsplash + one preferred pexels."""
    unsplash = [
        r for r in rows if classify_row(r)[0] == "unsplash"
    ]
    unsplash.sort(key=lambda r: r.get("storage_path") or "")
    out = list(unsplash)
    pex = pick_pexels_row(rows)
    if pex and pex not in out:
        out.append(pex)
    return out


def _weave_stock_mid(cast_rows: list[dict], stock_rows: list[dict]) -> list[dict]:
    """Insert pexels/unsplash into mid-deck only (after front shots, before farshot)."""
    if not stock_rows:
        return cast_rows
    if not cast_rows:
        return list(stock_rows)

    far: list[dict] = []
    front: list[dict] = []
    mid: list[dict] = []
    for r in cast_rows:
        path = r.get("storage_path") or ""
        bucket, _, _ = shot_rank(path)
        if bucket == 2:  # farshot
            far.append(r)
        elif bucket == 0:  # surf→swim→arrival→harbour→hike→cafe
            front.append(r)
        else:
            mid.append(r)

    if not mid:
        # no mid cast → put stock after front, before farshot
        return front + list(stock_rows) + far

    woven: list[dict] = []
    stock_q = list(stock_rows)
    step = max(1, len(mid) // (len(stock_q) + 1))
    for i, r in enumerate(mid):
        woven.append(r)
        if stock_q and (i + 1) % step == 0:
            woven.append(stock_q.pop(0))
    woven.extend(stock_q)

    return front + woven + far


def build_rotation(rows: list[dict]) -> list[dict]:
    """Cast: group by char (most images first); within char: surf→swim→arrival→…→farshot.
    Pexels/Unsplash woven mid-deck; arty/chatgpt after cast; goldie mid overall.
    """
    if len(rows) == 1 and classify_row(rows[0])[0] == "goldie":
        return rows

    by_char: dict[str, list[dict]] = defaultdict(list)
    arties: list[dict] = []
    goldies: list[dict] = []
    stock_pool: list[dict] = []

    for r in rows:
        kind, char = classify_row(r)
        if kind == "cast":
            by_char[char or "_unknown"].append(r)
        elif kind in ("arty", "chatgpt"):
            arties.append(r)
        elif kind == "goldie":
            goldies.append(r)
        elif kind in ("pexels", "unsplash"):
            stock_pool.append(r)

    arties.sort(key=lambda r: r.get("storage_path") or "")
    goldies.sort(key=lambda r: r.get("storage_path") or "")
    stock = pick_stock_rows(stock_pool) if stock_pool else []

    # Characters with the most cast images first; tie-break name
    char_order = sorted(by_char.keys(), key=lambda c: (-len(by_char[c]), c))

    cast_merged: list[dict] = []
    for char in char_order:
        shots = sorted(by_char[char], key=lambda r: shot_rank(r.get("storage_path") or ""))
        cast_merged.extend(shots)

    merged = _weave_stock_mid(cast_merged, stock)
    merged.extend(arties)

    if goldies:
        insert_at = max(1, len(merged) // 2) if merged else 0
        merged[insert_at:insert_at] = goldies

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


def _register_slug(by_slug: dict[str, dict], slug: str, place: dict) -> None:
    if not slug:
        return
    existing = by_slug.get(slug)
    if existing is None:
        by_slug[slug] = place
        return
    if not existing.get("image_slug") and place.get("image_slug"):
        by_slug[slug] = place
    elif not existing.get("country_code") and place.get("country_code"):
        by_slug[slug] = place


def build_places_by_slug(places: list[dict]) -> dict[str, dict]:
    by_slug: dict[str, dict] = {}
    for place in places:
        if place.get("image_slug"):
            _register_slug(by_slug, place["image_slug"], place)
        try:
            _register_slug(by_slug, _image_file_slug(place), place)
        except (KeyError, TypeError, AttributeError):
            pass
    return by_slug


def load_places_by_slug(place_filter: str | None) -> tuple[dict[str, dict], list[dict]]:
    if place_filter:
        sb = get_supabase()
        res = (
            sb.table("places")
            .select("id, name_en, country_code, image_slug")
            .ilike("name_en", f"%{place_filter}%")
            .execute()
        )
        places = res.data or []
    else:
        places = _paginate_table("places", "id, name_en, country_code, image_slug")
    by_slug = build_places_by_slug(places)
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

    stats = {"storage": len(storage_paths_list), "inserted": 0, "updated": 0, "deleted": 0,
              "skipped": 0, "touched_place_ids": set()}

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
                stats["touched_place_ids"].add(place["id"])
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
        stats["touched_place_ids"].add(place["id"])
        if not dry_run:
            sb.table("place_hero_images").upsert(row, on_conflict="storage_path").execute()
        db_by_path[path] = row

    for row in db_rows:
        path = row.get("storage_path") or ""
        if path in storage_paths:
            continue
        stats["deleted"] += 1
        stats["touched_place_ids"].add(row.get("place_id"))
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

    # Hard-delete shot dupes (main_1 / Finder (1)) — DB + storage, not just deactivate
    rows, dupe_drop = partition_shot_variant_dupes(rows)
    deleted_dupes = delete_hero_rows(sb, dupe_drop, dry_run=dry_run)

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
                # DISABLED cast normally skipped — exception: explicit place override
                # (e.g. hero_char_overrides "Snoqualmie Falls": "maria")
                forced_disabled = (
                    char in _DISABLED_CAST
                    and override
                    and not all_chars
                    and primary == char
                )
                if char in _DISABLED_CAST and not forced_disabled:
                    continue
                active.append(row)
            elif kind in ("goldie", "arty", "chatgpt"):
                active.append(row)

        for s in pick_stock_rows(rows):
            kind_s = classify_row(s)[0]
            if kind_s == "pexels" and name in no_pexels:
                continue
            if s not in active:
                active.append(s)

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
            "deleted_dupes": deleted_dupes,
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
        "deleted_dupes": deleted_dupes,
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
    parser.add_argument(
        "--changed-only",
        action="store_true",
        help="Nach --mirror-storage nur die Orte re-aktivieren, deren Storage-Zeilen sich "
             "geändert haben, statt alle ~3000. Ignoriert manuelle Änderungen an "
             "hero_char_overrides.json für unveränderte Orte — dafür ohne Flag laufen lassen.",
    )
    args = parser.parse_args()

    overrides = load_overrides()
    no_pexels = load_no_pexels()
    goldie_only_showcase = load_goldie_only_showcase()

    touched_place_ids = None
    if args.mirror_storage:
        print(f"{'DRY RUN — ' if args.dry_run else ''}Mirror bucket `{STORAGE_BUCKET}/` (recursive) → place_hero_images\n")
        stats = mirror_storage(args.place, dry_run=args.dry_run)
        touched_place_ids = stats["touched_place_ids"]
        print(
            f"\nStorage: {stats['storage']} files | "
            f"+{stats['inserted']} inserted | ~{stats['updated']} updated | "
            f"-{stats['deleted']} deleted | {stats['skipped']} unmatched\n"
        )

    places = resolve_places(args.place)

    if not places:
        print("No places found.")
        sys.exit(1)

    if args.changed_only:
        if touched_place_ids is None:
            print("--changed-only braucht --mirror-storage, ignoriere.")
        else:
            places = [p for p in places if p["id"] in touched_place_ids]
            if not places:
                print("Keine Storage-Änderungen -> nichts zu aktivieren.")
                return

    print(f"{'DRY RUN — ' if args.dry_run else ''}Sync hero activation for {len(places)} place(s)\n")

    synced = skipped = 0
    activated = deactivated = rotation_changes = deleted_dupes = 0
    total = len(places)
    for i, place in enumerate(places, 1):
        # Bei ~3000 Orten reißt die Supabase-Verbindung gelegentlich ab; ein Ort
        # ist idempotent, also einfach nochmal versuchen statt den Lauf zu killen.
        for attempt in range(1, 5):
            try:
                result = sync_place(
                    place, overrides, no_pexels, args.char,
                    dry_run=args.dry_run, goldie_only_showcase=goldie_only_showcase,
                )
                break
            except Exception as e:
                if attempt == 4:
                    raise
                wait = min(5 * attempt, 30)
                print(f"  {place.get('name_en')}: {type(e).__name__} -> retry in {wait}s "
                      f"(Versuch {attempt})", flush=True)
                time.sleep(wait)
        deleted_dupes += result.get("deleted_dupes", 0) or 0
        if result.get("skipped"):
            skipped += 1
            deactivated += result.get("deactivated", 0) or 0
        else:
            synced += 1
            deactivated += result.get("deactivated", 0) or 0
            rotation_changes += result.get("changes", 0) or 0
            if result.get("changes"):
                activated += 1
        if i % 100 == 0 or i == total:
            print(f"  … {i}/{total} places processed", flush=True)

    print(
        f"\nDone: {len(places)} place(s) checked, {activated} mit geänderter Rotation, "
        f"{rotation_changes} Zeilen umgeschaltet, {deactivated} Bilder deaktiviert, "
        f"{deleted_dupes} Duplikate gelöscht (DB+Storage), {skipped} ohne aktives Set."
    )
    orphans = purge_finder_storage_orphans(dry_run=args.dry_run)
    if orphans:
        print(f"Storage Finder orphans: {orphans} {'would delete' if args.dry_run else 'deleted'}.")


if __name__ == "__main__":
    main()
