"""Audit der Pexels-Heroes in Supabase — findet Bilder, die nicht zum Ort passen.

Stufen (einzeln aufrufbar, Ergebnisse landen in pexels_audit/):

  python3 audit_pexels.py fetch              # DB-Rows + Bilder in den Cache holen
  python3 audit_pexels.py clip               # CLIP-Vorfilter, gratis, rankt Verdächtige
  python3 audit_pexels.py vision --limit 300 # Vision-Urteil nur für die Top-Verdächtigen
  python3 audit_pexels.py review             # CLIP-Interface (Schätzwerte, kein Vision)
  python3 audit_pexels.py apply --apply      # Markierte deaktivieren

`review` = Browser-Grid der CLIP-Verdächtigen. Rot vorausgewählt ab Score 0.7.
Speichern → rejects.txt → apply.

`apply` setzt is_active=false UND trägt den Ort in `_no_pexels`
(hero_char_overrides.json) ein. Beides ist nötig, weil sync_hero_activation.py
sonst genau dieselbe Zeile beim nächsten --mirror-storage wieder aktiviert.
Der Ort fällt damit auf ein generisches Hero zurück; Ersatzbilder besorgen ist
ein separater Schritt (download_pexel.py).
"""

import argparse
import base64
import json
import os
import re
import sys
import threading
import time
import unicodedata
import webbrowser
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import psycopg2
import requests
from dotenv import load_dotenv

load_dotenv()

AUDIT_DIR = Path("pexels_audit")
CACHE_DIR = AUDIT_DIR / "cache"
ROWS_PATH = AUDIT_DIR / "rows.json"
CLIP_PATH = AUDIT_DIR / "clip.json"
VISION_PATH = AUDIT_DIR / "vision.json"
SHEET_PATH = AUDIT_DIR / "audit.html"
REJECTS_PATH = AUDIT_DIR / "rejects.txt"
OVERRIDES_PATH = Path(__file__).with_name("hero_char_overrides.json")

STORAGE_BASE = "https://skkkoxdobvimqpfqzbdx.supabase.co/storage/v1/object/public/dedicated"

DB = dict(
    host="aws-1-eu-west-1.pooler.supabase.com",
    port=5432,
    dbname="postgres",
    user="postgres.skkkoxdobvimqpfqzbdx",
    password=os.getenv("SUPABASE_DB_PASSWORD"),
)

ROWS_QUERY = """
SELECT phi.id, phi.storage_path, phi.is_active,
       p.id, p.name_en, p.country_code, p.place_type, p.attractiveness_score
FROM place_hero_images phi
JOIN places p ON p.id = phi.place_id
WHERE phi.storage_path ILIKE 'pexels/%'
ORDER BY p.attractiveness_score DESC NULLS LAST, phi.storage_path
"""

COUNTRY_NAMES = {
    "AD": "Andorra", "AL": "Albania", "AT": "Austria", "BA": "Bosnia", "BE": "Belgium",
    "BG": "Bulgaria", "BS": "Bahamas", "BY": "Belarus", "BZ": "Belize", "CA": "Canada",
    "CH": "Switzerland", "CU": "Cuba", "CY": "Cyprus", "CZ": "Czech Republic",
    "DE": "Germany", "DK": "Denmark", "DO": "Dominican Republic", "EE": "Estonia",
    "ES": "Spain", "FI": "Finland", "FR": "France", "GB": "United Kingdom",
    "GR": "Greece", "GT": "Guatemala", "HR": "Croatia", "HT": "Haiti", "HU": "Hungary",
    "IE": "Ireland", "IS": "Iceland", "IT": "Italy", "JM": "Jamaica",
    "LI": "Liechtenstein", "LT": "Lithuania", "LU": "Luxembourg", "LV": "Latvia",
    "MA": "Morocco", "MC": "Monaco", "MD": "Moldova", "ME": "Montenegro",
    "MK": "North Macedonia", "MT": "Malta", "MX": "Mexico", "NL": "Netherlands",
    "NO": "Norway", "PL": "Poland", "PT": "Portugal", "RO": "Romania", "RS": "Serbia",
    "SE": "Sweden", "SI": "Slovenia", "SK": "Slovakia", "SM": "San Marino",
    "TN": "Tunisia", "TR": "Turkey", "UA": "Ukraine", "US": "USA",
}

# --- CLIP-Vorfilter -------------------------------------------------------

CONTENT_LABELS = {
    "highrise": "a photo of modern glass skyscrapers and high-rise office towers",
    "old_town": "a photo of an old town street with historic european buildings",
    "town":     "a photo of a small town or village with houses",
    "church":   "a photo of a church, cathedral or castle",
    "harbor":   "a photo of a harbour with fishing boats",
    "beach":    "a photo of a sandy beach with sea and waves",
    "coast":    "a photo of a rocky coastline with cliffs and sea",
    "lake":     "a photo of a calm lake with its shore",
    "mountain": "a photo of mountains and alpine peaks",
    "forest":   "a photo of a forest with trees",
    "meadow":   "a photo of open fields, meadows or farmland",
    "desert":   "a photo of a desert with sand dunes",
    "river":    "a photo of a river or a waterfall",
    "road":     "a photo of an empty road curving through a landscape",
    "snow":     "a photo of a snowy winter landscape",
    "portrait": "a close-up portrait photo of a person's face",
    "people":   "a photo of people posing, a fashion or lifestyle model shot",
    "food":     "a photo of food or drinks on a table",
    "animal":   "a photo of an animal or a pet",
    "indoor":   "a photo of an indoor room or interior design",
    "product":  "a product photo or an advertisement",
    "graphic":  "a screenshot, poster or graphic with large text",
    "closeup":  "an extreme close-up of a flower, plant or small object",
    "abstract": "an abstract, blurry or surreal image",
}

_TOWNISH = {"old_town", "town", "church", "harbor"}
_SCENIC = {"lake", "mountain", "forest", "meadow", "river", "road", "snow",
           "coast", "beach", "desert"}

# Was für einen Orts-Typ plausibel ist. Absichtlich großzügig: der Vorfilter
# soll ranken, nicht urteilen — Fehlalarme klärt die Vision-Stufe.
ALLOWED = {
    "city":            _TOWNISH | {"highrise", "coast", "beach", "river", "road"},
    "medium_town":     _TOWNISH | _SCENIC,
    "small_town":      _TOWNISH | _SCENIC,
    "village":         _TOWNISH | _SCENIC,
    "beach":           {"beach", "coast", "harbor", "town", "old_town"},
    "lake":            {"lake", "river", "mountain", "forest", "town", "meadow"},
    "mountain":        {"mountain", "snow", "forest", "meadow", "lake", "town", "road"},
    "national_park":   _SCENIC,
    "natural_park":    _SCENIC,
    "nature_reserve":  _SCENIC | {"town"},
    "natural_feature": _SCENIC,
    "scenic_drive":    _SCENIC | {"town", "old_town"},
}
ALLOWED_DEFAULT = _TOWNISH | _SCENIC

VISION_SYSTEM = """Du prüfst Stockfotos für eine Reise-App. Zu jedem Bild bekommst du
den Ort, das Land und den Orts-Typ. Entscheide, ob das Bild als Titelbild für diesen
Ort durchgehen kann.

"ok"     = passt oder ist zumindest plausibel. Ein generisches Foto ist ausdrücklich
           in Ordnung, solange Landschaft, Bebauung, Klima und Region zum Ort passen
           (z.B. irgendein Sandstrand für einen Strandort, irgendeine Altstadtgasse
           für eine europäische Kleinstadt).
"bad"    = klarer Widerspruch. Zum Beispiel: Wolkenkratzer/Großstadt-Skyline für ein
           Dorf oder einen Strandort, tropische oder Wüsten-Szenerie in Nordeuropa,
           erkennbar eine andere Weltregion, Winterbild für einen Badeort,
           Porträt/Modelfoto, Essen, Innenraum, Produktfoto, Grafik mit Text,
           extreme Nahaufnahme ohne Ortsbezug.
"unsure" = du kannst es nicht entscheiden.

Antworte nur als JSON: {"verdict": "ok"|"bad"|"unsure", "reason": "<max 12 Wörter deutsch>"}"""


def db_conn():
    if not DB["password"]:
        sys.exit("SUPABASE_DB_PASSWORD fehlt (.env)")
    return psycopg2.connect(**DB)


def ascii_fold(s):
    return unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode("ascii")


def load_json(path, default):
    if path.exists():
        return json.loads(path.read_text())
    return default


def live_active_ids(hero_ids):
    """is_active frisch aus der DB — rows.json ist nach einem `apply` veraltet."""
    conn = db_conn()
    cur = conn.cursor()
    cur.execute(
        "SELECT id FROM place_hero_images WHERE id = ANY(%s) AND is_active",
        (list(hero_ids),),
    )
    ids = {r[0] for r in cur.fetchall()}
    conn.close()
    return ids


def blacklisted_places():
    """Orte in `_no_pexels` sind erledigt — ihre Pexels-Bilder sind aus dem Rennen."""
    if not OVERRIDES_PATH.exists():
        return set()
    data = json.loads(OVERRIDES_PATH.read_text())
    return {str(x) for x in (data.get("_no_pexels") or [])}


def open_rows(rows, include_inactive=False):
    """Rows, die noch zur Debatte stehen: aktiv laut DB und Ort nicht blacklisted."""
    if include_inactive:
        return rows
    active = live_active_ids([r["hero_id"] for r in rows])
    done = blacklisted_places()
    return [r for r in rows if r["hero_id"] in active and r["name_en"] not in done]


def cache_path(storage_path):
    # `pexels/unaccented/x.webp` und `pexels/x.webp` sind verschiedene Fotos mit
    # gleichem Dateinamen — der Cache-Name muss den Unterordner mitnehmen.
    rel = re.sub(r"^pexels/", "", storage_path or "")
    return CACHE_DIR / rel.replace("/", "__")


# --- Stufe: fetch ---------------------------------------------------------

def stage_fetch(args):
    CACHE_DIR.mkdir(parents=True, exist_ok=True)

    conn = db_conn()
    cur = conn.cursor()
    cur.execute(ROWS_QUERY)
    raw = cur.fetchall()
    conn.close()

    per_place = {}
    for rec in raw:
        per_place[rec[3]] = per_place.get(rec[3], 0) + 1

    rows = []
    for hero_id, storage_path, is_active, place_id, name_en, cc, place_type, attr in raw:
        rows.append({
            "hero_id": hero_id,
            "storage_path": storage_path,
            "is_active": is_active,
            "place_id": place_id,
            "name_en": name_en,
            "country_code": cc,
            "country": COUNTRY_NAMES.get(cc, cc),
            "place_type": place_type,
            "attractiveness": attr,
            "siblings": per_place[place_id],
            "file": cache_path(storage_path).name,
        })
    if args.limit:
        rows = rows[: args.limit]

    ROWS_PATH.write_text(json.dumps(rows, ensure_ascii=False, indent=1))
    active = sum(1 for r in rows if r["is_active"])
    places = len({r["place_id"] for r in rows})
    print(f"{len(rows)} Pexels-Rows ({active} aktiv) auf {places} Orten -> {ROWS_PATH}")

    todo = [r for r in rows if not cache_path(r["storage_path"]).exists()]
    if not todo:
        print("Cache komplett, nichts zu laden.")
        return
    print(f"Lade {len(todo)} Bilder in {CACHE_DIR}/ ...")

    done = {"n": 0, "err": 0}
    lock = threading.Lock()

    def grab(row):
        url = f"{STORAGE_BASE}/{row['storage_path']}"
        try:
            resp = requests.get(url, timeout=30)
            resp.raise_for_status()
            cache_path(row["storage_path"]).write_bytes(resp.content)
            ok = True
        except Exception as e:
            ok = False
            msg = f"{type(e).__name__}: {e}"
        with lock:
            if ok:
                done["n"] += 1
            else:
                done["err"] += 1
                print(f"  ERROR {row['storage_path']}: {msg}")
            total = done["n"] + done["err"]
            if total % 200 == 0:
                print(f"  ... {total}/{len(todo)}", flush=True)

    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(grab, todo))
    print(f"Fertig: {done['n']} geladen, {done['err']} Fehler")


# --- Stufe: clip ----------------------------------------------------------

def stage_clip(args):
    import torch
    import open_clip
    from PIL import Image

    rows = load_json(ROWS_PATH, None)
    if not rows:
        sys.exit("Keine rows.json — erst `fetch` laufen lassen.")

    if torch.cuda.is_available():
        device = "cuda"
    elif getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        device = "mps"
    else:
        device = "cpu"
    print(f"CLIP ViT-B-32 auf {device} ...")

    model, _, preprocess = open_clip.create_model_and_transforms(
        "ViT-B-32", pretrained="laion2b_s34b_b79k"
    )
    tokenizer = open_clip.get_tokenizer("ViT-B-32")
    model = model.to(device).eval()

    keys = list(CONTENT_LABELS.keys())
    tokens = tokenizer([CONTENT_LABELS[k] for k in keys]).to(device)
    with torch.no_grad():
        text_features = model.encode_text(tokens)
        text_features /= text_features.norm(dim=-1, keepdim=True)

    results = {}
    batch, meta = [], []

    def flush():
        if not batch:
            return
        tensor = torch.stack(batch).to(device)
        with torch.no_grad():
            feats = model.encode_image(tensor)
            feats /= feats.norm(dim=-1, keepdim=True)
            probs = (100.0 * feats @ text_features.T).softmax(dim=-1).cpu().numpy()
        for row, p in zip(meta, probs):
            allowed = ALLOWED.get(row["place_type"], ALLOWED_DEFAULT)
            allowed_p = float(sum(p[i] for i, k in enumerate(keys) if k in allowed))
            top_i = int(p.argmax())
            results[str(row["hero_id"])] = {
                "suspicion": round(1.0 - allowed_p, 4),
                "top": keys[top_i],
                "top_p": round(float(p[top_i]), 4),
            }
        batch.clear()
        meta.clear()

    missing = 0
    for i, row in enumerate(rows, 1):
        path = cache_path(row["storage_path"])
        if not path.exists():
            missing += 1
            continue
        try:
            batch.append(preprocess(Image.open(path).convert("RGB")))
            meta.append(row)
        except Exception:
            missing += 1
            continue
        if len(batch) >= 32:
            flush()
        if i % 500 == 0:
            print(f"  ... {i}/{len(rows)}", flush=True)
    flush()

    CLIP_PATH.write_text(json.dumps(results, indent=1))
    ranked = sorted(results.values(), key=lambda r: -r["suspicion"])
    over = sum(1 for r in ranked if r["suspicion"] > 0.5)
    print(f"{len(results)} bewertet ({missing} ohne Datei) -> {CLIP_PATH}")
    print(f"{over} mit suspicion > 0.5")
    if ranked:
        print(f"Top-Verdacht: {ranked[0]['suspicion']:.2f} ({ranked[0]['top']})")


# --- Stufe: vision --------------------------------------------------------

def vision_candidates(rows, clip, limit, include_inactive):
    scored = []
    for row in open_rows(rows, include_inactive):
        c = clip.get(str(row["hero_id"]))
        if not c:
            continue
        scored.append((c["suspicion"], row, c))
    scored.sort(key=lambda x: -x[0])
    return scored[:limit] if limit else scored


def stage_vision(args):
    rows = load_json(ROWS_PATH, None)
    clip = load_json(CLIP_PATH, None)
    if not rows or not clip:
        sys.exit("rows.json/clip.json fehlen — erst `fetch` und `clip` laufen lassen.")

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        sys.exit("OPENAI_API_KEY fehlt (.env)")

    out = load_json(VISION_PATH, {})
    todo = [
        (s, row, c)
        for s, row, c in vision_candidates(rows, clip, args.limit, args.include_inactive)
        if args.redo or str(row["hero_id"]) not in out
    ]
    if not todo:
        print("Nichts zu prüfen (alles schon in vision.json, oder --redo nutzen).")
        return

    est = len(todo) * 0.0012
    print(f"{len(todo)} Bilder an {args.model} (geschätzt ~{est:.2f} $) ...")

    lock = threading.Lock()
    counts = {"ok": 0, "bad": 0, "unsure": 0, "error": 0}

    def judge(item):
        suspicion, row, c = item
        path = cache_path(row["storage_path"])
        try:
            b64 = base64.b64encode(path.read_bytes()).decode()
        except Exception as e:
            return row, {"verdict": "error", "reason": str(e)}

        payload = {
            "model": args.model,
            "max_tokens": 120,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": VISION_SYSTEM},
                {"role": "user", "content": [
                    {"type": "text", "text": (
                        f"Ort: {row['name_en']}\nLand: {row['country']}\n"
                        f"Orts-Typ: {row['place_type']}"
                    )},
                    {"type": "image_url", "image_url": {
                        "url": f"data:image/webp;base64,{b64}",
                        "detail": "low",
                    }},
                ]},
            ],
        }

        last_err = "unknown"
        for attempt in range(1, 5):
            try:
                resp = requests.post(
                    "https://api.openai.com/v1/chat/completions",
                    headers={"Authorization": f"Bearer {api_key}"},
                    json=payload,
                    timeout=60,
                )
                if resp.status_code in (429, 500, 502, 503, 529):
                    last_err = f"HTTP {resp.status_code}"
                    time.sleep(min(5 * attempt, 30))
                    continue
                resp.raise_for_status()
                content = resp.json()["choices"][0]["message"]["content"]
                data = json.loads(content)
                verdict = str(data.get("verdict", "unsure")).lower()
                if verdict not in ("ok", "bad", "unsure"):
                    verdict = "unsure"
                return row, {
                    "verdict": verdict,
                    "reason": str(data.get("reason", ""))[:160],
                    "suspicion": suspicion,
                    "clip_top": c["top"],
                }
            except Exception as e:
                last_err = f"{type(e).__name__}: {e}"
                if attempt == 4:
                    break
                time.sleep(min(5 * attempt, 30))
        return row, {"verdict": "error", "reason": last_err}

    # Sequentiell + as_completed: ThreadPool.map hat hier schon mehrfach gehängt
    # (Rate-Limit / Connection), ohne sichtbaren Fortschritt.
    from concurrent.futures import as_completed
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(judge, item): item for item in todo}
        for n, fut in enumerate(as_completed(futures), 1):
            try:
                result = fut.result(timeout=180)
            except Exception as e:
                item = futures[fut]
                row = item[1]
                result = row, {"verdict": "error", "reason": f"{type(e).__name__}: {e}"}
            if not result:
                continue
            row, verdict = result
            out[str(row["hero_id"])] = verdict
            counts[verdict["verdict"]] = counts.get(verdict["verdict"], 0) + 1
            if verdict["verdict"] == "bad":
                print(f"  BAD  {row['name_en']} ({row['place_type']}): {verdict['reason']}",
                      flush=True)
            if n % 10 == 0 or n == len(todo):
                VISION_PATH.write_text(json.dumps(out, ensure_ascii=False, indent=1))
                print(f"  ... {n}/{len(todo)}  "
                      f"(bad={counts['bad']} ok={counts['ok']} unsure={counts['unsure']} "
                      f"err={counts['error']})", flush=True)

    VISION_PATH.write_text(json.dumps(out, ensure_ascii=False, indent=1))
    print(f"\nFertig -> {VISION_PATH}", flush=True)
    print("  " + " | ".join(f"{k}: {v}" for k, v in counts.items() if v), flush=True)


# --- Stufe: sheet ---------------------------------------------------------

CARD_ORDER = {"bad": 0, "unsure": 1, "error": 2, "ok": 3}

SHEET_CSS = """
body{background:#15171c;color:#e8e8ea;font:14px/1.4 -apple-system,Helvetica,sans-serif;margin:0;padding:16px}
h1{font-size:18px;margin:0 0 4px}
.bar{position:sticky;top:0;background:#15171cf2;padding:10px 0 12px;z-index:10;border-bottom:1px solid #2c2f36;margin-bottom:14px}
button{background:#3b82f6;color:#fff;border:0;border-radius:6px;padding:8px 14px;font-size:14px;cursor:pointer}
button.ghost{background:#2c2f36}
#status{margin-left:10px;color:#9aa0aa}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px}
.card{background:#1d2027;border:2px solid #1d2027;border-radius:8px;overflow:hidden;cursor:pointer}
.card.sel{border-color:#ef4444}
.card img{width:100%;aspect-ratio:2/3;object-fit:cover;display:block}
.meta{padding:7px 8px}
.name{font-weight:600;margin-bottom:2px}
.sub{color:#9aa0aa;font-size:12px}
.tag{display:inline-block;border-radius:4px;padding:1px 5px;font-size:11px;margin-top:4px}
.bad{background:#7f1d1d;color:#fecaca}
.unsure{background:#78350f;color:#fde68a}
.ok{background:#14532d;color:#bbf7d0}
.error{background:#3f3f46;color:#d4d4d8}
.card.sel .check:after{content:" ✓"}
"""

SHEET_JS = """
function cards(){return [...document.querySelectorAll('.card')]}
function selected(){return cards().filter(c=>c.classList.contains('sel'))}
function refresh(){document.getElementById('count').textContent=selected().length}
cards().forEach(c=>c.addEventListener('click',e=>{
  if(e.target.tagName==='A')return;
  c.classList.toggle('sel');refresh();
}));
function payload(){return selected().map(c=>[c.dataset.hero,c.dataset.name,c.dataset.file].join('\\t')).join('\\n')}
document.getElementById('save').onclick=async()=>{
  const body=payload();
  const st=document.getElementById('status');
  try{
    const r=await fetch('/save',{method:'POST',body});
    st.textContent=r.ok?('gespeichert: '+(await r.text())):'Fehler beim Speichern';
  }catch(e){
    const b=new Blob([body],{type:'text/plain'});
    const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='rejects.txt';a.click();
    st.textContent='kein Server — als Download gespeichert';
  }
};
document.getElementById('none').onclick=()=>{cards().forEach(c=>c.classList.remove('sel'));refresh();};
refresh();
"""


def stage_sheet(args):
    rows = load_json(ROWS_PATH, None)
    if not rows:
        sys.exit("Keine rows.json — erst `fetch` laufen lassen.")
    clip = load_json(CLIP_PATH, {})
    vision = load_json(VISION_PATH, {})

    from pexels_blacklist import load_blacklist, slug_from_filename
    banned = load_blacklist()
    banned_examples = []
    for r in rows:
        slug = slug_from_filename(r.get("storage_path") or "")
        if slug and slug in banned:
            c = clip.get(str(r["hero_id"]), {})
            banned_examples.append((c.get("suspicion", 0), r["name_en"], c.get("top", "?")))
    banned_examples.sort(reverse=True)

    candidates = open_rows(rows, include_inactive=not args.active_only)
    hidden = len(rows) - len(candidates)

    ignore_vision = getattr(args, "ignore_vision", False)
    wanted = None if args.verdict == "all" else {v.strip() for v in args.verdict.split(",")}

    # CLIP-Tops, die für Orte fast immer Klopper sind — auch bei niedriger
    # Gesamtsuspicion in die Review aufnehmen (Namens-Kollisionen).
    ALWAYS_FLAG_TOPS = {"animal", "portrait", "people", "food", "product",
                        "graphic", "indoor", "abstract", "closeup"}

    items = []
    for row in candidates:
        hid = str(row["hero_id"])
        v = None if ignore_vision else vision.get(hid)
        c = clip.get(hid, {})
        verdict = v["verdict"] if v else None
        if wanted is not None and (verdict or "none") not in wanted:
            continue
        sus = c.get("suspicion", 0.0)
        top = c.get("top", "?")
        force = ignore_vision and top in ALWAYS_FLAG_TOPS and sus >= 0.25
        if args.min_suspicion and sus < args.min_suspicion and not v and not force:
            continue
        # Force-Flag: Suspicion für Sortierung/Preselect anheben
        if force and sus < args.preselect_suspicion:
            sus = max(sus, args.preselect_suspicion)
        items.append({
            "row": row,
            "verdict": verdict,
            "reason": (v or {}).get("reason", ""),
            "suspicion": sus,
            "top": top,
        })

    items.sort(key=lambda it: (
        CARD_ORDER.get(it["verdict"], 4),
        -it["suspicion"],
    ))
    if args.limit:
        items = items[: args.limit]

    def esc(s):
        return (str(s or "").replace("&", "&amp;").replace("<", "&lt;")
                .replace(">", "&gt;").replace('"', "&quot;"))

    cards = []
    for it in items:
        row = it["row"]
        verdict = it["verdict"] or "—"
        cls = it["verdict"] if it["verdict"] in CARD_ORDER else "error"
        preselect = (
            it["verdict"] == "bad"
            or (it["verdict"] is None and it["suspicion"] >= args.preselect_suspicion)
        )
        sel = " sel" if (preselect and not args.no_preselect) else ""
        sib = f" · {row['siblings']}x" if row["siblings"] > 1 else ""
        inactive = "" if row["is_active"] else " · inaktiv"
        tag = verdict if it["verdict"] else it["top"]
        cards.append(f"""
<div class="card{sel}" data-hero="{row['hero_id']}" data-name="{esc(row['name_en'])}" data-file="{esc(row['file'])}">
  <img src="cache/{esc(row['file'])}" loading="lazy">
  <div class="meta">
    <div class="name">{esc(row['name_en'])}<span class="check"></span></div>
    <div class="sub">{esc(row['country_code'])} · {esc(row['place_type'])}{sib}{inactive}</div>
    <div class="sub">clip {it['suspicion']:.2f} · {esc(it['top'])}</div>
    <span class="tag {cls}">{esc(tag)}</span>
    <div class="sub">{esc(it['reason'])}</div>
  </div>
</div>""")

    n_sel = sum(1 for it in items if (
        it["verdict"] == "bad"
        or (it["verdict"] is None and it["suspicion"] >= args.preselect_suspicion)
    ) and not args.no_preselect)
    ex = ", ".join(f"{n} ({t})" for _, n, t in banned_examples[:8])
    # Garantiert die bekannten Namens-Klopper nennen, falls blacklisted
    must = [n for n in ("Alice", "Eagle Pass", "Eagle Mountain", "Chihuahua", "Red Deer")
            if any(n == e[1] for e in banned_examples)]
    if must:
        ex = ", ".join(must) + (", " + ex if ex else "")
    banned_note = (
        f"{len(banned)} bereits permanent gesperrt — nicht gezeigt"
        + (f": {ex}…" if ex else "")
    )
    html = f"""<!doctype html><meta charset="utf-8"><title>Pexels-Audit</title>
<style>{SHEET_CSS}</style>
<div class="bar">
  <h1>Pexels-Audit — {len(items)} Verdächtige, {n_sel} vorausgewählt</h1>
  <div class="sub">Klick = umschalten. Rot = löschen. Speichern, dann apply.</div>
  <div class="sub" style="color:#fca5a5;margin-top:4px">{esc(banned_note)}</div>
  <div style="margin-top:8px">
    <button id="save">Rejects speichern (<span id="count">0</span>)</button>
    <button class="ghost" id="none">Auswahl leeren</button>
    <span id="status"></span>
  </div>
</div>
<div class="grid">{''.join(cards)}</div>
<script>{SHEET_JS}</script>
"""
    SHEET_PATH.write_text(html)
    print(f"{len(items)} Karten -> {SHEET_PATH}")
    if hidden:
        print(f"{hidden} bereits erledigte Bilder ausgeblendet (deaktiviert oder _no_pexels)")
    if banned:
        print(f"{len(banned)} permanent blacklisted — z.B. {ex}")
        print("(Alice, Eagle Pass & Co. fehlen absichtlich: schon endgültig gelöscht)")

    if args.no_serve:
        print("Ohne Server: Auswahl landet als Download in ~/Downloads/rejects.txt")
        return

    serve_sheet(args.port)


def serve_sheet(port):
    root = AUDIT_DIR.resolve()

    class Handler(BaseHTTPRequestHandler):
        def translate_path(self, path):
            rel = path.split("?")[0].lstrip("/") or "audit.html"
            return str(root / rel)

        def do_GET(self):
            target = Path(self.translate_path(self.path)).resolve()
            inside = target == root or root in target.parents
            if not inside or not target.is_file():
                self.send_error(404)
                return
            ctype = "text/html; charset=utf-8" if target.suffix == ".html" else "image/webp"
            data = target.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_POST(self):
            if self.path != "/save":
                self.send_error(404)
                return
            length = int(self.headers.get("Content-Length") or 0)
            body = self.rfile.read(length).decode()
            lines = [l for l in body.splitlines() if l.strip()]
            REJECTS_PATH.write_text("\n".join(lines) + ("\n" if lines else ""))
            msg = f"{len(lines)} Rejects in {REJECTS_PATH}"
            print(f"  {msg}")
            data = msg.encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *a):
            pass

    url = f"http://127.0.0.1:{port}/audit.html"
    print(f"Sichtung: {url}   (Strg+C zum Beenden)")
    webbrowser.open(url)
    try:
        HTTPServer(("127.0.0.1", port), Handler).serve_forever()
    except KeyboardInterrupt:
        print("\nServer beendet.")


# --- Stufe: apply ---------------------------------------------------------

def stage_apply(args):
    if not REJECTS_PATH.exists():
        sys.exit(f"{REJECTS_PATH} fehlt — erst `sheet` durchklicken und speichern.")

    hero_ids, names = [], []
    for line in REJECTS_PATH.read_text().splitlines():
        if not line.strip():
            continue
        parts = line.split("\t")
        try:
            hero_ids.append(int(parts[0]))
        except ValueError:
            print(f"  übersprungen (keine hero_id): {line}")
            continue
        if len(parts) > 1:
            names.append(parts[1])

    if not hero_ids:
        sys.exit("Keine hero_ids in rejects.txt")

    conn = db_conn()
    cur = conn.cursor()
    cur.execute(
        """
        SELECT phi.id, phi.storage_path, phi.is_active, p.name_en,
               (SELECT count(*) FROM places p2 WHERE p2.name_en = p.name_en)
        FROM place_hero_images phi JOIN places p ON p.id = phi.place_id
        WHERE phi.id = ANY(%s)
        """,
        (hero_ids,),
    )
    found = cur.fetchall()
    by_name = {}
    for _, _, _, name_en, name_count in found:
        by_name[name_en] = name_count

    print(f"{len(hero_ids)} Rejects, {len(found)} in der DB gefunden, "
          f"{len(by_name)} Orte betroffen")
    for _, path, is_active, name_en, _ in found:
        print(f"  {'aktiv ' if is_active else 'inaktiv'} {name_en:28s} {path}")

    ambiguous = {n: c for n, c in by_name.items() if c > 1}
    if ambiguous:
        print("\nWARNUNG — diese Namen existieren mehrfach in `places`, der "
              "`_no_pexels`-Eintrag wirkt auf alle Treffer:")
        for n, c in ambiguous.items():
            print(f"  {n} ({c}x)")

    overrides = json.loads(OVERRIDES_PATH.read_text())
    current = list(overrides.get("_no_pexels") or [])
    new_names = [n for n in sorted(by_name) if n not in current]

    from pexels_blacklist import add_slugs, purge_local, slug_from_filename
    slugs = set()
    for _, path, _, _, _ in found:
        s = slug_from_filename(path or "")
        if s:
            slugs.add(s)
    # auch aus rejects.txt Dateinamen, falls DB-Row schon weg
    for line in REJECTS_PATH.read_text().splitlines():
        parts = line.split("\t")
        if len(parts) >= 3:
            s = slug_from_filename(parts[2])
            if s:
                slugs.add(s)

    if not args.apply:
        print(f"\nDRY RUN — würde {len(found)} Rows löschen (Storage + DB)")
        print(f"DRY RUN — würde {len(new_names)} Namen in _no_pexels ergänzen: "
              f"{', '.join(new_names) if new_names else '—'}")
        print(f"DRY RUN — würde {len(slugs)} Slugs permanent blacklisten: "
              f"{', '.join(sorted(slugs)[:8])}{'…' if len(slugs) > 8 else ''}")
        print("\nMit --apply ausführen.")
        conn.close()
        return

    # Storage weg — sonst holt der nächste Sync die Datei wieder in die DB
    from supabase import create_client
    sb = create_client(
        os.environ["SUPABASE_URL"],
        os.environ.get("SUPABASE_SERVICE_ROLE_KEY", os.environ["SUPABASE_ANON_KEY"]),
    )
    paths = [path for _, path, _, _, _ in found if path]
    for i in range(0, len(paths), 100):
        chunk = paths[i : i + 100]
        try:
            sb.storage.from_("dedicated").remove(chunk)
        except Exception as e:
            print(f"  Storage-Fehler: {e}")
    print(f"{len(paths)} Storage-Dateien gelöscht")

    cur.execute(
        "DELETE FROM place_hero_images WHERE id = ANY(%s)",
        (hero_ids,),
    )
    deleted = cur.rowcount
    conn.commit()
    conn.close()

    overrides["_no_pexels"] = current + new_names
    OVERRIDES_PATH.write_text(json.dumps(overrides, ensure_ascii=False, indent=2) + "\n")

    new_slugs = add_slugs(slugs)
    purged = []
    for s in sorted(slugs):
        purged.extend(purge_local(s))

    print(f"\n{deleted} DB-Rows gelöscht")
    print(f"{len(new_names)} Namen in _no_pexels ergänzt ({OVERRIDES_PATH.name})")
    print(f"{len(new_slugs)} neue Slugs permanent blacklisted → pexels_audit/blacklist_slugs.txt")
    print(f"{len(purged)} lokale Dateien gelöscht")
    print("Diese Orte bekommen nie wieder Stock — auch nicht nach release.")


# --- Stufe: release -------------------------------------------------------

# Vor dem Audit manuell gesetzte _no_pexels-Einträge bleiben blacklisted.
KEEP_BLACKLISTED = {"Tavira"}


def stage_release(args):
    """Verworfene Orte wieder für download_pexel.py freigeben.

    Löscht Row + Storage-Datei + lokale Kandidaten und nimmt den Ort aus
    `_no_pexels` — AUßER Orte deren image_slug auf der permanenten Blacklist steht
    (pexels_audit/blacklist_slugs.txt). Die bleiben für immer gesperrt.
    """
    from supabase import create_client
    from pexels_blacklist import load_blacklist

    permanent = load_blacklist()
    overrides = json.loads(OVERRIDES_PATH.read_text())
    keep = set(KEEP_BLACKLISTED)

    conn = db_conn()
    cur = conn.cursor()
    # Welche Namen haben blacklisted Slugs? Die bleiben in _no_pexels.
    if permanent:
        cur.execute(
            "SELECT name_en, image_slug FROM places WHERE image_slug = ANY(%s)",
            (list(permanent),),
        )
        for name_en, slug in cur.fetchall():
            keep.add(name_en)

    names = [n for n in (overrides.get("_no_pexels") or []) if n not in keep]
    if not names:
        conn.close()
        sys.exit("Keine freizugebenden Orte (Rest ist permanent blacklisted).")

    cur.execute(
        """
        SELECT phi.id, phi.storage_path, p.name_en, p.image_slug
        FROM place_hero_images phi JOIN places p ON p.id = phi.place_id
        WHERE p.name_en = ANY(%s) AND phi.storage_path ILIKE 'pexels/%%'
          AND COALESCE(p.image_slug, '') <> ALL(%s)
        """,
        (names, list(permanent) or [""]),
    )
    targets = cur.fetchall()

    slugs = sorted({slug for _, _, _, slug in targets if slug and slug not in permanent})
    local = [
        p
        for slug in slugs
        for d in ("pexels_output", "output")
        for p in Path(d).glob(f"{slug}_pexels_*.webp")
    ]

    print(f"{len(names)} Orte freigeben ({len(keep)} permanent gesperrt)")
    print(f"  {len(targets)} DB-Rows + Storage-Dateien löschen")
    print(f"  {len(local)} lokale Kandidaten löschen (pexels_output/, output/)")

    if not args.apply:
        print("\nDRY RUN — mit --apply ausführen.")
        conn.close()
        return

    sb = create_client(
        os.environ["SUPABASE_URL"],
        os.environ.get("SUPABASE_SERVICE_ROLE_KEY", os.environ["SUPABASE_ANON_KEY"]),
    )
    paths = [path for _, path, _, _ in targets]
    for i in range(0, len(paths), 100):
        chunk = paths[i : i + 100]
        try:
            sb.storage.from_("dedicated").remove(chunk)
        except Exception as e:
            print(f"  Storage-Fehler bei Chunk {i}: {e}")
    print(f"{len(paths)} Storage-Dateien gelöscht")

    cur.execute(
        "DELETE FROM place_hero_images WHERE id = ANY(%s)",
        ([hid for hid, _, _, _ in targets],),
    )
    deleted = cur.rowcount
    conn.commit()
    conn.close()
    print(f"{deleted} DB-Rows gelöscht")

    for p in local:
        p.unlink(missing_ok=True)
    print(f"{len(local)} lokale Dateien gelöscht")

    overrides["_no_pexels"] = sorted(
        {n for n in (overrides.get("_no_pexels") or []) if n in keep}
    )
    OVERRIDES_PATH.write_text(json.dumps(overrides, ensure_ascii=False, indent=2) + "\n")
    print(f"_no_pexels behält {len(overrides['_no_pexels'])} permanente Einträge")
    print("\nJetzt: python3 download_pexel.py --relevant-only")


# --- CLI ------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="stage", required=True)

    p = sub.add_parser("fetch", help="DB-Rows + Bilder in den Cache")
    p.add_argument("--limit", type=int, help="Nur die N attraktivsten Orte")
    p.set_defaults(func=stage_fetch)

    p = sub.add_parser("clip", help="CLIP-Vorfilter (gratis)")
    p.set_defaults(func=stage_clip)

    p = sub.add_parser("vision", help="Vision-Urteil für die Top-Verdächtigen")
    p.add_argument("--limit", type=int, default=300)
    p.add_argument("--model", default="gpt-4o-mini")
    p.add_argument("--workers", type=int, default=6)
    p.add_argument("--include-inactive", action="store_true")
    p.add_argument("--redo", action="store_true", help="Auch bereits geprüfte neu bewerten")
    p.set_defaults(func=stage_vision)

    p = sub.add_parser("sheet", help="HTML-Sichtung, schreibt rejects.txt")
    p.add_argument("--limit", type=int)
    p.add_argument("--verdict", default="bad,unsure",
                   help="Welche Urteile zeigen: bad,unsure (Default) | all | none | ok")
    p.add_argument("--min-suspicion", type=float, default=0.0)
    p.add_argument("--preselect-suspicion", type=float, default=0.7,
                   help="Ohne Vision-Urteil: ab diesem CLIP-Score vorauswählen")
    p.add_argument("--active-only", action="store_true", default=True)
    p.add_argument("--no-preselect", action="store_true",
                   help="nichts vorauswählen")
    p.add_argument("--no-serve", action="store_true")
    p.add_argument("--port", type=int, default=8765)
    p.set_defaults(func=stage_sheet)

    p = sub.add_parser("review", help="CLIP-Interface: Verdächtige durchklicken (kein Vision)")
    p.add_argument("--min-suspicion", type=float, default=0.5)
    p.add_argument("--preselect-suspicion", type=float, default=0.7)
    p.add_argument("--limit", type=int)
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--no-serve", action="store_true")
    def _review(a):
        # Vision komplett ignorieren — auch error/ok-Einträge aus abgebrochenen
        # Läufen dürfen CLIP-Verdächtige nicht ausblenden (Alice US-Bug).
        a.verdict = "all"
        a.active_only = True
        a.no_preselect = False
        a.ignore_vision = True
        stage_sheet(a)
    p.set_defaults(func=_review)

    p = sub.add_parser("apply", help="Rejects deaktivieren (Dry-Run ohne --apply)")
    p.add_argument("--apply", action="store_true", help="Wirklich schreiben")
    p.set_defaults(func=stage_apply)

    p = sub.add_parser("release", help="Verworfene Orte für Refill freigeben "
                                      "(Dry-Run ohne --apply)")
    p.add_argument("--apply", action="store_true", help="Wirklich löschen")
    p.set_defaults(func=stage_release)

    args = parser.parse_args()
    AUDIT_DIR.mkdir(exist_ok=True)
    args.func(args)


if __name__ == "__main__":
    main()
