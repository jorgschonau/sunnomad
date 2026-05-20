import os
import imagehash
import numpy as np
from PIL import Image, ImageFilter, ImageStat

UNSPLASH_DIR = "./unsplash_output"
PEXELS_DIR   = "./pexels_output"
OUTPUT_DIR   = "./output"
TARGET_W, TARGET_H, TARGET_KB = 800, 1200, 80
PHASH_THRESHOLD = 8  # < 8 = Duplikat, erhöhen wenn zu aggressiv
os.makedirs(OUTPUT_DIR, exist_ok=True)

# --- Global seen hashes (cross-place dedup) ---
global_seen = {}

def is_duplicate(path):
    h = imagehash.phash(Image.open(path))
    for seen_hash, seen_path in global_seen.items():
        if abs(h - seen_hash) < PHASH_THRESHOLD:
            return True, seen_path
    global_seen[h] = path
    return False, None

def has_person(path, skin_threshold=0.18):
    img = Image.open(path).convert("RGB").resize((100, 100))
    pixels = list(img.getdata())
    skin = sum(1 for r,g,b in pixels
               if r > 95 and g > 40 and b > 20
               and max(r,g,b) - min(r,g,b) > 15
               and r > g and r > b)
    return (skin / len(pixels)) > skin_threshold

def cityscape_score(path):
    img_gray = Image.open(path).convert("L").resize((100, 150))
    arr = np.array(img_gray)
    edges = np.array(Image.fromarray(arr).filter(ImageFilter.FIND_EDGES))

    top    = edges[:50, :]
    middle = edges[50:100, :]
    bottom = edges[100:, :]

    top_density    = top.mean()
    middle_density = middle.mean()
    bottom_density = bottom.mean()

    skyline_score      = bottom_density / (top_density + 1)
    distribution_score = min(top_density, bottom_density) / (middle_density + 1)

    img_rgb = Image.open(path).convert("RGB").resize((100, 150))
    top_rgb = np.array(img_rgb)[:50, :]
    sky_bonus = (top_rgb.mean() / 255) * 5

    return (skyline_score * 8) + (distribution_score * 5) + sky_bonus

def score_image(path):
    img = Image.open(path).convert("RGB")
    stat = ImageStat.Stat(img)
    w, h = img.size

    ratio_score      = 10 if h > w else 0
    brightness_score = 10 - abs(stat.mean[0] - 130) / 13
    contrast_score   = min(stat.stddev[0] / 10, 10)
    city_score       = cityscape_score(path) * 3

    return ratio_score + brightness_score + contrast_score + city_score

def convert_to_webp(src, dst):
    with Image.open(src) as img:
        img = img.convert("RGB")
        ratio = max(TARGET_W / img.width, TARGET_H / img.height)
        nw, nh = int(img.width * ratio), int(img.height * ratio)
        img = img.resize((nw, nh), Image.LANCZOS)
        left = (nw - TARGET_W) // 2
        top  = (nh - TARGET_H) // 2
        img = img.crop((left, top, left + TARGET_W, top + TARGET_H))
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

def get_place_key(filename):
    name = os.path.splitext(filename)[0]
    for suffix in ["_unspl", "_pexels_1", "_pexels_2", "_pexels_3"]:
        if name.endswith(suffix):
            return name[: -len(suffix)]
    return name

# --- Collect files grouped by place ---
places = {}
for folder in [UNSPLASH_DIR, PEXELS_DIR]:
    for fname in os.listdir(folder):
        if not fname.lower().endswith((".webp", ".jpg", ".jpeg", ".png")):
            continue
        key = get_place_key(fname)
        places.setdefault(key, []).append(os.path.join(folder, fname))

# --- Process ---
skipped_all, processed = 0, 0
for key, candidates in sorted(places.items()):
    scored = []
    for path in candidates:
        dup, dup_of = is_duplicate(path)
        if dup:
            print(f"  SKIP (dup of {os.path.basename(dup_of)}): {os.path.basename(path)}")
            continue
        if has_person(path):
            print(f"  SKIP (person): {os.path.basename(path)}")
            continue
        s = score_image(path)
        scored.append((s, path))
        print(f"  scored {os.path.basename(path)}: {s:.1f}")

    if not scored:
        print(f"{key}: ALL filtered — skipping")
        skipped_all += 1
        continue

    scored.sort(reverse=True)
    best_score, best_path = scored[0]
    dst = os.path.join(OUTPUT_DIR, f"{key}_pexels_1.webp")
    kb  = convert_to_webp(best_path, dst)
    print(f"✓ {key}: {os.path.basename(best_path)} → {kb:.0f}kb (score={best_score:.1f})\n")
    processed += 1

print(f"\nDone: {processed} processed, {skipped_all} fully skipped")