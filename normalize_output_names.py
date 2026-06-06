#!/usr/bin/env python3
"""Normalize hero filenames in ~/sunnomad_output → place_cc_char_…_main.webp style."""

from __future__ import annotations

import argparse
import re
import unicodedata
from collections import defaultdict
from pathlib import Path

OUTPUT_DIR = Path.home() / "sunnomad_output"

SHOT_MARKERS = (
    "_main", "_arrival", "_activity_", "_exploit_", "_cinematic_",
    "_scenic_", "_farshot", "_boost_", "_dayhike", "_pexels_",
)


def ascii_fold(s: str) -> str:
    return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii")


def has_shot_type(stem: str) -> bool:
    s = stem.lower()
    if any(m in s for m in SHOT_MARKERS):
        return True
    return "_goldie_" in f"_{s}_"


def clean_stem(stem: str) -> str:
    if stem.lower().startswith("sunnomad_"):
        stem = stem[9:]
    stem = re.sub(r"_\d{6}$", "", stem)
    stem = re.sub(r"_(\d+kb_)?(KEEP|DEL)$", "", stem, flags=re.I)
    stem = re.sub(r"_large$", "", stem, flags=re.I)
    stem = stem.replace("_cast_", "_")
    stem = re.sub(r"_noreview(_\d+)?", "", stem, flags=re.I)
    stem = re.sub(r"_roadtrip(_\d+)?", "_roadtrip", stem, flags=re.I)
    stem = re.sub(r"_old$", "", stem, flags=re.I)
    stem = stem.replace("altantic", "atlantic")
    return ascii_fold(stem).lower()


def normalize_stem(raw_stem: str) -> str:
    stem = clean_stem(raw_stem)
    if has_shot_type(stem):
        return stem

    dupe = 0
    while True:
        m = re.match(r"^(.+)_(\d+)$", stem)
        if not m or has_shot_type(m.group(1)):
            break
        stem = m.group(1)
        dupe = int(m.group(2)) if dupe == 0 else dupe

    if stem.endswith("_roadtrip"):
        stem = f"{stem}_main"
    else:
        stem = f"{stem}_main"
        if dupe > 1:
            stem = f"{stem}_{dupe - 1}"
    return stem


def assign_unique_names(planned: list[tuple[Path, str]]) -> list[tuple[Path, str]]:
    groups: dict[str, list[Path]] = defaultdict(list)
    for src, stem in planned:
        groups[stem].append(src)

    result: list[tuple[Path, str]] = []
    for stem, sources in sorted(groups.items()):
        sources.sort(key=lambda p: p.name)
        if len(sources) == 1:
            result.append((sources[0], f"{stem}.webp"))
            continue
        for i, src in enumerate(sources):
            suffix = "" if i == 0 else f"_{i}"
            result.append((src, f"{stem}{suffix}.webp"))
    return result


def main():
    parser = argparse.ArgumentParser(description="Normalize sunnomad_output filenames")
    parser.add_argument("--apply", action="store_true", help="Rename files (default: dry-run)")
    parser.add_argument("--dir", type=Path, default=OUTPUT_DIR)
    args = parser.parse_args()

    folder = args.dir.expanduser()
    if not folder.is_dir():
        raise SystemExit(f"Not a directory: {folder}")

    existing = {f.name for f in folder.glob("*.webp")}
    raw_plan: list[tuple[Path, str]] = []
    for f in sorted(folder.glob("*.webp")):
        new_stem = normalize_stem(f.stem)
        if f"{new_stem}.webp" == f.name.lower() and f.name == f.name.lower():
            continue
        raw_plan.append((f, new_stem))

    planned = assign_unique_names(raw_plan)
    # avoid clobbering files that stay put
    final: list[tuple[Path, str]] = []
    targets = {dst for _, dst in planned}
    for src, dst in planned:
        if dst == src.name:
            continue
        if dst in existing and dst not in targets:
            stem, ext = dst.rsplit(".", 1)
            n = 1
            while f"{stem}_{n}.{ext}" in existing or f"{stem}_{n}.{ext}" in targets:
                n += 1
            dst = f"{stem}_{n}.{ext}"
        final.append((src, dst))

    print(f"{'APPLY' if args.apply else 'DRY-RUN'} — {len(final)} renames in {folder}\n")
    for src, dst in final[:40]:
        print(f"  {src.name}\n    -> {dst}")
    if len(final) > 40:
        print(f"  … +{len(final) - 40} more")

    if args.apply:
        for src, dst in final:
            src.rename(folder / dst)
        print(f"\nDone: {len(final)} renamed")
    elif final:
        print("\nRun with --apply to rename")


if __name__ == "__main__":
    main()
