"""Permanente Blacklist für Pexels/Unsplash-Stock — nie wieder laden/uploaden.

Datei: pexels_audit/blacklist_slugs.txt (eine image_slug pro Zeile, z.B. alice_us).
Wird von apply befüllt und von download/compare/upload/release respektiert.
`release` und `_no_pexels` dürfen diese Einträge nicht wieder freigeben.
"""

from __future__ import annotations

import re
from pathlib import Path

BLACKLIST_PATH = Path("pexels_audit/blacklist_slugs.txt")

_STOCK_SUFFIX = re.compile(r"_(?:pexels|unspl|unsplash)_\d+$", re.I)


def slug_from_filename(name: str) -> str | None:
    base = Path(name).name
    if "/" in base:
        base = base.rsplit("/", 1)[-1]
    stem = base.rsplit(".", 1)[0]
    cleaned = _STOCK_SUFFIX.sub("", stem)
    return cleaned or None


def load_blacklist() -> set[str]:
    if not BLACKLIST_PATH.exists():
        return set()
    return {
        line.strip()
        for line in BLACKLIST_PATH.read_text().splitlines()
        if line.strip() and not line.strip().startswith("#")
    }


def add_slugs(slugs: set[str] | list[str]) -> list[str]:
    """Hängt neue Slugs an, sortiert eindeutig. Gibt die neu hinzugefügten zurück."""
    current = load_blacklist()
    new = sorted({s for s in slugs if s and s not in current})
    if not new:
        return []
    BLACKLIST_PATH.parent.mkdir(parents=True, exist_ok=True)
    all_slugs = sorted(current | set(new))
    BLACKLIST_PATH.write_text(
        "# Permanently rejected stock places — never re-download/upload\n"
        + "\n".join(all_slugs) + "\n"
    )
    return new


def purge_local(slug: str) -> list[str]:
    """Löscht lokale Kandidaten/Output/Cache für einen Slug. Gibt gelöschte Pfade zurück."""
    gone = []
    patterns = [
        Path("pexels_output").glob(f"{slug}_pexels_*.webp"),
        Path("unsplash_output").glob(f"{slug}_unspl_*.webp"),
        Path("output").glob(f"{slug}_pexels_*.webp"),
        Path("output").glob(f"{slug}_unspl_*.webp"),
        Path("pexels_audit/cache").glob(f"{slug}_pexels_*.webp"),
        Path("pexels_audit/cache").glob(f"unaccented__{slug}_pexels_*.webp"),
    ]
    for matches in patterns:
        for p in matches:
            p.unlink(missing_ok=True)
            gone.append(str(p))
    return gone
