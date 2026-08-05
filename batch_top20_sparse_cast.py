#!/usr/bin/env python3
"""Top-20 attractiveness batch for places with sparse / disabled-only cast.

Include if:
  A) no active human cast images
  B) exactly 1 active human cast image
  C) cast images only from DISABLED_CHARACTERS

Skip if:
  - ≥1 Regina (Sonder-Skip)
  - only Cleo cast (1× Cleo is enough — Witness places ok)
  - LATAM_BATCH_EXCLUDE / BATCH_EXCLUDE / GOLDIE_ONLY (unless --latam under --us)
  - ≥2 cast images from any active (non-disabled) char

Cast sources: active DB rows ∪ local ~/sunnomad_output cast webps
(main/arrival/activity/… — dry-runs not yet in DB still count).
Local place with ≥2 cast files = done (skip), even if DB not uploaded yet
or cast is DISABLED (e.g. maria) and sync will not activate.
If a more specific sibling has cast (e.g. Clearwater Beach → Tammy),
still queue the bare name (Clearwater city) but force that same character.

Region (required):
  --us   US / CA / MX  (+ LatAm with --latam later)
  --eu   Europe cast bucket + TR + North Africa

Run: --safe --us|--eu --include-existing-cast --no-pick-char
  1x active cast → --character <that char>
  else → auto select_character

Examples:
  python3 batch_top20_sparse_cast.py --us
  python3 batch_top20_sparse_cast.py --eu
  python3 batch_top20_sparse_cast.py --us --list
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent

from generate_hero_images import (
    BATCH_EXCLUDE_PLACE_NAMES,
    DISABLED_CHARACTERS,
    GOLDIE_ONLY_PLACE_NAMES,
    LATAM_BATCH_EXCLUDE,
    MAGHREB_TR_MODEST_COUNTRIES,
    _CAST_EU_CC,
    _KELEK_NORTH_AFRICA_CC,
    _MISSING_CAST_NON_HUMAN,
    _local_cast_files_by_slug,
    _place_file_slugs,
    _row_is_active_human_cast,
    supabase,
)
from sync_hero_activation import load_overrides

LIMIT = 20

# --us: North America now; LatAm codes ready for --latam
REGION_US = frozenset({"US", "CA", "MX"})
REGION_US_LATAM = frozenset(LATAM_BATCH_EXCLUDE)  # rest of LatAm / Caribbean when cast ready

# --eu: European cast bucket + Turkey + North Africa
REGION_EU = frozenset(_CAST_EU_CC) | frozenset(MAGHREB_TR_MODEST_COUNTRIES) | frozenset(
    _KELEK_NORTH_AFRICA_CC
)


def _active_cast_by_place() -> dict[str, list[str]]:
    by_place: dict[str, list[str]] = defaultdict(list)
    start = 0
    while True:
        rows = (
            supabase.table("place_hero_images")
            .select("place_id,character,variant,storage_path")
            .eq("is_active", True)
            .range(start, start + 999)
            .execute()
            .data
            or []
        )
        if not rows:
            break
        for r in rows:
            if not _row_is_active_human_cast(r):
                continue
            char = (r.get("character") or "").lower().strip()
            if not char or char in _MISSING_CAST_NON_HUMAN:
                continue
            by_place[r["place_id"]].append(char)
        if len(rows) < 1000:
            break
        start += 1000
    return by_place


def _merge_local_cast(
    by_place: dict[str, list[str]], places: list[dict]
) -> tuple[dict[str, list[str]], dict[str, int]]:
    """Merge local cast webps into DB counts; return (by_place, local_file_count_by_pid)."""
    local = _local_cast_files_by_slug()
    out: dict[str, list[str]] = {pid: list(chars) for pid, chars in by_place.items()}
    local_n: dict[str, int] = {}
    if not local:
        return out, local_n
    for p in places:
        pid = p["id"]
        hit_chars: list[str] = []
        for slug in _place_file_slugs(p):
            hit_chars.extend(local.get(slug, []))
        local_n[pid] = len(hit_chars)
        if not hit_chars:
            continue
        merged = out.get(pid, [])
        for char in hit_chars:
            merged.append(char)
        out[pid] = merged
    return out, local_n


def _sibling_force_char(
    place: dict,
    places: list[dict],
    local_n: dict[str, int],
    by_place: dict[str, list[str]],
    *,
    min_local: int = 2,
) -> str:
    """If a more specific same-country sibling has cast, return its dominant char.

    E.g. Clearwater Beach (tammy×5) → force tammy for bare Clearwater city.
    Match: other name starts with \"{name} \" (Clearwater Beach, …).
    """
    name = (place.get("name_en") or "").strip()
    cc = (place.get("country_code") or "").upper()
    if not name or not cc:
        return ""
    prefix = name + " "
    pid = place["id"]
    for other in places:
        if other.get("id") == pid:
            continue
        if (other.get("country_code") or "").upper() != cc:
            continue
        oname = (other.get("name_en") or "").strip()
        if not oname.startswith(prefix):
            continue
        oid = other["id"]
        chars = list(by_place.get(oid, []))
        if local_n.get(oid, 0) < min_local and len(chars) < min_local:
            continue
        # prefer non-disabled majority char
        active = [c for c in chars if c not in DISABLED_CHARACTERS]
        pool = active or chars
        if not pool:
            continue
        # most common
        best = max(set(pool), key=pool.count)
        return best
    return ""


def select_targets(
    region_codes: frozenset[str],
    *,
    include_latam: bool = False,
    limit: int = LIMIT,
) -> list[tuple[str, str, dict]]:
    """Return list of (place_id, force_char_or_empty, place_row)."""
    skip_names = set(BATCH_EXCLUDE_PLACE_NAMES) | set(GOLDIE_ONLY_PLACE_NAMES)
    skip_latam = set() if include_latam else set(LATAM_BATCH_EXCLUDE)
    cc_list = sorted(region_codes)
    places = (
        supabase.table("places")
        .select("id,name_en,country_code,state_name,attractiveness_score,image_slug")
        .eq("is_active", True)
        .in_("country_code", cc_list)
        .order("attractiveness_score", desc=True)
        .limit(800)
        .execute()
        .data
        or []
    )
    by_place, local_n = _merge_local_cast(_active_cast_by_place(), places)
    overrides = load_overrides()
    out: list[tuple[str, str, dict]] = []
    for p in places:
        cc = (p.get("country_code") or "").upper()
        if cc not in region_codes:
            continue
        if cc in skip_latam:
            continue
        if p.get("name_en") in skip_names:
            continue
        # Dry-run set already on disk (≥2 cast files) — do not re-queue
        if local_n.get(p["id"], 0) >= 2:
            continue
        chars = by_place.get(p["id"], [])
        n = len(chars)
        uniq = set(chars)
        if "regina" in uniq:
            continue
        # 1× Cleo (or only-Cleo cast) = covered enough — skip sparse refill
        if uniq == {"cleo"}:
            continue
        # Explicit override to a DISABLED char (e.g. Snoqualmie Falls → maria): keep, no refill
        ov = (overrides.get(p.get("name_en") or "") or "").lower()
        if ov in DISABLED_CHARACTERS and ov in uniq and n >= 2:
            continue
        ok = (
            n == 0
            or n == 1
            or (n >= 1 and uniq and uniq.issubset(DISABLED_CHARACTERS))
        )
        if not ok:
            continue
        force = ""
        if n == 1:
            only = chars[0]
            if only not in DISABLED_CHARACTERS or only == ov:
                force = only
        # Clearwater city empty but Clearwater Beach has Tammy → force Tammy
        if not force:
            force = _sibling_force_char(p, places, local_n, by_place)
        out.append((p["id"], force, p))
        if len(out) >= limit:
            break
    return out


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Top-20 sparse-cast batch by region")
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument(
        "--us",
        action="store_true",
        help="US / CA / MX (add --latam for rest of LatAm later)",
    )
    g.add_argument(
        "--eu",
        action="store_true",
        help="Europe (_CAST_EU_CC) + TR + North Africa",
    )
    p.add_argument(
        "--latam",
        action="store_true",
        help="With --us: also include LatAm/Caribbean (REGION_US_LATAM)",
    )
    p.add_argument("--list", action="store_true", help="Print place IDs only, no generate")
    p.add_argument("--limit", type=int, default=LIMIT, help=f"Max places (default {LIMIT})")
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    if args.latam and not args.us:
        print("--latam requires --us", file=sys.stderr)
        return 2
    if args.us:
        region = "us"
        region_codes = frozenset(REGION_US)
        if args.latam:
            region_codes |= REGION_US_LATAM
    else:
        region = "eu"
        region_codes = frozenset(REGION_EU)

    targets = select_targets(
        region_codes, include_latam=args.latam, limit=args.limit,
    )
    if not targets:
        print(f"no targets ({region})", file=sys.stderr)
        return 1
    print(f"region={region}  n={len(targets)}  codes={len(region_codes)}", file=sys.stderr)
    for i, (pid, force, p) in enumerate(targets, 1):
        cc = (p.get("country_code") or "").upper()
        mode = f"force={force}" if force else "auto"
        print(
            f"  {i:2}. {p.get('attractiveness_score', '?'):>3} {cc:2} "
            f"{p.get('name_en')}  {mode}",
            file=sys.stderr,
        )
    if args.list:
        print(",".join(pid for pid, _, _ in targets))
        return 0

    geo_flag = "--us" if region == "us" else "--eu"
    for pid, force, p in targets:
        cmd = [
            sys.executable,
            "generate_hero_images.py",
            "--safe",
            geo_flag,
            "--include-existing-cast",
            "--no-pick-char",
            "--limit",
            "1",
            "--only-ids",
            pid,
        ]
        if force:
            cmd.extend(["--character", force])
        print(
            f">>> {p.get('name_en')}  {geo_flag}  "
            f"{'force=' + force if force else 'auto'}",
            flush=True,
        )
        r = subprocess.run(cmd, cwd=ROOT)
        if r.returncode != 0:
            print(f"  ⚠️  exit {r.returncode} — continuing", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
