import os
from PIL import Image, ImageFilter, ImageEnhance, ImageStat

src_dir = "/Users/jorg/cursor_tutorial/pexels_output"
dst_dir = os.path.join(src_dir, "webp")
os.makedirs(dst_dir, exist_ok=True)

TARGET_W, TARGET_H = 800, 1200
TARGET_KB = 80


def enhance_adaptive(img):
    stat = ImageStat.Stat(img)

    hsv = img.convert("HSV")
    sat_mean = ImageStat.Stat(hsv).mean[1]  # 0-255

    gray = img.convert("L")
    std = ImageStat.Stat(gray).stddev[0]

    brightness_mean = stat.mean[0] * 0.299 + stat.mean[1] * 0.587 + stat.mean[2] * 0.114

    contrast_factor   = 1.0 + max(0, (60 - std) / 60) * 0.35
    color_factor      = 1.0 + max(0, (80 - sat_mean) / 80) * 0.4
    brightness_factor = 1.0 + (128 - brightness_mean) / 128 * 0.1

    print(f"  std={std:.1f} sat={sat_mean:.1f} bright={brightness_mean:.1f} → "
          f"contrast={contrast_factor:.2f} color={color_factor:.2f} brightness={brightness_factor:.2f}")

    img = ImageEnhance.Contrast(img).enhance(contrast_factor)
    img = ImageEnhance.Color(img).enhance(color_factor)
    img = ImageEnhance.Brightness(img).enhance(brightness_factor)
    return img


for fname in sorted(os.listdir(src_dir)):
    if not fname.lower().endswith(('.png', '.jpg', '.jpeg', '.webp')):
        continue

    src = os.path.join(src_dir, fname)
    name = os.path.splitext(fname)[0]
    dst = os.path.join(dst_dir, name + ".webp")

    with Image.open(src) as img:
        img = img.convert("RGB")

        # Resize + center crop
        ratio = max(TARGET_W / img.width, TARGET_H / img.height)
        new_w, new_h = int(img.width * ratio), int(img.height * ratio)
        img = img.resize((new_w, new_h), Image.LANCZOS)
        left = (new_w - TARGET_W) // 2
        top  = (new_h - TARGET_H) // 2
        img = img.crop((left, top, left + TARGET_W, top + TARGET_H))

        # Adaptive enhancement
        img = enhance_adaptive(img)

        # Sharpening
        img = img.filter(ImageFilter.UnsharpMask(radius=1, percent=80, threshold=3))

        # Binary search für ~80kb
        lo, hi, mid = 10, 95, 80
        while lo < hi - 1:
            mid = (lo + hi) // 2
            img.save(dst, "webp", quality=mid)
            size_kb = os.path.getsize(dst) / 1024
            if size_kb > TARGET_KB * 1.2:   hi = mid
            elif size_kb < TARGET_KB * 0.8: lo = mid
            else: break

        print(f"  {fname} → {name}.webp ({os.path.getsize(dst)/1024:.0f}kb, q={mid})\n")