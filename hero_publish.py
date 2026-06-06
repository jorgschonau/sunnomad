#!/usr/bin/env python3
"""Hero pipeline shortcuts. Beta: no remote config — DB sync after manual cast/ upload."""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def run(cmd: list[str]) -> int:
    print(f"\n→ {' '.join(cmd)}\n")
    return subprocess.call(cmd)


def main():
    p = argparse.ArgumentParser(description="Normalize local output and/or sync cast/ → Supabase")
    p.add_argument("--normalize", action="store_true", help="Fix ~/sunnomad_output filenames")
    p.add_argument("--sync", action="store_true", help="Mirror cast/ + activate (default if neither flag)")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--place", help="Limit to place name")
    args = p.parse_args()

    do_norm = args.normalize
    do_sync = args.sync or not args.normalize

    if do_norm:
        norm = [sys.executable, str(ROOT / "normalize_output_names.py")]
        if not args.dry_run:
            norm.append("--apply")
        if run(norm) != 0:
            sys.exit(1)
        if do_sync and not args.dry_run:
            print("Upload ~/sunnomad_output/*.webp → Supabase dedicated/cast/ then continuing…\n")

    if do_sync:
        sync = [sys.executable, str(ROOT / "sync_hero_activation.py"), "--mirror-storage"]
        if args.dry_run:
            sync.append("--dry-run")
        if args.place:
            sync.extend(["--place", args.place])
        sys.exit(run(sync))


if __name__ == "__main__":
    main()
