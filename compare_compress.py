import argparse
import json
import os

import imagehash
import numpy as np
from PIL import Image

from stock_image_score import place_key_from_filename, score_candidate

UNSPLASH_DIR = "./unsplash_output"
PEXELS_DIR   = "./pexels_output"
OUTPUT_DIR   = "./output"
TARGET_W, TARGET_H, TARGET_KB = 800, 1200, 80
PHASH_THRESHOLD = 8
MIN_SCORE = 20  # unterhalb → kein output (lieber kein Bild als Müll)
os.makedirs(OUTPUT_DIR, exist_ok=True)

# --- Meta aus den Download-Scripts ---
meta = {}
for folder in [UNSPLASH_DIR, PEXELS_DIR]:
    path = os.path.join(folder, "meta.json")
    if os.path.exists(path):
        with open(path) as f:
            meta.update(json.load(f))

global_seen = {}


def is_duplicate(path):
    h = imagehash.phash(Image.open(path))
    for seen_hash, seen_path in global_seen.items():
        if abs(h - seen_hash) < PHASH_THRESHOLD:
            return True, seen_path
    global_seen[h] = path
    return False, None


def grade_hero(img):
    """Dezenter Teal&Orange-Look: kühle Schatten, warme Lichter,
    sanfte S-Kurve, Vibrance. Bewusst subtil — soll nachhelfen, nicht färben."""
    arr = np.asarray(img, dtype=np.float32) / 255.0
    lum = (arr[..., 0] * 0.299 + arr[..., 1] * 0.587 + arr[..., 2] * 0.114)[..., None]

    # Split-Toning
    shadows = np.clip(1.0 - lum * 2.2, 0.0, 1.0)
    highlights = np.clip(lum * 2.2 - 1.2, 0.0, 1.0)
    teal = np.array([-0.020, 0.008, 0.030], dtype=np.float32)
    orange = np.array([0.035, 0.012, -0.028], dtype=np.float32)
    arr = arr + shadows * teal + highlights * orange

    # Sanfte S-Kurve (20% smoothstep-Anteil)
    arr = np.clip(arr, 0.0, 1.0)
    arr = arr * 0.8 + (arr * arr * (3.0 - 2.0 * arr)) * 0.2

    # Vibrance: wenig gesättigte Pixel stärker anheben als bereits satte
    sat = arr.max(axis=-1, keepdims=True) - arr.min(axis=-1, keepdims=True)
    boost = 1.0 + 0.18 * (1.0 - np.clip(sat * 2.5, 0.0, 1.0))
    arr = lum + (arr - lum) * boost

    return Image.fromarray((np.clip(arr, 0.0, 1.0) * 255).astype(np.uint8))


def convert_to_webp(src, dst):
    from PIL import ImageFilter

    with Image.open(src) as img:
        img = img.convert("RGB")
        ratio = max(TARGET_W / img.width, TARGET_H / img.height)
        nw, nh = int(img.width * ratio), int(img.height * ratio)
        img = img.resize((nw, nh), Image.LANCZOS)
        left = (nw - TARGET_W) // 2
        top  = (nh - TARGET_H) // 2
        img = img.crop((left, top, left + TARGET_W, top + TARGET_H))
        img = grade_hero(img)
        img = img.filter(ImageFilter.UnsharpMask(radius=1, percent=80, threshold=3))

        lo, hi, mid = 10, 95, 50
        while lo < hi - 1:
            mid = (lo + hi) // 2
            img.save(dst, "webp", quality=mid)
            kb = os.path.getsize(dst) / 1024
            if   kb > TARGET_KB * 1.2: hi = mid
            elif kb < TARGET_KB * 0.8: lo = mid
            else: break

        return os.path.getsize(dst) / 1024


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true",
                        help="Orte neu bewerten, für die output/ schon ein Bild hat "
                             "(z.B. nach Änderungen an der Scoring-Logik)")
    args = parser.parse_args()

    places = {}
    for folder in [UNSPLASH_DIR, PEXELS_DIR]:
        if not os.path.isdir(folder):
            continue
        for fname in os.listdir(folder):
            if not fname.lower().endswith((".webp", ".jpg", ".jpeg", ".png")):
                continue
            key = place_key_from_filename(fname)
            places.setdefault(key, []).append(os.path.join(folder, fname))

    skipped_all, processed, rejected_low, already_done = 0, 0, 0, 0
    for key, candidates in sorted(places.items()):
        if not args.force and os.path.exists(os.path.join(OUTPUT_DIR, f"{key}_pexels_1.webp")):
            already_done += 1
            continue

        candidates.sort(
            key=lambda p: not meta.get(os.path.basename(p), {}).get("relevant", False)
        )

        scored = []
        for path in candidates:
            dup, dup_of = is_duplicate(path)
            if dup:
                print(f"  SKIP (dup of {os.path.basename(dup_of)}): {os.path.basename(path)}")
                continue

            info = meta.get(os.path.basename(path), {})
            s, tags = score_candidate(path, info)
            scored.append((s, path, tags))
            tag_str = f" [{', '.join(tags)}]" if tags else ""
            print(f"  scored {os.path.basename(path)}: {s:.1f}{tag_str}")

        if not scored:
            print(f"{key}: ALL filtered — skipping\n")
            skipped_all += 1
            continue

        scored.sort(reverse=True)
        best_score, best_path, best_tags = scored[0]

        if best_score < MIN_SCORE:
            print(f"{key}: best score {best_score:.1f} < {MIN_SCORE} — rejected\n")
            rejected_low += 1
            continue

        dst = os.path.join(OUTPUT_DIR, f"{key}_pexels_1.webp")
        kb  = convert_to_webp(best_path, dst)
        print(f"✓ {key}: {os.path.basename(best_path)} → {kb:.0f}kb (score={best_score:.1f})\n")
        processed += 1

    print(
        f"\nDone: {processed} processed, {already_done} already in output/, "
        f"{skipped_all} no candidates, {rejected_low} rejected (score too low)"
    )


if __name__ == "__main__":
    main()
