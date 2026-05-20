"""
SunNomad — Add Camping Links
=============================
Post-processing script. Reads enriched CSV, adds camping_link column.

Logic:
- Only adds a link if a known campsite name is found in stay text
- Direct Google search link for that campsite — user finds official site
- No affiliate, no spam

Usage:
  python add_camping_links.py \
    --input places_2k_enriched.csv \
    --output places_2k_with_links.csv
"""

import argparse
import csv
import re
import urllib.parse

CAMPSITE_PATTERNS = [
    r"Camping\s+[\w\s\-\']+",
    r"Campsite\s+[\w\s\-\']+",
    r"Área\s+de\s+[Aa]utocaravanas\s+[\w\s\-\']+",
    r"Area\s+[Ss]osta\s+[\w\s\-\']+",
    r"Wohnmobilpark\s+[\w\s\-\']+",
    r"Wohnmobilstellplatz\s+[\w\s\-\']+",
    r"Stellplatz\s+[\w\s\-\']+",
    r"Campingplatz\s+[\w\s\-\']+",
    r"[\w\s\-\']+\s+Camping",
]

NO_LINK_KEYWORDS = [
    "conflict zone",
    "travel not recommended",
    "unverified",
    "check park4night",
]

def extract_campsite_name(stay: str) -> str | None:
    for pattern in CAMPSITE_PATTERNS:
        match = re.search(pattern, stay)
        if match:
            name = match.group(0).strip()
            name = re.sub(r'\s*[–\-—:,\.]+\s*$', '', name)
            if 5 < len(name) < 60:
                return name
    return None

def should_skip(row: dict) -> bool:
    stay = (row.get("stay") or "").lower()
    for kw in NO_LINK_KEYWORDS:
        if kw in stay:
            return True
    if row.get("research_score") == "1":
        return True
    return False

def generate_link(row: dict) -> str:
    if should_skip(row):
        return ""
    stay = row.get("stay", "")
    name = extract_campsite_name(stay)
    if not name:
        return ""
    query = urllib.parse.quote(f"{name} {row.get('ort', '')} camping")
    return f"https://www.google.com/search?q={query}"

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input",  required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    with open(args.input, encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))

    fieldnames = list(rows[0].keys())
    if "camping_link" not in fieldnames:
        fieldnames.append("camping_link")

    added = 0
    for row in rows:
        link = generate_link(row)
        row["camping_link"] = link
        if link:
            added += 1

    with open(args.output, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames,
                                extrasaction="ignore", quoting=csv.QUOTE_ALL)
        writer.writeheader()
        writer.writerows(rows)

    print(f"Done. {added}/{len(rows)} Orte mit Link → {args.output}")

if __name__ == "__main__":
    main()