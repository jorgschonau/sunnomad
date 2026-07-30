"""Score stock photo candidates — landscape/place shots, not portraits or signage."""

from __future__ import annotations

import re

import numpy as np
from PIL import Image, ImageFilter, ImageStat

NATURE_TYPES = {
    "beach", "lake", "mountain", "scenic_drive", "nature_reserve",
    "natural_park", "national_park", "natural_feature",
}

BAD_ALT_KEYWORDS = (
    # Personen
    "portrait", "woman", "women", "man", "men", "person", "people", "model",
    "selfie", "face", "headshot", "couple", "girl", "boy", "wedding", "makeup",
    "dj", "festival", "fashion", "hoodie",
    # Schrift / Zeichen
    "logo", "sign", "text", "graffiti", "neon", "letter", "typography",
    "poster", "sticker",
    # Einzelobjekte / Close-ups
    "flag", "close-up", "closeup", "close up", "macro", "globe", "car",
    "vehicle", "bottle", "coffee", "food", "plate", "drink", "phone", "book",
    "flower", "flowers", "leaf", "dog", "cat", "bird", "horse", "cow", "cows",
    "sheep", "insect", "butterfly", "statue", "mailbox", "lamp", "chair",
    "table", "guitar", "camera", "shoes", "hand", "hands",
)

GOOD_ALT_KEYWORDS = (
    "landscape", "cityscape", "aerial", "skyline", "coast", "beach", "view",
    "panorama", "harbor", "harbour", "old town", "village", "mountain", "lake",
    "architecture", "street", "downtown", "historic", "scenic", "sunset",
    "sunrise", "waterfront", "harbour", "bay", "cliff", "valley", "forest",
)

RELEVANCE_BONUS = 15
MIN_API_SCORE = -8  # darunter nicht mal runterladen


def rank_api_meta(
    alt: str,
    *,
    relevant: bool,
    place_type: str,
    likes: int = 0,
) -> float:
    """Alt-Text-Ranking vor dem Download — billig, spart Bandbreite."""
    blob = (alt or "").lower()
    score = RELEVANCE_BONUS if relevant else 0
    score -= alt_text_penalty(alt)
    score += sum(4 for kw in GOOD_ALT_KEYWORDS if kw in blob)
    if place_type in NATURE_TYPES:
        score += sum(3 for kw in ("beach", "coast", "nature", "park", "lake", "mountain") if kw in blob)
    score += min(likes / 80, 3)
    return score


def pick_from_api(
    results: list,
    alt_getter,
    relevant_getter,
    place_type: str,
    max_pick: int,
) -> list[tuple[dict, bool, float]]:
    """Beste N API-Treffer nach Meta-Score — nicht blind die ersten N."""
    scored: list[tuple[float, dict, bool]] = []
    for r in results:
        alt = alt_getter(r)
        rel = relevant_getter(r)
        s = rank_api_meta(alt, relevant=rel, place_type=place_type, likes=r.get("likes", 0))
        if s >= MIN_API_SCORE:
            scored.append((s, r, rel))
    scored.sort(key=lambda x: -x[0])
    return [(r, rel, s) for s, r, rel in scored[:max_pick]]


_FACE_CASCADES = None


def _get_cascades():
    global _FACE_CASCADES
    if _FACE_CASCADES is None:
        import cv2

        _FACE_CASCADES = [
            cv2.CascadeClassifier(cv2.data.haarcascades + name)
            for name in (
                "haarcascade_frontalface_default.xml",
                "haarcascade_profileface.xml",
                "haarcascade_fullbody.xml",
            )
        ]
    return _FACE_CASCADES


def center_person_strength(path: str) -> float:
    """0..1 — Gesicht/Körper prominent im Bild (echte Detektion, kein Hautton-Raten)."""
    import cv2

    img = cv2.imread(path)
    if img is None:
        return 0.0
    h, w = img.shape[:2]
    scale = 480 / max(h, w)
    if scale < 1:
        img = cv2.resize(img, (int(w * scale), int(h * scale)))
        h, w = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    gray = cv2.equalizeHist(gray)

    frame_area = float(h * w)
    best = 0.0
    for cascade in _get_cascades():
        if cascade.empty():
            continue
        hits = cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=6,
                                        minSize=(max(20, h // 20), max(20, h // 20)))
        for (x, y, fw, fh) in hits:
            area_frac = (fw * fh) / frame_area
            # Gesicht > 1.5% der Fläche = Person ist Motiv, nicht Staffage
            if area_frac < 0.015:
                continue
            cx = x + fw / 2
            centered = 1.0 if 0.2 * w < cx < 0.8 * w else 0.6
            strength = min(1.0, area_frac * 12) * centered
            best = max(best, strength)
    return best


def text_heavy_strength(path: str) -> float:
    """0..1 — große Schrift/Schilder: hohe Kantendichte UND bimodale Farbverteilung.

    Felsen/Wellen haben auch Kanten, aber breite Histogramme — Schilder sind
    zweifarbig (Schrift auf Grund)."""
    gray = Image.open(path).convert("L").resize((120, 180))
    arr = np.array(gray, dtype=float)
    h, w = arr.shape
    center = arr[h // 4 : 3 * h // 4, w // 4 : 3 * w // 4]

    edges = np.array(
        Image.fromarray(center.astype(np.uint8)).filter(ImageFilter.FIND_EDGES)
    )
    edge_density = edges.mean() / 255

    hist, _ = np.histogram(center, bins=16, range=(0, 255))
    shares = np.sort(hist / max(center.size, 1))[::-1]
    top2 = shares[:2].sum()

    bimodal = max(0.0, (top2 - 0.42) / 0.38)  # 0 bei breitem Histogramm, 1 bei 2-Ton
    return min(1.0, edge_density * 4.5 * min(1.0, bimodal))


_OCR_AVAILABLE = None


def ocr_text_strength(path: str) -> float:
    """0..1 — echtes OCR via macOS Vision. Liest Neon-Schriften, Banner und
    Schilder zuverlässig; kleine Schrift in der Ferne (< ~1% Fläche) ist ok."""
    global _OCR_AVAILABLE
    if _OCR_AVAILABLE is False:
        return 0.0
    try:
        import Vision
        import Quartz
        _OCR_AVAILABLE = True
    except ImportError:
        _OCR_AVAILABLE = False
        return 0.0

    url = Quartz.CFURLCreateWithFileSystemPath(
        None, path, Quartz.kCFURLPOSIXPathStyle, False
    )
    handler = Vision.VNImageRequestHandler.alloc().initWithURL_options_(url, None)
    req = Vision.VNRecognizeTextRequest.alloc().init()
    req.setRecognitionLevel_(Vision.VNRequestTextRecognitionLevelAccurate)
    ok, _err = handler.performRequests_error_([req], None)
    if not ok:
        return 0.0

    area = 0.0
    for obs in req.results() or []:
        if obs.confidence() < 0.4:
            continue
        bb = obs.boundingBox()
        area += bb.size.width * bb.size.height
    return float(np.clip((area - 0.008) / 0.03, 0.0, 1.0))


def alt_text_penalty(alt: str) -> float:
    if not alt:
        return 0.0
    # Wortgrenzen, sonst trifft "man" auch "Germany" und "cat" auch "cathedral"
    blob = alt.lower()
    words = set(re.findall(r"[a-z]+", blob))
    hits = 0
    for kw in BAD_ALT_KEYWORDS:
        if " " in kw or "-" in kw:
            if kw in blob:
                hits += 1
        elif kw in words:
            hits += 1
    return hits * 18


def cityscape_score(path: str) -> float:
    img_gray = Image.open(path).convert("L").resize((100, 150))
    arr = np.array(img_gray)
    edges = np.array(Image.fromarray(arr).filter(ImageFilter.FIND_EDGES))

    top, middle, bottom = edges[:50, :], edges[50:100, :], edges[100:, :]
    skyline_score = bottom.mean() / (top.mean() + 1)
    distribution_score = min(top.mean(), bottom.mean()) / (middle.mean() + 1)

    top_rgb = np.array(Image.open(path).convert("RGB").resize((100, 150)))[:50, :]
    sky_bonus = (top_rgb.mean() / 255) * 5

    return (skyline_score * 8) + (distribution_score * 5) + sky_bonus


def nature_score(path: str) -> float:
    img = Image.open(path).convert("RGB").resize((100, 150))
    sat = ImageStat.Stat(img.convert("HSV")).mean[1] / 255 * 10
    sky = np.array(img)[:50, :].mean() / 255 * 5
    return sat + sky


def score_candidate(path: str, info: dict | None = None) -> tuple[float, dict]:
    """Return (score, debug_tags). Higher = better hero shot."""
    info = info or {}
    img = Image.open(path).convert("RGB")
    stat = ImageStat.Stat(img)
    w, h = img.size
    place_type = info.get("place_type", "")

    ratio_score = 10 if h > w else 0
    brightness_score = 10 - abs(stat.mean[0] - 130) / 13
    contrast_score = min(stat.stddev[0] / 10, 10)

    scene_score = (
        nature_score(path) if place_type in NATURE_TYPES else cityscape_score(path)
    ) * 3

    relevance = RELEVANCE_BONUS if info.get("relevant") else 0

    # Gleiches Gate wie beim Download: schlechter Alt-Text ohne Gegengewicht
    # fliegt sofort raus (fängt auch Altbestände aus früheren Runs ab).
    alt = info.get("alt", "")
    if alt and rank_api_meta(alt, relevant=bool(info.get("relevant")),
                             place_type=place_type) < MIN_API_SCORE:
        return -999, ["ALT-REJECT"]

    person = center_person_strength(path)
    text = max(text_heavy_strength(path), ocr_text_strength(path))
    alt_pen = alt_text_penalty(alt)

    person_pen = person * 100
    text_pen = text * 80
    if text > 0.85:
        text_pen += 35

    # Einzelobjekte (Flagge, Produkt, Tier) sind pixel-statistisch nicht
    # zuverlässig von Fels/Strand trennbar — das regelt der Alt-Text
    # (BAD_ALT_KEYWORDS), sowohl vor dem Download als auch hier.

    total = (
        ratio_score + brightness_score + contrast_score + scene_score + relevance
        - person_pen - text_pen - alt_pen
    )

    tags = []
    if person > 0.15:
        tags.append(f"person={person:.2f}")
    if text > 0.25:
        tags.append(f"text={text:.2f}")
    if alt_pen:
        tags.append(f"alt=-{alt_pen:.0f}")
    if info.get("relevant"):
        tags.append("REL")

    return total, tags


def place_key_from_filename(filename: str) -> str:
    name = re.sub(r"\.[^.]+$", "", filename)
    m = re.match(r"(.+?)_(?:pexels_\d+|unspl(?:_\d+)?)$", name)
    return m.group(1) if m else name
