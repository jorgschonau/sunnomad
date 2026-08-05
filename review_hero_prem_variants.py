#!/usr/bin/env python3
"""
Find hero images that look like the same shot but differ by premium layer tag.

Example highlight:
  metka_prestige_eu_main.webp
  metka_eu_main_1.webp
→ same review key after stripping prestige / trailing _N / Finder (1)

Does NOT delete — review only.

Usage:
  python3 review_hero_prem_variants.py
  python3 review_hero_prem_variants.py --local
  python3 review_hero_prem_variants.py --db
  python3 review_hero_prem_variants.py --db --place Ajaccio
  python3 review_hero_prem_variants.py --both
  python3 review_hero_prem_variants.py --export
"""

from __future__ import annotations

import argparse
import os
import shutil
import sys
from collections import defaultdict
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

OUTPUT_DIR = Path(os.path.expanduser(
    os.environ.get("SUNNOMAD_OUTPUT_DIR", "~/sunnomad_output")
))

# Filename premium layers (must match generate_hero_images _style_tag)
PREMIUM_TOKENS = frozenset({
    "noir", "prestige", "nightlife", "viper", "maxpower",
    "eclipse", "sidewinder", "continental",
})

_IMAGE_EXTS = {".webp", ".jpg", ".jpeg", ".png"}

# Same two-step shot parse as sync_hero_activation.parse_shot_variant —
# a single greedy regex would eat `_1` into activity_/exploit_ shot names.
try:
    from sync_hero_activation import parse_shot_variant
except ImportError:  # pragma: no cover
    parse_shot_variant = None  # type: ignore


def normalize_prem_key(filename: str) -> tuple[str, frozenset[str], str] | None:
    """Return (review_key, premium_tokens_present, shot) or None if not a cast shot."""
    if parse_shot_variant is None:
        return None
    parsed = parse_shot_variant(filename)
    if not parsed:
        return None
    stem, shot, _num = parsed
    parts = [p for p in stem.split("_") if p]
    prem = frozenset(p for p in parts if p in PREMIUM_TOKENS)
    core = [p for p in parts if p not in PREMIUM_TOKENS]
    if not core:
        return None
    key = "_".join(core) + "_" + shot
    return key, prem, shot


def collect_local(root: Path, place_substr: str | None) -> list[dict]:
    if not root.is_dir():
        print(f"Local dir missing: {root}", file=sys.stderr)
        return []
    out = []
    for p in root.rglob("*"):
        if not p.is_file() or p.suffix.lower() not in _IMAGE_EXTS:
            continue
        # skip previous export folders
        if "_prem_review" in p.parts:
            continue
        name = p.name
        if place_substr and place_substr.lower() not in name.lower():
            continue
        if "water_exit" in name.lower():
            continue
        parsed = normalize_prem_key(name)
        if not parsed:
            continue
        key, prem, shot = parsed
        out.append({
            "source": "local",
            "path": str(p),
            "name": name,
            "key": key,
            "prem": prem,
            "shot": shot,
        })
    return out


def collect_db(place_substr: str | None) -> list[dict]:
    from supabase import create_client

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_ANON_KEY")
    if not url or not key:
        print("Missing SUPABASE_URL / key", file=sys.stderr)
        return []
    sb = create_client(url, key)

    place_ids = None
    if place_substr:
        places = (
            sb.table("places")
            .select("id, name_en")
            .ilike("name_en", f"%{place_substr}%")
            .execute()
            .data
            or []
        )
        place_ids = {p["id"] for p in places}
        if not place_ids:
            print(f"No places matching {place_substr!r}")
            return []

    # Paginate
    rows: list[dict] = []
    page = 0
    page_size = 1000
    while True:
        q = (
            sb.table("place_hero_images")
            .select("id, place_id, storage_path, character, is_active, sort_order")
            .range(page * page_size, (page + 1) * page_size - 1)
        )
        if place_ids is not None:
            q = q.in_("place_id", list(place_ids))
        batch = q.execute().data or []
        rows.extend(batch)
        if len(batch) < page_size:
            break
        page += 1

    out = []
    for r in rows:
        path = r.get("storage_path") or ""
        name = path.rsplit("/", 1)[-1]
        if "water_exit" in name.lower():
            continue
        parsed = normalize_prem_key(name)
        if not parsed:
            continue
        key, prem, shot = parsed
        out.append({
            "source": "db",
            "path": path,
            "name": name,
            "key": key,
            "prem": prem,
            "shot": shot,
            "is_active": r.get("is_active"),
            "character": r.get("character"),
            "id": r.get("id"),
        })
    return out


def review_groups(items: list[dict]) -> list[tuple[str, list[dict]]]:
    """Groups where ≥2 files share a key AND premium tag sets differ."""
    by_key: dict[str, list[dict]] = defaultdict(list)
    for it in items:
        by_key[it["key"]].append(it)

    highlighted = []
    for key, group in sorted(by_key.items()):
        if len(group) < 2:
            continue
        prem_sets = {frozenset(it["prem"]) for it in group}
        # Need at least two different premium footprints (incl. empty = no prem)
        if len(prem_sets) < 2:
            continue
        # Prefer showing groups that actually mix prem vs plain or different prems
        highlighted.append((key, sorted(group, key=lambda x: x["name"])))
    return highlighted


def _fmt_prem(prem: frozenset[str]) -> str:
    if not prem:
        return "(plain)"
    return "+".join(sorted(prem))


def print_report(title: str, groups: list[tuple[str, list[dict]]]) -> int:
    print(f"\n{'═' * 64}")
    print(f"{title} — {len(groups)} group(s) to review")
    print(f"{'═' * 64}")
    if not groups:
        print("  (none)")
        return 0
    for i, (key, group) in enumerate(groups, 1):
        print(f"\n[{i}] key: {key}")
        for it in group:
            active = ""
            if "is_active" in it:
                active = " active" if it["is_active"] else " inactive"
            print(f"    · {_fmt_prem(it['prem']):22} {it['name']}{active}")
            if it["source"] == "local":
                print(f"      {it['path']}")
            else:
                print(f"      {it['path']}")
    return len(groups)


def export_groups(groups: list[tuple[str, list[dict]]], dest: Path) -> int:
    """Copy local group files into dest/NN_key/ for side-by-side review."""
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True)
    n_files = 0
    for i, (key, group) in enumerate(groups, 1):
        folder = dest / f"{i:02d}_{key}"
        folder.mkdir()
        for it in group:
            if it["source"] != "local":
                continue
            src = Path(it["path"])
            if not src.is_file():
                print(f"  missing: {src}", file=sys.stderr)
                continue
            tag = _fmt_prem(it["prem"]).replace("+", "-").replace("(", "").replace(")", "")
            out_name = f"{tag}__{src.name}"
            shutil.copy2(src, folder / out_name)
            n_files += 1
    return n_files


def main() -> None:
    p = argparse.ArgumentParser(description="Review hero files that differ only by premium tag")
    src = p.add_mutually_exclusive_group()
    src.add_argument("--local", action="store_true", help="Scan ~/sunnomad_output only (default)")
    src.add_argument("--db", action="store_true", help="Scan place_hero_images only")
    src.add_argument("--both", action="store_true", help="Scan local + DB")
    p.add_argument("--place", help="Filter by place name / filename substr")
    p.add_argument("--dir", type=Path, default=OUTPUT_DIR, help="Local output dir")
    p.add_argument(
        "--export",
        nargs="?",
        const="__default__",
        metavar="DIR",
        help="Copy local review groups into DIR (default: <output>/_prem_review)",
    )
    args = p.parse_args()

    do_local = args.local or args.both or (not args.db and not args.both)
    do_db = args.db or args.both
    # default = local only
    if not args.local and not args.db and not args.both:
        do_local, do_db = True, False
    if args.export is not None:
        do_local = True  # export needs local files

    total = 0
    local_groups: list[tuple[str, list[dict]]] = []
    if do_local:
        items = collect_local(args.dir, args.place)
        local_groups = review_groups(items)
        total += print_report(f"LOCAL {args.dir}", local_groups)

    if do_db:
        items = collect_db(args.place)
        groups = review_groups(items)
        total += print_report("DB place_hero_images", groups)

    if args.export is not None:
        dest = (
            Path(args.dir) / "_prem_review"
            if args.export == "__default__"
            else Path(os.path.expanduser(args.export))
        )
        n = export_groups(local_groups, dest)
        print(f"\nExported {n} files → {dest}")

    print(f"\nTotal review groups: {total}")
    if total and args.export is None:
        print("No deletes — pick winners manually, then sync.")


if __name__ == "__main__":
    main()
