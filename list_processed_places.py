#!/usr/bin/env python3
"""Scan ~/sunnomad_output and write PROCESSED_PLACES.md for batch-run reference."""

from __future__ import annotations

import argparse
import os
import re
import unicodedata
from collections import defaultdict
from datetime import date
from pathlib import Path

OUTPUT_DIR = Path.home() / "sunnomad_output"
OUT_MD = Path(__file__).resolve().parent / "PROCESSED_PLACES.md"

CHARACTERS = sorted(
    [
        "driver_pov", "driver_van", "alessandra", "valentina", "charlotte", "ingrid",
        "naomi", "sofia", "yosra", "elena", "katja", "jade", "luca", "chad", "regina",
        "maya", "diaz", "stacy", "kay", "thea", "tammy", "lyra", "werra", "olga", "nina",
        "mila", "sigrid", "quinn", "isabella", "maria", "rosa", "carmela", "yuki", "celine",
        "amber", "bianca", "camille", "cleo", "diana", "kelek", "terry", "vera", "goldie",
        "metka", "tasha", "zara", "djordje", "conrad", "jane", "ana", "oksana", "kiona",
        "zsofi", "klara", "nadia",
    ],
    key=len,
    reverse=True,
)

SHOT_RE = re.compile(
    r"("
    r"_main(_\d+)?|_arrival(_\d+)?|_farshot(_\d+)?|_dayhike(_\d+)?|_noreview(_\d+)?|"
    r"_activity_[a-z0-9_]+|_exploit_[a-z0-9_]+|_cinematic_[a-z0-9_]+|"
    r"_golden_[a-z0-9_]+|_scenic_[a-z0-9_]+|_boost_[a-z0-9_]+|_pexels_[a-z0-9_]+|"
    r"_roadtrip(_main)?(_\d+)?"
    r")$",
    re.I,
)

CHAR_ALIASES = {"driver": "driver_pov"}

CC_RE = re.compile(r"^[a-z]{2}$")


def ascii_fold(s: str) -> str:
    return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii")


def place_slug(name: str) -> str:
    raw = ascii_fold(name.lower())
    return re.sub(r"[^a-z0-9]+", "_", raw).strip("_")


def clean_stem(stem: str) -> str:
    s = stem.lower()
    if s.startswith("sunnomad_"):
        s = s[9:]
    s = re.sub(r"_\d{6}$", "", s)
    s = re.sub(r"_(\d+kb_)?(keep|del)$", "", s, flags=re.I)
    s = s.replace("_cast_", "_")
    s = re.sub(r"_large$", "", s, flags=re.I)
    return s


def _strip_shots(s: str) -> str:
    while True:
        m = SHOT_RE.search(s)
        if not m:
            return s
        s = s[: m.start()]


def _find_character(s: str) -> tuple[int, str] | None:
    best: tuple[int, str] | None = None
    for ch in CHARACTERS:
        marker = f"_{ch}"
        idx = s.rfind(marker)
        if idx == -1:
            continue
        end = idx + len(marker)
        if end != len(s) and s[end] != "_":
            continue
        if best is None or idx > best[0] or (idx == best[0] and len(ch) > len(best[1])):
            best = (idx, ch)
    for alias, ch in CHAR_ALIASES.items():
        marker = f"_{alias}"
        idx = s.rfind(marker)
        if idx == -1:
            continue
        end = idx + len(marker)
        if end != len(s) and s[end] != "_":
            continue
        if best is None or idx > best[0]:
            best = (idx, ch)
    return best


def _split_place_cc(prefix: str) -> tuple[str, str] | None:
    parts = prefix.split("_")
    if len(parts) >= 2 and CC_RE.match(parts[-1]):
        return "_".join(parts[:-1]), parts[-1]
    return None


def parse_filename(stem: str, db_slugs: list[tuple[str, str]] | None = None) -> tuple[str, str, set[str]] | None:
    """Return (place_slug, country_code, characters) or None."""
    s = _strip_shots(clean_stem(stem))
    chars: set[str] = set()

    hit = _find_character(s)
    if hit:
        idx, ch = hit
        chars.add(ch)
        prefix = s[:idx]
        split = _split_place_cc(prefix)
        if split:
            return split[0], split[1], chars
        if db_slugs:
            for slug, cc in db_slugs:
                if prefix == slug or prefix == f"{slug}_{cc}" or prefix.startswith(f"{slug}_"):
                    return slug, cc, chars
        return prefix, "??", chars

    if s.endswith("_roadtrip"):
        s = s[: -len("_roadtrip")]
    split = _split_place_cc(s)
    if split:
        return split[0], split[1], chars

    if db_slugs:
        for slug, cc in sorted(db_slugs, key=lambda x: len(x[0]), reverse=True):
            for head in (f"{slug}_{cc}", slug):
                if s == head or s.startswith(f"{head}_"):
                    return slug, cc, chars
    return None


def load_db_places() -> dict[tuple[str, str], dict]:
    try:
        from dotenv import load_dotenv
        from supabase import create_client

        load_dotenv()
        url = os.environ.get("SUPABASE_URL")
        key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_ANON_KEY")
        if not url or not key:
            return {}
        client = create_client(url, key)
        rows = []
        offset = 0
        page = 1000
        while True:
            batch = (
                client.table("places")
                .select("id, name_en, country_code")
                .range(offset, offset + page - 1)
                .execute()
            ).data or []
            if not batch:
                break
            rows.extend(batch)
            if len(batch) < page:
                break
            offset += page
        out: dict[tuple[str, str], dict] = {}
        for row in rows:
            slug = place_slug(row.get("name_en") or "")
            cc = (row.get("country_code") or "").lower()
            if slug and cc:
                out[(slug, cc)] = row
        return out
    except Exception as exc:
        print(f"  (DB lookup skipped: {exc})")
        return {}


def scan_output(db: dict[tuple[str, str], dict] | None = None) -> tuple[dict[str, dict], list[str]]:
    db_slugs = sorted(db.keys(), key=lambda x: len(x[0]), reverse=True) if db else None
    by_key: dict[str, dict] = {}
    unparsed: list[str] = []
    for path in sorted(OUTPUT_DIR.glob("*.webp")):
        parsed = parse_filename(path.stem, db_slugs=db_slugs)
        if not parsed:
            unparsed.append(path.name)
            continue
        slug, cc, chars = parsed
        key = f"{slug}_{cc}"
        entry = by_key.setdefault(
            key,
            {"slug": slug, "cc": cc, "files": 0, "chars": set(), "shots": set()},
        )
        entry["files"] += 1
        entry["chars"] |= chars
        shot = path.stem
        for marker in ("_main", "_arrival", "_activity_", "_exploit_", "_farshot", "_dayhike", "_roadtrip"):
            if marker in shot.lower():
                entry["shots"].add(marker.strip("_"))
                break
        else:
            entry["shots"].add("other")
    return by_key, unparsed


def write_markdown(by_key: dict[str, dict], db: dict[tuple[str, str], dict], unparsed: list[str]) -> None:
    total_files = sum(e["files"] for e in by_key.values())
    lines = [
        "# Processed Places (Hero Pipeline)",
        "",
        f"Stand: {date.today().isoformat()} · **{len(by_key)} Orte** · **{total_files} Dateien** in `~/sunnomad_output`",
        "",
        "Regenerieren:",
        "",
        "```bash",
        "python3 list_processed_places.py",
        "```",
        "",
        "Vor einem Batch-Lauf: Orte hier abhaken — nicht nochmal generieren.",
        "",
    ]

    by_cc: dict[str, list[dict]] = defaultdict(list)
    for entry in by_key.values():
        by_cc[entry["cc"]].append(entry)

    lines.append("## Nach Land")
    lines.append("")
    for cc in sorted(by_cc, key=lambda c: (c == "??", c)):
        items = sorted(by_cc[cc], key=lambda e: e["slug"])
        lines.append(f"### {cc.upper()} ({len(items)})")
        lines.append("")
        for e in items:
            db_row = db.get((e["slug"], e["cc"]))
            name = (db_row or {}).get("name_en") or e["slug"].replace("_", " ").title()
            pid = (db_row or {}).get("id", "")
            chars = ", ".join(sorted(e["chars"])) if e["chars"] else "—"
            id_part = f" · `{pid}`" if pid else ""
            lines.append(f"- **{name}** (`{e['slug']}_{e['cc']}`){id_part} — {e['files']} files · {chars}")
        lines.append("")

    lines.append("## Slug-Index (copy-paste)")
    lines.append("")
    lines.append("| Ort | CC | Slug | ID | Files | Chars |")
    lines.append("|-----|----|------|----|-------|-------|")
    for key in sorted(by_key):
        e = by_key[key]
        db_row = db.get((e["slug"], e["cc"]))
        name = (db_row or {}).get("name_en") or e["slug"].replace("_", " ")
        pid = (db_row or {}).get("id") or ""
        chars = ", ".join(sorted(e["chars"])) if e["chars"] else "—"
        lines.append(f"| {name} | {e['cc']} | `{e['slug']}` | `{pid}` | {e['files']} | {chars} |")

    if unparsed:
        lines.extend(["", f"## Unparsed ({len(unparsed)})", ""])
        for name in unparsed[:50]:
            lines.append(f"- `{name}`")
        if len(unparsed) > 50:
            lines.append(f"- … +{len(unparsed) - 50} more")

    OUT_MD.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="List places already generated in ~/sunnomad_output")
    parser.add_argument("--no-db", action="store_true", help="Skip Supabase name/ID lookup")
    parser.add_argument("--print-slugs", action="store_true", help="Print slug_cc list to stdout")
    args = parser.parse_args()

    if not OUTPUT_DIR.is_dir():
        raise SystemExit(f"Output dir not found: {OUTPUT_DIR}")

    db = {} if args.no_db else load_db_places()
    by_key, unparsed = scan_output(db)
    write_markdown(by_key, db, unparsed)
    print(f"Wrote {OUT_MD} — {len(by_key)} places, {sum(e['files'] for e in by_key.values())} files")
    if unparsed:
        print(f"  {len(unparsed)} unparsed filenames (see bottom of md)")

    if args.print_slugs:
        for key in sorted(by_key):
            print(key)


if __name__ == "__main__":
    main()
