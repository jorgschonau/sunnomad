#!/usr/bin/env python3
"""Diaz ON-DUTY uniform pass — existing Diaz cast places that qualify for border uniform.

Finds places that already have Diaz (DB active cast ∪ local ~/sunnomad_output),
keeps only US/MX border-qualified spots (is_diaz_border_place), then prints
generate_hero_images.py commands for a full set in uniform.

Default: print commands only (does NOT run).
  --run     actually execute (still dry-run default of generate_hero_images)
  --list    place ids only (comma-separated)

Examples:
  python3 batch_diaz_uniform_pass.py
  python3 batch_diaz_uniform_pass.py --list
  python3 batch_diaz_uniform_pass.py --limit 5
  python3 batch_diaz_uniform_pass.py --run
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent

from generate_hero_images import (
    _MISSING_CAST_NON_HUMAN,
    _local_cast_files_by_slug,
    _place_file_slugs,
    _row_is_active_human_cast,
    is_diaz_border_place,
    supabase,
)

LIMIT_DEFAULT = 50


def _diaz_cast_place_ids() -> dict[str, int]:
    """place_id → count of Diaz cast rows/files (DB + local)."""
    counts: dict[str, int] = defaultdict(int)
    start = 0
    while True:
        rows = (
            supabase.table("place_hero_images")
            .select("place_id,character,variant,storage_path")
            .eq("is_active", True)
            .eq("character", "diaz")
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
            if char != "diaz" or char in _MISSING_CAST_NON_HUMAN:
                continue
            counts[r["place_id"]] += 1
        if len(rows) < 1000:
            break
        start += 1000
    return counts


def _load_places(pids: list[str]) -> list[dict]:
    if not pids:
        return []
    out: list[dict] = []
    # chunk ids
    for i in range(0, len(pids), 80):
        chunk = pids[i : i + 80]
        rows = (
            supabase.table("places")
            .select(
                "id,name_en,country_code,state_name,place_type,terrain_type,"
                "attractiveness_score"
            )
            .in_("id", chunk)
            .execute()
            .data
            or []
        )
        out.extend(rows)
    return out


def select_targets(limit: int) -> list[dict]:
    db_counts = _diaz_cast_place_ids()
    # also local-only diaz files for places we can resolve
    local = _local_cast_files_by_slug()
    # need all US/MX places to map local slugs → ids for diaz
    us_mx = (
        supabase.table("places")
        .select(
            "id,name_en,country_code,state_name,place_type,terrain_type,"
            "attractiveness_score"
        )
        .in_("country_code", ["US", "MX"])
        .execute()
        .data
        or []
    )
    local_n: dict[str, int] = defaultdict(int)
    for p in us_mx:
        n = 0
        for slug in _place_file_slugs(p):
            chars = local.get(slug, [])
            n += sum(1 for c in chars if c == "diaz")
        if n:
            local_n[p["id"]] = n
            db_counts[p["id"]] = db_counts.get(p["id"], 0) + n

    pids = list(db_counts.keys())
    places = _load_places(pids)
    # merge any us_mx rows missing from chunk load (local-only)
    have = {p["id"] for p in places}
    for p in us_mx:
        if p["id"] in local_n and p["id"] not in have:
            places.append(p)

    targets = []
    for p in places:
        if (p.get("country_code") or "").upper() not in {"US", "MX"}:
            continue
        if not is_diaz_border_place(p):
            continue
        if db_counts.get(p["id"], 0) < 1 and local_n.get(p["id"], 0) < 1:
            continue
        targets.append(p)

    targets.sort(
        key=lambda x: (-(x.get("attractiveness_score") or 0), x.get("name_en") or ""),
    )
    return targets[:limit]


def _cmd_for(pid: str) -> list[str]:
    return [
        sys.executable,
        "generate_hero_images.py",
        "--character",
        "diaz",
        "--diaz-on-duty",
        "--safe",
        "--us",
        "--include-existing-cast",
        "--no-pick-char",
        "--limit",
        "1",
        "--only-ids",
        pid,
        "--file-tag",
        "onduty",
    ]


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Diaz uniform pass on existing border cast places (print cmds by default)",
    )
    p.add_argument("--list", action="store_true", help="Comma-separated place IDs only")
    p.add_argument(
        "--run",
        action="store_true",
        help="Execute generate commands (default: print only)",
    )
    p.add_argument("--limit", type=int, default=LIMIT_DEFAULT)
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    targets = select_targets(args.limit)
    if not targets:
        print("no Diaz border places with existing cast", file=sys.stderr)
        return 1
    print(
        f"diaz uniform candidates: {len(targets)} (border + existing cast)",
        file=sys.stderr,
    )
    for i, p in enumerate(targets, 1):
        cc = (p.get("country_code") or "").upper()
        print(
            f"  {i:2}. {p.get('attractiveness_score', '?'):>3} {cc:2} {p.get('name_en')}",
            file=sys.stderr,
        )
    if args.list:
        print(",".join(p["id"] for p in targets))
        return 0

    for p in targets:
        cmd = _cmd_for(p["id"])
        line = " ".join(cmd)
        print(line, flush=True)
        if args.run:
            print(f">>> {p.get('name_en')}  --diaz-on-duty", flush=True)
            r = subprocess.run(cmd, cwd=ROOT)
            if r.returncode != 0:
                print(f"  ⚠️  exit {r.returncode} — continuing", file=sys.stderr)
    if not args.run:
        print(
            f"\n# {len(targets)} commands printed (dry-run default). "
            "Add --run to execute, or copy a line.",
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
