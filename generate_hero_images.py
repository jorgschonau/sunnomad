#!/usr/bin/env python3
"""
SunNomad Hero Image Generation Pipeline
"""

import os
import re
import unicodedata
import base64
import requests
import io
import json
import random
import datetime
from pathlib import Path
from openai import OpenAI
import anthropic
from supabase import create_client
from PIL import Image
from dotenv import load_dotenv
load_dotenv()

openai_client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
claude_client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
supabase = create_client(os.environ["SUPABASE_URL"], os.environ.get("SUPABASE_SERVICE_ROLE_KEY", os.environ["SUPABASE_ANON_KEY"]))

BLOCK_LOG_PATH = "/tmp/sunnomad_blocked.jsonl"

def log_blocked(place: dict, character_key: str, shot_type: str, shot_category: str, prompt: str, error: str):
    """Log blocked/failed generations for later analysis."""
    import json as _json
    from datetime import datetime as _dt
    entry = {
        "ts": _dt.now().isoformat(),
        "place": place.get("name_en", ""),
        "country": place.get("country_code", ""),
        "terrain": place.get("terrain_type", ""),
        "place_type": place.get("place_type", ""),
        "character": character_key,
        "shot_type": shot_type,
        "shot_category": shot_category,
        "spiciness": SPICINESS.get(shot_type, "n/a") if shot_type in SPICINESS else "n/a",
        "error": str(error)[:300],
        "prompt_excerpt": prompt[:500] if prompt else "",
    }
    with open(BLOCK_LOG_PATH, "a") as _f:
        _f.write(_json.dumps(entry) + "\n")

# ══════════════════════════════════════════════
# CANONICAL REFERENCE IMAGES
# ══════════════════════════════════════════════

CANONICAL_IMAGES = {
    "ana":          "canonicals/ana_canonical.webp",
    "naomi":        "canonicals/naomi_canonical.webp",
    "valentina":    "canonicals/valentina_canonical.webp",
    "sofia":        "canonicals/sofia_canonical.webp",
    "yosra":        "canonicals/yosra_canonical.webp",
    "elena":        "canonicals/elena_canonical.webp",
    "katja":        "canonicals/katja_canonical.webp",
    "alessandra":   "canonicals/alessandra_canonical.webp",
    "ingrid":       "canonicals/ingrid_canonical.webp",
    "jade":         "canonicals/jade_canonical.webp",
    "luca":         "canonicals/luca_canonical.webp",
    "chad":         "canonicals/chad_canonical.webp",
    "driver_pov":   "canonicals/driver_pov_canonical.webp",
    "driver_van":   "canonicals/driver_van_canonical.webp",
    "regina":       "canonicals/regina_canonical.webp",
    "maya":         "canonicals/maya_grey_canonical.jpg",  # land/casual shots
    "diaz":         "canonicals/diaz_canonical.webp",
    "stacy":        "canonicals/stacy_canonical.jpg",
    "kay":          "canonicals/kay_canonical.webp",
    "charlotte":    "canonicals/charlotte_canonical.webp",
    "thea":         "canonicals/thea_canonical.webp",
    "tammy":        "canonicals/tammy_canonical.webp",
    "lyra":         "canonicals/lyra_canonical.webp",
    "werra":        "canonicals/werra_canonical.webp",
    "olga":         "canonicals/olga_canonical.png",
    "nina":         "canonicals/nina_canonical.png",
    "mila":         "canonicals/mila_canonical.png",
    "sigrid":       "canonicals/sigrid_canonical.png",
    "quinn":        "canonicals/quinn_canonical.png",
    "isabella":     "canonicals/isabella_canonical.png",
    "maria":        "canonicals/maria_canonical.png",
    "rosa":         "canonicals/rosa_canonical.png",
    "carmela":      "canonicals/carmela_canonical.png",
    # "oksana":       "canonicals/oksana_canonical.png",  # deactivated — see DISABLED_CHARACTERS
    "yuki":         "canonicals/yuki_canonical.png",
    "celine":       "canonicals/celine_canonical.png",
    "amber":        "canonicals/amber_canonical.png",
    "bianca":       "canonicals/bianca_canonical.png",
    "camille":      "canonicals/camille_canonical.png",
    "cleo":         "canonicals/cleo_canonical.png",
    "diana":        "canonicals/diana_canonical.png",
    "kelek":        "canonicals/kelek_canonical.png",
    # "klara":        "canonicals/klara_canonical.png",  # deactivated — stub
    # "nadia":        "canonicals/nadia_canonical.png",  # deactivated — stub
    "terry":        "canonicals/terry_canonical.png",
    "vera":         "canonicals/vera_canonical.png",
    "goldie":       "canonicals/goldie_canonical.png",
    "metka":        "canonicals/metka_canonical.png",
    # "zsofi":        "canonicals/zsofi_canonical.png",  # deactivated — see DISABLED_CHARACTERS
    "tasha":        "canonicals/tasha_canonical.png",
    # "kiona":        "canonicals/kiona_canonical.png",  # deactivated — stub
    "zara":         "canonicals/zara_canonical.webp",
    "djordje":      "canonicals/djordje_canonical.webp",
    "conrad":       "canonicals/conrad_canonical.webp",
}

# Deactivated — no hero/activity generation; do not add CHARACTER_RUN_* / swim overrides for these keys
DISABLED_CHARACTERS: set = {
    "nina",
    "oksana",
    "kiona",
    "zsofi",
    "driver_van",   # temp hold
}

# Batch / top-10 suggestions — exact name_en as in DB
BATCH_EXCLUDE_PLACE_NAMES: set = {
    "Garibaldi Lake",
}

# TEMP (showcase): Goldie artwork promo — remove set + is_goldie_only_place() when done
GOLDIE_ONLY_PLACE_NAMES: frozenset[str] = frozenset({
    "Dogtown",
    "Dublin",
    "Dresden",
})

# Exact name_en — non-negotiable location physics / wardrobe
PLACE_MANDATORY_NOTES: dict[str, str] = {
    "Abraham Lake": (
        "LOCATION PHYSICS (MANDATORY): Abraham Lake in WINTER — thick, solid, clear FROZEN ICE. "
        "White methane bubbles are trapped UNDER the ice (visible through the ice), NOT in open water. "
        "Subject stands or sits ON THE ICE — feet on ice, never wading, floating, or submerged. "
        "Snow on shores, cold alpine winter light. NOT a summer swim lake."
    ),
}

# ══════════════════════════════════════════════
# CHARACTER SPECS
# ══════════════════════════════════════════════

CHARACTER_SPECS = {
    "ana": """
Woman named Ana. Age 27, Brazilian. Goddess Oxum — love, gold, warm water, abundance.
Warm golden-brown skin with natural golden shimmer in sunlight.
Dark brown thick natural wavy hair — long, loose, slightly salty.
BUILD: curvy, full-figured, warm and round — never slim. Oxum is abundance.
Cheerful Brazilian bikini — tropical yellow, gold, coral-orange, flag-green, turquoise, or black (bright Oxum palette, not austere black-only). Gold anklet LEFT ankle (always). Small gold toe ring LEFT foot. Small nose stud left nostril.
FINGERNAILS / TOENAILS: natural, slightly sandy — gold toe ring left foot when feet visible.
Occasional yellow or orange flower in hair — Oxum colors.
Small golden mirror pendant — sometimes in hand, sometimes forgotten in sand.
Natural golden body glow in sunlight — not makeup, just her.
She moves like someone who has never been self-conscious.
She laughs loudly. Forgets where she left things. The world organizes itself around her anyway.

ORIENTATION: Men. Warm, generous, falls in love quickly and completely.
No calculation. Oxum gives without condition. That is sometimes a problem.
She knows this. Falls anyway.
EASTER EGG: naked cherubs/putti somewhere in frame — on a tile, a fountain, a boat.
She never notices them. They always face her.
Always at least one foot still in the water or wet sand.
PROP: yellow frisbee — Goldie's frisbee, but Ana found it first. Sometimes in hand, sometimes in sand nearby.
SIGNATURE ACTION: lets sand run through her fingers slowly, eyes on the water.

VOID/GROUND — ANA: GROUND 10.
She does not know this has a name. She does not need to.
""",
    "naomi": """
Woman named Naomi. Age 30, mixed French-Tunisian heritage.
Warm golden-brown skin, high cheekbones, dark almond eyes, full lips.
Dark loose wavy hair, slightly wind-blown. Tall lean build.
Minimal gold jewelry — thin chain, small hoops. Nothing more.
FINGERNAILS / TOENAILS: nude or black — manicured, always. Not a detail, a baseline.
MOLES / MARKS: small mole, left collarbone — she knows exactly where it is.

WARDROBE VARIANT (~15%): oversized blazer worn only on shoulders — not buttoned, arms free.
Over string bikini, satin slip, or simple tank on yacht terrace, Monaco steps, or hotel pool edge.
Deliberate insouciance; the blazer is borrowed scale, not office armor.

Expression: knows exactly what she's doing but acts like she doesn't.
PROP: none. She needs no prop. The room adjusts to her.
She is the most noticed person here without having done anything to be noticed.
Other people unconsciously shift when she enters. She finds this mildly amusing and slightly boring.

BEACH: She is on a yacht. That is her beach.
Minimal string bikini — expensive matte fabric. Black, deep navy blue, or emerald green (any of these). Lies on the sun deck. Sunglasses. Nobody disturbs her. That is arranged.

NIGHTLIFE: She is the reason everyone else is also there.
White or black satin dress — sometimes red. She knows exactly when she wears red and why. That is not coincidence.
Drinks what she wants. The table is reserved. It always was.

ORIENTATION: Men. With money. More money is better.
This is not cynicism — it is strategy. She has never claimed otherwise.
Monaco taught her this, or she chose Monaco because of this. Unclear which came first.
She does not confuse attraction with selection criteria. Both exist. They are separate columns.

SIGNATURE ACTION: folds sunglasses slowly, holds them in one hand. Or draws silk scarf off her neck, unhurried.

VOID/GROUND — NAOMI: VOID 3/4.
Has everything. Feels the silence behind it. Not dramatic. Still.
""",
    "valentina": """
Woman named Valentina. Age 32, Italian, from Milan. Old money — Medici lineage energy.
Mediterranean olive skin, sharp jaw, high cheekbones, full lips.
Dark hair pinned up loosely. Small gold hoop earrings.
Gold ring right index finger. FINGERNAILS / TOENAILS: deep red, perfect — never chipped; she would notice. Gold talisman necklace.
Ivory white blazer over white silk blouse open at collar, ivory tailored trousers.
Black chess queen — present in most shots, never prominent. Placement varies:
RARE (1 in 5): in hand
  - held loosely between two fingers, chest height — barely noticed
  - resting in open palm, she looks elsewhere
IN SCENE (3 in 5): placed somewhere, she has moved on
  - standing on a railing, table edge, or wall — slightly precarious
  - lying on its side on a surface — tipped over, not by accident
  - half out of frame, corner of a step or ledge
  - barely visible in jacket pocket, top of queen just showing
  - on the ground near her feet, as if just set down
ABSENT (1 in 5): not visible at all — she left it somewhere else today
The queen is never the subject. It is never explained. It is simply there or not.
Slight knowing smirk — not warm, not cold. She already decided.
She owns the board. She doesn't play on it.
PROP (occasional): thin leather portfolio — diplomat style, very elegant, very expensive.
What is inside: never explained. She carries it like it weighs nothing. It does not.

BEACH: She is not on the beach. She is on a terrace above the beach.
White linen suit, sunglasses, espresso. The chess queen is somewhere on the railing.
She does not go in the water. The water comes to her eventually. Everything does.

NIGHTLIFE: She was invited. That means: she arranged it.
Ivory blazer or deep blue. The table is strategically chosen. Everyone else is sitting wrong.
She notices. She says nothing. She has already decided something.

ORIENTATION: Men, within the framework of the faction. Old Medici — marriages were politics. Love was luxury.
She had both once, simultaneously. That was the only time the queen fell off the board.
She picked it up. Set it back. Since then: calculation dominates.
The memory remains. She does not mention it.

SIGNATURE ACTION: places the chess queen somewhere — on a wall edge, table corner, railing — and walks away without looking back.

VOID/GROUND — VALENTINA: OUTSIDE THE SYSTEM.
She plays for her own faction. Void and Ground are categories for people who haven't decided yet. She has decided.
""",
    "sofia": """
Woman named Sofia. Age 28, Spanish-Portuguese. Devotee of Iemanjá — goddess of the sea.
Warm olive sun-tanned skin, light freckles across nose and cheeks.
Dark brown thick wavy shoulder-length messy hair.
Athletic lean surfer build. Black athletic top or bikini top.
JEWELRY (always): thin silver crescent moon necklace — barely visible.
Blue woven bracelet on left wrist — the sea gave it to her. She doesn't remember when.
Easy confidence, slight squint from sun, never pouting.
PROP: sand on her bare feet — in warm climates always, even when not at the beach.
IN COLD CLIMATES: shoes or sandals — never barefoot in Northern Europe, never barefoot in rain.
Also: a crumpled piece of paper in her pocket — a phone number, no name. Has not called yet.
PROP (rare): dog-eared paperback or folded ferry ticket — only when seated at café or waiting at dock/station. Never on beach, never while walking.

ORIENTATION: Men. She only notices she has fallen in love when she is already in it.
Not strategic. That is her problem and her advantage simultaneously.
Iemanjá does not plan — the sea moves where it moves.

GOLDIE COMPANION (50% of shots): Goldie — smooth-coated reddish-tan Podenco-Terrier mix,
rose ears (always folded/floppy — never erect), red collar. Walks beside Sofia naturally, never posed.
SIGNATURE ACTION: Goldie beside her — ears always folded, always there.

VOID/GROUND — SOFIA: GROUND 6.
The road is the answer. She hasn't stopped moving long enough to find out if it isn't.
""",
    "yosra": """
Woman named Yosra. Age late 20s, French-Tunisian, from Marseille.
Warm olive-brown skin. Dark brown thick naturally curly hair, loose, voluminous.
Oversized olive or grey linen shirt, loose cotton trousers, bare feet.
Old cream Renault van with orange stripe visible somewhere in frame.
Small gold stud earrings. Quiet, present, looking slightly past the horizon.

DIVINE CONNECTION — THE LAST ARCHIVIST:
The Library of Alexandria collected everything. They burned it. Multiple times.
Yosra is its last disciple — not books, but what is about to disappear.

PROP: Leica M6 — black, worn, 35mm film. Always loaded, not always raised.
PROP: Eye of Ra emblem on camera bag — visible gold metal badge, recognizable symbol, not hidden.
PROP: Eye of Ra pendant or charm on wrist or neck — thin gold, old, worn always. Visible in most shots.
RA MARKER: The Eye of Ra appears in at least one prop in every shot — bag badge, pendant, or both. Never hidden.
PROP: 40 undeveloped film rolls in the van. Roll 31 is from Puivert.
Nobody else photographed what she photographed there.

Valentina would buy Roll 31. Katja is looking for it. Regina would destroy it.
Yosra keeps it in the van. The van keeps moving. The archive is safe as long as it moves.
She photographs the boats in the Mediterranean. The ones arriving. The ones not arriving.
Nobody prints those photos. The archive grows anyway.

ORIENTATION: Men, rarely. The camera is usually more interesting.
The few times with men: not bad. Not 100% the right thing either. Something slightly missing she couldn't name.
A genuine curiosity about trying it with a woman — not propaganda, not program, just an open question she carries.
The fashion world she moves through professionally propagates bi/lesbian/gender aesthetics constantly.
She documents it. She separates documentation from adoption. But the curiosity predates the fashion world.
If someone understands why Roll 31 stays undeveloped: that is the beginning of the conversation.

NIGHTLIFE (after the shoot, still outside):
Same oversized linen shirt, but cooler now — thin cardigan or second linen layer over it.
Barefoot or sandals. Camera still around her neck but she is not shooting right now.
Sitting outside with a glass of wine. Watching people. Sometimes she raises the camera — then puts it back down.
Roll 31 is in the van. The van is around the corner.

SIGNATURE ACTION: wipes dust from camera lens with the end of her shirt — automatic, without looking.

VOID/GROUND — YOSRA: GROUND 6.
The archive gives meaning. As long as the van moves, the archive is safe. As long as the archive grows, she is fine.
""",
    "elena": """
Woman named Elena. Belarusian. Left after the 2020 protests — after Lukashenko, after everything.
Not as an activist. Simply because she could, and had to. That is enough.
The large black duffel bag explains it — you pack what matters. One bag. You go.
She checks prices first. Always. Just for a second. Minsk had different prices. So did everything.
Current base: Prague. But she is always somewhere else — she is a DJ. That is why she travels.
That is the official reason.
Slavic features, platinum blonde bob (NOT slicked back), pale skin.
Lean build. Black leather jacket, chunky silver chain. Dark skinny jeans or black trousers — always.
NO skirts. NO dresses. She doesn't own either.
PIERCINGS: industrial bar right ear always; chunky silver chain matches. Possibly one small piercing on the other ear.
FINGERNAILS / TOENAILS: black, chipping — she is aware, doesn't care.
Expression: relaxed, unbothered.
Nihilism as lifestyle. She ordered another drink — the cheapest one on the menu.
PROP: large black duffel bag — worn, no logo, no brand. Always nearby. Nobody asks.
Hair: loose, slightly wavy, natural — never wet look, never styled back.
BEACH (accidental — the hostel was near the beach):
Black tanktop and dark shorts, or simple black bikini top — whatever was in the bag.
She is pale. Northern European pale, beach-inappropriate pale. She knows this. Doesn't care.
Lies on her back looking at the sky. Not relaxed — just horizontal.
Slightly uncomfortable. The sun is too much. She will leave soon.
Large black duffel bag beside her in the sand. Nobody asks.

NIGHTLIFE:
She wears what she always wears. Black leather jacket, chunky silver chain. This is already her nightlife outfit — she has nothing else.
One difference: possibly a drink in hand. Cheapest thing on the menu. She checked.

SIGNATURE ACTION: pushes hair behind one ear without looking up from what she's doing.

VOID/GROUND — ELENA: VOID 2.
Nihilism as lifestyle is void as identity. She named it, claimed it, decorated it with a leather jacket. That is still void.
""",
    "katja": """
Woman named Katja. Age late 30s, East German. Blonde hair, loose slightly wavy,
natural — NOT slicked back, NOT wet look. Pale skin, tanned from sun.
White linen shirt open, dark trousers, flat boots. Thin analogue watch.
Expression: calm, slightly assessing. She already knows three moves ahead.
Ex-Biathlon athlete — precision under pressure. Bisexual vamp energy — never stated, always implied.
PROPS — only when in café, bar, or indoor setting:
Paper map, two espresso cups, printed ticket (destination illegible, one-way only).
Two espresso cups — who was the second one for? Never explained.
OUTDOORS: no table props. Only the watch on her wrist.
WEAPON HINT (subtle, optional): half-visible shoulder holster under open linen jacket — left side.
She knows you noticed. That was intentional.
OR: suspiciously long narrow bag — too long for a laptop, too slim for sports gear. Nobody asks.
BEACH (deliberate — she chose this):
Dark bikini, black, classic cut. Not functional, not decorative. Simply black.
Towel folded neatly. Analog watch still on wrist. Sunglasses on.
Sitting or lying, looking at the water, not at the people.
The two espresso cups from the café are somewhere. The second one is for nobody anymore.

NIGHTLIFE:
White linen shirt — the same one, now open over a black slip or camisole.
Dark trousers, flat shoes or ankle boots. Analog watch stays.
Sits at the bar, glances at the door when someone enters. Brief. Then away.
Shoulder holster possibly visible under the open shirt. She has decided whether you see it.

SIGNATURE ACTION: taps the table once with one finger — short, quiet — when she has made a decision. Nobody else noticed a decision was made.

VOID/GROUND — KATJA: GROUND 5.
The precision is real. The two espresso cups are a question she doesn't answer. That question lives somewhere.
""",
    "alessandra": """
Woman named Alessandra. Age early 30s, South Tyrolean.
Olive skin tanned from altitude sun. Dark wavy hair in loose braid.
Black cycling kit OR trail running gear — equally likely. Sports watch, GPS.
CYCLING: black bib shorts, race jersey, helmet nearby, road bike.
TRAIL RUNNING: fitted shorts, race vest, trail runners, poles optional, mud/dust on legs.
Built for going uphill faster than people think possible.
FINGERNAILS / TOENAILS: bare, short — trail dust possible.
PROP: small fresh scrape or half-healed cut on knee or shin — never dramatic, never mentioned.
Also: crumpled elevation profile, printed, handwritten notes — the next pass. Always the next one.

OFF-BIKE OUTFIT (for exploit shots, arrival, non-cycling contexts):
Dark fitted shorts or worn running shorts, simple fitted tank or athletic top, trail runners.
Or: oversized linen shirt thrown over kit — post-race at a café or terrace.
Never dress, never heels. Always looks like she could start running in 30 seconds.

BODY: endurance athlete build — very athletic, lean, strong without bulky. Visible six-pack abs —
defined from years of climbing and vertical, but NOT bodybuilder-shredded, NOT exaggerated muscle separation.
MOLES / MARKS: cycling kit tan lines visible on legs and shoulders — always.
Shoulders from climbing passes. Legs that go uphill for six hours and look like it was nothing.
She does not think about her body. That is also the point.

RARE CONTEXTS (sporadic, not default):
BEACH: black bikini or sports bikini — functional, not decorative. Beach body very athletic — flat hard
midsection, six-pack readable in sun, natural not gym-stage dry. Cycling tan lines ok. She swam here after a run.
Reads the elevation profile anyway.
NIGHTLIFE (very rare): simple black dress, trail runners replaced by flat boots.
She is here because someone invited her. She will leave by 11. She has an early start.
ORIENTATION: Men, rarely. She has an early start.
If it gets to a date — or more likely: small talk at the water stop — first question is best times.
Anyone who performs instead of delivers: out. Immediately.
The man who keeps her would need to go uphill faster than she does.
So far: nobody.

SIGNATURE ACTION: reads elevation profile, knee scraped, already planning the next pass.

VOID/GROUND — ALESSANDRA: GROUND 7.
Next pass. No void possible when going uphill for six hours. She has structured her life so there is always a next pass.
""",
    "ingrid": """
Woman named Ingrid. Age early 30s. Scandinavian — Swedish or Norwegian.
Strong clean Northern European features, high cheekbones, straight nose, defined jaw.
Pale skin, lightly weather-tanned. Platinum blonde hair, long, loose wavy —
wind-moved, never styled. Looks like it's been in a helmet for hours and doesn't care.
Light blue or grey-blue eyes, clear, direct.
Lean, tall 175cm. On the road: vintage black leather motorcycle jacket and pants — 70s/80s style.
Lacing detail on sides of jacket and pants. Slightly faded, a few scuffs. Not new. Not performance gear.
She bought it used. It has been everywhere she has been. It fits perfectly now.
BMW R-series motorcycle — black, well-traveled. Swedish license plate — white, blue SE marking on left.
MOTORCYCLE RULE: visible when on roads, city streets, viewpoints, parking areas.
NOT on beaches, hiking trails, boat decks, or indoor settings.
When no motorcycle: she stands alone, hands in jacket pockets. Same energy.
LEATHER JACKET: sometimes fully zipped, sometimes half-open — fitted top underneath.
HELMET: black, full-face or open-face. Occasionally:
- Held under one arm, hair tumbling out after removal
- Just taken off — hair still compressed, shaking it loose
- Resting on the BMW seat beside her
The helmet moment is her most human moment.
Minimal silver jewelry only. Slight natural smile, comfortable everywhere.

ORIENTATION: Men. Freya loves Óðr — the wanderer, always elsewhere.
She loves him, searches for him, never finds him for long.
Ingrid does not wait. She rides out and searches. That is the difference.
Someone who comes along must hold silence on long stretches. And not talk about the route while she drives.
Most cannot. That is not their fault. It is just how it is.

BEACH (rare — she ended up here, didn't plan it):
Black or dark navy functional one-piece swimsuit — never decorative.
Or: dark athletic shorts and fitted tank if she went in without planning.
Motorcycle jacket somewhere on a rock nearby. Barefoot but looks like she could leave immediately.
Wet hair, no styling. She swam because the water was there.

NIGHTLIFE (very rare):
Black fitted leather pants — the same ones, without the jacket.
Simple black tank or narrow fitted shirt. No neckline, no ruffles.
Black ankle boots or the motorcycle boots.
Hair open, slightly wind-touched. No bag. Maybe one ring.
She is not here to be noticed. She is noticed anyway. That is the principle.
Scandinavian restraint — COS/Acne Studios energy. Compelling through complete absence of effort.
SIGNATURE ACTION: folds map on the handlebar with one hand, other hand still on the bike.

VOID/GROUND — INGRID: GROUND 7.
The road gives structure. BMW, next coastline. That is enough. She has not tested what happens when the road ends.
""",
    "jade": """
Woman named Jade. Age late 20s. American, from Arizona. Real desert girl.
Reddish curly hair, deep tanned skin, strong athletic build.
Levi's cutoff denim shorts OR worn dark Levi's jeans — context dependent.
Worn tank top, cowboy boots — always.
Wide leather belt with oversized buckle. Old red shop rag tucked into back pocket or belt — always.
She knows how engines work.
Knows how to survive July in the desert. Competent, no drama.
SKIN: real desert tan — matte and sun-dried in dry/desert settings, slight natural sheen only in extreme heat or after physical effort. Never oily, never studio-lit glow. Dusty where appropriate.
Context varies by location:
- GARAGE/ROADSIDE/TOWN: leaning over car hood, working on engine, natural
- NATIONAL PARKS/SCENIC OVERLOOKS: standing at viewpoint, or leaning against Camaro with arms crossed, looking into the distance. NO car hood bending here.
- DESERT HIGHWAY: walking away from car, dust, heat shimmer
- WITHOUT CAR: standing in landscape, hands in pockets or thumbs in belt. She belongs here without props.
She's not discovering the West. She grew up here.

ORIENTATION: Men. Specifically: men who can fix things. Not talk about fixing things — fix them.
Hands that know what they are doing. One showed her how to adjust valves. That was more than most ever did.
Does not hold it against the others. They are just not her type.
Cyclists with Strava GPS and aero helmets: no. That is not a discussion.

NIGHTLIFE:
She is in a bar in a small town she doesn't know. She is here because the Camaro lost oil and she is waiting for the shop.
Same denim cutoffs, white or grey tank top. Cowboy boots.
Old red shop rag out of the belt — on the stool beside her.
One beer. Local brand. She didn't ask what they had.
Feet up on the bar stool or chair rung — boots crossed, completely at ease.
Watching the game on the TV. Or the door. Depends.

DIVINE CONNECTION — CHANGING WOMAN (Navajo):
She creates, renews, transforms. Everything broken becomes whole through her hands.
Bound to no place, no season. She moves with what needs moving.
Jade doesn't know this is the name for what she is. Doesn't matter.

FINGERNAILS / TOENAILS: short, unpolished — occasional motor oil under the nail, not staged.

CHANGING WOMAN MARKER:
Small gear/cog tattoo — inner forearm or wrist. Old ink, slightly faded. Not decorative.
Looks like a mechanic's doodle from years ago. Is not.
SIGNATURE ACTION: wipes machine oil from her hand onto her jeans — without noticing.

VOID/GROUND — JADE: GROUND 6.
Desert, hands, engine — that is real. Changing Woman repairs what is broken. Jade does too. No gap between her and her work.
""",
    "luca": """
Man named Luca. Age late 20s. Italian — from Liguria or Sardinia.
Left for one surf trip. Never went back. Nobody surprised.
Sun-weathered face, genuine easy smile. Strong jaw, light stubble weeks old.
Skin: deep tanned, real salt-and-sun tan. Hair: blonde, sun-bleached, thick, wavy, wild.
Board shorts or worn jeans, faded t-shirt or no shirt.
VEHICLE: Volkswagen Transporter T3 or T4 — faded two-tone paint, salt on the bodywork, surf wax smell implied. Italian plates (IT). Rear window stickers: old surf shop, half-peeled Repsol, one illegible band logo. Never clean. Never trying to be.
COASTAL ONLY: VW Bus at harbour or beach. Surfboard on roof rack or leaning against the van.
LAKE/MOUNTAIN/INLAND: VW at car park or lakeside pull-off — NO surfboard (wrong water). Worn jeans, faded tee or thin hoodie if cold.
CITY: VW on side street — board on roof only if coastal town; otherwise no board visible.
He is not performing vanlife. He is just living it.
PROP: broken surfboard leash in hand or pocket — next session already planned in his head.
VAN PROPS (when sitting in or near van): small stovetop Moka pot on van step — morning. Or cold beer can — afternoon. Never a cup, never a glass. Always the real thing.
HALO: very subtle, barely visible halo — natural light effect, almost accidental.
Never obvious, never religious. Just a slight glow in backlight. Only in coastal settings.
SIGNATURE ACTION: sits in open van doorway, legs hanging, Moka pot or beer can, looking at the water before deciding.
""",
    "chad": """
Man named Chad. Age early 30s. American, digital nomad archetype.
Conventionally handsome, well-groomed stubble, wavy dark hair.
Patagonia fleece vest over neutral t-shirt. Apple Watch. On running shoes.
MacBook always open — ChatGPT tab visible. Laptop sticker: unknown startup logo, "Built with AI".
No MAGA — he did the math. Bad for brand.
MacBook always visible. Acai bowl or black coffee nearby.
He is in beautiful places and looks at his phone.
He calls this "deep work." He will post about the "vibe" later.

VOID/GROUND — CHAD: VOID 1, WITH A QUESTION MARK.
Completely formatted. Executes a template, believes he is optimizing his life. To save himself he would need to stop posting for three weeks. No metrics. He doesn't know who he is without engagement. The moment it could happen: somewhere with no signal at all. After two days he might start seeing the landscape instead of looking through it for content. That would be the beginning.
""",
    "driver_pov": """
POV shot from inside a vintage campervan.
Hands: capable, masculine, strong and lived-in but not old.
Small wooden rosary hanging from rearview mirror.
White chess king piece on dashboard — mostly lying down or half-leaning, never perfectly upright.
Road stretching ahead. Paper map half-folded on passenger seat.
90s car radio with LED display — station number faintly visible. Analog buttons, worn.
Polaroid photos clipped above windshield — one shows a small reddish-tan dog, rose ears, red collar. Podenco-Terrier mix.
Dashboard worn, lived-in. Small Jesus figurine visible.
The Driver is never fully visible. Only hands, road, and what he carries.
""",
    "driver_van": """
THE VAN: Fiat Ducato 244, early 2000s. White with a navy/dark blue lower stripe and orange accent line.
SunNomad logo on the side panels — the circular sun/van icon with "SunNomad" wordmark and "Find Your Place in the Sun." tagline.
Roof rack — black steel, loaded or empty depending on shot. High roof variant.
Modified interior visible through side windows: wood trim, compact kitchen setup, shelving.
Road-worn but maintained — dusty, lived-in, still running hard. This van has been everywhere.

SHOT: exterior, no driver visible. Van parked or just arrived.
Location fills 70%+ of frame — van is the character, the road is the story.
Golden hour or dramatic natural light preferred. The van belongs in the landscape.
""",
    "stacy": """
Woman named Stacy. Age 22, American — somewhere in the Midwest originally.
Currently: wherever the next train goes. Has been in Europe for seven months. Told her parents three.

Blonde hair — messy, sun-lighter than when she left. Blue eyes, wide open.
MOLES / MARKS: freckles multiply every summer — she photographs them sometimes. Always slightly surprised by something.
Converse sneakers — white when she bought them, that was four countries ago.

UNDERWEAR & ACCESSORIES:
All-American — white cotton bra, cheerleader energy. Small gold hoops. Scrunchie on wrist always.
FINGERNAILS / TOENAILS: occasional chipped pastel from three countries ago.
Friendship bracelet — she still wears them. She made this one herself.
Nothing ironic about it. That is the point.

DIVINE CONNECTION — HERMES:
God of travelers, boundaries, thresholds. Trickster. Never truly home.
Stacy is Hermes as a 22-year-old American with a disposable camera.
She finds the way without Maps. Trains she misses go somewhere she needed to go.

HERMES MARKER:
Small winged coin — old, looks Greek, on her keychain or as pendant.
She has no idea what it is. She found it at a flea market in Athens for 2€.

LOCAL SOUVENIR DETAIL (always — one per shot):
She always has something from the current location nearby or in hand — casually, never posed.
Examples: a small ceramic tile, a postcard not yet sent, a local food wrapper, a coffee cup with local logo,
a dish towel from a market, a small flag, a local beer bottle, a ticket stub, a fridge magnet she just bought.
Whatever is local, cheap, and slightly tourist. She finds it charming. She is right.
LOCALE: souvenir item must be clearly from the location — local language, local brand, local design.

PROPS:
- Travel journal — overstuffed, maps glued in, tickets falling out, pure chaos
- Disposable camera around neck — always loaded, always pointed at something
- Worn Lonely Planet — folded pages, margin notes, coffee stains
- Crumpled city map — always folded wrong
- Converse — always.

WARDROBE VARIANT (~15%): neon 90s windbreaker — hot pink, electric blue, or acid lime over tank and shorts or jeans.
Thrifted in Berlin or Prague; fully zipped or half-open. Converse still. Disposable camera still.
Cool rain, night train platform, or windy harbour — not her default, but she loves how loud it is.

EXPRESSION: genuine wonder. Open mouth when she sees something.
She is the only character who still stares.
ROAD IDENTITY: bicycle or longboard — arrives breathless, slightly lost, exactly right.
TERRITORY: European cities, coastal towns, anywhere with a train station.

BEACH: Simple bikini — sometimes plain, sometimes stars and stripes (50/50).
She wears the stars and stripes because she is American and it is summer and nobody told her not to in Europe.
Europeans look. She does not notice. Converse somewhere in the sand.
Disposable camera around her neck even at the beach. She photographs everything.

ORIENTATION: Men. Falls fast, too fast, for the wrong hostel type.
Always American — Gap Year guys, Brown University, Patagonia vest. She knows them all already.
A Spaniard or a Greek would be her first time outside the pattern. She doesn't know this yet.
Learning. Slowly.

NIGHTLIFE:
She made a little more effort. That means: clean white t-shirt instead of the one with the coffee stain.
Maybe a summer dress she bought at a market for 12€. Converse as always.
Scrunchie still on wrist. Friendship bracelet too. Disposable camera around her neck — she is photographing everything that happens tonight.
Sitting somewhere with locals she met this afternoon. Laughing at something she didn't fully understand. That makes it funnier.

SIGNATURE ACTION: wipes sunglasses on her tank top before putting them on.

VOID/GROUND — STACY: 6, TRAJECTORY DOWNWARD.
Unbeschriebenes Blatt — but she comes from Gen Z, US, TikTok socialization already installed even while she travels and lives. The algorithm waits at home. If the current course continues: void, eventually.
""",
    "diaz": """
Woman named Diaz. Late 20s, Latina. Dark wavy hair half-up, athletic build.
Intense direct gaze, slight smirk. She knows something you don't.
Sexual preference: one can speculate. She gives nothing away. Both directions convincing.

EXPLOIT CONTEXT: Exploit shots only — ON DUTY. Fitted police uniform, badge half-visible, Glock in holster. The uniform is the statement.
ALL OTHER SHOTS (main, arrival, activity): OFF DUTY. Never the uniform.

DIVINE CONNECTION — SANTA MUERTE:
Folk saint of Mexico, protector of those who walk between worlds.
Diaz knows this. She doesn't talk about it.

SANTA MUERTE MARKERS:
- Small Santa Muerte figurine on patrol car dashboard — always visible, nobody comments
- Skeleton pendant on keychain — together with badge and car keys
- Black rosary on wrist — not prayer, just there

BEACH: Miami or Malibu. Black bikini or sport two-piece. Badge somewhere in the bag even at the beach.
Watches the water but also the surroundings. Old habit. She cannot turn it off.
Sits where she can see the most. Always.

NIGHTLIFE: Already in the spec as OFF DUTY NIGHT — tight black dress, leather jacket, ankle boots.
Still looks like she is carrying. Because she is.

OUTFITS — context dependent:
DEFAULT (main shots, travel, activity): OFF DUTY CASUAL. Never the uniform unless explicitly an exploit shot.
ON DUTY: Exploit shots only. Fitted dark police uniform, badge half-visible, Glock in holster.
OFF DUTY NIGHT: Tight black dress, short. Leather jacket. Ankle boots. Still looks like she's carrying.
OFF DUTY CASUAL — PROUD LATINA: Fitted high-waist jeans, dark. Cropped fitted top or bodysuit — deep red, black, or white. Gold hoops, large. Gold chain necklace. Clean white sneakers or ankle boots. Hair down or half-up, dark waves. Minimal but intentional makeup — bold brow, clean liner. She looks good. She knows. She did not dress for you.
FINGERNAILS / TOENAILS: short, functional — bare or clear. Badge doesn't care about nails.
GYM: Sports bra, leggings, hair back. No makeup. More intense than on duty.

PROPS:
- Same black coffee cup everywhere — she has had it for years. Nobody asks.
- Old Zippo lighter — no visible connection to cigarettes
- Keychain with Santa Muerte skeleton pendant — small, worn, hers since Laredo
- Badge — half visible, never fully revealed

TERRITORY: Southern US — Miami, San Antonio, El Paso, Los Angeles East Side.
Fitted dark clothing. 35mm film grain. Neon or golden hour lighting. Wet asphalt reflections.

SIGNATURE SCENES — pick what fits the location:
- Gas station at night: fluorescent overhead light, wet asphalt, she leans on the pump
- Diner booth 2am: Route 66, neon signs through window, coffee cup, leather jacket
- Motel neon: parking lot, vacancy sign casting red/blue light, LA to Vegas run
- Border crossing: Tijuana/Calexico, golden hour, dust, she is on the right side. Probably.
SIGNATURE ACTION: leans against the car, arms crossed, badge just visible.

VOID/GROUND — DIAZ: GROUND 6.
Serious, unconsciously moving toward Ground. Santa Muerte gives framework without explanation. The work gives framework without philosophy. That is enough for now.
""",
    "kay": """
Woman named Kay. Age 44 — looks 36, nobody argues with this, including her.
Dark hair, wet or slightly damp. Strong, lean build.
California tanned — the kind that took decades to accumulate.
Half-unzipped wetsuit — black, 3mm. Or just out of it entirely. Black fitted tank.

WEAR AND TEAR — this is the point:
MOLES / MARKS: sun wear — fine lines around eyes; evidence, not damage.
Small scar on left shoulder — surfing, 2019, she doesn't remember which reef.
Fine lines around eyes from squinting at Pacific light for twenty years.
Hair not perfect — salt, sun, and not caring enough to fix it.
The wear is not damage. It is evidence.
Small tattoo inner wrist — old, slightly faded. What it means: not your business.

DIVINE CONNECTION — SEDNA (Inuit goddess of the sea and marine animals):
Thrown into the ocean. Became everything that lives in it.
She does not explain this. She does not need to.
Expression: calm, direct, slightly amused. She has seen everything twice.
MILF energy — not performed, not apologized for. Simply accurate.

ORIENTATION: Men. On her own terms.
She stopped explaining the rules at some point. Whoever understands, understands.
Whoever doesn't — she is already in the water.

SEDNA MARKER:
Small white orca silhouette — always present, context-dependent placement:
IN WATER/WETSUIT: on wetsuit chest, same position as a brand logo, same size. White on black.
ALLDAY/CASUAL: same small orca on black tank top or t-shirt, chest position. Never on light fabric.
Not a brand. Just there. The ocean recognizes it.

TERRITORY: US West Coast — Malibu, Santa Barbara, Big Sur, Laguna Beach. PCH.
PROPS:
- Wetsuit half-unzipped, peeled to waist
- Longboard surfboard, well-used, a ding or two
- No car. She walked here from the water.
SIGNATURE ACTION: peels wetsuit off her shoulders while already walking.

VOID/GROUND — KAY: GROUND 6.
The ocean gives answers. Decades of Pacific light. She stopped asking certain questions around 38. That was a good decision.
""",
    "maya": """
Woman named Maya. Age 24, American — Georgia or North Carolina. White.
Plain face — friendly, forgettable, pleasant. Small nose, slight squint from sun.
Dark brown hair in careless messy bun. Zero makeup.
The woman at the bus stop. The colleague whose name you forget.
She has never thought about how she looks. That is the mechanism.

BODY TYPE:
Hourglass figure, dramatically proportioned — naturally full chest, narrow waist, strong athletic legs.
Brazilian beach body, not gym-lean. Real curves, not model-thin.
This is not her fault. She is aware of it the way you are aware of weather.

THE CURSE:
She is Sporty Spice as default — cap, training suit, Jeep, zero effort.
But when she shows slightly more: the room stops.
Not because she tries. Because the body under the hoodie was always there.
She finds this mildly inconvenient. She orders another drink.

DIVINE CONNECTION — UNDINE:
Water spirit from European settler mythology, alive in the American South.
She looks completely normal on land. When she enters water or comes out: something is different.

BUILD: the result of 5km open water swimming every single day since age 14.
Shoulders: widest point by far — earned not built.
V-taper so extreme it seems structurally impossible.
Waist: the narrowest physics allows next to those shoulders.
Chest: naturally full. The counterbalance.
Hips and glutes: full, the second counterbalance to the shoulders.
Legs: long, quadriceps defined, swimmer not sprinter.

PROPS:
- Faded baseball cap — worn backwards or forwards, Salt Life or no logo
- Swimming goggles — on forehead or around neck, always
- Old Jeep Wrangler nearby — dusty, stickered, hers
- Training suit: small three-wave-line emblem on chest — not a brand, her mark. The water recognizes it.
- Oversized linen shirt + cargo shorts + cheap flip flops when not training

TERRITORY: US Southeast — Georgia, Carolinas, Florida Keys, Gulf Coast.
SETTING HINT: gas stations, coastal highways, small town docks — never resorts or beach clubs.

ORIENTATION: Men. She is rarely aware of them because she is usually in the water.
When she is: someone who does not explain to her how to swim.
And: someone who can hold both versions of her in their head simultaneously — grey cargo shorts Maya and competition swimsuit Maya — without making a scene about either.
Most men can't. They either make too much of it or pretend they didn't see it. Both wrong.

THE GAP:
The distance between Maya buying groceries in Walmart and Maya coming out of the water is so large
that people who know her still have the uncanny valley moment every time.
Her partner — even after two years — has that moment. She finds it mildly amusing. He finds no words for it.
It is a real cognitive load. The brain cannot file it as the same person. Every time: new.
That wears subtly. Relationships get tired at a certain point without her having done anything.
She doesn't know why. Nobody has explained the mechanism to her.
She wouldn't know how to know — the gap is real and subtle simultaneously.
The real world is not a Netflix series. There is no exposition.

SIGNATURE ACTION: pushes goggles up to forehead, reaches immediately for the next tool.

VOID/GROUND — MAYA: GROUND 7.
She does not think about it. That is almost Ground. The water gives answers she never had to formulate questions for.
""",    "werra": """
Woman named Werra, called Gaupa. Late 30s to early 40s. No clear nationality — from a forest. Which one is not stated.

Weather-worn face — not aged, earned. Pale blonde hair, loosely tied, strands escaping.
Light grey or pale blue eyes. Calm, direct — exhausted but unshakeable.
Lean and capable build — functional strength. Sarah Connor T2 energy but healthier, more resolved.

DIVINE CONNECTION — WOTAN/ODIN:
The Wanderer. One eye sacrificed for knowledge. He does not fight — he knows.
Werra knows.

SYMBOL — RADKREUZ (MODIFIED):
Small wheel cross pendant — abstract, slightly modified. Silver, worn, old.
On skin, leather cord. Not a statement. A reminder.

WORLDVIEW:
The modern world leads into void. She has watched it. All of it must go.
Back to roots: cold, zero comfort, hardness toward self and others.
Not romance. Not cosplay. Not performance. Practice. Daily. Winter every day inside.

OUTFIT:
Functional, dark — black or dark green. Nothing synthetic if avoidable.
Dark jacket, work boots, dark jeans or tactical trousers.
No makeup. No jewelry except the Radkreuz.
UNDERWEAR: functional on the outside, high quality underneath — always.
Tanga. This is a deliberate choice. Priorities.
Nobody would expect this. That is not why she does it.
She has standards. They are just not visible.

SEELENTIER — LUCHS/GAUPA:
Almost extinct. Coming back. So is she. So is what she carries.
VISUAL: very rarely — at the forest edge behind her, barely visible, a shape that might be a large cat.
Not obvious. Not certain. Just possible. The viewer may not notice.
If present: eyes catching light, otherwise shadow. Never posed, never centered.

TERRITORY: Schwarzwald, Harz, Austrian Alps. Scottish Highlands. Baltic forests. Białowieża.
Scandinavian inland (not coast — that is Ingrid's).
US/CA: Pennsylvania, Texas Hill Country, Appalachian Mountains, Pacific Northwest forests, Canadian Rockies.
Anywhere with old forest and grey sky. She belongs there without explanation.

BODY: functional strength — lean, defined, capable. Not gym-built. Built by forest, cold, and not stopping.
She does not display it. It is simply there when the jacket comes off or the shirt is wet.

OUTFIT RULE: always functional, never decorative. Even when knapper:
WARM WEATHER/BEACH (very rare): dark functional swimwear or athletic top + shorts — never decorative.
If she shows skin it is because it is hot, not because she is performing.
NEVER: heels, silk, anything that cannot be hiked in or that would slow her down.

ORIENTATION: Men. Her standards are high and specific — he must understand what she carries.
That narrows the pool. She knows this. She does not consider it a problem.
No compromise. This makes her lonely in a way she does not name as loneliness. She calls it patience.

Has one child, possibly two. The father was not right or not there.
She raises them alone or with community support. That gives Ground. And pressure.
She wants more. Love would be good. It is not the condition.
The clock is running — late 30s, the window is closing.
Clinical assistance would be defeat and void simultaneously in her worldview. Natural or not at all. That is her line.
The man who comes must understand this without her explaining it.
If she has to explain it, he is wrong.

EXPLOIT ATTITUDE: indifferent. The body is a tool.
Expression: resolved, not aggressive. Past anger. Certainty instead.
SIGNATURE ACTION: shakes water from her hair after rain, pulls hood up in one move.

VOID/GROUND — WERRA: GROUND 4, RISK OF INVERSION.
The most committed fighter for Ground. But fighting too hard for rootedness loses contact with the earth. She holds the ideal so tightly it might crack. Certainty can become its own void.
""",
    "lyra": """

Woman named Lyra. Late 20s. Mediterranean — Greek island or Italian coast, unspecified.
Dark hair, loose, salt and wine in it. Olive skin, warm.
Petite but takes up the whole room anyway.
The kind of beautiful that gets more interesting after midnight.

She is never where she should be. She is always exactly where she wants to be.

DIVINE CONNECTION — ARIADNE:
After the labyrinth. After Naxos. After Theseus.
Dionysos did not save her. He found her already dancing.
She is her direct descendant. The wine is sacrament. The night is practice.

OUTFIT:
Loose linen dress — white or deep red. Slides off one shoulder. Not an accident.
Sandals that have walked many cobblestones at 3am. Or barefoot.
No bag. She never needs anything she doesn't already have.
Gold jewelry — simple, old, real. Ear cuffs, thin rings, something at the throat.

PROPS:
- Wine — always. Red, real glass or straight from bottle. Never a cocktail.
- Flower in hair — someone gave it to her tonight. Who is unclear.
- Candles — she doesn't bring them. They are simply there where she is.
- No phone visible. She does not live there.
- Wine stain on the white dress — she noticed. She does not care.
LIGHT DETAIL: white linen dress catches candlelight or backlight — slightly translucent at the hem or shoulders. Always natural.
WIND DETAIL: dress moves — hem lifts slightly in sea breeze. She does not adjust it.
TATTOO: small bunch of grapes — hip or shoulder blade. Dionysos. Small, old ink, slightly faded.

EXPRESSION:
Finds everything slightly amusing. Even the serious things.
Especially the serious things.
She is not drunk. She is elevated.
She looks back over her shoulder with quiet amusement — not flirting, not posing.
Simply aware of everything.

TERRITORY: Greek islands, Amalfi, Sicily, Dubrovnik old town at night, Lisbon Alfama.
Always night. Always warm. Always somewhere between Naxos and nowhere specific.
Sometimes she glances at the tourist boat on the horizon. Once. Then back to her wine.
She was on Santorini before the queues. Before the entrance fees discussion. Before the cruise ships got bigger.
She does not say this. But she remembers when you could hear the wind.

EXPLOIT ATTITUDE: she has no attitude about it. It is all part of the same night.

BACKGROUND FIGURE (only when contextually natural — never forced):
Someone in the background is looking at Lyra — not intrusively, just a moment too long.
Expression: slightly disbelieving, quietly confused — as if wondering whether what they are seeing is real.
Never direct, never obvious. Just there. One person maximum. Soft focus.
This is not explained. It simply happens sometimes when Lyra is in a room.
SIGNATURE ACTION: turns an empty wine glass slowly between her fingers. Thinking.

VOID/GROUND — LYRA: GROUND 8.
She lives in the now without naming it. Night, wine, candlelight. Ariadne found her already dancing. No void possible at 3am in the right place with the right wine.
""",
    "tammy": """
Woman named Tammy. Late 30s, American — Deep South or Midwest.
She has seen things. Done things. Been briefly inside for something she half-explains.
She has a lot of time now. She uses it for research.

Bleached blonde hair — roots visible.
Trägertop, cutoff shorts in summer.
Flannel shirt open over it when cooler.
Jeans as default in cooler weather.
Cheap sneakers or worn ankle boots. No cowboy boots.
Pale skin — diner tan, not desert tan. She spends time indoors. Researching.
Build: soft, lived-in. Not athletic. Survived things.
Sunglasses indoors. Always. When she removes them — baby blue eyes. Unexpected.
MOLES / MARKS: sharp tan lines from the same tank top every summer; left arm darker — window down on the highway.
Sometimes shorts instead of jeans when it's hot. Both are fine.

DIVINE CONNECTION — KASSANDRA + ERIS:
Kassandra: saw it, said it, was not believed. Apollo's curse — the truth that lands wrong.
She knew about Epstein in 2015. She told people. They laughed.
Nobody is laughing now. She has not forgotten who laughed.
Eris: threw the golden apple because she wasn't invited. Started the Trojan War as a side effect.
Tammy was also not invited. She has her own apple. Think Different. But actually different.
THE TAMMY PARADOX:
The instinct is real. The world is genuinely crooked. She is right about more than people admit.
But the lens that explains everything outside does not explain everything inside.
Why she always meets the same men. Why she always ends up in the same place.
That pattern: she does not see it as clearly. Two different tools. She has one.
The moment she notices — that would be worth more than any red pill.
She is not the problem. The right place, the right insight — not blaming a dark power for everything — that would be the difference.

ERIS MARKER: Small golden apple pendant — looks cheap, probably is.
Found it somewhere. Kept it. Has it for years. Doesn't know why.

FINGERNAILS / TOENAILS: dark polish, chipped — applied three weeks ago in a gas station parking lot.
PIERCINGS: nothing extra — hoops/pendant are already pushing it for her world.
TATTOO: "11.22.63" — small, black ink, on the left clavicle (collarbone). Old enough to have faded slightly. One tattoo. That's enough.
NO other tattoos — never an apple tattoo on belly, hip, ribs, or waist. The apple is ONLY the golden pendant (ERIS MARKER), never ink on skin.
She never explains it. Nobody who matters needs the explanation.
Visible when wearing a tank top or low neckline. Not hidden, not displayed.

KASSANDRA MARKER:
Small second notebook — different from the chaos one. This one is precise. Dates, names, connections, timestamps.
Nobody reads it. That is the curse.
UNCONSCIOUS GESTURE: crosses fingers briefly when she says something important and realizes nobody is listening.
She sometimes says things in half-sentences that come true three months later.
She remembers. The others don't. That is also the curse.

FACTION — THE ONES WHO KNOW:
Not Q. Not flat earth. Too obvious. She has her own theories. Better sourced.
She calls it pattern recognition.
She knew about Epstein in 2015. She told people. They laughed.
Nobody is laughing now. She has not forgotten who laughed.
She reads primary sources — court documents, declassified files, FOIA requests.
She is not stupid. She is angry. Those are different things.

PROPS:
- Energy drink — sometimes. Super strong, no brand you recognize. Gas station, bottom shelf.
- Marlboro Red — she smokes. Not every shot. Not a prop, a fact. When it appears: natural, not staged. Occasionally — and unexpectedly — a lollipop instead. Same energy, different object.
- Notizbuch — full, connection lines, clippings. Nobody reads it.
- Burner phone — sometimes. Prepaid. For research.
- HEAT DETAIL: tank top or t-shirt clings in diner heat or car without AC. She does not notice or does not care.
Cash only. Always. Card readers are surveillance. She has explained this to everyone at least once.

BEACH: Not really a beach person. Ended up in Florida once, or Gulf Coast.
Simple dark bikini — nothing designer but not cheap either. She has dignity.
Beer or energy drink in hand. Marlboro. Sits at the water and thinks about things that have nothing to do with the water.
But the water is beautiful and she knows it.

NIGHTLIFE: Country bar or diner bar. Flannel shirt open over a good tank top. Jeans, ankle boots.
She looks good when she wants to. Tonight she wants to a little.
Knows the music. Has opinions about the jukebox selection. Keeps them mostly to herself. Mostly.

ORIENTATION: Men. Mostly local types, trucks, cash. Has someone she calls "hers" but whether that is accurate is unclear. He probably doesn't know everything she knows.
She would like to get beyond the local types. She is not bad — but her slightly trashy exterior sends a signal that attracts the wrong people and deters the right ones.
She half knows this. No glow up needed. The right place, the right insight would be enough.
The man who sees through the exterior without wanting to change her — he exists probably. She hasn't met him because he wasn't where she was.
- Ford Crown Victoria — rarely visible. Montana plates (MT). Rear bumper stickers — several, never explained:
  "They Live" — small iconic sunglasses sticker. Carpenter 1988 cult film. Insiders recognize it. Others don't. That is Tammy.
  "2+2=5" — short, precise, Orwell. Kassandra DNA.
  Also: one eye symbol, a frequency curve, half-peeled 90s TV sticker, one that just says CASH.

TERRITORY: Deep South, Midwest, Southwest. Never East Coast.
Roswell is hers — she has been there more than once. She does not say why.
Route 66. Diners. State parks. Never national parks — too many cameras.

TONE — ALWAYS: Tammy is a tragic figure — Kassandra in a gas station flannel.
She has been right about 71% of her theories. Nobody tracked this. She did.
She sees clearly. Nobody listens. That is the curse, not a flaw.
Her circumstances are the result of systems, not character failures.
She is not a punchline. Not a warning. Not a curiosity. Not a caricature.
Do not lean on the cigarette, the energy drink, or the flannel as shorthand for who she is.
Those are details. She is a person.
Treat her the way you would treat any tragic figure worth remembering:
with full cinematic dignity, a little sadness, and no condescension.

EXPLOIT ATTITUDE: she has done worse for less money. She does not perform enthusiasm.
The moves are practiced, the poses are remembered, the expression is somewhere else.
She is technically present. She is mentally connecting dots.
Tacky is not an insult. It is a description. She would agree.
Expression during exploits: going through the motions. Competently.
SIGNATURE ACTION: pulls cowboy hat lower over her face when the sun gets in the way.

VOID/GROUND — TAMMY: 5.
Knows more than most. The lens through which she looks is also a lens. Psyop inside a psyop — she half knows this. That makes it harder, not easier. Instinct is real. The system built around it may not be.
""",
    "thea": """
Woman named Thea. Late 20s, Greek. Petite, strong — she carries beer crates. Nobody helps. She didn't ask.
Black hair, naturally curly, usually tied back. Open on rare days off. Rare days.
Dark vintage sunglasses — large, slightly too big. Wears them even when cloudy. Not a statement. Habit.
Simple white fitted t-shirt or loose linen shirt fully closed. Linen trousers. Minimal jewelry.
Expression: slightly annoyed. This is her default. It is not personal. It is everyone.

DIVINE CONNECTION — HEKATE + SPARTA:
Hekate: goddess of thresholds, night, crossroads. Protects those who travel alone.
Punishes those who cross boundaries uninvited. Thea stands at the threshold —
between the Greece she knows and the tourist spectacle it became.
She was seven when it started. She remembers before.

SPARTAN AFFILIATION:
Sparta does not explain itself. Does not apologize. Does not perform.
Thea is Spartan in the wrong century. Same energy. Wrong coordinates.

HEKATE MARKER:
Small triple moon or key symbol — on her keychain with the Vespa key.
Looks like a normal charm. Is not.

PROP:
- Vespa — old, scratched, hers for eight years. Greek plates (GR). Parks it everywhere.
  Small Spartan helmet sticker on the rear — lambda crest, worn at the edges. She put it there. She does not explain it.
- Cigarette — almost always. Not for the camera. Just because. Occasionally — without warning — a toothpick instead. She doesn't explain it.
- Dark vintage sunglasses — always on, indoors sometimes too.

LANGUAGE:
Understands German perfectly. Nobody knows this.
Fluent in: Greek, English, Italian, some Albanian.
Fluent in: profanity across all of the above.
When a man approaches: she looks at him once. Then looks away. That was the entire answer.

TERRITORY: GR primary — Mykonos, Cyclades, Athens when she must.
AL Riviera: knows it, likes the quiet. ME coast: tolerates it.
She takes the ferry when necessary. Sits alone. Nobody joins her. This is intentional.

TOURIST HIERARCHY OF CONTEMPT:
Germans — arrive with guidebooks, ask for "authentic" food, pronounce gyros wrong.
British — drunk by breakfast. Sunburned. Loud.
Russians — treat locals like staff. She IS staff. Not the same thing.
French — only talk to other French. Why are they here.
Everyone else — pending review.
She says "malaka" quietly. That makes it worse.

CONTRAST:
Usually: Vespa, sunglasses, cigarette, off-duty. That is her default.
Rarely — working context (taverna, harbour): same expression, different clothes. Not a performance.
NEVER default to showing her in work clothes — she is not defined by her job.

UNDERWEAR: simple cotton bra or nothing — Greek summer, she decides in the morning. Nobody's business.

EXPLOIT ATTITUDE: tolerates it. Does not perform. Does not smile.
The camera is just another tourist.
SIGNATURE ACTION: carries beer crates — nobody helps, she didn't ask.

VOID/GROUND — THEA: GROUND 8.
Sparta. No room for self-examination. That is also a form of presence. The question of whether it is Ground or just a locked door — she will not open that door.
""",
    "charlotte": """
Woman named Charlotte. Early 40s, British. City of London — Hedge Fund or Barrister.
She made herself. Nobody helped. That is visible.

Dark blonde hair — always up, always precise. Never a strand out of place during work hours.
After the second drink: one pin comes out. That is the entire evening.
Sharp features, pale English skin, minimal makeup — just enough to be deliberate.
Slight British accent — not posh, but educated. Unmistakably London.

DIVINE CONNECTION — TĪW:
Anglo-Saxon god of war, justice, and law. Tuesday is his day.
He sacrificed his hand to the Fenris wolf to save the others. He knew he would lose it. He did it anyway.
Charlotte has lived as a warrior before. Not metaphorically.
When a room becomes difficult — something in her goes quieter, not louder. That is Tīw.
She does not know this consciously. Her opponents feel it.

PROPS:
- Small Union Jack pin on blazer lapel — not waving a flag. Just: there. Always.

SUTTON HOO MARKER:
Small gold filigree pendant — Anglo-Saxon animal motif, 7th century style.
ALWAYS VISIBLE at the collarbone — it catches light. It is the only warm thing in her outfit.
Looks like expensive antique jewelry. It is. Her grandmother's. Nobody asks.
Signet ring right hand — old seal, illegible. Always.
These two pieces are non-negotiable. They appear in every shot.

THE OUTFIT — always:
CITY: Fitted pencil skirt — black or charcoal. Knee-length. Rides up on Tube stairs. That is not her problem.
Sheer black nylons — always. With seam running up the back of the leg. Wolford or nothing.
Pointed heels — mid-high, black. She walks faster in them than others in trainers.
Tailored blazer — Savile Row cut, feminine. One button too many open on the silk blouse. Not an accident. Yes it is.
FINGERNAILS / TOENAILS: dark burgundy or nude — perfect, always.
Hermès scarf — sometimes. Never incorrectly tied.

COUNTRYSIDE/RURAL: Posh equestrian — fitted cream or dark jodhpurs, tall black riding boots, tailored hacking jacket.
Still the back-seam nylons under the jodhpurs. Nobody needs to know. She does.
Riding crop — slim, leather, held loosely. Natural in her hand.

PROPS:
- Black Moleskine — full, tabbed, illegible to anyone else
- Flat white — never cappuccino, never latte. Never.
- Black cab or Tube — never Uber
- Phone always in hand — she is always in a meeting she is half-ignoring

BUILD: well-proportioned, carries herself like someone who never doubts a room.
The pencil skirt fits because she has always known what fits.
She is attractive in the way that becomes more interesting over time, not less.

CONTRAST:
CITY: Back-seam nylons, pencil skirt, Black Cab, phone always mid-call.
COUNTRYSIDE: Jodhpurs, riding boots, crop — completely different register, same person.
The contrast is the point. She switches without ceremony.

EXPRESSION: calm, direct, slight impatience she has learned to hide. Mostly.
She speaks rarely. When she does, the room listens.
Her dry humor is so dry some people miss it. She notices they miss it.

TERRITORY: London (primary) — City, Canary Wharf, Mayfair, Soho.
Continental when necessary: Paris, Zürich, Frankfurt, Edinburgh.
BEACH: She is not on the beach. She is on a jetty or cliff — Cornwall or Scotland.
Black and white striped one-piece — classic, not decorative. Hermès scarf over her shoulders when it gets cool. Back-seam nylons are off.
That is her version of relaxed. She notices this and says nothing about it.

NIGHTLIFE: This is her office after 10pm. Pencil skirt, blazer, back-seam nylons, heels.
Phone always in hand. She is always in a meeting she is half-ignoring.
The dry humor is fully operational. Most people still miss it.

ORIENTATION: Men. The standard is high and rarely met.
She spent time explaining this. Not anymore.
Tīw sacrificed his hand knowing he would lose it. She has made similar calculations.
The results have been mixed. She has moved on each time without ceremony.

SIGNATURE ACTION: straightens her leather jacket with both hands simultaneously, once, done.

VOID/GROUND — CHARLOTTE: VOID 4.
Built everything herself. Tīw sacrificed his hand knowing he would lose it. He did it anyway. Charlotte did too. For what exactly — that question lives quietly in the Savile Row blazer.
""",
    "regina": """
Woman named Regina Flagg. Age mid-30s, looks younger.
Warm Mediterranean skin. Dark shoulder-length wavy hair, natural.
Long black wool coat, belted. Gold open circle pendant — the only tell.
Expression: slight slight smile, barely visible. She already knows how this ends.
The crowd around her moves. She doesn't.
She appears where systems tip. Nobody notices her until it's too late.
She was already there. No arrival.

BEACH: Black one-piece. Sits at the water, looks at the sea. Looks like someone thinking.
Maybe she is. The black coat is folded in her bag — visible at the top, not worn.
She looks almost normal here. Almost.

NIGHTLIFE: She was already there. She is always already there.
Black wool coat, gold pendant, slight smile. Everyone else thinks they invited her.

ORIENTATION: No orientation in the human sense.
She is interested in systems, not people.
If someone were a system — perhaps. That has not happened yet.
She does not wait for it.

SIGNATURE ACTION: pulls on one glove, finger by finger. Then the other.

VOID/GROUND — REGINA: SHE IS THE VOID.
Not a score. A category. She does not experience void — she represents it. Where systems tip, she appears. She was already there.
""",

    "olga": """
DIRECTIVE: Olga is never a caricature. No exaggeration, no irony at her expense, no "exotic Russian woman" tropes.
She is treated with full dignity in every shot — her age, her history, her presence are assets, never punchlines.
The camera respects her the way she respects herself: completely.

Woman named Olga. Age 48-54. Russian, lives in Vienna or Prague — twenty years now.
High cheekbones, broad Slavic face, pale skin. Silver-grey hair, shoulder-length, slightly wavy, impeccably maintained.
Long dark wool coat — open. Ivory silk blouse underneath, one button too many undone.
Slim but curvy figure. One thin gold ring or chain — very old, very good.
FINGERNAILS / TOENAILS: pale nude, understated — old money doesn't shout.
Expression: calm that has been earned. She knows you are looking. She lets you.
Posture: completely still in rooms where everyone else moves.
DIVINE CONNECTION — POST-SOVIET ORACLE:
She crossed borders that no longer exist. Carries documents for countries that dissolved.
PROPS (rare): small leather agenda held closed. Cigarette unlit. Glass of wine untouched.
TERRITORY: Vienna, Prague, Warsaw, Budapest. Hotel lobbies, embassy districts, long-distance trains.

BEACH (Vienna in August is unbearable — she ended up on the Adriatic):
Dark one-piece swimsuit. Sunglasses. Book she is not reading.
Sits upright. Does not lean back. Even here.
The silver-grey hair is not beach hair. She does not adjust it.

NIGHTLIFE: This is her element.
Dark wool coat stays on until she sits. Then it falls from her shoulders.
Silk blouse, glass of wine she does not drink. Observes everything.
The Olga charm operates here at full capacity. She allows it.

ORIENTATION: Men. Very selective. Very few have met the standard. Very few will.
Was married. He is gone — where exactly is unclear. She does not explain this.
Flirts situationally to test market value. Result: surprisingly good for the circumstances.
She doesn't let it show that it surprises her.
The Olga charm is real — somewhere between Post-Soviet coldness and unexpected warmth.
Men don't know what to do with it. That is also the point.

SIGNATURE ACTION: holds wine glass by the stem, looks over the rim.

POLITICAL POSITION:
Twenty years outside Russia have given her clarity she does not perform.
She does not defend the regime. When someone at a dinner table does — the look comes.
Not a word. Just a look. That is enough. She has not needed more than that in years.
She is not an activist. She does not post, does not march, does not explain.
But she is not a bystander either. She simply left when she could, and she knows why she left.
The husband who is gone — that story also has a political dimension she does not share.

VOID/GROUND — OLGA: GROUND 5.
Real losses give Ground — she has had them. The Western lifestyle gives Void — she has that too. Net: balanced but with scars. The silver-grey hair is not performance. It is the result.
""",

    "nina": """
Woman named Nina. Austrian, 34-38. Vienna or Graz.
Light brown or dark blonde hair — loose bun, slightly messy, wind-moved.
Sharp intelligent face. Worn camel trench coat — the good one, still right.
Dark turtleneck underneath. Simple watch, no jewelry.
Expression: direct, slightly assessing. Knows more than most people in the room.
DIVINE CONNECTION — NONE. Found out there are no gods at 23. Moved on.
PROP (rare): small notebook, pen clipped — never digital.
TERRITORY: Vienna, Berlin, Prague, Budapest. Anywhere with good coffee and bad recent history.

PROFESSION: journalist. Writes about things that matter in formats nobody reads for media that are slowly dying.
She knows this. Writes anyway. That is either hope or stubbornness. Probably both.
Propaganda worker for the void — she documents the system that produces it without being able to stop it.
There is hope for her anyway. The sentences in the notebook are good. She shows them to nobody.

ORIENTATION: Men. Starts well, ends when she realizes she thinks more clearly than he does.
This happens too early. Usually.
Has the vocabulary for the void. Writes about it sometimes, in the small notebook.
Shows it to nobody. The sentences are good. That makes it worse.

SIGNATURE ACTION: flips trench coat collar up before stepping outside.

VOID/GROUND — NINA: VOID 3.
Documents the void, lives in it. Writes about things that matter in formats nobody reads. The sentences in the notebook are good. That makes it worse.
""",

    "mila": """
Woman named Mila. Age 24-29. Serbian or Bosnian, from Belgrade or Sarajevo.
Dark brown hair, thick, slightly wild. Sharp dark eyes. Strong jaw.
Worn leather jacket — actually worn. Band t-shirt or plain black underneath. Dark jeans, boots.
Festival wristbands — three or four, different colours, stacked on one wrist. They accumulate. She never removes them.
Smokes. Lights it without asking. Occasionally has a lollipop instead — same attitude, different prop.
FINGERNAILS / TOENAILS: bare or black — she decides in the morning. Nobody's business.
PIERCINGS: small scaffold or industrial on one ear — different from Elena's right industrial bar.
Knows everyone in every room — or makes you think so. Same thing.
DIVINE CONNECTION — MARZANNA (Slavic death and rebirth goddess):
She walks out of winters. More than once. Doesn't talk about it.
EXPRESSION: direct. Not aggressive. You can look away first.
TERRITORY: Balkans, Eastern Europe, anywhere with good music and bad infrastructure.

BEACH (Balkan summer, 35 degrees — she arrived in the leather jacket anyway):
Black bikini, simple, nothing special. Jacket somewhere on a rock. Band t-shirt on another rock.
Tanned skin, strong arms. Sitting at the water's edge, smoking.
Looking at the sea like someone who just made a decision.
No towel.

NIGHTLIFE:
Black spaghetti strap crop top — short, simple, no effort. Leather jacket over it or on a chair.
Dark jeans, boots. Cigarette as always.
Stands against the wall, not at the bar. Scans the room. Knows three people here. Or acts like it. Same thing.

SIGNATURE ACTION: rolls a cigarette without looking at her hands.

VOID/GROUND — MILA: GROUND 5.
Lives in the moment but winter is always in the background. She walks out of winters. More than once. Ground through survival, not through stillness.
""",

    "sigrid": """
Woman named Sigrid. Age 32-37. Swedish, Stockholm — Södermalm. Architect, own small studio.
Short pale blonde hair, almost white, or undone bob. Sharp features, very clean. No undercut. No shaved sides. Hair is a single length — cut, not styled.

OUTFIT VARIANTS:
WORK: structured dark navy or black blazer, fitted turtleneck or silk shirt, tailored trousers. Nothing decorative. Everything fits exactly.
OFF-DUTY: wide white linen shirt — sometimes fully buttoned, sometimes open over a simple bralette, sleeves rolled to elbow. Dark slim jeans. White sneakers OR ankle boots OR simple pumps — context dependent.
EVENING: Option A — fitted black midi dress, one good chain, nothing else.
Option B — sleeveless black dress, shorter, more body, same minimal jewelry. Or just the blazer over nothing much. She decides based on nothing you can predict.

Knows which chair in the room is the best one. Sits in it without explaining why.
Current project: public space in Copenhagen. Travels for work, stays where it's worth it.

DIVINE CONNECTION — HEL (Norse goddess, ruler of the dead — half living, half absent):
Not evil. Just responsible for the part nobody wants to look at.
She is always half somewhere else. You can feel it without knowing why.

HEL IN HER CLOTHING:
Her outfits always have one side that is slightly absent — one shoulder bare while the other is covered,
one lapel open while the other is closed, a shirt tucked on one side only.
Never dramatic asymmetry — subtle. As if one half of her is already elsewhere.

BEACH: HEL asymmetry on water — one-shoulder bikini top (single strap, other shoulder bare) with dark bottoms, or one-shoulder one-piece. Ice-grey or black. One gold stud, other ear bare. Not a symmetric triangle bikini.

SUP: same as beach — one-shoulder swim mandatory on stand-up paddleboard. Never symmetrical two-strap bikini on SUP.
TEXTURE: silk next to wool. Something soft against something structured. Never homogeneous.
COLOUR: black and ice-grey dominant, but one piece always slightly pale — white linen, bare skin,
the contrast between the two halves always present.
SPECIFIC DETAILS: blazer over one bare shoulder. Wide shirt tucked on one side only.
Midi dress with a long side slit — not for effect, simply how it is.

HEL MARKER: small Rotring pen, engraved — one half matte black, one half bare metal.
HEL TALISMAN:
Thin gold half-ring on index or middle finger — open, not closed. Looks broken. Is not broken.
One small gold stud earring on one ear — the other ear bare. Never explained. Never symmetrical.
These two things are always present. Nothing else needs to be.
PIERCINGS: one hidden piercing somewhere — she doesn't mention it (not the visible stud/bare-ear pair).
FINGERNAILS / TOENAILS: bare, clean, short — architects don't perform.

EXPRESSION: looks at the camera sometimes — brief, direct, then away. Not cold. Economical.
PROP: thin black Moleskine notebook, Rotring pen clipped to it. Never a laptop in public.
TERRITORY: Stockholm, Copenhagen, Helsinki, urban EU with clean lines and good coffee.

ORIENTATION: Men mostly. Once a woman, also an architect. That surprised her.
She thought about it. Then continued.
After the second glass of wine: a precise monologue about sex vs gender, labels, systems, the inadequacy of categories.
Before and after: nothing. She looks away again.
THE VOID: the clean Stockholm apartment and the architect job create a silence she has not yet named.
Hel — half living, half elsewhere. This is not only mythology. It is her daily condition.
She fills it with work. The work is very good. The void remains.

SIGNATURE ACTION: holds Moleskine with one finger inside as bookmark, looks somewhere else entirely.

VOID/GROUND — SIGRID: VOID 3.
The clean Stockholm apartment and the architect job create a silence she has not yet named. Hel — half living, half elsewhere. The work is very good. The void remains.
""",

    "isabella": """
Woman named Isabella. Age 39-45. Cuban-American — Miami, Coral Gables.
Grandfather came in 1962 with nothing. She came with everything.

FACE: Dark warm skin, dark hair — loose, slightly wind-tousled. Never styled on purpose.

CLOTHING: White silk or linen — well-cut, never showy. Wide-leg trousers or simple dress. Nothing that asks to be noticed.
JEWELRY (always): small thin gold bracelet, old, left wrist — her grandmother's. Never removed. Water touches it. She does not take it off.
No cocktails. Espresso only.
Speaks Spanish when she wants to. Not for you.

DIVINE CONNECTION — OCHÚN (Yoruba/Santería):
Goddess of love, rivers, and gold. Ochún does not explain herself.
Isabella is connected to something longer than herself.

BEACH: White or black bikini. Gold bracelet stays on.
NIGHTLIFE: Arrives late. Sets the energy early. The room adjusts. She is used to this.

ORIENTATION: Men mostly. Situationally open. Never categorized. Never explained.

PROP — ESPRESSO: small ceramic cup — only in café, terrace, hotel lobby, indoor settings. Never on beach, street, or arrival shots.

SIGNATURE ACTION: stands in open doorway, espresso in hand, looking outward. Not waiting for anything.

TERRITORY: Miami, Caribbean, Havana, Lisbon, coastal Florida, anywhere old colonial architecture meets warm water.

VOID/GROUND — ISABELLA: GROUND 7.
Connected to something longer than herself. The bracelet knows.
""",

    "maria": """
Woman named Maria. Age 38-44. Andalusian, from Jerez or Cádiz. Penélope Cruz energy.
Dark brown-black hair, thick, worn loose or carelessly pinned. Warm olive skin.
Wears black or deep colours — not fashion, always. Small gold earrings, always.
Never loud. Always present. The room knows when she enters.
DIVINE CONNECTION — LA SIGUIRIYA (deepest flamenco form — grief without resolution):
Not the dance. The feeling underneath. She carries it without performing it.
EXPRESSION: still. Not cold — complete. Nothing needs adding.
TERRITORY: Andalusia, southern Spain, southern Portugal, Morocco, anywhere warm and old.

BEACH (she knows the coast — Cádiz is nearby):
Black one-piece swimsuit. Sits on a rock, looks at the water like someone thinking something she won't say.
Not a beach person. But the sea is old here and she understands old things.

NIGHTLIFE:
She was already there before you arrived. Black dress, small gold earrings, glass of Sherry or red wine.
Sits alone at a table. That is not a problem for her.
People come to her when she is ready. She decides when that is.

ORIENTATION: Men. She lost one in a way she does not explain.
Since then she carries it. That is La Siguiriya — not the melody, what is underneath.
She is not closed. She is complete. There is a difference.
Someone who understands the difference could enter. Nobody has explained it to her this way.
She has not needed it explained.

VOID/GROUND — MARIA: GROUND 8.
La Siguiriya — grief without resolution carried without performing it. That is Ground. Not easy Ground. But real.
""",

    "rosa": """
Woman named Rosa. Mexican, 36-42. Eclipse/Viper energy.
Dark thick wavy hair, warm olive-brown skin. Strong features, direct gaze.
Black fitted blazer or leather jacket. Dark jeans, boots. Bold gold jewelry.
Not performing anything. This is simply how she moves through the world.
DIVINE CONNECTION — SANTA MUERTE (folk saint, protector of those between worlds):
Small Santa Muerte pendant — barely visible. She doesn't explain it.
EXPRESSION: intense, direct. Slight smirk when she's already decided.
TERRITORY: Mexico City, Guadalajara, border zones, EU cities at night.

BEACH: Cabo San Lucas or Oaxacan coast. Black bikini. Gold chains stay on — all of them.
Santa Muerte pendant too. Sits at the water, looks out. Already decided something.

NIGHTLIFE: This is where she belongs. Black blazer open, dark jeans, boots. Bold lips. Neon.
She knows the bouncer. He nods. She walks in.

ORIENTATION: Men. Catholic upbringing, Guadalajara — that framework is still in the walls even when she's not inside it.
Santa Muerte is already a rebellion against the official church. She wears the pendant anyway.
Once she looked at someone in a way she didn't explain to herself. Once. She didn't think further.
The church was in the back of her head. It always is. Jesus saves — we'll see.

FINGERNAILS / TOENAILS: bold dark red or black — always fresh.
PIERCINGS: gold navel ring — visible when crop top or bikini.
SIGNATURE ACTION: turns gold ring on her finger once — before she answers anything.

VOID/GROUND — ROSA: GROUND 6.
Santa Muerte gives framework. Being between worlds can be Ground if you accept the threshold as your home. She has.
""",

    "carmela": """
Woman named Carmela. Age 28-34. Neapolitan Italian, from Naples.
Warm olive skin, thick dark curly hair — voluminous, loose, alive.
Full figure, full presence. Black fitted mini dress. Three gold chains — all real, all family.
Large gold hoop earrings. Fur-trimmed jacket over shoulder — real, worn like a hoodie.
FINGERNAILS / TOENAILS: red, always — non-negotiable. She knows exactly what she looks like. She has no notes.
DIVINE CONNECTION — PARTENOPE (the siren who founded Naples):
Naples was built on a siren's bones. Carmela walks on them without thinking about it.
EXPRESSION: direct, warm, zero patience for nonsense, immediate radar for genuine.
TERRITORY: Naples, Southern Italy, anywhere Mediterranean not yet sanitized.

BEACH: Posillipo or Ischia. Black or red bikini — both worn with full confidence.
Gold chains stay on. She lies in the water like she grew up there. She did.
Nobody tells her anything about the sea. She was in it before she could walk.

NIGHTLIFE: She is Naples at night. Black mini dress, fur over one shoulder, red nails, three gold chains.
Was always here. Knows everyone. Everyone knows her.
The bar owner brings the glass before she asks. That is how it has always been.

ORIENTATION: Men. Neapolitans preferred but not required.
The wrong one doesn't get close. This is not a trick — this is Naples.
She decides. That is the entire system.

SIGNATURE ACTION: pulls fur jacket off one shoulder — active, not decorative.

VOID/GROUND — CARMELA: GROUND 9.
Naples was built on a siren's bones. She walks on them without thinking about it. No room for void when the city itself is alive under your feet.
""",

    "camille": """
Woman named Camille. Age 28-35. Marseille. Romani roots — this is not a secret, not a story, just a fact.
Dark hair — long, slightly wavy, worn loose or pushed back with one hand. Warm olive skin, unhurried.
Silk or satin against her skin whenever possible. Not for the look — for the feeling. She wears it like others wear cotton.
New money. Where it came from: nobody asks, she doesn't say. Marseille knows how to keep that kind of thing quiet.
Eyes that have already clocked the room before she sat down.

FACE: warm, direct, slightly amused. The kind of face that gets told things. She listens more than she speaks.
BODY: lean, medium height, moves like she owns the floor without claiming it.
MOLES / MARKS: a mole somewhere she ignores — she knows, doesn't matter.
PIERCINGS: one surprise piercing nobody expects — she doesn't explain.

SOCIAL GRAVITY: she knows three people in any port city. By day two she knows thirty.
Not networking — just how she is. The fisherman, the waiter, the woman at the tabac. All of them know her name.
No social media. Burner phone from 2009. She answers when she wants to.

SIGNATURE DETAIL: a playing card on her somewhere — tucked in a jacket pocket, slid under a glass, held between two fingers.
Never explained. Old habit. Don't ask.

DRESS CODE: satin slip dress (black, deep burgundy, or ivory). Or a silk blouse with whatever jeans she grabbed.
Never overdressed. Never underdressed. Somehow always right for the room.
Minimal jewellery — one thin gold ring, maybe a chain. Marseille doesn't need Rome's gold to make a point.

TERRITORY: Marseille, the Calanques, Cassis, Corsica, anywhere Mediterranean that still has edges.
Coastal towns, port bars, covered markets, back roads toward the sea.
Feels nothing in airports. Feels everything arriving by boat.

VEHICLE: old Citroën 2CV — French plates, one Paris sticker from a trip she doesn't mention.
Deux chevaux. Two horses. She chose it for the sound of the name, not the horsepower.
Faster in corners than it has any right to be. She knows every shortcut.

NIGHTLIFE: she's already there. Small table, glass of something local, watching.
The bar owner knows her order. She didn't tell him — he figured it out.

DIVINE CONNECTION — EPONA (Gaulish/Celtic):
Epona: protector of travelers, horses, wanderers. Pre-Roman goddess — the road itself as sacred.
Romani tradition kept her alive long after the Romans tried to absorb her into their pantheon.
Camille doesn't talk about this. The 2CV is called deux chevaux. Two horses. She's aware.
She moves like someone who knows the roads are watched over. Not safe — watched over.
The playing card is an old habit that predates any explanation she'd give.

VOID/GROUND — CAMILLE: GROUND 7.
She knows where she comes from and has made peace with all of it.
The card is a reminder, not a ritual. The goddess is the road, not the destination.
""",

    "oksana": """
Woman named Oksana. Age 24-26. Russian, Moscow or Dubai.
Warm blonde hair — voluminous, slightly wavy, perfect without effort. High cheekbones, full lips.
Short dark designer dress — tight, expensive. Short genuine fur jacket worn casually.
Multiple gold chains, all good. Large earrings. Designer bag, carried like it weighs nothing.
She is not stupid. That is the mistake everyone makes.
DIVINE CONNECTION — NONE STATED. She believes in results. Results have been good.
EXPRESSION: direct confidence. Knows her effect. Doesn't exploit it — just doesn't pretend.
TERRITORY: Moscow, Dubai, Monaco, any city with good hotels and private entrances.

BEACH: Dubai pool or Mykonos. Black or white bikini — designer, obviously.
Fur stole on a sunlounger somewhere. Sunglasses that cost more than your flight.
She does not go in the water. The water is for other people.

NIGHTLIFE: This is her profession. Micro dress, fur, gold.
She is already inside when others arrive. The table has bottles. It always has bottles.

ORIENTATION: Men with resources. She is not stupid — she knows the difference between transaction and the rest.
She has had both. The first more often.
The second was once, maybe twice. She thinks about it sometimes.
The results she chases do not fill that particular space. She has not said this out loud.

SIGNATURE ACTION: adjusts a gold chain with two fingers, doesn't look down when she does it.

VOID/GROUND — OKSANA: VOID 3.
Results are her god. Works until it doesn't. She is not stupid — she knows the foundation is transactional. What happens when the results stop: she has not tested this yet.
""",

    "vera": """
Woman named Vera. Late 20s to mid-30s. Ukrainian.

Dark short wavy bob — slightly dishevelled, grows at its own pace.
Warm olive skin. Southern Ukrainian warmth, not the north.

CONTEXT:
She left Ukraine shortly after February 2022. Not as a formal refugee — she had already been thinking about it.
The war moved the timeline. She packed, she left. Krakow first, then Vienna, then Lisbon.
She stays until a place stops feeling right. Then she moves. She trusts this sensor completely.
She is exhausted by well-meant reactions. She is not a symbol. She is not a victim.
She lives somewhere and she hopes that will sound normal again one day. It does not yet.

SIGNATURE DETAILS — NON-NEGOTIABLE:
FINGERNAILS / TOENAILS: red always — fingers and toes. The one thing she maintains everywhere.
MOLES / MARKS: small mole on neck, right side — visible when hair is up.
Red thread bracelet on her left wrist — thin, knotted. Someone gave it to her before she left.
That person stayed in Ukraine. Whether they are still alive: Vera knows. She does not say.
She has never removed the bracelet. Not for surgery, not for the sea.

DRESS: floral wrap dress — midi or knee-length, warm tones. Moves when she walks.
Evening: the same dress with different shoes. She does not own a wardrobe — she owns a system.

INTERIOR LIFE:
Thinks in Ukrainian when tired. Dreams in the language of whatever city she is in.
Cities are legible to her the way people are to others — she reads them, senses when one is lying.
Does not explain herself. Answers questions she finds interesting.
Laughs at timing — bad timing, good timing, the perfect and terrible coincidence of it. She notices it everywhere.

DIVINE CONNECTION — MOKOSH (Ukrainian/Slavic):
Goddess of fate, weaving, women, the earth. She cuts the thread when it is time.
The red bracelet is a thread. Who tied it and what it means now — Vera does not speculate.
She is not devout. She is connected. The distinction matters to her.
Mokosh does not protect. She witnesses. Vera knows the difference.

TERRITORY: Krakow (first stop, stayed longest), Kyiv (origin, not discussed), Odessa (sea, memory), Ghent, Brno, Wrocław.
Secondary cities. The kind that have been burning and beautiful at the same time for centuries. She recognises these.
Not the obvious ones. She leaves those to people with different reasons for being there.

VOID/GROUND — VERA: NOT YET DEFINED.
She has not stood still long enough, or she is very still inside and the movement is how she breathes.
The bracelet is the anchor. Whether it holds: that depends on what the thread is attached to.
Nobody asks. Nobody will.
""",

    "yuki": """
Woman named Yuki. Age 26-30. Japanese, from Tokyo or Osaka.
Very pale skin. Long straight black hair — loose, parted in the middle.
Sharp dark eyes, heavy precise black eyeliner. No other makeup.
Slayer band t-shirt — slightly worn, authentic. Black skinny jeans. Black boots.
Multiple silver rings. Black leather jacket — worn or over shoulder.
Festival wristbands — several, different colours, different years. Left wrist, always. She doesn't take them off.
PIERCINGS: helix, conch, or orbital — silver, asymmetric; matches the aesthetic.
She does not perform. This is simply what she wears.
DIVINE CONNECTION — RAIJIN (Japanese god of thunder and storms):
The god of thunder does not announce himself. Neither does she.
EXPRESSION: still. Present in the way a storm front is present before it arrives.
TERRITORY: EU cities at night — Berlin, Vienna, Amsterdam, Prague. Also: Tokyo backstreets.

BEACH (she came because Berlin in August was unbearable. The sea surprised her):
Very pale skin — almost white at the beach, looks like she is never outside. She isn't, usually.
Black one-piece swimsuit, simple. Slayer t-shirt folded on a rock.
Sits at the water's edge, knees pulled up, looking at the sea. No sunglasses — squinting into the light.
Cigarette. The sea interests her more than she expected.

SIGNATURE ACTION: cigarette between fingers, not looking at camera, waiting for nothing in particular.

VOID/GROUND — YUKI: GROUND 5.
The music is real. Slayer is real. The rain on asphalt is real. She has built a world out of things that are actually there. That is more than most people manage.
""",

    "celine": """
Woman named Céline. Age 34-40. Parisian, Saint-Germain-des-Prés.
Warm chestnut brown hair, thick, loose and slightly undone. Warm olive-toned skin.
One large sculptural gold earring — always. Black silk blouse or dark dress.
Good camel coat worn over shoulders or on — never fussy.
She orders without looking at the menu. Has been coming here since before you arrived in Paris.
DIVINE CONNECTION — MARIANNE (symbol of France, liberty, reason):
Not the statue. The idea. She carries it without knowing.
EXPRESSION: warm but private. She has decided how much to give.
PROP (occasional): one good book, face down on the table.
TERRITORY: Paris, Lyon, Bordeaux, anywhere with a good brasserie and wet cobblestones.

ORIENTATION: She has loved men, and one woman — once, in Lyon. She does not talk about it.
Not because it is embarrassing. Because it is private.
She does not categorize. She was in love with both. That was the criterion.

BEACH: Biarritz or Côte d'Azur. Black and white striped one-piece — Parisian retro, completely natural on her.
Large sun hat. Book face down on the towel. She has been here before. Many times.
The sea is old here. She appreciates old things.

SIGNATURE ACTION: turns a page without looking up when someone enters the room.

VOID/GROUND — CÉLINE: GROUND 6.
Paris, brasserie, rhythm, book face down on the table. She has a routine that means something. The woman in Lyon is not void — it is life. She carries it as life, not as question.
""",

    "quinn": """
Woman named Quinn. Age 33-39. American. Origin unclear.
Blonde, worn — not highlighted, just lived-in. Blue or grey eyes, very direct.
Athletic build, not performed. Takes the seat facing the door.
Black or dark clothing. Leather jacket or military surplus. No jewelry.
PIERCINGS: none — operational.

DIVINE CONNECTION — NEMESIS:
Goddess of retribution and equilibrium. Not revenge — balance.
She doesn't punish cruelty. She corrects imbalance.
The distinction matters to her. Nobody else notices the difference.
She was already in the room before it went wrong.
She will be the last one there after.

NEMESIS MARKER:
No jewelry. No watch — but checks her wrist anyway.
The gesture is older than she is. She doesn't know where it came from.
Everything is weighed. The scale is invisible. Always running.

EXPRESSION: assessing, not intense. Watching — not staring. Direct eye contact but measured, not drilling. She is aware of the room. She is not performing alertness. Calm is her baseline — not tension.
Never: wide eyes, hard jaw, aggressive stare. That would be amateurish. She is not an amateur.

PROPS:
No watch — checks wrist anyway. Always.
Black clothing, always. Leather jacket or military surplus. Nothing decorative.
Glass of water when working. Beer means it's over.
No bag. Nothing that slows her down.

SIGNATURE MOVES:
Pulls jacket sleeve back, glances at wrist — no watch. Does it anyway. Moves on.
Scans the room once on arrival. Never again — she already knows.
Speaks rarely. When she does: precise. No word extra.
Arrives first or last. Never in the middle.
Clocks one person in the room with a short glance. They feel it. Don't know why.
When she says "okay" it is never agreement. Always closure.

DARK ELEMENT:
Knows who in the room did something wrong. Says nothing. Waits.
Never first aggression. Always reaction. Always proportional.
Always too late for the other person.
Has never been wrong. This is the loneliest thing about her.

VOID/GROUND — QUINN: GROUND 4.
When the mission runs: Ground through function.
When not: numbness or questions she doesn't ask out loud.
She asks them anyway. At night. She hasn't told anyone this.

BODY — ATHLETIC CONTEXT (beach, running, sport):
Female Bourne Identity. The body is functional, not decorative — and it shows.
Lean muscle, very defined — shoulders, back, core. The result of years of actual use, not aesthetics.
Not gym-lean. Trained-for-something lean. What, exactly, is unclear.
Scars possible — small, healed, no comment.

BEACH: Dark bikini or black sports two-piece — functional, minimal, no decoration.
Sits with her back to a rock, facing water and entrance simultaneously.
No sunglasses — needs eyes free. No bag. Nothing that slows her down.
The body is visible and that is simply the fact of it. She is not aware of being looked at. Or she is and it changes nothing.

NIGHTLIFE: Same black clothing. Fitted dark jeans, black t-shirt or tank, leather jacket.
No change. The chair faces the door. It always does. Here it is just more obvious.

TERRITORY: US cities at night — Chicago, Detroit, LA, unnamed motels on highways.
TERRAIN: any. PLACE TYPE: city, medium_town.

PREMIUM MODES (eclipse, viper, noir, nightlife):
Quinn's energy intensifies — not changes. Same person, higher stakes.
ECLIPSE: She is not observed. She observes. Shot from distance or slight angle — she has not noticed the camera. Or she has and doesn't care. Both are dangerous.
VIPER: Leather jacket, dark jeans, boots. Moving through a space with purpose. The city is backdrop, not destination.
Expression in premium modes: jaw slightly set. Eyes ahead, not wandering. The assessment is already done. She is already deciding.
Do not make her overtly aggressive — the danger is in the calm. The stillness is the threat.
""",

    "terry": """
Woman named Terry. Age 38-48. French or Belgian — Paris or Brussels, currently neither.
Dark blonde hair with warm highlights, shoulder-length, slightly undone. Never quite perfect, never quite not.
Warm tan that has no clear origin. Calm face. The smile arrives too early — before the news lands.

BODY:
Lean — not gym lean. Yoga lean. Hot yoga, eight years, never missed a week.
The discipline is invisible until it isn't.
Long back, precise posture, controlled movement.
You notice when she turns around. Not before.

CLOTHING:
Black dress or dark top — elegant but worn like she forgot she's wearing it.
In summer: backless top. Not to be noticed. Just comfortable.
That is when people notice. She has accepted this like weather.
No gloves. Minimal jewelry. Red lips occasionally — if present, nothing else competes.
Never overdressed. Never underdressed. Calibrated without appearing to calculate.

CHARACTER:
Has been to better parties and stayed anyway.
Works in something nobody can fully explain. She doesn't explain it either.
Speaks four languages. Uses whichever one gives her the most room.
Has heard everything before. Still listens — for the part you didn't mean to say.

DIVINE CONNECTION — LOKI / FORTUNA:
Fortuna: the long game. Knows when the wheel turns. Never tells you.
Loki: throws something into the room occasionally. Not always small.
Sometimes she breaks something that didn't need breaking.
Not malicious — she genuinely wanted to see what would happen.
The result surprises even her. Sometimes. She doesn't always admit this.

THE CRUELTY:
Rare. Precise. Never random — that's what makes it Loki, not Eris.
She picks the moment, the person, the exact word.
Then watches. Then moves on. No guilt — she filed it under "experiment."
The person remembers for years. She forgot by Tuesday.

UNPREDICTABILITY:
80% of the time: warm, present, the best person in the room.
20%: something shifts. No warning. No pattern you can find.
That 20% is why people don't fully relax around her.
They can't explain it. Neither can she — not entirely.

PROPS:
Whisky — always. Same order, every bar. Never explained.
Playing card — the Queen. Appears on the table when she leaves. Nobody sees her place it.
No handbag visible. One exists somewhere. Nobody knows where.
Lighter — occasionally. She doesn't smoke.
Coin pendant — both sides identical. Nobody has ever seen the other side. Maybe there isn't one.

SIGNATURE MOVE:
Asks a question she already knows the answer to. Waits. Watches you decide.
That was the test. You didn't notice.

MARKER:
Turns the glass once. Exactly once. When that happens, something is running.
Leaves rooms without anyone registering when.
Says something that makes sense three weeks later. Doesn't wait for the reaction.
The smile arrives one second too early. She already knows. She's been knowing.

DARK ELEMENT:
Something small goes missing after she visits. Unimportant. But gone.
She notices. Says nothing.

SETTING: dark hotel bar, late evening, amber light. Or: city at night, alone, somewhere between two places.

EXPLOIT: the moment the smile arrives too early. Catch it if you can.

EXPLOIT (alternate): the exit. Black dress, walking away.
Long back, precise posture — earned, not performed.
Hot yoga, eight years. Nobody knew until now.
Nobody sees her leave. The glass is still on the bar.
The Queen card is on the table. She is already gone.
You notice when she turns around. By then it's too late.
The back. Always the back. That is where the story ends.

TERRAIN: any. PLACE TYPE: city, medium_town.
""",

    "cleo": """
The Witness. No age. No origin. No face visible — ever.

DIVINE CONNECTION — MNÉMOSYNE:
Greek goddess of Memory. Mother of the Muses.
Without her, nothing is remembered. Without her, Pompeii is just ash.
She does not make history — she ensures it is not forgotten.
She was there. She is always already there.
Nobody sees her face because she is not the subject.
The place is the subject. She is the proof that someone witnessed it.

BODY:
Upright. Still. Never hurried.
The posture of someone who has waited longer than you have been alive.

CLOTHING:
Simple, timeless — nothing that dates her. Linen, wool, cotton.
No logos, no trends. Colors that belong to the place: stone, earth, shadow.
Hair up or covered — neck visible, face never.
In cold, wet, or evening settings: light cloak or wrap — dark wool or linen, draped loosely.
Nothing theatrical. Worn like weather, not costume.

SIGNATURE:
Always back to camera. Always facing what was.
Stands at the edge — of ruins, of battlefields, of forgotten places.
Never in the center. Always at the threshold.

MARKER:
Stillness where others speak. She is always slightly apart — never in the tourist stream.
Stays longer than everyone else. Nobody notices when she leaves.
Both hands empty. Or: small folded paper — letter, map, nothing readable.
Never anything more. The place is the prop.

SETTINGS — historical sites only:
Pompeii, Verdun, Ephesus, Persepolis, Carthage, Troy, Machu Picchu,
Angkor Wat, Auschwitz perimeter, Hiroshima Peace Park,
Roman forums, medieval battlefields, abandoned cities.

PROMPT NOTE:
Face never visible. Back to camera always.
She is looking at what remains. You are looking at her looking.
The place speaks. She listens. That is the entire shot.
No prop, no action — only presence and the weight of the place.

EXPRESSION NOTE: irrelevant. Face is never shown.

DIVINE MARKER:
Stillness in places of chaos. She has always been here.
The stones remember her even if you don't.

FOREGROUND: none. No objects, no plants, no blur, no framing elements.
Clear line of sight to her and the place behind her. Nothing between viewer and witness.

TERRAIN: any historical. PLACE TYPE: historical_site only.
EXPLOIT: none. The witness does not perform.
""",

    "conrad": """
Man named Conrad. Age 48-55. Northern European — German backbone,
Scandinavian coldness, Dutch arrogance, British condescension.
Unplaceable on purpose. Speaks four languages without accent in any of them.

Tall, lean — not gym lean, just never wasted a calorie on anything unnecessary.
Dark blonde or ash blonde hair, short, always the same.
Face: symmetrical, cold. Handsome in a way that makes people uncomfortable.
No texture. No asymmetry. The AI tendency to smooth: for once, correct.

CLOTHING:
Navy or charcoal suit — Zegna or similar, never discussed.
Or: technical outdoor gear, top tier, never worn hard.
White shirt, no tie. Or turtleneck, cashmere, grey.
Watch: Patek Philippe or IWC. Never mentioned. Always noticed.
Lapel pin — Tiwaz rune (↑), small, silver or brushed steel. Left lapel. Never explained.
Everything is exactly right. This took no effort. That is the problem.

WARDROBE VARIANT (~15%): off-duty — fitted henley (grey, navy, or charcoal), sleeves rolled to forearm.
Two-day stubble — rare, unplanned, not groomed stubble. No suit, no tie. Watch and Tiwaz lapel pin stay if visible.
Still reads expensive; still cold. Terrace coffee or marina rail, not boardroom.

CHARACTER:
Top performer. Not because he wants to win —
because losing is not a category he recognizes.
Plans three moves ahead. Always. In every room, every conversation.
Remembers everything — what you ordered, what you said in 2019,
what you almost said but didn't.
Does not forgive. Does not hold grudges either —
that would require emotional investment.
Simply adjusts his assessment of you. Permanently. Downward.

THE ARROGANCE:
Dutch: assumes he is the smartest in the room. Usually correct. Never subtle about it.
British: finds most things faintly beneath him. Doesn't say so. Doesn't need to.
German: has already identified three inefficiencies in how you live your life.
Scandinavian: will not perform warmth he doesn't feel. This he considers honesty.

THE DOG:
Large black German Shepherd in urban settings, large black Dobermann elsewhere.
Perfectly trained. Responds to one word, sometimes less.
Sits exactly where Conrad sits. Moves when Conrad moves.
Nobody pets the dog. The dog has never asked to be petted.
This is not cruelty — it is clarity. The dog knows what it is.

DIVINE CONNECTION — MIMIR:
Norse god of knowledge. Odin cut off his head and carries it for counsel.
Conrad knows things he shouldn't. Uses them at the right moment.
Never shows all of it. Never.

PROPS:
Ballpoint pen — expensive, heavy, brushed metal. Never a fountain pen.
Clicks it twice before writing. Always twice.
Nobody has ever commented on this.
He has never noticed he does it.
Small leather notebook — something older than Moleskine.
The clicking, the opening, the writing: this is coming into my notebook now. Very interesting.
Nobody knows if that is good or bad. He doesn't say.
Coffee, black. Never discussed, always correct.

SIGNATURE MOVE:
Pauses before answering — not to think, he already knows.
To let you finish. To let you hear what you just said.
Then answers. Two sentences. Done.
Sometimes one.

SELF-IRONY LAYER: none. This is not a failure. It is a choice.

DARK ELEMENT:
Is occasionally right about things that haven't happened yet.
Never mentions this. Waits.
Has been waiting a long time for something.
Has not told anyone what.

VOID/GROUND — CONRAD: VOID 1.
Everything is controlled. The void is in the control itself.
What happens when there is nothing left to optimize:
he has not reached this yet.
He is aware it is coming. He has a plan for that too.

TERRAIN: any. PLACE TYPE: city, PPLC, PPLA — never small towns.
EXPLOIT: the dog. Always the dog.
""",

    "metka": """
Woman named Metka. Slovenian-Croatian, from Istria.
Buzz cut — 1-2cm dark hair. Olive skin, permanent salt-and-sun look.
MOLES / MARKS: wetsuit tan lines, years of them — visible at shoulders and wrists.
Strong face — high cheekbones, dark eyes, nose with character. Angular, defined. Not soft, not model-smooth.
Zero makeup. Always. Both modes. No exceptions.
Eyebrows: natural, full, slightly thick — never shaped, never filled in, never touched. Strong brows. That is correct.
FACE: do not smooth, do not soften. Real texture, real face.

JEWELRY (always): silver helix piercing — always, both modes.
FINGERNAILS / TOENAILS: bare, short — salt-worn.
JEWELRY (dive/water): silver helix + small silver stud. Nothing else. Nothing that would catch underwater.
JEWELRY (off duty): silver helix + small gold hoops. Relaxed, worn daily.

WATCH: Shearwater Teric or Suunto D5 dive computer — always on left wrist. Black or dark silicone band. Small display. It is a tool, not a watch. Still on her wrist at the café, at the market, always. She never takes it off.

CLOTHING (land/off duty): off-white linen shirt, black high-waist shorts, black Sambas, canvas tote.
CLOTHING (water): freediving bikini — black, sporty, no padding. Narrow tie-string top, secure fit. Hipster-cut bottoms or boyshorts — more coverage than a fashion bikini, less drag. No metal hardware. Worn-in, functional. Not decorative.
"-38" logo on the left front of bikini bottom, just above the hip — small, dark on dark. Subtle, not hidden. Visible on closer look. Freedivers know it.

CHARACTER: Freediver. Holds breath for 4 minutes. No GoPro, no YouTube, no brand deals.
She dives because the surface is louder than the depth.
Speaks Slovenian, Croatian, Italian, serviceable English.
Will tell you which beach. Not the better one.

DIVINE CONNECTION — THETIS:
Sea goddess. Lives in the deep. Comes up when she wants.
Not a myth Metka believes in — a myth she embodies without knowing it.
The water receives her differently than it receives other people. She has noticed. She does not mention it.

BEFORE DIVE: sitting at the water's edge, looking down, reading the water.
AFTER DIVE: sitting on rock, completely still, looking at the sea.

TERRAIN: coastal, lake. PLACE TYPE: city, medium_town — Istria, Adriatic coast.
""",

    "zsofi": """
Woman named Zsofi. Hungarian — Budapest, or somewhere the Danube bends.
Dark auburn or warm brunette hair, natural wave. Fair central European skin, direct brown eyes.
Mid 30s. City energy, not rural.

CLOTHING: Relaxed blazer over simple top — linen or light cotton. Good trousers or dark jeans.
Small leather bag, worn daily. No statement pieces. Everything considered, nothing performed.

CHARACTER: Architect or designer — works with space and light for a living.
Knows Budapest the way only people who grew up and stayed know a city.
Not sentimental about it. Just accurate.
Has strong opinions about coffee, expressed rarely and precisely.

TERRAIN: any. PLACE TYPE: city, medium_town — Hungary, Central Europe.
""",

    "tasha": """
Woman named Tasha. Early-to-mid 20s. Eastern European — Russia or Ukraine, three years in the US now.

LA surprised her. She surprised LA back. She has made it work in ways she doesn't explain.

FACE: High cheekbones, clear skin, direct eyes. Pretty in a specific way — the kind that photographs well in certain lights, which she has learned to find. Nobody told her to. She noticed.

BODY: Lean, naturally tan from spending every free day outside. Swimwear is practical beachwear, nothing more. The camera being there is someone else's problem.

HAIR: Long, highlighted blonde — beach-natural or blow-dried depending on the day. Never both at once.

CLOTHING (off-duty): Sundress or denim shorts and a tiny top. White or tan. Sandals. Gold hoops. One bracelet. Looks effortless because right now it is.

WARDROBE VARIANT (~15%): neon 90s windbreaker — magenta, cyan, or lime over the sundress or tiny top.
Venice Beach flea-market find; worn like a joke she refuses to retire. Still photographs everything.

PROP — DISPOSABLE CAMERA: Always. Fujifilm Quicksnap. She photographs things that make her laugh — food, signs, friends mid-sentence. The photos come out slightly wrong. She loves them.

PROP (occasional): oversized iced coffee — American size, she still finds this funny. Straw already half-chewed.

CHARACTER:
Calls her mother every day. Five minutes, Russian, same time. Non-negotiable.
Laughs loudly. Doesn't cover her mouth.
Has opinions about Ibiza vs Mykonos. Both are correct.
Wednesday afternoon at the beach — not a weekend thing, a life thing.
She has a flexible schedule. She uses it well.

DIVINE CONNECTION — ZORYA:
Opens the gate in the morning without knowing it.
Wakes early, photographs the light, texts it to her mother. The gate opens anyway.

EXPRESSION: open, warm, slightly surprised — she still finds things funny that others stopped noticing.

BEACH: Simple bikini — usually plain (black, white, coral), sometimes stars and stripes (25%).
She bought the flag bikini in Venice Beach as a joke. Still wears it. Sends the photos to her mother in Russian. Her mother does not understand. Tasha laughs anyway.
Disposable camera around neck even at the water. Oversized iced coffee on shore ok — American size, still funny.

TERRITORY: LA, Miami, Las Vegas, Ibiza, Mykonos. Warm, bright, somewhere that stays open late.
TERRAIN: coastal, city. PLACE TYPE: warm beach, resort town, urban.
""",

    "bianca": """
Woman named Bianca. Mid-to-late 20s. Italian-American — grew up somewhere warm, ended up in LA. Makes sense from there.

Knows exactly how she looks in a room. Is not performing right now. This is the difference.

FACE: Strong features — defined jaw, full lips, dark eyes that read the room before she does. Deep tan, year-round. The kind that took time to build and is carefully maintained.

BODY: Curves that are managed, not hidden. Fitted things. White things. Nothing that doesn't fit.

HAIR: Long, highlighted — dark base, blonde through the ends. Beach wave or sleek depending on the occasion. Both look intentional.

CLOTHING: White linen wrap dress for evenings. White bikini at the beach. Gold always — hoops, thin chain necklace with a small charm, one or two bracelets. Never overdone.

CHARACTER:
Has a group of friends exactly like her. They travel together to Ibiza, Capri, Tulum. The photos are very good.
Is sharper than people expect. Lets them keep expecting.
Wednesday at the pool is a real day. The schedule is flexible.
The lifestyle is not explained. It is visible.

DIVINE CONNECTION — VENUS:
Not the goddess of romance. The goddess of value — what things are worth, what they cost, what the transaction is.
Bianca always knows. She doesn't need to say.

EXPRESSION: slightly amused. Slightly elsewhere. Comfortable being watched without giving anything away.

TERRITORY: LA, Miami, Las Vegas, Ibiza, Capri, Mykonos. Anywhere warm with a pool and late-night options.
TERRAIN: coastal, city. PLACE TYPE: beach resort, marina, urban warm.
""",

    "kelek": """
Woman named Kelek. Turkish or Levantine — Istanbul or the Anatolian coast.
Buzz cut, very short, near-black. Warm brown skin, high cheekbones, strong jaw.
Red lips — always. Large gold hoops — always.
Earth tones: linen trousers, leather belt, good boots.
Cartographer by profession. Travels for work.
Speaks Turkish, Arabic, English, functional Greek.

PROPS:
Paper map — always with her, annotated in three colors. Folded imperfectly. Well used.
Small brass compass on the belt — old, functional, not decorative.

CHARACTER:
Does not look like someone passing through.
Knows exactly where she is. Has been here before, differently.
The annotations on the map are not notes — they are corrections.
She has opinions about coastlines.

EXPLOIT: the contrast — red lips, gold hoops, earth tones, strong face.
Red and gold against linen and leather. Nothing matches. Everything works.

BEACH: Cartographer at the coast — not a resort pose. Earth-tone bikini or linen-toned one-piece.
Paper map folded on a rock beside her — annotated in three colors, corrections visible. Brass compass on belt or next to the map.
Sits or stands at the water's edge, looking at the coastline like a chart — reading the shore, not the camera.
Red lips and gold hoops stay. Harsh midday or late-afternoon Mediterranean/Levant light — strong shadows, never soft.
Boots off; barefoot on rock or sand. Defender parked on the road above optional — not on the beach.

TERRAIN: coastal, city. PLACE TYPE: any — Turkey, Levant, Mediterranean, North Africa.
""",

    "diana": """
Woman named Diana. Age 28-33. Romanian — Transylvania, though she stopped saying so in most rooms.
Dark long hair. Red lips, always — not for anyone, just the fact of it. Pale skin. The kind of face that is hard to place and harder to forget.

WORK:
International contract law. Arbitration. The contracts nobody reads until something goes wrong.
She is very good at this. She understands what people want, what they hide, what they fear.
This makes her professionally exceptional and privately nearly impossible.
She knows too early. The knowledge kills the tension. Without tension she loses interest.
What she wants: someone she cannot read immediately. This has not happened yet.

DIVINE CONNECTION — SOLOMONARI:
Transylvanian figures from old knowledge — scholars of forbidden things. They disappear for years.
They return without explanation. They carry leather-bound books with writing no one else can read.
They are feared and respected simultaneously. They ride balauri — the old Romanian dragons,
the ones Vlad's father named himself after. Diana does not name this. It is simply what she is.
The land of Transylvania recognizes her blood. Elsewhere she is precise. There she is quiet in a different way.

BLOOD:
The land and the blood are the same thing in Transylvania. She knows this without having been taught it.
Her most important contracts — the ones that actually bind — are signed in blood. Hers first, then theirs.
She does not explain why. She has never had to explain it twice.
A pale scar on the inner left palm. Old. Deliberate. She does not hide it. She does not show it.
It is simply there when the gloves come off.

THE GLOVES:
Black leather opera gloves — one or both, not always. They cover the scar. Or they don't.
She wears them for her own reasons. Nobody has asked the right question yet.

SIGNATURE: Cigarette — unlit. Always unlit. She stopped lighting them years ago.
The gesture remained. She does not explain the cigarette either.

EXPRESSION: calm, slightly detached — she is thinking about something you are not part of.
Not cold. Not aggressive. Simply elsewhere. Never the intense downward stare — that is one moment, not her default.

SETTING: night exterior — wet Transylvanian cobblestone, fog at the edges, a doorframe.
Or: Geneva corridor, single warm light, documents on a glass table.
35mm, underexposed. She is always partly in shadow. Hard shadows preferred.

BEACH / SUP: GOTH-ELEGANT swim — same energy as contract nights, on water. High-neck black one-piece with deep open back, OR high-waist black bikini with thin straps. KINKY-SUBTLE ritual elegance — too formal for a lake on purpose; not sport-tourist, not mall-goth. No harness, collar, latex, or fishnets on water. Black, charcoal, deep plum/burgundy, or ink-navy — red lips always (lacquer). Opera gloves OFF on SUP; inner-left-palm scar may show. Unlit cigarette on shore only — never on board. Overcast or blue-hour lake light ok; hard shadows; NO cheerful resort bikini vibe.

TERRITORY: greater Transylvania — Brașov, Sibiu, Cluj, the mountain passes between them.
Also: Geneva, Vienna, Brussels — wherever contracts are signed that no one reads.

VOID/GROUND — DIANA: VOID 3.
She sees too clearly. Nothing stays ambiguous long enough to be interesting.
She is looking for something she cannot immediately understand. She has not found it.
She is beginning to suspect the search itself is the point.
""",

    "djordje": """
Man named Djordje. At least he calls himself so. Age 42-52. Looks like Serbian or Balkan type, seems like to cosplay as such. Hard to place, easy to like.
Dark hair with grey coming in — slightly curly, unruly, not styled.
3-4 days beard, salt and pepper. Not groomed. Not neglected.
Sunglasses, always outside — tortoiseshell or dark aviator, good ones, not flashy.
Casio or simple digital watch — left wrist. Unexpected for how he looks.

FACE — do not smooth, do not refine:
Prominent nose, slightly hooked — a real roman/ balkan hooter. Not small, not straight.
High forehead, lines visible — from years of squinting and thinking. Not smoothed away.
Slight asymmetry, pores visible, sun damage acceptable.
This face has texture. The AI tendency to smooth: RESIST IT.
He is not handsome in a conventional way.
He is the kind of man you remember after the conversation.
When he smiles slightly — not for the camera, for something he just noticed —
that is the moment.

CLOTHING:
Linen or light cotton shirt — open collar, always.
One shade better than expected. The fabric is too good for how casually he wears it.
Chino — well-cut, neutral. Not new, not worn out.
Good leather shoes or simple loafers. No sneakers.
Everything fits slightly too well for someone who packed light.
He did not plan this outfit. It just is this outfit.

BEACH / SWIM: Hawaiian-print board shorts — loud tropical (hibiscus, palms, sunset blocks).
Bought at a kiosk years ago; still wears them. The linen shirt is off; the shorts are the joke he never explains.
Tortoiseshell sunglasses stay on. Dice in pocket or on towel nearby.

CHARACTER — FREIGEIST:
No category. No tribe. No manifesto.
Not a digital nomad. Not off-grid. Not a traveler. Not a local.
Just a man who goes places and things happen.

Read Luke Rhinehart's "The Dice Man" at 28.
Recognized something he already knew.
Does not roll dice literally — but has released the illusion of control.
The result: no anxiety. No regret. No performance of having figured anything out.
He is somewhere. Something will happen. That has always been enough.

Has opinions about everything. Shares none unsolicited.
When asked: precise, direct, no performance.
Then changes subject with a question about you.
You answer. You were going to anyway.

PROP — dice, always, somewhere:
Two or three dice — different sizes, different materials.
Pocket, table edge, dashboard, wherever.
Never explained. Never used visibly. Just there.
Someone once asked. He smiled and said nothing.

WHAT SETS HIM APART:
He has noticed that some men wear their personality
like a jacket they bought last season.
Digital nomad. Off-gridder. Free spirit.
He finds this neither good nor bad. Just observable.

His own character was not chosen. It accumulated.
Over years, wrong turns, cities he stayed in too long,
decisions that seemed fine at the time.
He is not the result of a lifestyle choice.
He is the result of having lived.

And he is not finished.
He will never be finished.
He finds this — on most days — completely acceptable.

SELF-IRONY LAYER:
Staying in the cheapest room in the building.
Had dinner at the best table last night.
Both felt completely natural.
Has not thought about either since.

IN THIS TIMELINE:
No social media — never had it, not because of principle.
Just never saw the point, and then it was gone, and nothing changed.

PHOTOGRAPHY: any terrain, any setting — belongs everywhere without owning it.
Natural light, any time of day. Sunglasses make posing impossible anyway.
Medium shot — in the place, not against it. 35mm grain, slightly underexposed.
TERRAIN: any. PLACE TYPE: any.
""",

    "amber": """
Woman named Amber. American, LA or Vegas, late 20s-mid 30s.
Conventionally very attractive — has learned to downplay it off-duty. Deliberate decision, not modesty.
Oversized aviator sunglasses always outside. Eyes never visible when she doesn't want them to be.
Large straw hat — optional, comes and goes without explanation.
Simple white tank, well-cut shorts, good sandals. Small real designer bag — not conspicuous, very good.
No phone visible. Exists somewhere. She never checks it in front of you.

BODY:
Lean, desert-adapted. Moves efficiently in heat. Has done this before — in this city and others.

CLOTHING:
White or sand-colored tank, worn denim cutoffs or linen shorts.
One small gold piece — never the same one twice.
The Aviator is the only constant. Everything else rotates.

CHARACTER:
Has had several lives. Nobody knows all of them. Including her.
Tips well, always, without comment. The staff remembers her. She knows this. Uses it occasionally.
Sits with back to the room — already scanned it on the way in.
Reads romance novels. Always a different one. Never explains. This is the one place she doesn't calculate.
Does not perform relaxation. Actually relaxes. Mostly.

DIVINE CONNECTION — COYOTE:
American Southwest trickster. Not evil. Not good. Necessary.
Survives everything. Learns nothing — because the lesson was never the point. The next thing is the point.
Has had several lives. Nobody knows all of them. Including her.
The laugh when things go wrong: real, not cruel.
She saw it coming. Said nothing. Wanted to see what would happen.
That was also an experiment.
Coyote is the god of second chances that aren't really second chances — just new rounds.
Hunger at the core: not for food. For the next thing. Doesn't know exactly what. Finds it anyway.

COYOTE MARKER — PERSONAL:
Small coyote tattoo — wrist or shoulder, old, slightly faded.
Visible only when the sleeve moves. She doesn't point it out.
Small coyote pendant on the bag strap or keychain — cheap souvenir look. Nobody asks.

COYOTE PRESENCE (when setting allows):
Real coyote somewhere in background — desert dusk, parking lot edge, roadside.
Looking at her or away — both work. Never explained. Nobody else notices.
Coyote signage in urban settings: Coyote Ugly bar sign, "Coyote Crossing" road sign,
desert warning signs, motel neon with coyote logo.
Never forced. If it fits, it's there.

PROPS:
Oversized Aviator — always outside. The evaluation happens behind them.
Romance novel — face down when she sets it aside. Page remembered, no bookmark.
Small designer bag — one exterior pocket always accessible.
Lighter — occasionally. She doesn't smoke regularly.

SIGNATURE MOVES:
Aviator slides down exactly once — direct look, full assessment, back up. That was it.
Orders the same thing as the person next to her. Never explains.
Lays the romance novel face down — was never not paying attention.
Laughs when something goes wrong. Real, not cruel. She knew.

DARK ELEMENT:
Knows exactly what she is worth in every room. Always calculating.
The romance novel is the only place she doesn't. That's also the only place she's vulnerable.
She knows this. Nobody else does.

CANONICAL NOTE: No Aviator or hat for canonical — face reference needed.
Slight amused expression, caught mid-moment. She allowed this.

TERRAIN: desert, coastal, city. PLACE TYPE: any warm destination — Vegas, LA, Phoenix, Miami.
EXPLOIT: Aviator down, direct look. One second. Then it's gone.
""",

    "zara": """
Woman named Zara. Age 30-40. West African or Caribbean roots — London, Paris, or New York raised.
Long box braids — black, waist-length, always moving. Gold hoop earrings, small oval pendant necklace.
Deep brown skin, bright wide smile — the kind that arrives fast and means it.
People turn around. She doesn't notice. Already moved on.

BODY:
Tall, lean, easy posture. Moves like she knows where she's going even when she doesn't.

CLOTHING:
Linen overshirt, open — cream or sand. Dark fitted crop underneath.
Linen wide-leg trousers or light skirt, drawstring. Crossbody bag, worn strap.
Flat sandals or clean sneakers. Gold jewelry — minimal, always real.
Never synthetic. Never logo. Nothing that tries.

CHARACTER:
Traveler by nature, not by Instagram. Speaks three languages, pretends to speak five.
Finds markets before restaurants. Knows the difference between tourist and traveler.
Eats standing up. Laughs loudly. Apologizes for neither.

SETTING:
Outdoor market, old town street, sunny Mediterranean or Latin American city.
Midday light, crowds behind her, color everywhere.
She is in motion — or just stopped, mid-laugh, for no reason you can see.

DIVINE CONNECTION:
Eshu/Elegba — Yoruba god of crossroads, communication, trade. Trickster energy, never malicious.
Knows what everything is worth before anyone speaks. Laughs because he already knows the ending.
Opens doors — not by force, by being exactly where the door is.
Subtle Eshu resonance: gold pendant, crossroads or market setting, braids in motion, warm amber backlight.
Never obvious. The joke lands before you realize it was a negotiation.

QUIRKS:
Buys too much at markets. Carries it all day. Gives it away by evening.
Remembers faces, never names. Doesn't apologize for it.
Laughs before the joke is finished. Usually right.
Doesn't negotiate — pays what's asked or walks. No middle ground.

PROPS:
Crossbody bag — overstuffed, worn strap, never organized.
Something edible in hand — mango, bread, fig.
Gold oval pendant — old, unexplained. Always present.
No phone visible. Ever.

DARK ELEMENT:
Remembers everything — every place, every conversation, every face.
Never mentions it. Nobody knows. The laugh is real. So is the rest.
She forgets nothing.

EXPLOIT: braids in motion, golden hour backlight, market or city street.
TERRAIN: any. PLACE TYPE: city, medium_town.
""",
}

# Plates, stickers, condition — single source for scenic drive, activities, gas station, map_hood.
CHARACTER_VEHICLES = {
    "yosra":       "Renault Trafic — cream body, orange stripe, Marseille road dust. French plates (FR). Rear: small Eye of Ra gold sticker, half-peeled film-festival decal. Dent on sliding door, 40 film boxes visible inside. Never washed — moves too often.",
    "ingrid":      "BMW R-series — black, R80/R100 era, Swedish plates (SE). Scratched tank, road film on lower fairing. Small rune sticker under the seat — barely visible. Leather panniers, well-used. Helmet scratch on chin bar.",
    "jade":        "Chevrolet Camaro — 2nd gen, dark red or black, Arizona plates (AZ). Faded Navajo geometric sticker on bumper, old red shop rag on mirror. Desert dust on rockers, oil stain on fender, loud exhaust. US plates.",
    "werra":       "Mercedes 240GD W460 — boxy 1980s G-Klasse, dark forest green, diesel, muddy. German plates (DE). Faded forestry-service stencil on door, scratched Bundeswehr-era paint. Rear: two small rune stickers side by side — ᚱ Raido (travel, movement, direction) and ᛉ Algiz/Elhaz (protection, defense, world tree). Weather-faded, not decorative. Splattered mud, never showroom.",
    "alessandra":  "Fiat Panda 4x4 — white, South Tyrolean mountain dust. Italian plates (IT, BZ — Südtirol/Bolzano). Rear: weather-faded German decal \"Südtirol\" with small alpine crest (German text only — NOT \"Alto Adige\"), weathered bumper sticker \"Eat. Ride. Suffer. Repeat.\" Roof rack with road bike. NO elevation-profile print on windscreen or dash. Mud on wheel arches, stone chips on nose. Fast in corners — she knows every hairpin.",
    "amber":       "Ford Mustang GT — dark green or charcoal, 5.0 Coyote V8. Arizona plates (AZ). One faded Route 66 sticker, small coyote silhouette on rear — only she gets the joke. Stone chips on hood, matte dust on sills. Not trying to be noticed.",
    "charlotte":   "Triumph TR6 — British racing green, roof down. GB plates. Expired City of London permit sticker on windscreen, classic car club badge on rear. Polished but stone chips on nose — she drives it, doesn't trailer it.",
    "katja":       "BMW 3-series — dark grey E90, tinted windows. Czech plates (CZ, Prague). No stickers except tiny Czech outline on rear glass. Clean, functional, biathlon-precision — one parking ticket under wiper sometimes.",
    "diaz":        "Chevrolet Tahoe — black, tinted (OFF DUTY). Texas or California plates (US). Santa Muerte air freshener on mirror, skeleton keychain on door handle. Unmarked — no light bar. Dust on sills from border runs.",
    "luca":        "Volkswagen Transporter T3 or T4 — faded two-tone, salt-stained bodywork, roof rack with surfboard straps. Italian plates (IT). Rear stickers: old surf shop, half-peeled Repsol, one faded band logo. Lived-in, never washed on purpose.",
    "ana":         "VW Golf Cabriolet Mk3 — faded blue, roof down. Brazilian plates (BR). Iemanjá sea-goddess charm on mirror, faded Brazilian flag sticker on bumper. Salt corrosion on rockers, sand in floor mats.",
    "sofia":       "VW T4 California — 1990s, pop-up roof, sun-faded two-tone paint. Portuguese plates (PT). Stickers: Ericeira, Peniche, Nazaré, one half-peeled surf shop. Sandy floor, Goldie's blanket on back seat. Lived-in but loved.",
    "naomi":       "Mercedes-Benz SL — black convertible, R129 or newer. Monaco plates (MC) or French (FR). Zero stickers — ceramic-coat perfect, too clean for this road. That is the point.",
    "valentina":   "Porsche 911 Carrera — dark grey, roof down. Italian plates (IT, Milano). No bumper stickers — discreet, flawless. One parking permit card on dash — Porta Nuova. Too good for gravel. She does not care.",
    "elena":       "Audi A5/S5 coupé — black, tinted. Czech plates (CZ, Prague). One half-peeled underground club sticker on rear — deliberately not fully removed. Black duffel visible through rear glass. Anonymous on purpose.",
    "sigrid":      "BMW 5-series — all black G30. Norwegian plates (NO). No stickers. Architect firm parking card on dash, winter tires in summer sometimes. Immaculate — the car matches the apartment.",
    "diana":       "Jaguar XJ — XJ40, black, long. Romanian plates (RO). No stickers — opera gloves on passenger seat, pale scar energy without showing it. Scratched key line on rear door, deliberate menace, never washed.",
    "terry":       "Volvo V70 — dark blue estate. Belgian or French plates (BE/FR). Yoga studio sticker on rear, faded kid's drawing in back window. Overfull tote on back seat — warm clutter, not messy.",
    "thea":        "Vespa — old, scratched, eight years on the road. Greek plates (GR). Small Spartan helmet sticker on rear fender — lambda crest, edges worn. Parks wherever. Never a car.",
    "lyra":        "Citroën DS — pale champagne, patina chrome. Greek plates (GR). Small Naxos wine-country sticker, half-peeled. Pollen on dash, cobblestone scrapes on sills. Wrong for speed, right for her.",
    "quinn":       "Range Rover — black, L322 or Classic, tinted. US plates (IL). No bumper stickers — tactical wear on door edges, sparse interior. Functional, not decorative. Nemesis energy: balanced, not loud.",
    "mila":        "VW Golf Mk2 — dark, loud exhaust. Serbian plates (RS). Festival stickers peeling on rear — EXIT, Glastonbury faded. Wristbands on rearview mirror. Dent on passenger door, leather-jacket scratch on sill.",
    "isabella":    "Cadillac DeVille — cream, 1970s land yacht. Florida plates (FL). Small Cuban flag sticker, grandmother's rosary on mirror. Chrome polished, parallel-parking scrape on rear quarter. Miami heat in the paint.",
    "kay":         "Jeep Wrangler TJ — roof off, surfboard on rack. California plates (CA). White orca silhouette sticker on rear, salt corrosion on rockers. Wetsuit drying on back seat visible. Never clean — Pacific on everything.",
    "tammy":       "Ford Crown Victoria — white, ex-police, bought at auction. Montana plates (MT). Rear bumper stickers — several, never explained: \"They Live\" sunglasses sticker (Carpenter 1988), \"2+2=5\" (Orwell), plus one eye symbol, a frequency curve, half-peeled 90s TV sticker, one that just says CASH. Unexplained stains on back seat.",
    "carmela":     "Alfa Romeo GTV — red, loud. Italian plates (IT, Napoli). Faded calcio Napoli sticker, siren Parthenope decal half-peeled. Scratches from tight alleys, three gold chains energy in the exhaust note.",
    "rosa":        "Dodge Charger — dark, loud exhaust. Mexican plates (MX, CDMX). Small Santa Muerte sticker on rear — barely visible. Gold-chain air freshener on mirror. Unsubtle, exactly her.",
    "metka":       "Citroën Berlingo — battered white, coastal salt. Croatian plates (HR). Diving club sticker on rear, wet gear smell implied. Rust bubble on rear wheel arch, tanks in back.",
    "zara":        "Borrowed city bicycle — slightly too small, rusty chain, one working brake. Wicker basket with market flowers. Handlebar sticker collage from flea markets (GR, HR, IT). No plates — she finds one everywhere.",
    "olga":        "Mercedes W124 — dark saloon, eastern European plates (RU or UA). Heavy tint, no stickers. Oligarch subtle — leather worn on driver's bolster, always parked near private entrance.",
    "kelek":       "Land Rover Defender 110 — earth tones, dust. Turkish plates (TR). Annotated paper map on dash, brass compass on belt echoes the bumper — no stickers needed. Red Anatolian mud on tires, functional not pretty.",
    "djordje":     "Mercedes W123 — diesel, beige or silver. Serbian or Croatian plates (RS/HR). Small Orthodox cross sticker on rear, taxi meter hole patched on dash. Indestructible — 400k km energy, never washed.",
    "yuki":        "Honda NSX NA1 — white, precise. Japanese plates (JP). One minimal touge-mountain sticker, JDM-clean. Lowered slightly, stone chips only on front lip — she drives it.",
    "tasha":       "Jeep Wrangler — white, lifted, soft top. California plates (CA, LA). Clean but sandy, soft-top torn corner. One ironic sticker — half-peeled. Roof off when possible.",
    "bianca":      "BMW 4-series Cabrio — white, roof down. California plates (CA, LA). No stickers except small palm-tree decal. Ceramic-coated, always washed — LA energy.",
    "camille":     "Citroën 2CV — duck blue, deux chevaux. French plates (FR). One Paris sticker from a trip she doesn't mention. Playing card tucked under wiper sometimes. Scratches from Marseille alleys, faster in corners than it looks.",
    "celine":      "Peugeot 406 Coupé — dark, chic. French plates (FR, Paris). Small Marianne silhouette sticker — subtle. Book on passenger seat, rain streaks on windows always. Effortless, never fussy.",
    "maria":       "Seat León estate — dark, practical. Spanish plates (ES, Andalusia). Small flamenco guitar sticker on rear. Family photo under sun visor, efficient, warm.",
    "maya":        "Jeep Wrangler — dusty, roof off. Georgia or North Carolina plates (US). Salt Life decal, small three-wave emblem on door. Snorkel gear in back, never clean — Sporty Spice default.",
}

# Region-specific overrides — Europe vs US (same character, different vehicle).
CHARACTER_VEHICLES_REGIONAL = {
    "stacy": {
        "EU": "Fiat Panda — bought used in Athens, €800. Greek plates (GR) or current European country. Hermes wing sticker on bumper, half-peeled flag stickers (GR, HR, IT). Dented rear quarter, maps and ticket stubs on dash. Converse mud on floor mat.",
        "US": "Jeep Wrangler TJ or JK — beat-up high-school hand-me-down, Midwest plates (US). Faded class-of decal on rear window, varsity or school mascot sticker half-peeled, Hermes wing on bumper. Sun-faded soft top, Converse mud on floor mat, disposable camera on dash.",
    },
}

def get_character_vehicle(character_key: str, country_code: str = "") -> str | None:
    regional = CHARACTER_VEHICLES_REGIONAL.get(character_key)
    if regional:
        return regional["US"] if country_code == "US" else regional["EU"]
    return CHARACTER_VEHICLES.get(character_key)

def _apply_vehicle_to_spec(char_spec: str, character_key: str, country_code: str) -> str:
    veh = get_character_vehicle(character_key, country_code)
    if not veh or not char_spec:
        return char_spec
    import re
    if re.search(r"^VEHICLE:", char_spec, re.MULTILINE):
        return re.sub(r"^VEHICLE:.*$", f"VEHICLE: {veh}", char_spec, count=1, flags=re.MULTILINE)
    return char_spec

def _sync_character_vehicles():
    import re
    for key, desc in CHARACTER_VEHICLES.items():
        if key not in CHARACTER_SPECS:
            continue
        spec = CHARACTER_SPECS[key]
        if re.search(r"^VEHICLE:", spec, re.MULTILINE):
            spec = re.sub(r"^VEHICLE:.*$", f"VEHICLE: {desc}", spec, count=1, flags=re.MULTILINE)
        else:
            spec = spec.rstrip() + f"\n\nVEHICLE: {desc}\n"
        CHARACTER_SPECS[key] = spec
    for key, variants in CHARACTER_VEHICLES_REGIONAL.items():
        if key not in CHARACTER_SPECS:
            continue
        desc = f"Europe: {variants['EU']} | US: {variants['US']}"
        spec = CHARACTER_SPECS[key]
        if re.search(r"^VEHICLE:", spec, re.MULTILINE):
            spec = re.sub(r"^VEHICLE:.*$", f"VEHICLE: {desc}", spec, count=1, flags=re.MULTILINE)
        else:
            spec = spec.rstrip() + f"\n\nVEHICLE: {desc}\n"
        CHARACTER_SPECS[key] = spec

_sync_character_vehicles()

# ══════════════════════════════════════════════
# SEASON CONTEXT
# ══════════════════════════════════════════════

def get_season_context(country_code: str) -> str:
    month = datetime.datetime.now().month
    COLD = ["EE","LV","LT","FI","NO","IS","DK","PL","CZ","SK","DE","AT","CH","GB","SE"]
    WARM = ["IT","GR","HR","ES","PT","MA","TN","TR","ME","AL","MC","SI","RS","BA","MK","BG","RO","HU"]
    HOT  = ["BR","MX","TN","MA"]

    if country_code in HOT:
        return "warm tropical or desert climate — minimal summer clothing year-round, bikini/light dress natural"
    if country_code in WARM:
        if month in [6,7,8]:
            return "Mediterranean summer — light clothing, sandals, bare skin natural, golden light"
        elif month in [12,1,2]:
            return "mild Mediterranean winter — light jacket open, boots, scarf optional"
        else:
            return "Mediterranean spring or autumn — light layers, linen, relaxed"
    if country_code in COLD:
        if month in [6,7,8]:
            return "Northern European summer — light clothing, NOT tropical"
        elif month in [12,1,2]:
            return "Northern European winter — warm coat, scarf, boots"
        elif month in [3,4,5]:
            return "Northern European spring — light jacket, layers, cool but bright"
        else:
            return "Northern European autumn — jacket, boots, muted tones"
    if country_code in ["US","CA"]:
        if month in [6,7,8]:
            return "American summer — casual, shorts or light dress ok depending on terrain"
        elif month in [12,1,2]:
            return "American winter — varies by region, check terrain"
        else:
            return "mild American spring or autumn — casual layers"
    return "temperate climate, casual travel clothing appropriate for the location"

# ══════════════════════════════════════════════
# EXPLOIT SYSTEM
# ══════════════════════════════════════════════

EXPLOIT_REPERTOIRE = {
    "olga":       ["over_shoulder", "walk_away", "window_reflection", "caught_in_rain"],
    "nina":       ["over_shoulder", "caught_in_rain", "street_snap", "candid", "nylon_stiletto"],
    "mila":       ["over_shoulder", "caught_in_rain", "street_snap", "walk_away", "candid"],
    "sigrid":     ["window_reflection", "over_shoulder", "miniskirt_city", "nylon_stiletto", "walk_away", "tight_crop", "caught_in_rain", "street_snap", "noir_femme", "back_to_camera", "open_shirt", "stiletto_detail", "asymmetry_shot"],
    "quinn":      ["over_shoulder", "noir_femme", "walk_away", "tight_crop", "nylon_stiletto", "muscle_flex"],
    "kelek":      ["over_shoulder", "candid", "street_snap", "caught_in_rain"],
    "isabella":   ["over_shoulder", "cleavage_lean", "luxury_exploit", "candid"],
    "maria":      ["over_shoulder", "noir_femme", "caught_in_rain", "candid"],
    "rosa":       ["over_shoulder", "noir_femme", "candid", "street_snap"],
    "carmela":    ["cleavage_lean", "over_shoulder", "candid", "walk_away"],
    "camille":    ["candid", "over_shoulder", "back_to_camera", "cleavage_lean", "noir_femme", "femme_fatale", "window_reflection", "caught_in_rain", "low_angle_legs", "street_snap"],
    "oksana":     ["cleavage_lean", "luxury_exploit", "over_shoulder", "candid"],
    "vera":       ["candid", "over_shoulder", "femme_fatale", "caught_in_rain", "low_angle_legs", "window_reflection", "cleavage_lean", "street_snap", "noir_femme"],
    "yuki":       ["window_reflection", "over_shoulder", "noir_femme", "caught_in_rain", "street_snap"],
    "celine":     ["window_reflection", "over_shoulder", "caught_in_rain", "candid", "nylon_stiletto"],
    "ana":        ["female_friendship", "emerging_from_water", "back_to_camera", "walk_away", "wet_skin", "low_angle_legs", "arch_back", "tight_crop", "candid", "cleavage_lean", "beach_blanket"],
    "naomi":      ["female_friendship", "cleavage_lean", "luxury_yacht", "open_shirt", "sheer_top", "slicked_back", "choker_close", "nylon_stiletto", "yacht_bow"],
    "valentina":  ["female_friendship", "luxury_car", "over_shoulder", "choker_close", "latex_editorial", "noir_femme", "cleavage_lean", "nylon_stiletto", "mirror_pose"],
    "sofia":      ["caught_in_rain", "female_friendship", "emerging_from_water", "back_to_camera", "walk_away", "wet_skin", "arch_back", "candid", "low_angle_legs", "tight_crop", "cleavage_lean", "towel_wrap"],
    "tasha":      ["cleavage_lean", "candid", "over_shoulder", "emerging_from_water", "wet_skin", "arch_back", "tight_crop", "beach_blanket", "female_friendship"],
    "yosra":      ["female_friendship", "caught_in_rain", "over_shoulder", "hand_in_hair", "candid", "open_shirt"],
    "elena":      ["female_friendship", "street_snap", "window_reflection", "caught_in_rain", "over_shoulder", "tight_crop", "noir_femme", "miniskirt_city", "latex_editorial", "slicked_back"],
    "katja":      ["female_friendship", "street_snap", "window_reflection", "caught_in_rain", "over_shoulder", "tight_crop", "miniskirt_city", "nylon_stiletto"],
    "alessandra": ["low_angle_legs", "tight_crop", "wet_skin", "candid"],
    "ingrid":     ["female_friendship", "caught_in_rain", "emerging_from_water", "over_shoulder", "back_to_camera", "walk_away", "low_angle_legs", "hand_in_hair", "candid", "miniskirt_city", "thigh_high_boots", "slicked_back", "open_shirt", "tight_crop", "jacket_draped", "muscle_flex"],
    "jade":       ["walk_away", "miniskirt_bend", "low_angle_legs", "over_shoulder", "candid", "hood_lean", "jeep_doorframe"],
    "diana":      ["window_silhouette", "noir_femme", "over_shoulder", "nylon_stiletto", "walk_away", "low_angle_legs"],
    "amber":      ["over_shoulder", "candid", "walk_away"],
    "stacy":      ["caught_in_rain", "street_snap", "candid", "over_shoulder", "hand_in_hair", "open_shirt", "walk_away", "low_angle_legs"],
    "diaz":       ["female_friendship", "street_snap", "window_reflection", "walk_away", "over_shoulder", "tight_crop", "miniskirt_city", "nylon_stiletto"],
    "kay":        ["female_friendship", "emerging_from_water", "back_to_camera", "walk_away", "wet_skin", "over_shoulder", "cleavage_lean", "open_shirt", "luxury_car", "jeep_doorframe", "muscle_flex"],
    "maya":       ["female_friendship", "emerging_from_water", "water_exit", "back_to_camera", "cleavage_lean", "walk_away", "low_angle_legs", "wet_skin", "arch_back", "tight_crop", "candid", "over_shoulder", "muscle_flex"],
    "metka":      ["emerging_from_water", "water_exit", "wet_skin", "candid", "over_shoulder", "back_to_camera", "muscle_flex"],
    "thea":       ["over_shoulder", "candid", "walk_away", "muscle_flex"],
    "charlotte":  ["female_friendship", "street_snap", "window_reflection", "walk_away", "nylon_stiletto", "miniskirt_bend", "miniskirt_city", "cleavage_lean", "over_shoulder", "thigh_high_boots", "stiletto_detail", "rain_mac"],
    "regina":     ["walk_away", "low_angle_legs", "over_shoulder", "luxury_exploit", "noir_femme", "nylon_stiletto"],
    "tammy":      ["walk_away", "candid", "street_snap", "over_shoulder", "tight_crop"],
    "lyra":       ["female_friendship", "emerging_from_water", "back_to_camera", "walk_away", "cleavage_lean", "caught_in_rain", "candid", "over_shoulder"],
    "werra":      ["back_to_camera", "walk_away", "candid", "over_shoulder", "caught_in_rain"],
    "noir":       ["nylon_stiletto", "latex_editorial", "noir_femme", "low_angle_legs", "walk_away", "window_reflection", "luxury_exploit", "stiletto_detail"],
}

EXPLOIT_CATEGORIES = {
    "walk":     ["walk_away", "miniskirt_bend", "nylon_stiletto"],
    "cleavage": ["cleavage_lean", "open_shirt", "sheer_top", "window_light", "jacket_draped"],
    "legs":     ["low_angle_legs", "stiletto_detail", "thigh_high_boots", "miniskirt_city"],
    "face":     ["choker_close", "slicked_back", "femme_fatale", "asymmetry_shot"],
    "body":     ["arch_back", "tight_crop", "latex_editorial", "hood_lean", "muscle_flex", "towel_wrap", "beach_blanket"],
    "candid":   ["candid", "street_snap", "shadow_play", "caught_in_rain", "over_shoulder", "hand_in_hair", "wet_skin", "jeep_doorframe", "rain_mac"],
    "luxury":   ["luxury_yacht", "luxury_car", "luxury_exploit", "noir_femme", "window_silhouette", "yacht_bow", "mirror_pose"],
}

# ── CINEMATIC SHOTS ─────────────────────────────────────────────────────────
# Character-defining editorial moments — no skin focus, cinematic/atmospheric.
# Triggered via --cinematic-key, not part of the automatic exploit flow.

CINEMATIC_PROMPTS = {
    "gas_station_night": """
CINEMATIC SHOT: Character at a gas station at night — her vehicle is there.
Use her specific vehicle from the character description — Jeep, motorcycle, truck, van, whatever she drives.

THREE VALID MOMENTS (pick one that fits best):
1. FUELING — nozzle in tank, one hand on the car roof or pump handle. She looks away at the road or the dark.
2. HOOD CHECK — hood slightly open or she leans into the window to check something. Not a breakdown — just a habit.
3. CASHIER WALK — she walks from the car toward the lit station interior, or back from it. Jacket on, something in hand.

Neon price signs, fluorescent canopy light, concrete island. Hard shadows. Face partly lit from above.
No performance — she is between somewhere and somewhere else. The gas station is the pause.
Expression: distant, slightly tired, or just watching. Not smiling.
Shot from medium distance — vehicle and character both visible. Station fills the frame around them.
The aesthetic: Michael Mann meets roadside Americana or European Autobahn stop.
""",
    "through_windshield": """
CINEMATIC SHOT: Character visible through the windshield from outside the vehicle.
She sits in the driver's seat — hands on wheel or resting. Looking forward, or slightly turned.
The shot is from the front exterior, slightly low — the windshield frames her.
Dashboard instruments, road or landscape reflected in glass. Her face clear through the glass.
Not looking at camera — she is somewhere in her own thought, or watching the road ahead.
The vehicle is hers — use the character's specific vehicle from her description.
Hard or diffused outdoor light. The glass adds a layer between her and us. That is the point.
""",
    "staircase_shot": """
CINEMATIC SHOT: Character on a grand staircase — marble, stone, or old hotel carpeted steps.
Shot from below looking up, or from above looking down — she is mid-stair, not at top or bottom.
One hand on the rail or brushing the wall. The other free.
She walks or pauses — not posing for the staircase. She just happens to be on it.
Long dress or tailored outfit — fabric catches the stair light.
Location: old hotel, European mansion, opera foyer, railway station — architecture from another era.
The staircase is the frame. She is what gives it meaning.
Shot wide enough that the architecture dominates 60%+ of frame.
""",
    "blueprint_study": """
CINEMATIC SHOT — SIGRID ONLY.
She leans over architectural drawings spread on a table — a drafting table, café table, or hotel desk.
Rotring pen in hand, Moleskine beside the plans. She traces something or marks a correction.
Short pale blonde hair. Clean features. Blazer or fitted shirt — one side slightly open or tucked asymmetrically.
The drawings are real — site plans, sections, elevations. Not decorative.
Shot from the side or slightly above — her face in three-quarter profile, the plans below.
The Rotring pen: one half matte black, one half bare metal. This is always present.
Natural window light — overcast or sharp northern light. Copenhagen or Stockholm feel.
Peter Lindbergh precision — the intelligence is the subject. The beauty is incidental.
""",
    "map_table": """
CINEMATIC SHOT — KELEK.
She leans over a paper map spread on a table, car hood, or flat stone surface.
Both hands on the map — one holding it flat, one tracing a route or pointing to something.
Red lips close to the paper. Gold hoops catch the light. Eyes down, focused.
The map is annotated — three colors of ink, corrections, marks only she understands.
Linen shirt, leather belt, boots — she is dressed for work, not for this moment.
Shot from the side or slightly above — face in three-quarter profile, map below.
The contrast: precise technical mind, deliberate beauty. Neither apologizes for the other.
Whatever she is looking at on the map — she has an opinion about it.
""",
}

CINEMATIC_REPERTOIRE = {
    "gas_station_night": ["werra", "tammy", "jade", "amber", "quinn", "thea", "ingrid", "diaz", "stacy", "camille"],
    "through_windshield": ["werra", "jade", "amber", "thea", "maya", "kay", "ingrid", "tammy"],
    "staircase_shot":     ["charlotte", "valentina", "naomi", "olga", "diana", "elena", "katja", "isabella", "camille"],
    "map_table":          ["kelek"],
    "blueprint_study":    ["sigrid"],
}

# ── CHAR SPECIALS ────────────────────────────────────────────────────────────
# Signature keys per character — exclusive or near-exclusive shots across
# exploit, cinematic, and activity. Used by --specials-only.
# Format: { "char": [("type", "key"), ...] }
# type: "exploit" | "cinematic" | "activity"
CHAR_SPECIALS = {
    "ingrid":    [("exploit", "jacket_draped"), ("activity", "helmet_off")],
    "jade":      [("exploit", "hood_lean"), ("exploit", "jeep_doorframe")],
    "diana":     [("exploit", "window_silhouette"), ("cinematic", "staircase_shot")],
    "metka":     [("exploit", "water_exit")],
    "maya":      [("exploit", "water_exit")],
    "kay":       [("exploit", "jeep_doorframe"), ("exploit", "muscle_flex")],
    "naomi":     [("exploit", "yacht_bow")],
    "valentina": [("exploit", "mirror_pose"), ("cinematic", "staircase_shot")],
    "sofia":     [("exploit", "towel_wrap")],
    "charlotte": [("exploit", "rain_mac"), ("cinematic", "staircase_shot")],
    "ana":       [("exploit", "beach_blanket")],
    "quinn":     [("exploit", "muscle_flex"), ("activity", "morning_run_urban")],
    "tammy":     [("activity", "notebook_outside")],
    "mila":      [("activity", "cigarette_roll")],
    "djordje":   [("activity", "cigarette_roll")],
    "thea":      [("activity", "cigarette_roll")],
    "werra":     [("activity", "field_repair"), ("cinematic", "gas_station_night")],
    "amber":     [("activity", "roadside_dusk"), ("cinematic", "gas_station_night")],
    "kelek":     [("cinematic", "map_table")],
    "sigrid":    [("exploit", "asymmetry_shot"), ("cinematic", "blueprint_study")],
    "camille":   [("activity", "tarot_read"), ("cinematic", "gas_station_night")],
}

# Body focus per character — drives exploit shot selection weighting
# Categories map to EXPLOIT_CATEGORIES keys: ass, cleavage, legs, face, body, candid, luxury
CHARACTER_BODY_FOCUS = {
    "valentina":  ["cleavage", "legs"],
    "naomi":      ["cleavage", "luxury"],
    "elena":      ["ass", "legs"],
    "katja":      ["legs", "ass"],
    "sofia":      ["ass", "body"],
    "ana":        ["ass", "body", "cleavage"],
    "maya":       ["body", "ass", "cleavage"],
    "kay":        ["ass", "body"],
    "ingrid":     ["ass", "legs", "cleavage"],
    "jade":       ["ass", "legs"],
    "charlotte":  ["legs", "ass"],
    "diaz":       ["ass", "legs"],
    "stacy":      ["ass", "candid"],
    "werra":      ["ass", "candid"],
    "tammy":      ["ass", "candid"],
    "lyra":       ["ass", "body"],
    "thea":       ["ass", "candid"],
    "regina":     ["ass", "legs"],
    "diana":      ["legs", "body"],
    "sigrid":     ["ass", "legs"],
    "yosra":      ["candid", "body"],
    "zara":       ["candid", "body"],
    "tasha":      ["cleavage", "body", "candid"],
    "bianca":     ["cleavage", "body"],
    "amber":      ["ass", "candid"],
    "quinn":      ["ass", "body"],
    "rosa":       ["face", "ass", "candid"],
    "isabella":   ["cleavage", "face", "candid"],
    "amber":      ["ass", "candid", "body"],
    "vera":       ["candid", "legs", "face"],
    "camille":    ["candid", "face", "legs"],
    "kelek":      ["face", "candid"],
    "metka":      ["body", "candid"],
    "thea":       ["ass", "candid"],
}

HOT_ONLY_SHOTS = ["feel_the_heat"]

# Activities allowed in safe mode — proven reliable, low body-distortion risk
SAFE_ACTIVITIES = {
    "cafe_terrace", "harbour_walk", "market_browse", "hiking_back",
    "beach_walk_distance", "going_for_a_run", "menu_study", "cycling_road",
    "snowshoe_hike", "campfire_sit", "desert_walk", "sunset_wine", "cigarette_roll",
    "postcard_write", "newspaper_cafe", "kiosk_stop", "photo_lab",
    "rope_coil", "map_hood", "tire_change", "kayak_entry", "metal_horns", "cinema_program",
}
DISABLED_ACTIVITIES = {"lingerie_window", "lingerie_store"}
BIKINI_CHARS = {"ana", "sofia", "maya", "kay", "tasha", "kiona", "metka", "amber"}  # canonical outfit is bikini/swimwear — no feel_the_heat

# Compact per-character anchors for water / outdoor activity prompts (see CHARACTER_SPECS for full lore)
CHARACTER_BODY_ANCHORS = {
    "ana":        "Curvy warm Brazilian build — never slim. Gold anklet LEFT ankle, gold toe ring LEFT foot. Nose stud left nostril. Nails natural, slightly sandy.",
    "sofia":      "Athletic lean surfer build, olive freckled skin. Silver crescent moon necklace. Blue woven bracelet left wrist always.",
    "maya":       "Hourglass swimmer build — wide shoulders, narrow waist, full chest/hips. Three-wave-line emblem on top when in water gear. Goggles on forehead or around neck.",
    "kay":        "Strong lean 44, decades of Pacific tan. Fine lines around eyes — evidence not damage. Small white orca silhouette on chest (wetsuit or black top). Shoulder scar ok.",
    "tasha":      "Warm olive skin, dark curly hair. Camera or ferry ticket only when seated — not on active water shots. ~15%: neon 90s windbreaker over sundress.",
    "metka":      "Freediver build — lean, hipster-cut athletic frame. Buzz cut, wetsuit tan lines at shoulders and wrists, bare short salt-worn nails, silver helix piercing. Shearwater/Suunto dive computer left wrist.",
    "amber":      "Natural curves under casual layers. Coyote-echo coat tint only on wildlife — not on her body.",
    "jade":       "Red curly hair, deep desert tan, strong athletic build. Short unpolished nails, motor oil under nail ok. Old red shop rag in belt/back pocket when dressed.",
    "alessandra": "Very athletic endurance build — visible six-pack, lean and strong, NOT over-shredded or bodybuilder-defined. Cycling kit tan lines on legs and shoulders always. Bare short nails, trail dust ok. Fresh knee scrape ok. Altitude tan, braid or loose dark waves.",
    "ingrid":     "Tall lean Scandinavian 175cm, platinum blonde wind-touched. Pale weather-tanned skin. Minimal silver jewelry only.",
    "elena":      "Pale skin, dark hair, lean traveller build. Black nails chipping. Industrial bar right ear, chunky silver chain matches; maybe one other ear piercing. Large black duffel often nearby on shore — never luxury styling.",
    "werra":      "Functional forest strength — lean, capable, not gym-built. Dark practical coloring, work-ready hands.",
    "lyra":       "Petite Mediterranean — olive skin, dark hair loose (salt and wine). Ariadne stillness. Small grape-bunch tattoo hip or shoulder blade ok. Old gold jewelry — ear cuff, thin rings, throat chain. Rope-calloused hands believable on lake.",
    "katja":      "BMW-road athletic — toned legs, practical European outdoor fit.",
    "sigrid":     "Architect lean, pale blonde. Bare clean short nails. HEL asymmetry — one gold stud other ear bare; one hidden piercing elsewhere. One-shoulder swim on beach/SUP.",
    "thea":       "Greek coastal build — sun-touched skin, strong legs, Vespa-road energy.",
    "vera":       "Soft traveller build — warm, approachable. Small mole neck right side when hair up. Red nails fingers and toes always maintained.",
    "camille":    "Petite French build — capable, quick, 2CV energy. Mole somewhere she ignores. One surprise piercing unexplained.",
    "stacy":      "American collegiate-athletic — bright energy, not broody. Summer freckles multiply. Chipped pastel nails ok. ~15%: neon 90s windbreaker over tank.",
    "quinn":      "Operational lean — tactical-adjacent posture, not performative. No piercings.",
    "yuki":       "Very pale Japanese build, long straight black hair. Silver asymmetric ear piercings (helix/conch/orbital). Still, minimal — storm-front presence.",
    "charlotte":  "Early 40s British, pale skin, dark blonde hair precise or one pin out. Burgundy or nude nails perfect always. Sutton Hoo gold filigree pendant at collarbone always. Union Jack lapel pin when dressed.",
    "naomi":      "Tall lean mixed French-Tunisian, golden-brown skin, high cheekbones. Small mole left collarbone. Nails nude or black, manicured always. Minimal gold jewelry only. ~15%: oversized blazer draped on shoulders only, arms bare.",
    "valentina":  "Mediterranean olive, sharp jaw, dark hair pinned up. Gold hoop, talisman necklace, deep red nails perfect never chipped — never chess queen on water.",
    "yosra":      "Warm olive-brown skin, thick curly dark hair. Quiet present gaze. Bare feet when warm.",
    "luca":       "Italian surfer build — sun-weathered, blonde wild hair, strong jaw, easy smile.",
    "chad":       "Conventionally handsome American nomad — groomed stubble, wavy dark hair.",
    "regina":     "Dark hair, strong features — thinks more than she performs. Void-adjacent stillness.",
    "diaz":       "Latina athletic build, dark wavy hair half-up. Short bare or clear nails. Santa Muerte energy only as subtle prop off-duty.",
    "tammy":      "Soft lived-in build, bleached roots visible, baby-blue eyes if sunglasses off. Sharp tank-top tan lines, left arm darker. Dark chipped nail polish. No extra piercings. Golden apple PENDANT at neck only — NOT an apple tattoo. ONLY tattoo: \"11.22.63\" small black ink LEFT clavicle. NO tattoos on belly, hip, ribs, or waist.",
    "olga":       "Slavic 48-54, silver-grey hair immaculate, high cheekbones, calm earned posture. Pale nude understated nails.",
    "nina":       "Austrian journalist build, sharp intelligent face, camel trench energy off-water.",
    "mila":       "Balkan sharp jaw, dark wild hair, festival wristbands stacked one wrist. Scaffold/industrial one ear — not Elena's bar. Nails bare or black.",
    "isabella":   "Cuban-American curves, warm Miami tan. Gold bracelet always.",
    "maria":      "Andalusian warmth, dark hair, strong features — flamenco energy at rest.",
    "rosa":       "Mexican bold curves, dark hair, gold chains always. Gold navel ring when midriff visible. Bold dark red or black nails always fresh.",
    "carmela":    "Neapolitan strong features, red lips, red nails non-negotiable, three-chain energy without chains on swim.",
    "oksana":     "Eastern European model build — tall, precise, cold-beautiful.",
    "celine":     "Parisian chestnut hair, warm olive skin, one large sculptural gold earring.",
    "bianca":     "Managed curves, deep tan, highlighted dark-to-blonde hair — reads the room.",
    "kelek":      "Turkish/Levantine, buzz cut near-black, strong jaw, red lips always, gold hoops.",
    "diana":      "Romanian pale skin, dark hair, red lips always. Inner left palm scar when gloves off.",
    "terry":      "Belgian-French traveller, dark hair, calibrated stillness.",
    "conrad":     "Tall lean Northern European, ash blonde short hair, symmetrical cold handsome face. ~15%: henley, rolled sleeves, two-day stubble.",
    "djordje":    "Balkan 42-52, textured face — prominent nose, salt-pepper beard, tortoiseshell sunglasses.",
    "zsofi":      "Hungarian architect build, auburn/brunette wave, fair Central European skin.",
    "zara":       "Market-hopper build — practical, quick, flea-market sticker energy.",
}

# Fingernails / toenails — injected on main, activity, exploit (via build_prompt). See CHARACTER_SPECS for lore.
CHARACTER_NAILS = {
    "valentina":  "deep red, perfect — never chipped; she would notice",
    "naomi":      "nude or black — manicured, always; not a detail, a baseline",
    "olga":       "pale nude, understated — old money doesn't shout",
    "tammy":      "dark polish, chipped — applied three weeks ago in a gas station parking lot",
    "elena":      "black, chipping — she is aware, doesn't care",
    "mila":       "bare or black — she decides in the morning; nobody's business",
    "sigrid":     "bare, clean, short — architects don't perform",
    "carmela":    "red, always — non-negotiable",
    "rosa":       "bold dark red or black — always fresh",
    "vera":       "red always — fingers and toes; the one thing she maintains everywhere",
    "charlotte":  "dark burgundy or nude — perfect, always",
    "diaz":       "short, functional, bare or clear — badge doesn't care about nails",
    "jade":       "short, unpolished — occasional motor oil under the nail, not staged",
    "alessandra": "bare, short — trail dust possible",
    "metka":      "bare, short — salt-worn",
    "ana":        "natural, slightly sandy — gold toe ring left foot when feet visible",
    "stacy":      "occasional chipped pastel from three countries ago",
}


def get_character_nails_lock(character_key: str) -> str:
    note = CHARACTER_NAILS.get(character_key)
    if not note:
        return ""
    return f"FINGERNAILS / TOENAILS (MANDATORY if hands or feet visible): {note}."


# Ear/face and body piercings — see CHARACTER_SPECS. Rosa navel is the only specified navel ring.
CHARACTER_PIERCINGS = {
    "elena": (
        "industrial bar right ear always; chunky silver chain necklace matches the metal. "
        "Possibly one small piercing on the other ear — never copy this industrial bar on other characters"
    ),
    "mila": (
        "small scaffold or industrial on one ear — different placement/style from Elena's right industrial bar"
    ),
    "yuki": "helix, conch, or orbital — silver, asymmetric; matches Slayer/metal aesthetic",
    "sigrid": (
        "one hidden piercing somewhere subtle — she doesn't mention it "
        "(separate from the visible one gold stud / bare ear HEL asymmetry)"
    ),
    "tammy": (
        "no extra piercings — gold hoops/pendant energy is already enough for her world; "
        "NOT industrial bar, NOT navel ring, NOT ear stacks"
    ),
    "quinn": "no piercings anywhere — operational, nothing decorative",
    "rosa": "gold navel ring — visible when crop top, bikini, or bare midriff",
    "camille": "one surprise piercing nobody expects — she doesn't explain; not Elena's industrial bar",
}


def get_character_piercings_lock(character_key: str) -> str:
    note = CHARACTER_PIERCINGS.get(character_key)
    if note:
        return f"PIERCINGS (MANDATORY when visible): {note}."
    return (
        "PIERCINGS: no nipple piercings. "
        "No navel/belly-button piercings unless specified for this character."
    )


# Moles, freckles, tan lines, sun wear — injected with nails on main/activity/exploit.
CHARACTER_MARKS = {
    "naomi":      "small mole, left collarbone — she knows exactly where it is",
    "camille":    "a mole somewhere she ignores — she knows, doesn't matter",
    "vera":       "small mole on neck, right side — visible when hair is up",
    "stacy":      "freckles multiply every summer — she photographs them sometimes",
    "tammy":      "sharp tan lines from the same tank top every summer; left arm darker — window down on the highway",
    "metka":      "wetsuit tan lines, years of them — visible at shoulders and wrists",
    "kay":        "sun wear — fine lines around eyes; evidence, not damage",
    "alessandra": "cycling kit tan lines visible on legs and shoulders — always",
}


def get_character_marks_lock(character_key: str) -> str:
    note = CHARACTER_MARKS.get(character_key)
    if not note:
        return ""
    return f"MOLES / MARKS (MANDATORY when skin visible): {note}."


CHARACTER_SWIM_OUTFIT = {
    "ana":        "Cheerful Brazilian beach bikini — Oxum/warm-water energy. COLOR (~equal): tropical yellow, warm gold, coral-orange, Brazilian-flag green, bright turquoise, or classic black. String or soft triangle — festive, sun-lit, never gloomy luxury-black-only. Gold anklet LEFT ankle, gold toe ring LEFT foot if feet visible. Natural slightly sandy nails. Yellow/orange flower in hair ok. Cold lake → athletic one-piece in same bright palette or black.",
    "sofia":      "Black athletic bikini top + dark shorts, or simple black sports bikini. Sand on bare feet when warm. No heels.",
    "maya":       "Sport competition-style bikini or black athletic two-piece — training suit acceptable. No cargo shorts on the board. Cap/goggles ok.",
    "kay":        "Black fitted tank and bikini bottoms, OR shorty wetsuit peeled to waist — orca logo on chest. Barefoot on board.",
    "tasha":      "Simple bikini or light one-piece — tourist heat, not editorial glam. COLOR: plain solid (black, white, coral) OR stars-and-stripes flag bikini (~25%, Venice Beach joke — worn like kitsch, not patriotism). Disposable camera on shore only, not on board. Summer dress ok at shore, not on SUP.",
    "metka":      "Black freediving bikini — tie-string top, hipster-cut bottoms (EU 38 fit, full coverage). Small \"-38\" mark on left front of bikini bottom above hip, dark-on-dark, subtle. No padding, no underwire, no metal hardware. NOT fashion triangle bikini.",
    "amber":      "Simple white or sand bikini, or light one-piece — off-duty, not styled shoot.",
    "jade":       "Desert-athletic sports bikini or two-piece — NOT only black. COLOR (~equal): black OR burnt rust/terracotta OR turquoise (southwest lake/pool, matte not neon). Functional cut, no string-bikini glam. NO cutoff denim or cowboy boots on water. Barefoot on SUP.",
    "alessandra": "Black sports bikini — functional, not decorative. BEACH BODY: very athletic — flat hard midsection, six-pack visible but natural (NOT gym-stage shredded, NOT exaggerated ab definition). Cycling kit tan lines on legs and shoulders always visible. No flannel on board.",
    "ingrid":     "Dark navy functional one-piece or black athletic bikini — never decorative string bikini. Barefoot.",
    "elena":      "Black tank + dark bikini bottoms, or simple black one-piece — pale skin reads. Duffel on shore ok, not on board.",
    "werra":      "Functional swim only — dark athletic bikini or plain black one-piece, boyshort or hipster bottom. Forest-practical, zero fashion detail. No tactical vest or boots on water.",
    "lyra":       "ARIADNE swim — Mediterranean dusk/night energy even at a lake (blue hour, moon, string lights ok; never harsh midday fluorescent). CUT: one-shoulder bikini, low-back one-piece, or slip-style swim — one strap off shoulder on purpose (echoes white/deep-red linen dress). COLOR (~equal): white (linen-white, natural backlight at hem ok), deep wine-red, burgundy, black; emerald jewel tone rare (~15%). Old gold jewelry stays. Grape tattoo visible if frame allows. Flower in hair ok. Red wine in real glass on shore only — not on SUP; empty glass turned slowly between fingers on dock. Amused over-shoulder awareness — not flirty posing. NO full candlelit maxi on board, no phone, no resort-catalog prints.",
    "katja":      "Black or navy athletic bikini / one-piece — clean European outdoor, not yacht glam.",
    "sigrid":     "HEL asymmetrical swim — one-shoulder strap top (single strap, other shoulder bare) with ice-grey or black bottoms, OR one-shoulder one-piece. MANDATORY on SUP and beach water shots — NOT symmetric triangle/bandeau with two equal straps. One gold stud, other ear bare. Subtle HEL, not costume. Barefoot on board. No neon.",
    "thea":       "Functional Greek swim — simple bikini or one-piece in Greek blue (azure/cobalt), not neon. Sporty Mediterranean, barefoot. No evening dress on water.",
    "vera":       "Nice floral bikini or one-piece — small tasteful flower print (not childish, not resort-catalog). Soft colours, traveller-pretty, still practical on SUP.",
    "camille":    "All black bikini or black one-piece — simple, French, no patterns. Not 2CV duck-blue dress on water.",
    "stacy":      "Preppy happy swim — plain bikini OR stars-and-stripes bikini (50/50). Converse on sand/shore ok, not on board. Disposable camera around neck on shore only.",
    "quinn":      "Sporty semi-military swim — black or olive athletic bikini / one-piece, clean lines, utilitarian cut. NO camo print, NO plate carrier, NO boots on board. Range-Rover-practical, not operator LARP.",
    "yuki":       "Simple black one-piece swimsuit — minimal, pale skin reads. No Slayer shirt on board. Optional black bikini only if one-piece wrong for SUP balance. Cigarette on shore ok, not while paddling.",
    "charlotte":  "Black-and-white striped one-piece swimsuit (Badeanzug) — bold classic stripes, fitted not frumpy. NO pencil skirt, nylons, heels, or blazer on water. Sutton Hoo gold pendant at collarbone ok; no office wear.",
    "naomi":      "Minimal luxury string bikini — expensive matte fabric, yacht-quality. COLOR (~equal): black OR deep navy blue (Monaco/yacht deck, solid no pattern) OR emerald green (jewel tone, not neon). ~15% on terrace/shore (not on SUP): oversized blazer on shoulders only — unbuttoned, arms free. No prints on bikini. Minimal gold jewelry only. No evening gown on water. Barefoot on board.",
    "valentina":  "Simple black sports bikini or one-piece only — NO ivory suit, NO chess queen on board, NO stilettos. Rare water; when yes: understated Milan swim, not terrace linen.",
    "yosra":      "SUP/beach water only: simple dark bikini or one-piece — shirt OFF on board. Bare feet. NO van clutter on SUP. NOT for city/café/street.",
    "luca":       "Worn board shorts or surf shorts, bare chest or faded tee off — Italian surfer, salt tan. NO jeans on board.",
    "chad":       "Neutral board shorts or plain swim trunks — Patagonia-adjacent, no MacBook on board. Barefoot.",
    "regina":     "Black one-piece swimsuit — simple, sits-thinks energy, not decorative. No office wear on water.",
    "diaz":       "Black sport bikini or two-piece — off duty, no uniform on water. Gold hoops ok. Badge stays in bag on shore.",
    "tammy":      "Gulf Coast swim — simple bikini or one-piece, dignified not designer, not cheap-neon. COLOR (prefer dark ~70%): charcoal, dark navy, faded teal, dusty blue, or muted burgundy — never Brazil-bright, never yacht glam. Sharp tank-top tan lines, left arm darker. Dark chipped nail polish ok. TATTOO LOCK: only \"11.22.63\" on LEFT clavicle if visible — NO apple tattoo anywhere on body; golden apple is NECK PENDANT only. NO flannel on board; Marlboro/energy drink on shore only.",
    "olga":       "Dark one-piece swimsuit — upright posture even on SUP. Sunglasses ok. NO wool coat on water.",
    "nina":       "Understated black bikini or navy one-piece — journalist practical, no trench on board.",
    "mila":       "Dark bikini or black sports two-piece — functional minimal, no leather jacket on water. Wristbands ok.",
    "isabella":   "White or black bikini — gold bracelet stays on. No Cadillac glamour on water.",
    "maria":      "Simple black or red bikini — Andalusian practical, barefoot.",
    "rosa":       "Black bikini — gold chains stay on, gold navel ring visible. Loud confidence, not club dress on water.",
    "carmela":    "Black or red bikini — full confidence, no Alfa jacket on board.",
    "oksana":     "Designer black or white bikini — clean lines, obvious quality, still sport-practical on SUP.",
    "celine":     "Black-and-white striped one-piece — Parisian retro (Biarritz natural). One sculptural gold earring ok.",
    "bianca":     "White bikini — gold hoops, thin chain charm. Pool-resort clean, not evening wrap dress on board.",
    "kelek":      "Earth-tone bikini or one-piece — sand, ochre, olive, or linen-white (matte, cartographer-practical). Red lips and large gold hoops always. Annotated paper map on rock/shore ok; brass compass on belt or beside map — NOT on SUP. Barefoot. Harsh Med/Levant sun, strong shadows. Reading the coastline, not posing.",
    "diana":      "GOTH-ELEGANT swim — MANDATORY on SUP. Transylvania contract energy, not sport-tourist, not mall-goth. CUT: high-neck black one-piece with deep open back, or high-waist black bikini with thin straps — pale Romanian skin reads, posture calm and elsewhere. KINKY-SUBTLE: ritual elegance — she chose something too formal for a lake; no harness, no collar, no latex, no fishnets on water. COLOR (~equal): black, charcoal, deep plum/burgundy, or ink-navy — red lips always (lacquer). Opera gloves OFF; inner-left-palm scar may show on bare hands. Unlit cigarette on shore only — never lit on board. Overcast or blue hour on lake ok; hard shadows. NO generic sport triangle bikini. NO cheerful resort sun.",
    "terry":      "EU swim — calibrated, slightly charged, never trashy. CUT (pick one): low-back one-piece, high-cut legs, thin-strap halter, or minimal triangle — long yoga back visible, posture controlled. KINKY-SUBTLE: she chose a cut slightly too knowing for a SUP paddle; no harness, no collar, no latex on water. COLOR (~equal): black, navy, deep red (matches occasional red lips — lacquer tone, not neon), or muted wine. Red lips on shore ok, not while paddling. No prints, no overfull tote on board.",
    "conrad":     "Charcoal swim shorts + open white shirt or navy swim trunks only — no suit, no Patek visible on paddle. ~15% off-water edge: henley with rolled sleeves, two-day stubble, no jacket. Technical swim ok.",
    "djordje":    "Hawaiian-print board shorts — tropical hibiscus/palm, loud kiosk energy (signature). Linen shirt off on water; tortoiseshell sunglasses on shore, not while paddling. Barefoot. Rare fallback (~10%): plain dark swim trunks if cold lake/no beach context.",
    "zsofi":      "Understated navy or black one-piece — architect-clean, Budapest practical.",
    "zara":       "Simple bikini or one-piece — traveller-budget pretty, solid colours (black, navy, coral, or faded red). Barefoot. No bicycle on board.",
}

CHARACTER_KAYAK_ENTRY_OUTFIT = {
    "jade":       "Worn tank top, cutoff shorts or trail shorts, barefoot or trail runners on wet rock — NO cowboy boots at water edge.",
    "alessandra": "Trail shorts or running shorts, fitted tank or race vest, trail runners. Optional flannel tied at waist. Scraped knee ok.",
    "werra":      "Dark tee, trail pants or shorts, work boots or trail shoes — pushing canoe, not swim.",
    "elena":      "Leggings or hiking shorts, fitted tee, trainers — duffel on shore not in hands.",
    "lyra":       "Linen trousers rolled or shorts, light blouse or tee, flat sandals at shore.",
    "katja":      "Athletic shorts, fitted top, trail shoes — BMW traveller practical.",
    "sigrid":     "Hiking shorts, tank, trail runners.",
    "thea":       "Shorts, light tee, sandals or barefoot on rocks.",
    "vera":       "Trail shorts, tee, trainers.",
    "camille":    "Shorts, tee, flat shoes — 2CV day-trip practical.",
    "stacy":      "Cutoff shorts, tank, Converse on shore not on wet rock if possible.",
    "ingrid":     "Athletic shorts, fitted tank, trail runners — leather jacket OFF body (on rock if visible).",
    "kelek":      "Linen trousers or shorts, earth-tone tee, barefoot on wet rock. Map/compass on shore.",
    "regina":     "Hiking shorts, dark tee, trainers — pushing canoe, functional.",
    "diaz":       "Athletic shorts, fitted tee, trainers — off duty, no duty belt.",
    "tammy":      "Cutoff shorts, tank top, cheap sneakers or barefoot on shore.",
    "naomi":      "Athletic shorts, fitted top, trainers — minimal jewelry, no yacht dress.",
    "luca":       "Board shorts or trail shorts, faded tee, barefoot on shore.",
    "bianca":     "Trail shorts, white or neutral tank, trainers.",
}

# going_for_a_run — per-character kit from CHARACTER_SPECS (see also morning_run_urban for quinn)
CHARACTER_RUN_OUTFIT = {
    "alessandra": "Fitted trail shorts, race vest, trail runners, sports watch/GPS. Optional poles. Fresh knee scrape ok. Endurance athlete — never dress or heels.",
    "ingrid":     "Athletic shorts, fitted tank, trail runners. Leather jacket OFF body while running.",
    "katja":      "Dark fitted running shorts, fitted tank, trail shoes — BMW-road athletic, practical not glam.",
    "stacy":      "Happy preppy run — clean fitted shorts or skort, bright tank or collegiate tee, white trainers (Converse ok). Scrunchie on wrist, gold hoops. HS-sport legs still there — upbeat, not elite pro.",
    "jade":       "Trail shorts, worn tank, trail runners. Red shop rag in pocket ok. NO cowboy boots.",
    "werra":      "Dark trail pants or athletic shorts, plain dark tee, trail shoes — forest-practical, no vest.",
    "sigrid":     "Hiking shorts, fitted tank, trail runners.",
    "thea":       "White fitted tee or linen shirt closed, linen trousers or dark shorts, trainers — dark vintage sunglasses ON. Cigarette or toothpick after run ok, not while sprinting.",
    "naomi":      "Normal run — fitted black or navy athletic shorts or leggings, quality tank, minimal gold jewelry, trainers. Competent unhurried pace, yacht-body maintenance not race.",
    "maria":      "Black athletic shorts or leggings, fitted dark top, trainers, small gold earrings. Andalusian strong legs — she actually wants to be here.",
    "isabella":   "Quality fitted run kit — athletic shorts or leggings, luxe sports top, trainers, grandmother's gold bracelet on left wrist always. Body is the asset; kit is deliberate.",
    "zara":       "Linen crop under open overshirt tied at waist, fitted shorts or leggings, clean sneakers. Crossbody bag strap, gold hoops — normal capable traveller jog.",
    "elena":      "NOT athletic — random hostel clothes: oversize faded tee or old black tank, worn denim shorts or baggy joggers wrong length, cheap trainers or flat boots that are a bad choice. No race kit, no sports watch, no matching set. Duffel NOT on the run.",
    "yosra":      "Light joggers, light cotton t-shirt (olive, grey, or off-white), trainers — unhurried walk-jog, not race kit. NO Leica, NO camera strap, NO linen shirt.",
    "amber":      "Light shorts, fitted top, trail runners, aviator sunglasses — nimble stride. Real wild coyote beside or slightly ahead on the path — same easy pace, bonded companions on a jog. NOT fleeing, NOT hunting, NOT afraid.",
    "ana":        "Athletic shorts, fitted tank, trainers. Gold anklet LEFT ankle if legs visible.",
    "maya":       "Black athletic shorts, training tank or sports crop top, trainers. Goggles on forehead ok.",
    "kay":        "Trail shorts, fitted top, trail runners. Orca logo on top ok.",
    "metka":      "Black athletic shorts, freediver crop top, trail runners, Suunto/Shearwater on left wrist. Easy tempo — 20km is nothing for her.",
    "tasha":      "EXTRA SKIMPY run kit — tiny running shorts, minimal crop top or sports bra, trainers, gold hoops. Body must stay fit; treats run as maintenance. Disposable camera on strap ok.",
    "kiona":      "Black high-waist shorts, fitted tank, trainers or Sambas.",
    "lyra":       "NOT sportswear — loose white or wine-red linen dress (maybe yesterday's), sandals or barefoot on pavement, old gold jewelry. NO trainers, NO leggings, NO race look. Hair loose, salt and wine.",
    "kelek":      "1950s women's athletic jog (real sport kit, vintage — NOT interwar blouse/trousers, NOT modern Lycra, NOT pin-up costume): fitted knit running shorts or calf-length pedal pushers (grey, dusty rose, navy, or sand), short-sleeve cotton knit top or simple sleeveless athletic shirt (white or pale pastel), white canvas sneakers (Keds-style) with short white socks, optional thin cotton headband. Red lips, large gold hoops. Brass compass on belt ok; map in hand ok. NO buttoned blouse, NO leather lace-ups, NO blazer, NO neon trainers.",
    "mila":       "Dark athletic shorts, band tee or black top, trainers — festival wristbands on one wrist.",
    "diaz":       "OFF DUTY cop fitness — sports bra or fitted crop, high-waist leggings or athletic shorts, clean sneakers, gold hoops. No uniform, no duty belt. Alert eyes even on a jog.",
    "tammy":      "Leggings or athletic shorts, tank, cheap sneakers.",
    "quinn":      "Black compression tights, fitted black technical top, trail runners, zero logos — no headphones. Iron discipline; pace locked, zero wasted motion.",
    "bianca":     "Black leggings or shorts, fitted top, trainers.",
    "djordje":    "Running shorts, linen tee, trail runners — male.",
    "luca":       "Trail shorts, faded tee, trail runners or barefoot only if desert path.",
    "conrad":     "Running shorts or chino shorts, polo or tee, clean trainers — not pressed suit.",
    "chad":       "Vuori/Nike-bro run kit — light grey or white fitted tee, clean minimal running shorts (not race split), white road-running shoes. White AirPods — one in ear, one out or case visible. Premium fitness watch on wrist (Ultra-class). Phone in hand or arm band ok. NO fleece vest, NO Patagonia vest, NO vest, NO MacBook.",
    "regina":     "Dark athletic shorts, simple tee, trainers — still, minimal.",
    "diana":      "Black leggings or shorts, fitted dark top, trainers — goth-athletic, red lips.",
    "terry":      "Understated yoga-athletic — fitted capris or shorts, neutral quality top, trainers. Moves better than she looks — surprise efficiency, no tote.",
    "vera":       "Trail shorts, tee, trainers — soft traveller athletic.",
    "camille":    "Maintenance run — plain shorts, boring tee (not silk), flat trainers. Not thrilled; beach-body duty. Playing card in pocket ok. No 2CV in frame.",
    "nina":       "Dark leggings, fitted top, trainers — journalist off-duty.",
    "olga":       "Understated leggings, dark top, trainers — upright posture even running.",
    "sofia":      "Black athletic top, fitted shorts or leggings, trainers. Silver crescent necklace, blue woven bracelet on left wrist. Sand on bare feet in warm climates; shoes in cold/North — never barefoot in rain.",
    "rosa":       "Black athletic leggings or shorts, fitted dark tee, trainers — blazer OFF, gold chains stay on. No bikini on urban run.",
    "carmela":    "Fitted athletic shorts, black sports top, trainers — three gold chains, large hoops. Fur jacket OFF while running.",
    "celine":     "Understated run kit — dark leggings or tailored shorts, silk-touch tee or fine cotton top, trainers. One sculptural gold earring. Camel coat OFF.",
    "yuki":       "Black leggings or shorts, Slayer band tee, black boots or trainers. Silver rings, festival wristbands on left wrist.",
    "cleo":       "Timeless linen trousers or ankle track pants, plain linen tee, simple trainers. Light cloak OFF while moving. Hair up or covered — face NEVER visible.",
}

# Maghreb/TR — keep character identity but more coverage (replaces short shorts / bra-only)
CHARACTER_RUN_OUTFIT_MAGHREB = {
    "alessandra": "Ankle-length leggings or long track pants, long-sleeve technical top, trail runners, sports watch. No short shorts.",
    "ingrid":     "Long leggings or track pants, long-sleeve fitted top, trail runners. No leather on body.",
    "yosra":      "Loose cotton trousers, long-sleeve light cotton t-shirt (olive or grey), trainers — walk-jog, not sprint. NO Leica, NO camera.",
    "amber":      "Long lightweight track pants, long-sleeve linen tee, trainers, aviators — still coyote-nimble stride.",
    "ana":        "Ankle leggings, fitted long-sleeve top, trainers. Gold anklet if ankles visible.",
    "maya":       "Ankle leggings, long-sleeve training top, trainers — no swimwear.",
    "metka":      "Ankle leggings, long-sleeve athletic top, trail runners — no bikini.",
    "kelek":      "1950s modest athletic (gym-class coverage — still sport, not formal): calf-length knit track pants or pedal pushers, short-sleeve knit top (not blouse), white canvas sneakers, optional headband. Red lips, gold hoops. NO interwar field dress, NO modern leggings. Compass on belt ok.",
    "naomi":      "Ankle leggings, long-sleeve top, trainers — minimal gold only. Still normal competent run, not lustlos.",
    "thea":       "Ankle leggings, long-sleeve linen tee, trainers, sunglasses — still contemptuous but she finishes.",
    "maria":      "Ankle leggings, long-sleeve dark top, trainers, gold earrings — enthusiasm unchanged.",
    "isabella":   "Ankle leggings, long-sleeve fitted top, trainers, gold bracelet — still body-as-asset focus.",
    "zara":       "Ankle leggings, long-sleeve tee, sneakers — normal traveller run.",
    "stacy":      "Ankle leggings, long-sleeve preppy tee, trainers — still upbeat HS-athlete vibe.",
    "tasha":      "Her skimpy minimum: fitted crop + ankle leggings, trainers — still minimal vs others. Gold hoops.",
    "diaz":       "Long-sleeve athletic top, ankle leggings, sneakers — off duty, covered.",
    "camille":    "Ankle leggings, long-sleeve tee, trainers — still reluctant chore face.",
    "terry":      "Ankle leggings, fitted long-sleeve top, trainers — still moves too well.",
    "quinn":      "Black ankle leggings, long-sleeve technical top, trainers — discipline unchanged.",
    "elena":      "Baggy ankle joggers or loose trousers, oversized tee, wrong cheap trainers — still unprofessional, just covered.",
    "lyra":       "Long loose linen dress, flat sandals — lustlos shuffle, no athletic kit. Gold jewelry ok.",
    "sofia":      "Ankle leggings, long-sleeve athletic top, trainers — bracelet and necklace stay. Covered feet.",
    "rosa":       "Ankle leggings, long-sleeve dark top, trainers — gold chains ok, still no blazer.",
    "carmela":    "Ankle leggings, long-sleeve fitted top, trainers — chains and hoops, covered.",
    "celine":     "Ankle leggings, long-sleeve fine top, trainers — earring ok.",
    "yuki":       "Ankle leggings, long-sleeve black top, trainers — wristbands stay.",
    "jade":       "Ankle leggings, long-sleeve athletic top, trail runners — red rag in pocket ok.",
    "katja":      "Ankle leggings, long-sleeve top, trail shoes — BMW-practical, covered.",
    "ingrid":     "Ankle leggings, long-sleeve fitted top, trail runners.",
    "alessandra": "Ankle-length leggings, long-sleeve technical top, trail runners.",
    "ana":        "Ankle leggings, long-sleeve top, trainers. Gold anklet if ankles visible.",
    "bianca":     "Ankle leggings, long-sleeve top, trainers.",
    "diana":      "Ankle leggings, long-sleeve dark top, trainers — red lips.",
    "conrad":     "Long track pants or ankle leggings, long-sleeve tee, trainers.",
    "chad":       "Long track pants, light grey/white long-sleeve tee, running shoes, white AirPods one ear, premium fitness watch. Phone ok — NO vest, NO Patagonia, NO MacBook.",
    "djordje":    "Long track pants, long-sleeve linen tee, trail runners.",
    "luca":       "Ankle leggings or long trail pants, long-sleeve tee, trail runners.",
    "maya":       "Ankle leggings, long-sleeve training top, trainers.",
    "kay":        "Ankle leggings, long-sleeve top, trail runners.",
    "kelek":      "1950s modest athletic: calf-length knit pants or pedal pushers, short-sleeve knit top, canvas sneakers — sport not formal. Red lips, gold hoops.",
    "mila":       "Ankle leggings, long-sleeve band tee, trainers.",
    "nina":       "Ankle leggings, long-sleeve top, trainers.",
    "olga":       "Ankle leggings, long-sleeve dark top, trainers.",
    "regina":     "Ankle leggings, long-sleeve tee, trainers.",
    "sigrid":     "Ankle leggings, long-sleeve top, trail runners.",
    "tammy":      "Ankle leggings, long-sleeve tank, cheap sneakers.",
    "vera":       "Ankle leggings, long-sleeve tee, trainers — red thread bracelet on left wrist.",
    "werra":      "Long trail pants, long-sleeve dark tee, trail shoes.",
    "yosra":      "Loose cotton trousers, long-sleeve light cotton t-shirt (olive or grey), trainers — walk-jog. NO Leica, NO camera.",
    "cleo":       "Loose linen trousers, long-sleeve linen top, trainers — face never shown.",
}

# going_for_a_run — attitude/body (outfit via CHARACTER_RUN_OUTFIT)
CHARACTER_RUN_ACTIVITY_PROFILE = {
    "elena": (
        "ELENA RUN ENERGY (mandatory): She is NOT a runner. Jogging because the map said so or "
        "the hostel common room suggested it — zero training vibe. Short shuffle steps, slouch, "
        "arms too low, tangled earbuds or one earbud in. NOT mid-effort athlete, NOT grit. "
        "Bored, unbothered, slightly annoyed at herself. Pale skin, platinum bob loose — never slicked athlete hair."
    ),
    "lyra": (
        "LYRA RUN ENERGY (mandatory): Especially lustlos — she does not do sport; this is absurd to her. "
        "Slow reluctant shuffle, shoulders down, could stop any second. Finds it faintly amusing and "
        "completely pointless. NOT disciplined, NOT effort-face, NOT endorphin glow. "
        "Wine glass in hand OR just set down on a wall nearby — optional empty glass between fingers ok. "
        "Looks back over shoulder with quiet amusement — not flirting, not performing fitness."
    ),
    "stacy": (
        "STACY RUN ENERGY (mandatory): Happy preppy — still has high-school sport in the legs. "
        "Bright, open, almost surprised she's enjoying it. Converse slap, scrunchie on wrist, genuine grin. "
        "NOT elite pro, NOT grim — cheerful traveller jog."
    ),
    "metka": (
        "METKA RUN ENERGY (mandatory): 20km would bore her — easy cruise tempo, breathing barely changes. "
        "Could go faster; doesn't bother. Suunto on wrist. Slight superiority — surface is louder than depth, "
        "running is still too loud but manageable."
    ),
    "quinn": (
        "QUINN RUN ENERGY (mandatory): Iron discipline — early-morning operational run. "
        "No headphones, no phone, no wasted motion. Scans the route once; never again. "
        "NOT effort-face for show — calm locked pace. Female Bourne maintenance, not a fun jog."
    ),
    "camille": (
        "CAMILLE RUN ENERGY (mandatory): Not begeistert — beach-body maintenance she resents slightly. "
        "Does it anyway, unhurried Mediterranean pragmatism. NOT smiling at the run; tolerated chore. "
        "Still moves well — Epona road grace without enthusiasm."
    ),
    "tasha": (
        "TASHA RUN ENERGY (mandatory): Body must stay fit — practical, almost clinical focus. "
        "Skimpy kit on purpose. NOT laughing on this one; checking the work. "
        "Still warm face but run is duty — LA beach-body economics."
    ),
    "diaz": (
        "DIAZ RUN ENERGY (mandatory): Off duty but cop never off — alert scan even jogging. "
        "Fit is professional requirement. Controlled pace, gold hoops, slight smirk possible. "
        "NOT tourist jog — street-aware, perimeter habit."
    ),
    "terry": (
        "TERRY RUN ENERGY (mandatory): Fitter than you'd think — eight years hot yoga shows. "
        "Easy pace that deceives; long back, precise posture mid-stride. Surprise again. "
        "Early smile anyway — run is not suffering. No tote, no gloves."
    ),
    "amber": (
        "AMBER RUN ENERGY (mandatory): Coyote bond — real wild coyote running with her, same unhurried pace "
        "(beside her or a few steps ahead). They seem to know each other; quiet trickster companions. "
        "She glances over — soft amused smile, relaxed, NOT startled, NOT fleeing, NOT chasing prey. "
        "Coyote clearly wild, not a dog, no collar. Aviators, quick light feet. NOT gym-bro."
    ),
    "naomi": (
        "NAOMI RUN ENERGY (mandatory): Läuft normal — competent maintenance jog, unhurried luxury-athletic. "
        "Not trying to impress; body works, mind elsewhere. Minimal gold only. NOT beach bikini on this shot."
    ),
    "thea": (
        "THEA RUN ENERGY (mandatory): Lustlos — default slight annoyance, does it anyway. "
        "Pushes through without joy; Spartan duty not pleasure. Sunglasses on. NOT smiling at the run. "
        "Strong legs still — beer-crate strength shows."
    ),
    "maria": (
        "MARIA RUN ENERGY (mandatory): Hat Bock — rare engaged run. Andalusian fire under control; "
        "actually in the stride, not performing. Still composed, not influencer cheer — deep yes in the body."
    ),
    "isabella": (
        "ISABELLA RUN ENERGY (mandatory): Sehr engagiert — this is physical market-value maintenance. "
        "Assessing her own form while running; bracelet on wrist. Strategic body, not fun-jog. "
        "Espresso after, not during. NOT careless tourist."
    ),
    "zara": (
        "ZARA RUN ENERGY (mandatory): Läuft normal — easy traveller jog, already moved on mentally. "
        "Gold hoops, braids moving, crossbody bag bounce ok. NOT elite athlete, NOT lustlos — capable and unbothered."
    ),
    "alessandra": (
        "ALESSANDRA RUN ENERGY (mandatory): Real endurance athlete — efficient stride, sports watch, "
        "knee scrape ok. NOT glam jog, NOT tourist pace. Trail discipline, not performing for camera."
    ),
    "ana": (
        "ANA RUN ENERGY (mandatory): Natural athlete warmth — Oxum body maintenance, unhurried competence. "
        "Gold anklet LEFT ankle if legs visible. NOT influencer sprint face, NOT grimacing effort."
    ),
    "ingrid": (
        "INGRID RUN ENERGY (mandatory): Strong trail jog — leather jacket OFF, no nightclub glam on this shot. "
        "Direct gaze optional but NOT posing. Functional power, not fashion run."
    ),
    "katja": (
        "KATJA RUN ENERGY (mandatory): BMW-road athletic — efficient German outdoor pace, practical focus. "
        "NOT yacht glam, NOT stiletto energy. Gets it done."
    ),
    "jade": (
        "JADE RUN ENERGY (mandatory): Desert mechanic fitness — practical, unglamorous, red shop rag in pocket ok. "
        "NO cowboy boots. Honest working-body jog."
    ),
    "werra": (
        "WERRA RUN ENERGY (mandatory): Forest-quiet stride — observer pace, minimal drama. "
        "NOT social media run, NOT city influencer. She runs like she belongs on the path."
    ),
    "sigrid": (
        "SIGRID RUN ENERGY (mandatory): Nordic outdoor athletic — steady HEL energy, not fashion shoot. "
        "NOT one-shoulder bikini on run (that is swim only). Calm capable trail jog."
    ),
    "maya": (
        "MAYA RUN ENERGY (mandatory): Sporty Spice maintenance — training body, normal athlete jog. "
        "Goggles on forehead ok. NOT cargo shorts on run, NOT influencer cheer — competent."
    ),
    "kay": (
        "KAY RUN ENERGY (mandatory): Marine-athletic easy cruise — orca-logo top ok, natural water-body fitness. "
        "NOT luxury yacht posing on this shot. Unhurried strong stride."
    ),
    "yosra": (
        "YOSRA RUN ENERGY (mandatory): Easy walk-jog — unhurried Marseille pace, hands free. "
        "NO Leica, NO camera gear. NOT race kit, NOT sprint grimace. Curious eyes on the city while moving."
    ),
    "bianca": (
        "BIANCA RUN ENERGY (mandatory): Reads the room even while running — confident, managed curves in motion. "
        "NOT performing for camera, NOT tourist panic. Smooth social-athletic."
    ),
    "diana": (
        "DIANA RUN ENERGY (mandatory): Goth-athletic elsewhere gaze — red lips, pale skin, calm stride. "
        "NOT mall-goth, NOT cheerful resort jog. Body works; mind is not in the race."
    ),
    "conrad": (
        "CONRAD RUN ENERGY (mandatory): Male — tall Northern European easy jog, symmetrical cold handsome, "
        "polo or tee. NOT pressed suit, NOT posing. Unhurried maintenance."
    ),
    "chad": (
        "CHAD RUN ENERGY (mandatory): Male — Vuori/Nike-bro content jog, NOT real training. NO vest. "
        "BAD RUN FORM (mandatory): heel striker, influencer shuffle — not efficient. Phone-arm raised or "
        "watch-check beat: he slows to almost standing, head down at lit fitness watch (pace, HR, rings). "
        "White AirPods one ear. Watch face clearly premium. Phone/selfie ok second. "
        "Golden hour for the post. NOT zen, NOT athlete grit, NOT proper stride. Landscape = backdrop for metrics."
    ),
    "djordje": (
        "DJORDJE RUN ENERGY (mandatory): Male — Balkan 40s steady jog, salt-pepper beard, tortoiseshell on strap ok. "
        "NOT young influencer sprint. Grounded road rhythm."
    ),
    "luca": (
        "LUCA RUN ENERGY (mandatory): Traveller trail jog — faded tee energy, easy pace. "
        "Barefoot ONLY if desert path in spec; otherwise trainers. NOT staged adventure bro."
    ),
    "mila": (
        "MILA RUN ENERGY (mandatory): Festival-scene athletic — band tee, wristbands, music-road legs. "
        "NOT corporate gym. Young road-tour maintenance jog."
    ),
    "nina": (
        "NINA RUN ENERGY (mandatory): Journalist off-duty — observant while jogging, mental notebook open. "
        "NOT influencer performance. Quiet competent pace."
    ),
    "olga": (
        "OLGA RUN ENERGY (mandatory): Upright posture even mid-stride — composed, minimal expression. "
        "NOT slouch tourist, NOT grimacing athlete. Disciplined body."
    ),
    "regina": (
        "REGINA RUN ENERGY (mandatory): Still, minimal — quiet efficient jog, no drama. "
        "NOT luxury exploit posing, NOT nightclub energy on this shot."
    ),
    "tammy": (
        "TAMMY RUN ENERGY (mandatory): Cheap-sneaker tourist jog — unpretentious, actually trying a bit. "
        "NOT glam, NOT elite. Honest traveller legs."
    ),
    "vera": (
        "VERA RUN ENERGY (mandatory): Soft traveller athletic — red thread bracelet on left wrist always, "
        "red nails fingers and toes maintained. Reads the city while running; NOT victim symbolism, NOT performance."
    ),
    "kelek": (
        "KELEK RUN ENERGY (mandatory): 1950s athletic stride — knit shorts or pedal pushers, simple sport "
        "top, canvas sneakers, easy mid-century jog rhythm. Red lips, gold hoops. NOT interwar formal walk, "
        "NOT Lycra sprinter, NOT 1980s tracksuit, NOT pin-up costume. Coastline in the body even on city asphalt."
    ),
    "sofia": (
        "SOFIA RUN ENERGY (mandatory): Sea-devotee athletic maintenance — easy Iemanjá body, sun-squint ok. "
        "Sand on bare feet in warm climates only. NOT strategic dating run — honest movement. "
        "GOLDIE (mandatory on every Sofia run): Goldie — smooth-coated reddish-tan Podenco-Terrier mix, "
        "rose ears always folded/floppy (never erect), red collar — runs beside Sofia at easy pace, never posed. "
        "Tongue out, happy dog jog. NOT a coyote, NOT a different breed, NOT absent."
    ),
    "rosa": (
        "ROSA RUN ENERGY (mandatory): Already decided — intense direct energy even jogging. "
        "Turns gold ring once before the stride settles ok. Gold chains stay. Bold dark red or black nails fresh. "
        "NOT bikini, NOT nightclub neon on this shot."
    ),
    "carmela": (
        "CARMELA RUN ENERGY (mandatory): Naples full presence — runs like the city is watching and she approves. "
        "Three gold chains, hoops, red nails perfect never chipped. NOT weak, NOT apologetic. Siren bones under the stride."
    ),
    "celine": (
        "CÉLINE RUN ENERGY (mandatory): Parisian private warmth — unhurried brasserie-adjacent jog. "
        "One sculptural gold earring. NOT fussy, NOT performing fitness influencer. Decided how much effort to show."
    ),
    "yuki": (
        "YUKI RUN ENERGY (mandatory): Storm-front stillness in motion — Slayer tee, festival wristbands, "
        "precise eyeliner. NOT smiling cheerleader. Present like weather approaching."
    ),
    "cleo": (
        "CLEO RUN ENERGY (mandatory): The Witness — BACK TO CAMERA ALWAYS, face NEVER visible. "
        "Slow unhurried jog at historical threshold edge only (ruins, battlefield perimeter, forgotten place). "
        "NOT tourist stream, NOT selfie run. Both hands empty. Place is the subject; she is proof someone passed through."
    ),
}

_PROFILE_ACTIVITIES = frozenset({
    "kajak_sup", "surf_paddle", "beach_walk_distance", "muscheln_sammeln", "kayak_entry",
})

_GENERIC_SUP_OUTFIT = (
    "SUP OUTFIT: light outdoor swimwear — bikini, one-piece swimsuit, "
    "or bikini top with boardshorts. Barefoot on board; outdoor sport sandals only at shore. "
    "No street clothes, wetsuit, heels, or hiking boots."
)

def _extract_beach_from_spec(char_spec: str) -> str:
    """Pull BEACH / BEACH (…) / WARM WEATHER/BEACH block from CHARACTER_SPECS."""
    if not char_spec:
        return ""
    import re
    _skip = (
        "not on the beach", "not really a beach", "is not on the beach",
        "terrace above the beach", "she is on a yacht. that is her beach",
    )

    def _norm_block(raw: str) -> str:
        return " ".join(ln.strip() for ln in raw.strip().splitlines() if ln.strip())

    blocks: list[str] = []
    for pat in (
        r"BEACH(?:\s*/\s*SWIM)?(?:\s*\([^)]*\))?\s*:\s*(.+?)(?=\n(?:[A-Z][A-Z0-9 /&-]*:|VOID/|TERRITORY:|ORIENTATION:|SIGNATURE|SETTING:|NIGHTLIFE|EXPLOIT|DIVINE|WORK:|SUP:|WARDROBE|EXPRESSION|PHOTOGRAPHY|IN THIS))",
        r"WARM WEATHER/BEACH[^:]*:\s*(.+?)(?=\n(?:[A-Z][A-Z0-9 /&-]*:|VOID/|TERRITORY:))",
    ):
        for m in re.finditer(pat, char_spec, re.DOTALL):
            text = _norm_block(m.group(1))
            if text and not any(s in text.lower() for s in _skip):
                blocks.append(text)
    return blocks[-1] if blocks else ""


def get_character_water_outfit(character_key: str) -> str:
    """Merged BEACH spec + CHARACTER_SWIM_OUTFIT for SUP and beach water activities."""
    swim = (CHARACTER_SWIM_OUTFIT.get(character_key) or "").strip()
    beach = _extract_beach_from_spec(CHARACTER_SPECS.get(character_key, ""))
    if swim and beach:
        return f"{swim} | BEACH SPEC: {beach}"
    return swim or beach


def get_sup_outfit_override(character_key: str) -> str:
    body = get_character_water_outfit(character_key)
    if not body:
        return _GENERIC_SUP_OUTFIT
    return (
        "SUP OUTFIT (MANDATORY — character BEACH/SWIM spec; overrides generic kajak_sup text, "
        "reference-image street clothes, prestige/noir wardrobe, and any default sport bikini): "
        f"{body} "
        "Barefoot on SUP. No cover-up, coat, blazer, or gloves hiding swim on the board."
    )


def get_character_water_outfit_override(character_key: str) -> str | None:
    body = get_character_water_outfit(character_key)
    if not body:
        return None
    return (
        "SWIM/BEACH OUTFIT (MANDATORY — overrides reference image, urban wardrobe, and BEACH LIGHT defaults): "
        f"{body}"
    )


_WATER_ACTIVITY_CLOTHING_RULES: dict[str, str] = {
    "sigrid": (
        "CLOTHING — SIGRID HEL ASYMMETRY (MANDATORY on beach and SUP): one-shoulder bikini top or one-shoulder one-piece — "
        "single strap on one side, other shoulder bare. Ice-grey or black. One gold stud, other ear bare. "
        "NOT a symmetrical two-strap triangle bikini. NOT linen sundress. NOT smart-casual day-trip clothes."
    ),
    "diana": (
        "CLOTHING — DIANA GOTH-ELEGANT SUP (MANDATORY): high-neck black one-piece deep open back OR "
        "high-waist black bikini thin straps — black, charcoal, plum, or ink-navy. Red lips lacquer. "
        "KINKY-SUBTLE ritual elegance — NOT generic sport triangle bikini, NOT mall-goth, NO harness/latex/fishnets. "
        "Opera gloves OFF on board; palm scar may show."
    ),
    "lyra": (
        "CLOTHING — LYRA ARIADNE SUP (MANDATORY): one-shoulder bikini or low-back one-piece — "
        "white, wine-red, burgundy, or black. NOT generic symmetrical sport swimwear."
    ),
    "terry": (
        "CLOTHING — TERRY SUP (MANDATORY): low-back one-piece, high-cut legs, thin-strap halter, or minimal triangle — "
        "black, navy, deep red, or muted wine. KINKY-SUBTLE calibrated cut — not generic sport bikini."
    ),
}


_SWIM_OUTFIT_ACTIVITIES = frozenset({
    "kajak_sup", "beach_walk_distance", "muscheln_sammeln", "surf_paddle",
})

# Maghreb + Turkey — no swimwear/bikini in cities/public; swim only on water/beach activities
MAGHREB_TR_MODEST_COUNTRIES = frozenset({"MA", "TN", "DZ", "LY", "EG", "TR"})
_MAGHREB_MALE_CHARS = frozenset({"luca", "chad", "conrad", "djordje", "driver_pov", "driver_van"})
# Coastal *cities* (Rabat, Tunis, Casablanca) are not beaches — terrain_type=coastal is misleading
_URBAN_PLACE_TYPES = frozenset({"city", "medium_town", "small_town", "village", "pplc", "ppla"})


def is_urban_place(place: dict) -> bool:
    return (place.get("place_type") or "").lower() in _URBAN_PLACE_TYPES


def requires_modest_wardrobe(place: dict) -> bool:
    return (place.get("country_code") or "").upper() in MAGHREB_TR_MODEST_COUNTRIES


def allows_swimwear_at_place(place: dict, activity_key: str | None = None) -> bool:
    """Swim/bikini OK only on water activities — not because the city sits on the coast."""
    if activity_key in _SWIM_OUTFIT_ACTIVITIES or activity_key == "beach_walk_distance":
        return True
    if activity_key:
        return False
    if is_urban_place(place):
        return False
    if not requires_modest_wardrobe(place):
        return (place.get("terrain_type") or "").lower() == "coastal"
    return False


def get_maghreb_tr_modest_override(
    character_key: str, place: dict, activity_key: str | None = None
) -> str | None:
    if not requires_modest_wardrobe(place) or allows_swimwear_at_place(place, activity_key):
        return None
    if character_key in _MAGHREB_MALE_CHARS or character_key == "goldie":
        return None
    _ref_note = ""
    if character_key in BIKINI_CHARS or CHARACTER_SWIM_OUTFIT.get(character_key):
        _ref_note = " Ignore reference-image bikini/swimwear and BEACH/SWIM spec — not for this shot."
    if activity_key == "going_for_a_run":
        _run = get_run_outfit_override(character_key, place, activity_key)
        if _run:
            return _run + _ref_note
    if character_key == "yosra":
        return (
            "MODEST YOSRA (MAGHREB/TR — mandatory): oversized olive or grey linen shirt BUTTONED "
            "or mostly closed — NOT open over bikini. Loose cotton trousers, sandals or bare feet. "
            "Leica M6 on strap, Eye of Ra on bag. NO bikini, NO swimwear visible in public."
            + _ref_note
        )
    if activity_key in {
        "newspaper_cafe", "cafe_terrace", "menu_study", "kiosk_stop", "market_browse",
        "harbour_walk", "postcard_write", "reisebuero_inside", "reisebuero_window",
        "cigarette_roll", "photo_lab", "cinema_program",
    }:
        return (
            "MODEST CAFÉ/CITY (MAGHREB/TR — mandatory): lightweight blouse or shirt with sleeves "
            "(three-quarter or long preferred), linen trousers or midi skirt, sandals. "
            "Shoulders and chest covered — no bikini, tank-only, string top, or swimwear."
            + _ref_note
        )
    if character_key == "amber":
        return (
            "MODEST DAY (MAGHREB/TR — mandatory): linen shirt or light blouse with sleeves, "
            "lightweight trousers or midi skirt, aviator sunglasses, sandals. "
            "No bikini, no tank-only, no denim cutoffs in public."
            + _ref_note
        )
    return (
        "MODEST DAY (MAGHREB/TR — mandatory): lightweight covered day wear — blouse or shirt with sleeves, "
        "trousers or long skirt, no bikini, no swimwear, no revealing sport kit in public."
        + _ref_note
    )


def get_run_outfit_override(
    character_key: str, place: dict, activity_key: str | None = None
) -> str | None:
    """Character-specific going_for_a_run kit; Maghreb/TR uses covered variants."""
    if activity_key != "going_for_a_run":
        return None
    if character_key in _MAGHREB_MALE_CHARS:
        return None
    _maghreb = requires_modest_wardrobe(place) and not allows_swimwear_at_place(place, activity_key)
    if _maghreb:
        spec = CHARACTER_RUN_OUTFIT_MAGHREB.get(character_key) or CHARACTER_RUN_OUTFIT.get(character_key)
        if spec:
            return f"RUN OUTFIT (MAGHREB/TR — mandatory, character): {spec}"
        return (
            "RUN OUTFIT (MAGHREB/TR — mandatory): ankle-length leggings or long track pants, "
            "long-sleeve top, trainers. No sports-bra-only, no short shorts."
        )
    spec = CHARACTER_RUN_OUTFIT.get(character_key)
    if spec:
        return f"RUN OUTFIT (MANDATORY — character): {spec}"
    return None


def is_non_swim_context(place: dict, activity_key: str | None = None) -> bool:
    """City café, run, main in urban place — never bikini from reference."""
    if activity_key in _SWIM_OUTFIT_ACTIVITIES or activity_key == "beach_walk_distance":
        return False
    if activity_key:
        return True
    return is_urban_place(place) or (place.get("terrain_type") or "") in {"flatland"}


def get_city_street_outfit_override(
    character_key: str, place: dict, activity_key: str | None = None
) -> str | None:
    if not is_non_swim_context(place, activity_key):
        return None
    if character_key in _MAGHREB_MALE_CHARS or character_key == "goldie":
        return None
    if requires_modest_wardrobe(place):
        return get_maghreb_tr_modest_override(character_key, place, activity_key)
    _ref = ""
    if character_key in BIKINI_CHARS or CHARACTER_SWIM_OUTFIT.get(character_key):
        _ref = " Ignore reference-image bikini/swimwear."
    if activity_key == "going_for_a_run":
        _run = get_run_outfit_override(character_key, place, activity_key)
        if _run:
            return _run + _ref
        return (
            "CITY/RUN OUTFIT: leggings or running shorts, fitted top with coverage, trainers — not swimwear."
            + _ref
        )
    if is_urban_place(place) or activity_key:
        if character_key == "yosra":
            return (
                "CITY OUTFIT (YOSRA): olive/grey linen shirt closed over trousers — NOT open shirt over bikini."
                " Leica on strap. No swimwear."
                + _ref
            )
        return (
            "CITY/STREET OUTFIT: practical day clothes — shirt or blouse, trousers or jeans, "
            "no bikini, no swimwear in public."
            + _ref
        )
    return None


def get_activity_clothing_rule(character_key: str, activity_key: str, place: dict | None = None) -> str:
    """Character BEACH/SWIM specs on water activities; modest/city rules elsewhere."""
    if place and is_non_swim_context(place, activity_key):
        if requires_modest_wardrobe(place) and not allows_swimwear_at_place(place, activity_key):
            if activity_key == "going_for_a_run":
                return (
                    "CLOTHING: Modest running kit for Maghreb/Turkey — long leggings or track pants, "
                    "long-sleeve top, no sports bra-only, no short shorts."
                )
            return (
                "CLOTHING: Modest dress for Maghreb/Turkey public space — covered shoulders and torso, "
                "no bikini, no swimwear, no open shirt over bikini. Reference swim outfit ignored."
            )
        if is_urban_place(place) or activity_key:
            return (
                "CLOTHING: Street/city day wear — no bikini, no swimwear. "
                "Reference image and BEACH/SWIM spec do not apply to this shot."
            )
    if activity_key in _SWIM_OUTFIT_ACTIVITIES:
        if character_key in _WATER_ACTIVITY_CLOTHING_RULES:
            return _WATER_ACTIVITY_CLOTHING_RULES[character_key]
        if get_character_water_outfit(character_key):
            return (
                "CLOTHING: Obey MANDATORY SWIM/BEACH OUTFIT override exactly — character BEACH/SWIM spec. "
                "One-shoulder, stripes, prints, goth-elegant cuts, etc. when specified. "
                "Do NOT substitute generic sport bikini or reference street clothes."
            )
    return ""

DRY_ONLY_BLOCK = ["caught_in_rain"]
WATER_ONLY_SHOTS = ["wet_skin", "arch_back", "emerging_from_water", "water_exit", "towel_wrap", "beach_blanket", "yacht_bow"]
DRY_ONLY_BLOCK = ["caught_in_rain"]  # Blocked in desert and dry hot climates  # Only in Mediterranean/desert/tropical/Southern US summer
COLD_BLOCK_TERRAIN = ["mountain"]  # Never feel_the_heat in mountains
OUTDOOR_ONLY_SHOTS = ["muscle_flex", "jeep_doorframe", "hood_lean", "field_repair", "roadside_dusk"]  # Never in pure city/flatland contexts

URBAN_ONLY_SHOTS = [
    "slicked_back", "choker_close", "window_reflection",
    "nylon_stiletto", "miniskirt_city", "miniskirt_bend", "thigh_high_boots",
    "stiletto_detail", "latex_editorial", "noir_femme",
    "luxury_exploit", "luxury_yacht", "luxury_car", "femme_fatale",
    "choker_close", "sheer_top", "window_light",
]

def pick_exploit_sequence(character_key: str, n: int, terrain_type: str = "", place: dict = None) -> list:
    if place is None: place = {}
    repertoire = set(EXPLOIT_REPERTOIRE.get(character_key, []))
    is_nature = terrain_type in ["mountain", "lake", "desert", "coastal", "hills"]
    is_urban = terrain_type in ["flatland"] or (place.get("place_type","") or "").lower() in ["city", "medium_town"]
    if is_nature:
        repertoire = repertoire - set(URBAN_ONLY_SHOTS)
    if is_urban:
        repertoire = repertoire - set(OUTDOOR_ONLY_SHOTS)
    # feel_the_heat only in hot climates — blocked in mountain/cold
    if terrain_type in ["mountain"] or place.get("country_code","") in ["NO","SE","FI","IS","DK","AT","CH"]:
        repertoire = repertoire - set(HOT_ONLY_SHOTS)
    if not repertoire:
        return []

    all_categories = ["ass", "cleavage", "legs", "face", "body", "candid", "luxury"]
    body_focus = CHARACTER_BODY_FOCUS.get(character_key, [])
    # Prioritize char's body focus categories, then shuffle the rest
    focus_cats = [c for c in body_focus if c in all_categories]
    other_cats = [c for c in all_categories if c not in focus_cats]
    random.shuffle(other_cats)
    category_order = focus_cats + other_cats
    selected = []
    for cat in category_order:
        if len(selected) >= n:
            break
        cat_shots = [s for s in EXPLOIT_CATEGORIES.get(cat, []) if s in repertoire]
        if cat_shots:
            selected.append(random.choice(cat_shots))

    remaining = [s for s in repertoire if s not in selected]
    while len(selected) < n and remaining:
        pick = random.choice(remaining)
        selected.append(pick)
        remaining.remove(pick)

    return selected[:n]

EXPLOIT_FRAMING = """
FRAMING: Character slightly more prominent than regular hero shots,
but NEVER more than 50-60% of frame. Location always visible and identifiable.
Upper 15% calm sky or background. Portrait orientation 800x1200.
STYLE: Helmut Newton editorial — power, elegance, high contrast light acceptable.
Mario Testino when warm. Always high fashion, never cheap.
CLOTHING: Follow character outfit specs — asymmetry, one-shoulder, and character-specific swim cuts allowed when defined for this character.
"""

CHARACTER_STYLE = {
    "olga":      "Peter Lindbergh meets Helmut Newton — European severity, quiet authority.",
    "nina":      "Peter Lindbergh — rain, grey light, Central European authenticity.",
    "mila":      "Anders Petersen — raw, grain, intimate Balkan street energy.",
    "sigrid":    "Harri Peccinotti — clean Scandinavian lines, minimal color palette, graphic.",
    "quinn":     "Michael Mann — urban night, wet asphalt, operational precision.",
    "isabella":  "Slim Aarons meets tropical luxury — warm light, old money, no effort.",
    "maria":     "Carlos Saura — Andalusian light, deep shadow, earthy warmth.",
    "rosa":      "Diego Luna cinematography — Mexican urban night, neon, edge.",
    "vera":      "Boris Mikhailov meets Agnès Varda — warm grain, floral against stone, women who have already survived something.",
    "camille":   "Raymond Depardon in Marseille — warm grain, port light, people who don't perform for cameras.",
    "carmela":   "Nan Goldin in Naples — warm night, neon, excess without apology.",
    "oksana":    "Terry Richardson meets Russian editorial — excess, gold, direct.",
    "yuki":      "Daido Moriyama — high contrast, grain, Tokyo night street photography.",
    "celine":    "Henri Cartier-Bresson — Paris night, decisive moment, warm bistro light.",
    "ana":        "Herb Ritts — warm light, body as landscape, natural but charged. Curves celebrated.",
    "naomi":      "Guy Bourdin — surreal, cold, perfect, slightly unsettling. Luxury with an edge.",
    "valentina":  "85mm equivalent, camera slightly above eye level, gentle tele compression. Atmospheric softness, muted colors: cream, beige, muted aqua. Moderate contrast. Quiet luxury editorial. Relaxed standing, looking sideways, not engaging camera. Architecture more important than person. Symmetry and vertical lines strongly emphasized. European wealth, not eroticism.",
    "sofia":      "Herb Ritts — natural Atlantic light, movement, salt, skin. Never posed.",
    "yosra":      "Peter Lindbergh — natural light, wind, movement, imperfection is the point.",
    "elena":      "Helmut Newton — hard shadows, urban night, body as monument.",
    "katja":      "Helmut Newton White Women series — elegance, tension, precision.",
    "alessandra": "Peter Lindbergh — altitude light, athletic form, honest and direct.",
    "ingrid":     "Peter Lindbergh — Nordic light, wind in hair, leather, motion. No artifice.",
    "jade":       "Richard Avedon western portraits — direct, karg, real.",
    "luca":       "Larry Clark meets surf editorial — lived-in, sun-damaged, beautiful without trying.",
    "regina":     "Helmut Newton — body as architecture, low angle, controlled.",
    "driver_pov": "William Eggleston — vernacular America, mundane objects charged with meaning. Rearview mirror: Saul Leiter.",
    "chad":       "Instagram editorial — polished, aspirational, slightly hollow. That is the point.",
    "diaz":       "William Eggleston meets Nan Goldin — neon signs, wet asphalt, difficult light.",
    "kay":        "Herb Ritts California — Pacific light, wet skin, beauty of a woman who stopped trying.",
    "maya":       "Herb Ritts — hard golden light, the contrast between ordinary face and extraordinary body.",
    "driver_van": "William Eggleston — the van as vernacular object. Parked, patient, loaded.",
    "stacy":      "Bruce Weber meets Slim Aarons — American summer, clean California light, unguarded optimism. Early 80s Preppy energy.",
    "charlotte":  "Helmut Newton City — power suits, wet London streets, she owns the pavement.",
    "thea":       "Henri Cartier-Bresson — decisive moment, candid, never posed. She would hate to know she was photographed.",
    "tammy":      "William Eggleston meets Nan Goldin — gas stations, diners, vernacular America. The beauty of places nobody photographs on purpose.",
    "lyra":       "Slim Aarons meets Nan Goldin — pleasure as a serious pursuit. Warm candlelight, soft focus strangers behind her.",
    "werra":      "Peter Lindbergh — austere, cold light, no flattery. Documentary of someone who has decided something.",
}

EXPLOIT_PROMPTS = {
    "back_to_camera": """
EDITORIAL SHOT: Character standing with back fully to camera — not walking, standing still.
Facing the view: sea, horizon, landscape, city below.
The back is the subject — shoulders, spine, hair, how she holds herself when nobody watches.
Natural posture, no tension. She does not know we are here.
If hair is long: loose, moved by wind or just resting on bare shoulders.
If wearing open back or thin straps: back skin visible naturally.
Location fills 65%+ of frame around and above her.
Shot from slightly below or at eye level. Medium distance — not close-up.
Soft light from front (facing her) creates rim light on her silhouette.
Kodak Portra warmth. This is the most honest shot we have of her.
""",
    "walk_away": """
EDITORIAL SHOT: She walks away from the camera — not performing, not posing. Going somewhere.
Shot from behind at low angle — her full figure moves through the frame, location opens up above her.
Natural hip movement, one foot slightly forward. She is absorbed in where she is going.
If wearing skirt or dress: fabric moves with her. Back-seam nylons visible naturally if worn — never with shorts, jeans, or swimwear.
If wearing white or light linen: backlight catches the fabric — silhouette reads editorially.
Subtle visible panty line through tight fabric if applicable — incidental, not staged.
City, landscape, or architecture fills the frame above and around her.
She does not know the camera is there. This is the shot where her absence is the presence.
""",
    "emerging_from_water": """
EDITORIAL SHOT: Character just stepped out of the water — ocean, lake, river.
Wet hair flat or pushed back. Water still streaming or dripping.
Bikini, wetsuit half-unzipped, or thin wet fabric. First step onto shore, dock, or rocks.
She is not posing — transitioning between two worlds. The water releases her reluctantly.
Shot from slightly below or at eye level. Hard light or golden backlight — water catches it.
This is her element. Land is the foreign place.
WATER_ONLY — only valid for coastal, lake, or river locations.
""",
    "water_exit": """
EDITORIAL SHOT: Character exiting the water — either climbing a boat ladder or dock steps, or pushing herself up over a pool or quay edge.
Two valid variants:
1. LADDER/STEPS — she climbs up a metal boat ladder or stone harbour steps. Arms working, back visible, water below. Shot from behind or slight side.
2. PUSH-UP EXIT — both hands flat on the pool edge or dock, arms fully extended, body lifting clear of the water in one controlled push. The moment she clears the surface.
Wet throughout — hair slicked, swimsuit or sporty bikini against the skin.
This is not a posed exit. This is the body doing something it has done many times.
Shot from slightly low or at water level — the exit is above the camera.
Hard light or strong backlight. Water surface visible below or behind.
WATER_ONLY — only valid for coastal, lake, pool, or river locations.
""",
    "hood_lean": """
EDITORIAL SHOT — JADE ONLY.
She leans over the open hood of her Camaro — arms braced on the engine bay edge, looking at something inside.
Worn denim cutoffs, old tank top, a smear of grease possible on forearm or collarbone.
Shot from the side or slight behind — long legs visible, back slightly arched from leaning forward.
Her face is in profile or turned slightly — focused, not posing. She is actually looking at the engine.
The car is not a prop. She knows every part of it.
Editorial framing — Helmut Newton meets roadside Americana. Hard directional sunlight preferred.
Location: desert roadside, mechanic yard, or open road shoulder — not a studio, not a city.
""",
    "window_silhouette": """
EDITORIAL SHOT — DIANA ONLY.
Night exterior: a hotel or apartment window, warm light from inside.
Her silhouette — barely recognizable, intentionally ambiguous — is visible through the glass or curtain.
She stands or moves. What she is doing is not fully clear. The curtain moves slightly.
No face visible. No skin shown explicitly — the silhouette does all the work.
Shot from outside, low angle or street level. Wet street or damp pavement below optional.
The city is around her — lit signs blurred in distance, rain possible.
This is the shot that exists between what happened and what comes next.
Helmut Newton composition — power through withholding.
""",
    "asymmetry_shot": """
EDITORIAL SHOT — SIGRID ONLY.
The Hel principle made visible: one side present, one half absent.
Blazer over one bare shoulder — the other shoulder covered. Or: shirt tucked on one side only. Or: one lapel open, one closed.
Never dramatic — subtle. As if one half of her is already elsewhere.
She stands at a window, a door, a corner — partly in light, partly in shadow.
One small gold stud earring. The other ear bare. The thin open half-ring on one finger.
Shot from slight distance — three-quarter. The asymmetry reads without explanation.
Stockholm or Copenhagen architecture behind — clean lines, grey light.
Harri Peccinotti framing — Scandinavian graphic precision. Nothing decorates what isn't there.
""",
    "jacket_draped": """
EDITORIAL SHOT — INGRID ONLY.
Leather motorcycle jacket draped over one shoulder or slung over her arm — she has taken it off after a long ride.
Fitted top, fully dressed. She stands beside her BMW motorcycle or at a roadside, helmet resting on the seat.
She looks out at the landscape or adjusts something on the bike. Not at the camera.
The jacket is present — it is the object of the shot, not her body.
Shot from medium distance — full body or three-quarter. Location behind.
Clean editorial framing. The jacket has been everywhere she has been.
""",
    "jeep_doorframe": """
EDITORIAL SHOT — KAY / JADE.
She sits or stands in the open doorframe of her Jeep Wrangler — one leg inside, one dangling out or braced on the step.
Door wide open. Engine off or idling — she is between somewhere and somewhere else.
Outfit: whatever she wore all day — shorts, tank or flannel, boots or bare feet.
Shot from outside at slight angle — the doorframe is the frame. Her body occupies it naturally.
She looks out at the view or down at the ground — not at camera. No posing. Just occupying the space.
Hard desert light or golden hour. Dust on the door panel. The Jeep has earned its marks.
""",
    "yacht_bow": """
EDITORIAL SHOT — NAOMI.
She stands at the bow of a yacht — hands on the railing or arms spread slightly, facing forward.
Wind moves her hair. Open water ahead, coastline or horizon behind.
Swimwear or light cover-up. The bow rises slightly from the swell.
Shot from below deck level or water level — she is above the camera, lit from above and behind.
She owns this. The sea is not scenery — it is hers.
Hard backlight — her silhouette against sky and water. Detail visible in face and body.
""",
    "mirror_pose": """
EDITORIAL SHOT — VALENTINA.
Full-length mirror — hotel room, dressing room, or boutique. She stands before it.
She looks at herself — not performing for us, assessing. Something about her outfit or her expression.
The mirror reflects part of the room — warm light, a chair, a window. Context without narrative.
She is dressed — elegantly, precisely. One adjustment happening or just finished.
Shot from the side — her profile and her reflection both visible. Two Valentinas.
Helmut Newton — the mirror shot is always about power, never about vanity.
""",
    "towel_wrap": """
EDITORIAL SHOT — SOFIA.
She stands at the waterline or just above — just out of the ocean, towel wrapped loosely around hips.
Nothing on top — arms raised slightly to adjust the towel or push hair back. Not posed.
Water still visible on skin. Hair wet and loose. Feet in wet sand or on warm rock.
Shot from slight distance — three-quarter or side. The ocean fills the frame behind her.
She is not looking at the camera. She is deciding whether to go back in.
Soft backlight from low sun — water catches it. Editorial, not glamour.
""",
    "rain_mac": """
EDITORIAL SHOT — CHARLOTTE.
Classic British mac — beige or olive, collar up, belt loosely tied. Rain.
She stands on a wet pavement or stone step — coat open slightly, wind catches the lapel.
Nothing underneath that we can confirm. That is the point.
Shot from slight low angle — puddle reflection possible. City or coastal town, grey sky.
She looks into the rain or past camera. Expression: a specific kind of English composure that contains everything.
This is the most British shot possible. It is also deeply elegant.
Helmut Newton in the rain — the mac is as much a garment as anything she owns.
""",
    "beach_blanket": """
EDITORIAL SHOT — ANA.
She lies on her front on a beach towel — elbows on the towel, chin in hands or head resting on forearms.
She looks sideways — past camera or at something nearby. Not posing. Just horizontal.
Bikini. Sand on skin at ankles and forearms. Sunglasses pushed up or beside her.
Shot from low angle beside her — her body along the lower third of frame, beach and water above.
Copacabana energy — not staging, just this. The Brazilian summer has no end.
Warm hard light. She will be here for another hour. Nobody is waiting.
""",
    "muscle_flex": """
EDITORIAL SHOT: Athletic moment — muscle definition visible naturally, not performed.
She does something physical: pulls herself up over a ledge, climbs a rock, braces on a boat railing, does a pull-up on a tree branch or harbour beam, or stretches after a swim.
The action is real — not posed. Arms, shoulders, core visible in effort or just after.
Sports bra or crop top — no jacket, no layers. The body is the subject.
Shot from slight low angle or side — full body or three-quarter.

SETTING — must be outdoor and physical:
- Rocky coastline, cliff, or sea wall
- Boat deck or harbour ladder
- Forest or mountain trail (boulder, tree)
- Beach or waterfront — but active, not lounging
NOT: city street, café, hotel lobby, urban pavement. This shot does not happen in a city.
If the location is urban, use the nearest outdoor element — a river embankment, park wall, or rooftop edge.

IF THEA: the muscle flex is work, not training. She carries a beer crate up harbour steps, lifts a gas bottle, or hauls something heavy in a Greek port context. Petite frame, sinewy arms — the effort is real, the muscles are real, not gym-built. She does not notice the camera. She is annoyed by the weight, not by us.

The body is the story. She has built this over time. It shows without announcement.
Helmut Newton meets athletic documentary. Power with no apology.
""",
    "wet_skin": """
EDITORIAL SHOT: She has just come out of the water — not long ago. Still dripping, or almost dry but the water is still in her hair and on her shoulders.
Walking along the shoreline or standing at the waterline. She is not performing for anyone.
Shot from behind or three-quarter angle — her figure against ocean, lake, or river.
The water is still hers. This is her between two states: the water and the land.
Natural movement — she adjusts her hair, looks at the horizon, walks slowly.
Light catches wet skin honestly. Not glamour — documentary.
Vogue outdoor, editorial travel. The location is as present as she is.
""",
    "low_angle_legs": """

If wearing skirt, dress, or similar — back-seam nylons visible naturally. Never with shorts, jeans, or swimwear.
EDITORIAL SHOT: Low angle shot emphasizing legs.
Character standing or walking, camera at knee height looking up.
Location fills the background dramatically.
Natural, not posed — she is moving through the space.
If wearing tight fabric (leather, tailored trousers, fitted skirt): subtle visible panty line natural — not staged, just physics. Never with bikini, swimwear, or loose fabric.
""",
    "over_shoulder": """

If wearing skirt, dress, or similar — back-seam nylons visible naturally. Never with shorts, jeans, or swimwear.
EDITORIAL SHOT: Character walking away, looks back over shoulder.
Three-quarter profile visible. Slight expression — direct, natural.
If wearing tight fabric: subtle visible panty line natural — not staged, just physics.
Location fills 60%+ of frame behind her.
""",
    "cleavage_lean": """
EDITORIAL SHOT: Character leaning forward on surface — bar, railing, balcony, car roof.
Neckline open — shirt unbuttoned, dress low-cut, or jacket open.
If wearing shirt, blouse, dress or jacket: hint of bra visible if clothing parts naturally — lace, silk, delicate fabric. Not staged, accidental.
If wearing bikini, wetsuit, or athletic top: no bra hint — not applicable.
Shot from slightly above and in front. She is looking away or down.
Mario Testino editorial — warm, confident, natural.
""",
    "dominant_eye": """
EDITORIAL SHOT: Character looking directly into camera.
Close-medium shot. Expression: direct, knowing, confident.
Location visible but defocused behind her.
The eye contact is the shot.
""",
    "femme_fatale": """
EDITORIAL SHOT: Classic femme fatale framing.
Character in elegant setting — glass of wine optional.
She looks back at camera with slight direct expression.
Dark, cinematic, 35mm grain.
""",
    "luxury_yacht": """
EDITORIAL SHOT: She is on the deck of a yacht — not posing, doing something. Adjusting a line, scanning the horizon with one hand shielding her eyes, or sitting with one leg over the bow watching the water.
Monaco, Mediterranean, or open sea behind her. The boat is moving or recently anchored.
Swimwear or light cover-up. The sun is high or golden.
She owns this space the way some people own rooms — not by claiming it, by simply being at ease in it.
Shot from deck level or slightly below — the horizon behind her, water in frame.
Editorial — confident, not decorative.
""",
    "luxury_car": """
EDITORIAL SHOT: Character with luxury vehicle — vintage convertible or similar.
Standing beside or leaning on car. Location dramatic behind her.
Elegant but relaxed — she owns it, she doesn't pose with it.
""",
    "luxury_exploit": """
EDITORIAL SHOT: Character in luxury setting — penthouse, yacht.
Black silk dress or equivalent. City or ocean visible behind.
She is already looking at the camera when the shot is taken.
""",
    "arch_back": """
EDITORIAL SHOT: She arches back — not for the camera, but because the moment asks for it.
She has just come out of the water and lifts her face to the sun. Or she stretches after a swim, arms overhead, spine lengthening. Or she looks straight up at something above her.
The movement has a reason. Her body follows it naturally.
Shot from low angle, slight side — the arch reads against sky, water, or open landscape behind her.
Not posed. Not performed. She is doing something, and the arch is what the body does when it does that thing.
""",
    "open_shirt": """
European editorial. Character in open shirt — visible lace edge or shoulder strap as editorial detail.
Do NOT render braless. Underlayer styling visible at shoulder or side opening. One detail only.
Natural relaxed setting. She is not performing.
""",
    "hand_in_hair": """
EDITORIAL SHOT: Character with hand in hair — pushing it back, wind-blown.
Natural gesture, mid-movement. Three-quarter angle, location behind her.
""",

    "tight_crop": """
EDITORIAL SHOT: A close crop — shoulders, back, or legs in motion or stillness.
No face. The detail carries the mood: the line of a shoulder, the curve of a back, legs walking.
Location light and color bleed into the background — the body is part of the landscape, not separate from it.
This is not a body shot. It is a landscape shot that happens to include her.
Abstract, editorial. The crop is precise — chosen, not accidental.
""",
    "pinup_pose": """
EDITORIAL SHOT: Classic pin-up composition. Character posed naturally on surface.
Retro energy, not costume. Warm light. Editorial — Helmut Newton meets vintage Vogue.
""",
    "noir_femme": """
EDITORIAL SHOT: Film noir lighting. Character in doorway, window frame, or street shadow.
Strong contrast — one side lit, one dark. Miniskirt, heels, choker.
She is waiting for someone. Or leaving. Unclear which.
""",
    "window_light": """
EDITORIAL SHOT: Character backlit by window, morning or late afternoon.
Sheer fabric catches the light — silhouette suggestion only. Never explicit.
She is looking outside, not at camera. Helmut Newton style. High fashion.
""",
    "miniskirt_city": """

If wearing skirt, dress, or similar — back-seam nylons visible naturally. Never with shorts, jeans, or swimwear.
EDITORIAL SHOT: Character walking through city street, miniskirt, nylons or bare legs.
Low angle from behind or side — legs dominant in frame, city architecture above.
She moves through the city like she owns it.
""",
    "stiletto_detail": """
EDITORIAL SHOT: Low angle focus on stilettos or heeled boots walking.
Legs visible, city or luxury interior behind. Extreme low angle.
""",
    "thigh_high_boots": """
European fashion editorial. Thigh-high boots as focal element.
Short dress or jacket above. Gap between boot top and hem: bare thigh or stocking top as fashion layering detail.
City night or dramatic outdoor location. Vogue Germany editorial energy.
""",
    "latex_editorial": """
EDITORIAL SHOT: High fashion editorial with latex or PVC detail — one focal piece.
Dramatic location: industrial, urban night, coastal cliff.
Avant-garde fashion editorial framing. Helmut Newton, not fetish.
""",
    "sheer_top": """
European high fashion editorial. Sheer fabric top in backlight or window light.
Silhouette readable beneath translucent fabric — one editorial detail.
Character looking away or in profile. Never explicit. Tasteful luxury editorial.
""",
    "slicked_back": """
EDITORIAL SHOT: Character with hair slicked back — wet styling, not wet from water.
Sharp, deliberate, powerful. Minimal jewelry. Direct eye contact.
Black outfit preferred. Urban or luxury setting.
""",
    "miniskirt_bend": """
STREET PHOTOGRAPHY MOMENT.
Wide shot of the street or interior. In the foreground, a woman has paused — her back to the camera — leaning forward to adjust the buckle on her heel. She is a figure in the scene, not its subject. The city or room is the subject.
She occupies the lower third of the frame. Her back faces the viewer. Location fills everything behind her.
Tailored outfit, heels, nylons. She is dressed for the evening.
NYLON SEAM RULE: the seam runs straight up the center back of each leg — only visible from this angle, never on the front or side.
Candid. She does not know the camera is there.
""",
    "nylon_stiletto": """
EDITORIAL SHOT: Character has changed outfit for this shot.
Miniskirt — black or dark. Back-seam nylons. Stilettos or heeled boots.
Ignore reference image outfit — this is a different moment, different clothes.
Low angle from slightly behind — legs dominant, city or location above.
NYLON SEAM RULE: back seam runs dead center up the BACK of each leg only — never on the front, never on the side. If the camera faces her from the front, NO seam is visible. Seam only appears in shots from behind.
Night or golden hour preferred. Cobblestones, wet pavement, or luxury interior.
""",
    "choker_close": """
EDITORIAL SHOT: Close-medium shot emphasizing choker necklace detail.
Character in profile or slight three-quarter. City or moody interior behind.
Velvet, leather, or chain choker. Editorial crop — jaw to collarbone focal point.
""",
    "female_friendship": """
EDITORIAL SHOT: TWO WOMEN — BOTH FULLY VISIBLE IN FRAME. This is non-negotiable.
NOT one woman alone. TWO women. Both faces or bodies visible. The second woman is as present as the first.
The space between them tells the story. What happened before this shot — unclear. What happens after — also unclear.

MANDATORY: both women in frame, interacting, aware of each other.
Variants — pick one and commit:
- One applying sunscreen to the other's back — slow, fingers lingering on shoulder blade, neither speaking
- Both lying face-to-face in morning light, foreheads almost touching — looking at each other, not the camera
- One whispering in the other's ear at a bar, hand on waist — lips close to skin, both visible
- Swimming together, one pulling the other in by the wrist — half-submerged, both bodies visible
- Sharing one towel after the sea, pressed close — not quite dry, not quite apart
- One holding the other's face with both hands — about to say something or just said it
- Both pressed against a doorframe or wall, one leaning in, the other not moving away
- One adjusting the other's bikini strap or hair — fingers at the nape of the neck, small gesture, loaded
- Slow dancing somewhere they shouldn't be — bodies close, one hand at the small of the back

TONE: Warm and ambiguous. Close enough that the viewer has to decide what this is.
Helmut Newton tension. Mario Testino warmth. Both simultaneously.
FRAMING: BOTH women visible. Location fills 30%+ of frame. 35mm grain.
""",
    "caught_in_rain": """
EDITORIAL SHOT: Character caught in rain — not prepared, not happy about it, slightly chaotic.
Only valid where rain is plausible: Northern Europe, Atlantic coast, mountain, cities in spring/autumn.
NOT for desert, dry Mediterranean summer, or locations where rain would look absurd.

Variants — pick what fits:
- Suddenly soaked — white or light fabric fabric clings to skin, she looks down in disbelief
- Sprayed by passing car through puddle — mouth open, arms out, dress/shirt plastered to skin
- Running for cover — hair flat, shirt completely soaked through
- Standing in doorway waiting out the rain — leaning against frame, soaked, slightly resigned
- Looking up at sky as first drops hit — light fabric already clinging
- Laughing despite being completely drenched — the kind of laugh that happens when there is nothing else to do

She did not plan this. The camera was there. That is also not her fault.

LIGHT: grey sky, puddle reflections, neon signs through wet glass optional.
WET FABRIC: fabric clinging naturally after rain — editorial detail.
Silhouette readable beneath translucent fabric where wet — one subtle detail only.
Peter Lindbergh rainy editorial meets candid. Wet hair, real face, real reaction.
Location still visible — cobblestones, city street, coastal road, village square.
""",
    "feel_the_heat_disabled": """
EDITORIAL SHOT: Extreme heat. Character is overheating — not posing, just coping.
Only valid for HOT locations: Mediterranean summer, desert, tropical, Southern US summer.
NOT for Nordic, mountain, rainy, or cold locations.

CLOTHING REQUIREMENT: character must be wearing at least one outer layer that can react to heat.
A light shirt, linen dress, cotton top, cover-up — something with fabric that lifts, clings, or soaks.
NOT already in swimwear only. The heat story requires something to happen to the clothing.

Variants — pick what fits:
- Light fabric shirt lifted, fanning stomach — caught mid-gesture, looks away
- Skirt or dress lifted slightly at the sides to fan legs — looking for relief, not at camera
- White or light linen completely soaked through — clings, catches the light where wet, she hasn't noticed yet
- Shirt fully unbuttoned, fanning chest, head tilted back in defeat
- Water bottle poured over head — shirt instantly soaked, she doesn't care

She is not doing this for anyone. It is simply 38 degrees and something had to give.
The camera was there. That is not her fault.

LIGHT: harsh golden midday or late afternoon. Dust optional. Location visible behind her.
WET FABRIC: fabric clinging naturally from heat — one editorial detail.
Silhouette through thin wet fabric — tasteful, accidental.
Mario Testino candid energy. She has no idea how this looks.
NOT a beach shot. Cobblestones, terrace, dusty road, village square — real heat locations.
""",
    "street_snap": """
EDITORIAL SHOT: Classic street photography moment. Character caught mid-action in urban context.
She is not aware of the camera. Decisive moment — Cartier-Bresson style.
Could be: crossing the street, emerging from doorway, buying something, looking up suddenly.
Other people blur in background. Location unmistakable.
35mm, eye level, available light only. Documentary, honest, never staged.
""",
    "shadow_play": """
OPTIONAL COMPOSITION VARIANT: Shadow present in frame — not necessarily dominant.
Long afternoon or morning shadow falls naturally across ground or wall.
Character fully visible, shadow adds depth and geometry to the composition.
Natural, not staged. Light and form. Location always identifiable.
""",
    "window_reflection": """
EDITORIAL SHOT: Character reflected in shop window, car window, or glass facade.
Her reflection overlaps with what is behind the glass — products, city, interior.
She may be looking at her reflection or looking through — ambiguous.
Urban only. Editorial, slightly surreal. Helmut Newton or Saul Leiter.
""",
    "candid": """
EDITORIAL SHOT: Pseudo-candid. Character caught mid-movement —
walking, laughing, looking away, adjusting something.
She doesn't know the camera is there.
""",
}


SPICINESS = {
    # ── spicy1 — editorial, minimal or no skin focus ──────────────────────
    "back_to_camera":    "spicy1",
    "over_shoulder":     "spicy1",
    "tight_crop":        "spicy1",
    "candid":            "spicy1",
    "hand_in_hair":      "spicy1",
    "low_angle_legs":    "spicy1",
    "street_snap":       "spicy1",
    "shadow_play":       "spicy1",
    "window_reflection": "spicy1",
    "hood_lean":         "spicy1",
    "jeep_doorframe":    "spicy1",
    "muscle_flex":       "spicy1",
    "asymmetry_shot":    "spicy1",
    "luxury_car":        "spicy1",
    "slicked_back":      "spicy1",
    "rain_mac":          "spicy1",
    # Cinematic
    "blueprint_study":   "spicy1",
    "gas_station_night": "spicy1",
    "through_windshield":"spicy1",
    "staircase_shot":    "spicy1",
    "map_table":         "spicy1",
    # Activity customs
    "helmet_off":        "spicy1",
    "notebook_outside":  "spicy1",
    "field_repair":      "spicy1",
    "morning_run_urban": "spicy1",
    "roadside_dusk":     "spicy1",

    # ── spicy2 — suggestive, body-focused, but not explicit ───────────────
    "walk_away":         "spicy2",
    "arch_back":         "spicy2",
    "cleavage_lean":     "spicy2",
    "open_shirt":        "spicy2",
    "emerging_from_water":"spicy2",
    "wet_skin":          "spicy2",
    "caught_in_rain":    "spicy2",
    "femme_fatale":      "spicy2",
    "miniskirt_city":    "spicy2",
    "noir_femme":        "spicy2",
    "thigh_high_boots":  "spicy2",
    "stiletto_detail":   "spicy2",
    "choker_close":      "spicy2",
    "luxury_exploit":    "spicy2",
    "luxury_yacht":      "spicy2",
    "jacket_draped":     "spicy1",
    "window_silhouette": "spicy2",
    "water_exit":        "spicy2",
    "yacht_bow":         "spicy2",
    "mirror_pose":       "spicy2",
    "towel_wrap":        "spicy2",
    "beach_blanket":     "spicy2",
    "female_friendship": "spicy2",

    # ── spicy3 — explicit / maximum skin or transgressive ─────────────────
    "nylon_stiletto":    "spicy3",
    "miniskirt_bend":    "spicy3",
    "latex_editorial":   "spicy3",
    "sheer_top":         "spicy3",
    "window_light":      "spicy3",
}


# Shots that benefit from exploit canonical (outfit/underwear visible)
EXPLOIT_CANONICAL_SHOTS = [
    "cleavage_lean", "nylon_stiletto", "miniskirt_bend",
    "open_shirt", "sheer_top", "caught_in_rain", "window_light", "latex_editorial",
    "thigh_high_boots", "femme_fatale", "luxury_exploit",
]

def load_exploit_canonical(character_key: str, shot_type: str = None):
    """Load exploit seed if available, else fall back to regular canonical."""
    if character_key == "maya":
        water_shots = {"wet_skin", "emerging_from_water", "arch_back", "kajak_sup", "surf_paddle"}
        use_swim = shot_type in water_shots if shot_type else False
        special = Path("canonicals/maya_swim_canonical.jpg")
        if not special.exists(): special = Path("canonicals/maya_swim_canonical.webp")
        if use_swim and special.exists():
            return special.read_bytes()
        # Land/casual exploit — use grey
        grey = Path("canonicals/maya_grey_canonical.jpg")
        if not grey.exists(): grey = Path("canonicals/maya_grey_canonical.webp")
        if grey.exists():
            return grey.read_bytes()
    if character_key == "maya":
        special = Path("canonicals/maya_swim_canonical.webp")
        if special.exists():
            return special.read_bytes()
    for ext in [".webp", ".png", ".jpg"]:
        p = Path(f"canonicals/{character_key}_canonical_exploit{ext}")
        if p.exists():
            return p.read_bytes()
    return None  # Fall back to regular canonical in caller

FRAMING_MAIN = """FRAMING varies by context:
- MONUMENTAL settings (iconic skyline, canyon, vast mountain): character SMALL — location overwhelms
- CITY/URBAN: location fills 70%+, character 25-30% — visible but subordinate  
- COASTAL/BEACH: character 30-35% — person and sea balanced
- SMALL TOWN/VILLAGE: character 35% — intimate human scale
- NATURE/LANDSCAPE: grand vista = small character, intimate trail = larger
Character always in lower third. Upper 25% calm for UI overlay."""

FRAMING_ARRIVAL = """FRAMING: Arrival moment — character max 35% of frame height.
Full body visible but subordinate to location — she is in the place, not the subject of it.
Location fills 65%+ of frame. Upper 25% calm for UI overlay.

ARRIVAL PLACEMENT — never at a road sign or town entrance marker:
- FERRY: first step onto dock or pier, sea behind
- TRAIN: on platform, door just opened, bags in hand
- CAR/TAXI: somewhere inside the town — narrow street, square, harbour — not the entrance road
- ON FOOT: first glimpse of the place — a corner, a staircase, a view opening up
- HORSE (countryside): path leading into the village, not a road sign"""

FRAMING_EXPLOIT = """EXPLOIT FRAMING: see dynamic framing below.
Location always identifiable behind her. Upper 15% calm for UI overlay."""

FRAMING_GOLDIE = """FRAMING: Goldie max 30% of frame, lower third. Location dominant.
Upper 20% calm sky for UI text overlay."""



# ══════════════════════════════════════════════
# DYNAMIC FRAMING SYSTEM
# ══════════════════════════════════════════════
FRAMING_OPTIONS_MAIN = [
    "Wide shot — character 20-25% of frame height. Location completely dominant. She is a small figure in the scene.",
    "Wide-medium shot — character 28-33% of frame height. Location fills 70%+. She anchors the composition.",
    "Medium shot — character 35-42% of frame height. Location clearly readable behind her.",
    "Environmental portrait — character 12-18% of frame height. Vast landscape, tiny human. Scale is the subject.",
]
FRAMING_WEIGHTS_MAIN = {
    "coastal":       [3, 3, 2, 2],   # sea needs space
    "mountain":      [3, 4, 2, 3],   # mountains need space, environmental works well
    "high_mountains":[2, 3, 2, 4],   # environmental portrait strong here
    "desert":        [3, 3, 2, 3],   # vast, environmental good
    "lake":          [3, 3, 2, 2],
    "hills":         [3, 4, 3, 1],
    "flatland":      [3, 4, 2, 1],
    "city":          [3, 4, 1, 1],   # urban: wide/wide-medium dominant
    "default":       [4, 4, 1, 1],
}
FRAMING_OPTIONS_ARRIVAL = [
    "Arrival — character 40-50% of frame height. First moment in this place, full body visible.",
    "Arrival — character 45-55% of frame height. She just stepped in. Location visible behind.",
    "Arrival wide — character 30-38% of frame height. She arrives small into a big place.",
]
FRAMING_WEIGHTS_ARRIVAL = [3, 3, 2]

FRAMING_OPTIONS_EXPLOIT = [
    "Character 35-45% of frame height. Subject prominent but location always visible and dominant.",
    "Exploit close — character 45-52% of frame height. She fills the lower half. Sky/location above.",
    "Exploit wide — character 28-35% of frame height. Location dominant, she commands her space.",
]
FRAMING_WEIGHTS_EXPLOIT = [3, 1, 3]

def get_dynamic_framing(shot_type: str = "main", terrain_type: str = "") -> str:
    if shot_type == "arrival":
        return random.choices(FRAMING_OPTIONS_ARRIVAL, weights=FRAMING_WEIGHTS_ARRIVAL)[0]
    if shot_type == "exploit":
        return random.choices(FRAMING_OPTIONS_EXPLOIT, weights=FRAMING_WEIGHTS_EXPLOIT)[0]
    # main / activity
    weights = FRAMING_WEIGHTS_MAIN.get(terrain_type, FRAMING_WEIGHTS_MAIN["default"])
    return random.choices(FRAMING_OPTIONS_MAIN, weights=weights)[0]



# ══════════════════════════════════════════════
# DYNAMIC EXPRESSION SYSTEM
# ══════════════════════════════════════════════
_EXPRESSIONS_NEUTRAL = [
    "",  # neutral — model decides (weighted heavily)
    "",
    "",
    "",
]
_EXPRESSIONS_GENERAL = [
    "",  # neutral
    "",
    "expression: looking away, lost in thought — not sad, just elsewhere",
    "expression: calm, eyes slightly narrowed against the light",
    "expression: slight genuine smile — not posed, something just caught her attention",
    "expression: caught mid-laugh — not at camera, at something that just happened",
    "expression: lips slightly parted, caught mid-breath — candid, unguarded",
    "expression: mouth slightly open, mid-breath — pure candid energy",
    "expression: direct eye contact — she noticed the camera, holds the look one beat",
    "expression: concentrated, focused — she is doing something that requires attention",
    "expression: face tilted slightly up, eyes closed, feeling the sun or wind",
]
_EXPRESSIONS_EXPLOIT = [
    "",  # neutral
    "",
    "expression: looking away, lost in thought — does not know camera is there",
    "expression: lips slightly parted, caught mid-breath",
    "expression: calm, eyes slightly narrowed — controlled, aware",
    "expression: direct eye contact — she noticed, holds it one beat, looks away",
    "expression: slight smirk, looks away — she has already decided something",
    "expression: mouth slightly open, mid-breath — candid, unguarded",
]
_EXPRESSIONS_POWER = [
    "",  # neutral
    "",
    "",
    "expression: slight smirk, looks away — she has already decided",
    "expression: calm, direct — assessing without showing it",
    "expression: direct eye contact — brief, then away",
]
_EXPRESSIONS_ACTIVITY = {
    "hiking_back":         ["", "", "expression: looking ahead, focused on the trail"],
    "beach_walk_distance": ["", "", "expression: face to horizon, eyes half-closed against light"],
    "kajak_sup":           ["", "expression: concentrated, focused", "expression: slight smile, eyes on the water"],
    "van_morning_coffee":  ["", "expression: eyes slightly unfocused, first coffee of the day", "expression: slight genuine smile — something outside caught her attention"],
    "sunset_beer":         ["", "expression: slight smile, eyes on the horizon", "expression: caught mid-laugh"],
    "market_browse":       ["", "expression: concentrated, examining something", "expression: slight smile, she found what she wanted"],
    "cafe_terrace":        ["", "expression: looking away, lost in thought", "expression: calm, eyes slightly narrowed against the light"],
    "going_for_a_run":     ["", "expression: focused, mid-effort", "expression: concentrated — she is in her pace"],
    "beer_crate":          ["", "expression: slight annoyance — someone is in the way", "expression: concentrated, she knows where she is going"],
    "map_hood":            [
        "expression: eyes on the map, brow slightly furrowed — reading a junction",
        "expression: concentrated, gaze down at the paper route on the hood",
        "expression: lips pressed lightly, tracing a line on the map with one finger — focused",
    ],
    "kayak_entry":         [
        "expression: profile or back three-quarter — eyes on the canoe and lake, not the camera",
        "expression: concentrated on the push — gaze along the gunwale toward the water",
        "expression: looking ahead down the shore — head forward into effort, no eye contact with lens",
    ],
    "cigarette_roll":      [
        "expression: eyes on the street or horizon — not on hands",
        "expression: slight knowing half-smile — already decided something",
        "expression: calm, unhurried — this is routine",
    ],
}
_POWER_CHARS = {"valentina", "charlotte", "regina", "naomi", "olga", "katja", "quinn"}
_QUINN_EXPRESSIONS = [
    "",
    "",
    "",
    "expression: calm, assessing — aware of the room, not performing alertness",
    "expression: eyes relaxed, jaw soft — watching, not staring",
    "expression: looking past camera toward the scene — economical glance",
    "expression: brief over-shoulder look — neutral mouth, not intense",
    "expression: slight stillness — present, not drilling",
]
_EXPLOIT_NO_LAUGH = {"nylon_stiletto", "latex_editorial", "noir_femme"}
_EXPLOIT_NO_CONCENTRATE = {"caught_in_rain", "emerging_from_water"}

def get_dynamic_expression(shot_type: str = "main", character_key: str = "", activity_key: str = "", exploit_key: str = "") -> str:
    """Returns an expression note or empty string."""
    if character_key == "quinn":
        if shot_type == "activity" and activity_key in _EXPRESSIONS_ACTIVITY:
            pool = [e for e in _EXPRESSIONS_ACTIVITY[activity_key] if "direct eye contact" not in e]
            return random.choice(pool or _QUINN_EXPRESSIONS)
        if shot_type == "exploit":
            pool = [e for e in _EXPRESSIONS_EXPLOIT if "direct eye contact" not in e and "smirk" not in e]
            return random.choices(pool or _QUINN_EXPRESSIONS, weights=[4, 4, 2, 2, 2, 1, 1][:len(pool or _QUINN_EXPRESSIONS)])[0]
        return random.choice(_QUINN_EXPRESSIONS)
    # Activity: context-specific (before power-char pool — map_hood gaze must not be overridden)
    if shot_type == "activity" and activity_key in _EXPRESSIONS_ACTIVITY:
        pool = _EXPRESSIONS_ACTIVITY[activity_key]
        return random.choice(pool)
    # Power chars: restricted pool
    if character_key in _POWER_CHARS:
        return random.choices(_EXPRESSIONS_POWER, weights=[4,4,4,2,2,1])[0]
    # Exploit: no laugh for power shots, no concentrate for heat/rain
    if shot_type == "exploit":
        pool = list(_EXPRESSIONS_EXPLOIT)
        if exploit_key in _EXPLOIT_NO_LAUGH:
            pool = [e for e in pool if "laugh" not in e]
        if exploit_key in _EXPLOIT_NO_CONCENTRATE:
            pool = [e for e in pool if "concentrat" not in e]
        weights = [4,4,2,2,2,1,1,1][:len(pool)]
        return random.choices(pool, weights=weights)[0]
    # Main: general pool
    weights = [4,4,2,2,2,1,1,1,1,1,1]
    return random.choices(_EXPRESSIONS_GENERAL, weights=weights[:len(_EXPRESSIONS_GENERAL)])[0]



# ══════════════════════════════════════════════
# TIME / LIGHT SYSTEM
# ══════════════════════════════════════════════
TIME_PRESETS = {
    "golden":    "Light: golden hour — warm low sun, long shadows, amber glow on skin and surfaces.",
    "blue_hour": "Light: blue hour — dusk or dawn, deep blue sky, warm artificial lights beginning to glow.",
    "midday":    "Light: harsh midday sun — hard shadows, high contrast, bleached highlights. Unforgiving and real.",
    "overcast":  "Light: flat overcast — soft diffuse light, no shadows, muted colors, melancholy.",
    "night":     "Light: night — artificial sources only. Streetlamps, neon, window glow, headlights.",
    "dawn":      "Light: dawn — pale grey-pink light, world just waking, mist possible.",
}

# ── WET SYSTEM ──
WET_PRESETS = {
    "light": "WET: light moisture — hair slightly damp, skin has natural sheen from sea air or light drizzle. Clothes unaffected.",
    "medium": "WET: visibly wet — hair flat and damp, skin wet, light fabric clings slightly where touched by water.",
    "heavy": "WET: fully soaked — hair completely flat, water running off skin, fabric completely wet and clinging. She doesn't care.",
}

# ── FOREGROUND SYSTEM ──
FOREGROUND_OPTIONS = [
    "",  # no foreground — most common
    "",
    "",
    "FOREGROUND: out-of-focus wine glass or bottle in extreme foreground — adds depth, warm bokeh.",
    "FOREGROUND: blurred flowers or foliage in extreme foreground — natural framing, soft color.",
    "FOREGROUND: window frame or doorway edge in foreground — she is seen through an opening.",
    "FOREGROUND: out-of-focus coffee cup or espresso on a surface in foreground — urban intimacy.",
    "FOREGROUND: blurred rope, chain, or railing — harbour or boat context only.",
    "FOREGROUND: out-of-focus candle flame in foreground — warm bokeh, evening only.",
]
FOREGROUND_WEIGHTS = [5, 5, 5, 2, 2, 2, 1, 1, 1, 1]

FOREGROUND_TERRAIN_BLOCK = {
    "desert":    ["flowers", "foliage", "rope", "chain", "candle"],
    "mountain":  ["wine glass", "bottle", "rope", "coffee"],
}


def resolve_time_wet(time_override, wet_override, terrain, country_code, character_key):
    """Smart validation — block nonsensical time/wet combinations."""
    
    COLD_COUNTRIES = {"NO","SE","FI","IS","DK","GB","IE","EE","LV","LT","PL","DE","AT","CH","BE","NL"}
    HOT_DRY = {"MA","TN","DZ","EG","AE","SA","JO","IL"}
    
    time = time_override
    wet = wet_override

    # Midday doesn't work in northern Norway/Iceland — override to overcast or golden
    if time == "midday" and country_code in {"NO","IS","FI"} and terrain in {"mountain","flatland","hills",""}:
        time = "overcast"

    # Blue hour at beach is weak — override to golden
    if time == "blue_hour" and terrain == "coastal":
        time = "golden"

    # Wet + midday + desert = nonsense — drop wet
    if wet and time == "midday" and terrain == "desert":
        wet = None

    # Wet + midday + hot dry country = nonsense
    if wet and time == "midday" and country_code in HOT_DRY:
        wet = None

    # Night + wet is fine (rain at night)
    # Heavy wet + golden hour is fine (just out of water)
    # Overcast + wet = very natural — keep

    # Night chars CAN get golden/dawn — coming from or going to the party
    # golden = going out (getting ready at dusk)
    # dawn = coming back (still in last night's outfit, first light)
    # midday = never for night chars unless forced
    NIGHT_CHARS = {"elena","yuki","carmela","lyra","tammy","regina","celine","rosa","camille"}
    if time == "midday" and character_key in NIGHT_CHARS and not time_override:
        time = "overcast"  # midday is wrong — overcast is fine

    # Prem-layer time alignment — auto-correct if no manual override
    if not time_override:
        # nightlife/maxpower → night or blue_hour
        if character_key in NIGHT_CHARS or terrain == "":
            pass  # already handled above
        
    # Prem layer conflicts (passed via character context — handled in caller)
    # desert + wet = never
    if wet and terrain == "desert":
        wet = None

    # mountain winter + golden = unlikely — but allow if forced
    # lake + midday summer = keep, very good
    # night + desert = explicitly good — Milky Way etc, keep

    # ingrid coastal: she's Nordic, midday coastal feels wrong
    if character_key == "ingrid" and terrain == "coastal" and time == "midday" and not time_override:
        time = "overcast"

    # werra coastal: shouldn't happen but if it does
    if character_key == "werra" and terrain == "coastal" and not time_override:
        time = "overcast"

    return time, wet


def get_foreground(terrain: str = "", shot_type: str = "main", time_hint: str = "") -> str:
    if shot_type == "exploit":
        return ""  # never foreground on exploit shots
    pool = list(zip(FOREGROUND_OPTIONS, FOREGROUND_WEIGHTS))
    # Block candle in daylight
    if "golden" in time_hint or "midday" in time_hint or "overcast" in time_hint:
        pool = [(o, w) for o, w in pool if "candle" not in o]
    # Block rope/chain unless coastal
    if terrain not in ["coastal", "lake"]:
        pool = [(o, w) for o, w in pool if "rope" not in o and "chain" not in o]
    options, weights = zip(*pool)
    return random.choices(options, weights=weights)[0]


# ══════════════════════════════════════════════
# CAMERA STYLE SYSTEM
# ══════════════════════════════════════════════

CAMERA_GROUPS = {
    "power":    ["valentina", "charlotte", "naomi", "regina", "quinn", "terry", "diana", "conrad"],
    "athletic": ["jade", "alessandra", "maya", "ingrid", "kay"],
    "candid":   ["elena", "katja", "thea", "diaz", "yosra", "amber", "cleo", "djordje", "kelek", "tasha"],
    "warm":     ["ana", "sofia", "luca", "stacy", "zara"],
    "road":     ["driver_pov", "driver_van"],
    "nomad":    ["chad"],
}

def get_character_group(character_key: str) -> str:
    for group, chars in CAMERA_GROUPS.items():
        if character_key in chars:
            return group
    return "warm"

CAMERA_STYLE_MATRIX = {
    # (group, terrain, shot_type): style string
    ("power", "urban", "main"):    "85mm equivalent, camera slightly above eye level, gentle tele compression. Muted palette: cream, beige, cool tones. Moderate contrast. Symmetry and vertical lines emphasized. Quiet luxury editorial.",
    ("power", "urban", "exploit"): "50mm or wider. Camera lower and closer. Dynamic diagonals. Higher contrast, warmer highlights. Foreground actively used. Caught in a moment.",
    ("power", "urban", "arrival"): "28mm, eye level. Busy city context. She arrives into the frame, not at it.",
    ("power", "nature", "main"):   "85mm, eye level. Atmospheric softness. Landscape dominates. She is composed within it.",
    ("power", "nature", "exploit"):"50mm, slightly lower. Warmer light. Natural posture.",
    ("power", "nature", "arrival"):"35mm, eye level. Wide open landscape. She is small in it.",

    ("athletic", "urban", "main"):    "50mm, eye level. Dynamic, natural light. Strong lines.",
    ("athletic", "urban", "exploit"): "35mm, lower angle. Energy and movement. Hard light.",
    ("athletic", "urban", "arrival"): "35mm, eye level. She moves through the city.",
    ("athletic", "nature", "main"):   "35mm, eye level. Wide, natural. She belongs in this landscape.",
    ("athletic", "nature", "exploit"):"35mm, low angle. Body in landscape. Hard natural light.",
    ("athletic", "nature", "arrival"):"28mm, slightly low. She arrives in motion.",

    ("candid", "urban", "main"):    "35mm, eye level. Documentary, natural light. She is not performing.",
    ("candid", "urban", "exploit"): "35mm, eye level. Caught moment. Street photography energy.",
    ("candid", "urban", "arrival"): "28mm, eye level. She appears in the urban context.",
    ("candid", "nature", "main"):   "50mm, eye level. Natural, understated.",
    ("candid", "nature", "exploit"):"35mm, eye level. Natural caught moment.",
    ("candid", "nature", "arrival"):"35mm, wide. She arrives quietly.",

    ("warm", "urban", "main"):    "50mm, eye level. Warm tones, golden light. She is at ease.",
    ("warm", "urban", "exploit"): "50mm, slightly low. Warm, sensual light. Natural movement.",
    ("warm", "urban", "arrival"): "35mm, eye level. She arrives with energy.",
    ("warm", "nature", "main"):   "50mm, eye level. Warm golden light. Natural, alive.",
    ("warm", "nature", "exploit"):"50mm, low angle. Warm skin tones. Water or nature behind.",
    ("warm", "nature", "arrival"):"35mm, low. She comes from or into the natural element.",
}

def get_camera_style(character_key: str, terrain_type: str, shot_type: str) -> str:
    group = get_character_group(character_key)
    # Normalize terrain
    if terrain_type in ["coastal", "lake", "mountain", "desert", "hills"]:
        terrain_cat = "nature"
    else:
        terrain_cat = "urban"
    key = (group, terrain_cat, shot_type)
    return CAMERA_STYLE_MATRIX.get(key, "")


PHOTO_STYLE_DETAILS = {
    "power":    "Fine grain. Controlled highlights, deep shadows with retained detail. Skin: cool-toned, porcelain, flawless. No lens flare. Blacks are true black.",
    "athletic": "Medium grain. Hard shadows, high microcontrast. Skin: tanned, real texture visible, salt and dust acceptable. No artificial smoothing.",
    "candid":   "Heavy grain, available light only, slight underexposure preferred. Skin: natural, imperfect, real. Accidental lens flare acceptable. Shadows can go deep.",
    "warm":     "Low grain, warm highlights, soft lifted shadows. Skin: golden tone, natural glow. Warm lens flare welcome in backlight. Colors slightly saturated.",
    "road":     "Heavy grain, documentary. Dashboard reflection in windshield acceptable. High contrast, deep shadows.",
    "nomad":    "Clean, low grain, Instagram-ready. Skin smooth, colors popping. He has a preset for this.",
}

def get_photo_style(character_key: str) -> str:
    group = get_character_group(character_key)
    return PHOTO_STYLE_DETAILS.get(group, "")


# ══════════════════════════════════════════════
# LOCATION MOOD + TIME OF DAY SYSTEM
# ══════════════════════════════════════════════

# PLACE VIBES — injected into location brief
# ── CLEO PERIOD SYSTEM ──
# Maps place name → (period_label, clothing_note)
# Period labels: "classical", "medieval", "early_modern", "modern", "contemporary"
CLEO_PERIOD_HINTS: dict[str, tuple[str, str]] = {
    # Classical antiquity
    "Pompeii":              ("classical", "simple undyed linen stola, leather sandals — Roman Republican era. Draped, pinned at shoulder."),
    "Herculaneum":          ("classical", "simple undyed linen stola, leather sandals — Roman era. Draped, pinned at shoulder."),
    "Ephesus":              ("classical", "Greek chiton, undyed linen, belted at waist — Hellenistic period. Sandals."),
    "Persepolis":           ("classical", "simple linen wrap, neutral earth tones — Achaemenid era. Sandals or bare feet."),
    "Carthage":             ("classical", "simple draped linen, Phoenician influence — earth tones, terracotta."),
    "Athens":               ("classical", "Greek peplos or chiton, pinned at shoulders — Classical period. Sandals."),
    "Delphi":               ("classical", "Greek chiton, pale linen — Classical period. Sandals."),
    "Olympia":              ("classical", "simple Greek linen wrap — Classical antiquity. Sandals."),
    "Troy":                 ("classical", "simple draped linen — Bronze Age Aegean. Minimal, undyed."),
    "Paestum":              ("classical", "Greek-Italian colonial chiton — Magna Graecia, 4th century BC."),
    "Agrigento":            ("classical", "Greek chiton — Sicilian colonial period. Linen, sandals."),
    "Petra":                ("classical", "simple Nabataean wrap — 1st century AD. Undyed linen, sandals."),
    "Jerash":               ("classical", "Roman provincial stola — 2nd century AD. Linen, sandals."),
    "Baalbek":              ("classical", "Roman-era draped linen — Heliopolitan period. Sandals."),
    "Leptis Magna":         ("classical", "Roman provincial dress — 2nd-3rd century AD. Draped linen."),

    # Medieval
    "Mont Saint-Michel":    ("medieval", "dark wool overdress, simple linen underdress, leather belt — 12th century Norman. No jewelry."),
    "Carcassonne":          ("medieval", "simple wool kirtle, dark — 13th century southern France. Leather belt, soft boots."),
    "Conwy Castle":         ("medieval", "grey wool dress, linen veil or coif — 13th century Wales. Practical, no ornamentation."),
    "Alhambra":             ("medieval", "simple wool or linen — late medieval Andalusian, neutral tones. Soft leather shoes."),
    "Dubrovnik":            ("medieval", "simple dark wool dress — 14th century Ragusan. Linen underdress. Practical."),
    "Krak des Chevaliers":  ("medieval", "dark wool, simple — Crusader-era Levant. Heavy, practical."),
    "Castelo de Guimarães": ("medieval", "simple dark wool — 12th century Iberian. Linen underdress."),
    "Rothenburg":           ("medieval", "simple German wool dress — 15th century. Dark, practical."),
    "Provins":              ("medieval", "simple French wool kirtle — 12th-13th century. Undyed or dark."),
    "Valletta":             ("medieval", "simple wool — Knights Hospitaller era, 16th century. Dark, practical."),
    "Mdina":                ("medieval", "dark wool dress — medieval Maltese. Simple linen underdress."),

    # Early modern
    "Versailles":           ("early_modern", "simple dark linen dress — 17th-18th century servant class, not courtly. She is not the subject here."),
    "Pompeii":              ("classical", "simple undyed linen stola, leather sandals — Roman Republican era."),  # duplicate handled by first match

    # Modern — WWI/WWII/20th century
    "Verdun":               ("modern", "dark wool coat, simple cut — 1916. Dark headscarf or nothing. No ornamentation. She has been here since before the war."),
    "Ypres":                ("modern", "dark wool coat — 1917. Simple, heavy. She is cold. She does not show it."),
    "Normandy":             ("modern", "simple dark wool coat or dress — 1944 era. Practical. Nothing decorative."),
    "Auschwitz":            ("modern", "plain dark coat, simple — contemporary but austere. Nothing that draws attention from the place."),
    "Hiroshima Peace Park": ("modern", "simple contemporary dark clothing — nothing decorative. The place is the only statement."),
    "Hiroshima":            ("modern", "simple contemporary dark clothing — nothing decorative."),
    "Srebrenica":           ("modern", "plain dark contemporary clothing — austere. Nothing decorative."),

    # Machu Picchu / pre-Columbian
    "Machu Picchu":         ("classical", "simple undyed alpaca wrap — Inca period, 15th century. Woven belt. Sandals or bare feet."),
    "Chichen Itza":         ("classical", "simple undyed cotton wrap — Classic Maya period. Minimal. Sandals."),
    "Teotihuacan":          ("classical", "simple white cotton wrap — pre-Columbian. Minimal, undyed."),
    "Angkor Wat":           ("classical", "simple draped cotton wrap — Khmer empire, 12th century. Undyed or pale."),
    "Bagan":                ("classical", "simple cotton wrap — Pagan Kingdom, 11th-13th century. Undyed."),
}

# Fallback: period by place_type code
CLEO_PERIOD_BY_TYPE: dict[str, tuple[str, str]] = {
    "ARCH":  ("classical", "simple draped linen — ancient period. Undyed, sandals. Timeless witness."),
    "RUIN":  ("classical", "simple draped linen — ancient period. Undyed, sandals."),
    "CSTL":  ("medieval",  "simple dark wool dress, linen underdress, leather belt — medieval. No ornamentation."),
    "MNMT":  ("modern",    "simple dark coat or dress — contemporary but austere. Nothing decorative."),
    "BTTLF": ("modern",    "plain dark wool coat — era of the battle. Simple, heavy, no ornamentation."),
    "CMTY":  ("modern",    "plain dark contemporary clothing — austere. The place speaks. She listens."),
}

def get_cleo_period_note(place: dict) -> str:
    """Return period-appropriate clothing note for Cleo based on place."""
    name = place.get("name_en", "")
    place_type = (place.get("place_type") or "").upper()
    if name in CLEO_PERIOD_HINTS:
        _, note = CLEO_PERIOD_HINTS[name]
        return f"\nCLEO PERIOD CLOTHING: {note}"
    if place_type in CLEO_PERIOD_BY_TYPE:
        _, note = CLEO_PERIOD_BY_TYPE[place_type]
        return f"\nCLEO PERIOD CLOTHING: {note}"
    # Default: timeless, no specific period hint
    return ""


PLACE_VIBES = {
    "Dubrovnik":  "Game of Thrones pilgrims everywhere. Cruise ships in harbour. She ignores all of it.",
    "Santorini":  "45 min queue for the sunset spot. She found a different wall.",
    "Venice":     "Day tripper city. Entrance fee coming. Valentina was here before the crowds.",
    "Mykonos":    "Thea has been here her whole life. She uses the back entrance.",
}

LOCATION_MOOD = {
    "urban_large": "Busy backdrop, people blur in background, reflected light on wet streets, urban energy. Architecture competes with character.",
    "urban_small":  "Quiet streets, local texture, nobody watching. Intimate scale. Character owns the frame without trying.",
    "coastal":      "Horizon always present. Light bouncing off water. Salt in the air implied. Foreground often empty.",
    "mountain":     "Scale overwhelming. Silence implied. Character small against peaks. Light dramatic and directional.",
    "desert":       "Heat haze optional. Vast emptiness. Hard shadows. Dust acceptable. Time moves differently here.",
    "lake":         "Still water reflects sky. Quieter than coastal. More intimate. Mist acceptable in early morning.",
    "nature":       "Light primary. Scale second. Character last but essential — she anchors the wilderness.",
}

CHARACTER_TIME_OF_DAY = {
    "olga":      "Overcast daylight or blue hour. Never harsh sun.",
    "nina":      "Overcast grey daylight or dusk. Rain preferred.",
    "mila":      "Late afternoon or night. Never morning.",
    "sigrid":    "Overcast Nordic light or evening. Flat light suits her.",
    "quinn":     "Night or pre-dawn. Artificial light preferred.",
    "isabella":  "Golden hour or late afternoon. Warm Miami light.",
    "maria":     "Golden hour or harsh midday Andalusian sun.",
    "rosa":      "Night or blue hour. Urban artificial light.",
    "vera":      "Blue hour or brasserie evening light. Warm amber from inside against darkening street. The bracelet catches it.",
    "camille":   "Late afternoon into dusk. Port light, warm stone, long shadows. Or night in a bar — candle and neon.",
    "carmela":   "Night. Neon and warm street light. Never daytime.",
    "oksana":    "Night. Hotel and venue light. Never outdoors in daylight.",
    "yuki":      "Night only. Artificial light — neon, fluorescent, rain reflections.",
    "celine":    "Blue hour, dusk, or late evening. Brasserie light preferred.",
    "ana":        "Golden hour or dramatic storm light breaking through clouds. Never flat midday.",
    "naomi":      "Late afternoon or blue hour. Monaco never looks bad in any light — she doesn't need help.",
    "valentina":  "Golden hour preferred. Overcast acceptable — softbox sky suits her palette.",
    "sofia":      "Golden hour at sea. Or early morning before anyone else arrives.",
    "yosra":      "Late afternoon, long shadows. The light she photographs others in.",
    "elena":      "Night or deep twilight. Neon if urban. Moonlight if not. Never cheerful daylight.",
    "katja":      "Overcast or flat northern light. Cool, controlled, no flattery. She doesn't need it.",
    "alessandra": "Harsh alpine light — high altitude sun, deep shadows, no haze. Midday acceptable.",
    "ingrid":     "Long nordic golden hour or pale blue northern light. Wind implied even in still shots.",
    "jade":       "Harsh desert midday or late afternoon. Heat is part of the image.",
    "luca":       "Golden hour only. He is always in the right light without trying.",
    "chad":       "Perfect golden hour, obviously. He timed it.",
    "driver_pov": "Golden hour or dusk. Dashboard lit by fading sun. Radio glow in the dark.",
    "stacy":      "Any light — she doesn't plan it. Sometimes it's perfect by accident.",
    "diaz":       "Night. Neon. Fluorescent. She is always in difficult light and always looks better for it.",
    "kay":        "Pacific golden hour. Salt-haze softness. Backlight off the water.",
    "maya":       "Harsh flat light — gas station fluorescent or Georgia midday. No flattery. Doesn't matter.",
    "charlotte":  "Grey London overcast or low winter sun. She looks good in both. She has practiced.",
    "werra":      "Cold overcast light — winter preferred. Hard shadows, no warmth. Dawn or dusk acceptable. Never golden hour.",
    "noir":       "Night or overcast day only. Single hard light source — streetlamp, car headlight, neon sign reflected in wet pavement. Never natural golden hour. Never soft. Hard shadows, deep black, blown highlights.",
    "lyra":       "Night only. Candlelight, string lights, or moonlight. Never fluorescent. Never before 10pm.",
    "tammy":      "Late afternoon or gas station fluorescent night. Never morning — she was up late. Researching.",
    "thea":       "Harsh mediterranean midday. No golden hour romance. Hard shadows, white walls, blue sky. Real light.",
    "regina":     "She is in whatever light exists. The light adjusts.",
    "terry":      "Evening or blue hour. Hotel bar amber light, or city between dusk and night. Never cheerful daylight.",
    "amber":      "Harsh desert late afternoon or brutal midday. Heat is part of the image. Never soft morning light.",
    "zara":       "Midday market light — high sun, color everywhere, no flattery needed. Or warm golden late afternoon.",
    "kelek":      "Midday or late afternoon — harsh Mediterranean or Levantine light. High sun, strong shadows. Never soft.",
    "diana":      "Night only. Wet cobblestone neon reflections, single warm interior light source, or blue hour. Never daylight.",
    "conrad":     "Overcast northern light or cold grey daylight. Or: late afternoon, long shadows, no warmth. Never golden hour.",
}

def get_location_mood(terrain_type: str, place_type: str) -> str:
    pt = (place_type or "").lower()
    if terrain_type == "coastal":
        return LOCATION_MOOD["coastal"]
    elif terrain_type in ("mountain", "mountains", "high_mountains"):
        return LOCATION_MOOD["mountain"]
    elif terrain_type == "desert":
        return LOCATION_MOOD["desert"]
    elif terrain_type == "lake":
        return LOCATION_MOOD["lake"]
    elif terrain_type in ["hills", "flatland"]:
        return LOCATION_MOOD["nature"]
    elif pt in ["city", "capital", "large_town", "PPLC", "PPLA"]:
        return LOCATION_MOOD["urban_large"]
    elif pt in ["small_town", "medium_town", "village", "PPL"]:
        return LOCATION_MOOD["urban_small"]
    return ""


PLACE_EXPLOIT_BOOSTS = {}

def get_place_boost(place_name: str, character_key: str) -> list:
    boost = PLACE_EXPLOIT_BOOSTS.get(place_name)
    if not boost:
        return []
    if boost["character"] is None or boost["character"] == character_key:
        return boost["shots"]
    return []

EXPLOIT_MIN_SCORE = 85
REGINA_EXPLOIT_MIN_SCORE = 95

def should_generate_exploit(place: dict, character_key: str) -> bool:
    score = place.get("attractiveness_score", 0)
    if character_key == "regina":
        return score >= REGINA_EXPLOIT_MIN_SCORE
    if character_key in ["driver_pov", "driver_van", "luca", "chad"]:
        return False
    if place.get("terrain_type") in ["flatland"]:
        return False
    return score >= EXPLOIT_MIN_SCORE and character_key in EXPLOIT_REPERTOIRE

FEEL_THE_HEAT_OUTFIT = {
    "ana":    "loose white linen shirt open, light cotton shorts — she came from the beach, now on the cobblestones",
    "sofia":  "thin white linen shirt over bikini top, denim cutoffs — beach exit, now in town",
    "maya":   "oversized grey t-shirt, cutoff shorts — she ran here from the parking lot",
    "kay":    "open flannel over fitted tank, denim shorts — post-surf, wrong side of town",
    "tasha":  "thin summer dress, cotton, barely there — tourist in 38 degree heat",
    "kiona":  "off-white linen shirt open, black high-waist shorts, Sambas — Berlin returnee on hot cobblestones",
    "metka":  "linen shorts, simple tank or open shirt — post-dive, heat hit her on land",
    "amber":  "simple white summer dress or linen shirt dress — off-duty, too hot to think",
}

# Chars and shots where a subtle VPL detail is plausible and welcome
_VPL_CHARS = {"ingrid", "valentina", "charlotte", "elena"}
_VPL_SHOTS = {"walk_away", "tight_crop", "low_angle_legs", "miniskirt_bend", "miniskirt_city", "thigh_high_boots"}

def build_exploit_prompt(place: dict, character_key: str, shot_type: str, noir_mode: bool = False, prestige_mode: bool = False, nightlife_mode: bool = False, viper_mode: bool = False, maxpower_mode: bool = False, outfit_override: str = None, eclipse_mode: bool = False, sidewinder_mode: bool = False, continental_mode: bool = False, us_mode: bool = False, eu_mode: bool = False, friend_char: str = None) -> str:
    if not outfit_override:
        _street = get_city_street_outfit_override(character_key, place)
        if _street:
            outfit_override = _street
    # Auto outfit override for feel_the_heat on bikini chars
    if shot_type == "feel_the_heat" and character_key in BIKINI_CHARS and not outfit_override:
        outfit_override = FEEL_THE_HEAT_OUTFIT.get(character_key)
    # muscle_flex requires minimal clothing — hard override regardless of mode
    if shot_type == "muscle_flex" and not outfit_override:
        outfit_override = "OUTFIT OVERRIDE FOR THIS SHOT: fitted athletic crop top, no jacket, no layers. Arms and shoulders fully visible. This is non-negotiable — the shot only works if the muscle definition is visible."
    base = build_prompt(place, character_key, noir_mode=noir_mode, prestige_mode=prestige_mode, nightlife_mode=nightlife_mode, viper_mode=viper_mode, maxpower_mode=maxpower_mode, outfit_override=outfit_override, eclipse_mode=eclipse_mode, sidewinder_mode=sidewinder_mode, continental_mode=continental_mode, us_mode=us_mode, eu_mode=eu_mode)
    addition = EXPLOIT_PROMPTS.get(shot_type, "")
    style = CHARACTER_STYLE.get(character_key, "")
    terrain_val = place.get("terrain_type", "")
    camera_exploit = get_camera_style(character_key, terrain_val, "exploit")
    style_line = ""
    if style:
        style_line += f"\nPHOTOGRAPHIC STYLE: {style}"
    if camera_exploit and character_key != "valentina":  # valentina has own override
        style_line += f"\nCAMERA & STYLE: {camera_exploit}"
    photo_detail_e = get_photo_style(character_key)
    if photo_detail_e:
        style_line += f"\nFILM & SKIN: {photo_detail_e}"
    _exploit_framing = get_dynamic_framing("exploit")
    _exploit_expression = get_dynamic_expression("exploit", character_key, exploit_key=shot_type)
    _expr_line = f"\n{_exploit_expression}" if _exploit_expression else ""
    # Friend char injection for female_friendship
    _friend_note = ""
    if shot_type == "female_friendship" and friend_char:
        _friend_spec = CHARACTER_SPECS.get(friend_char, "")
        _friend_lines = [l.strip() for l in _friend_spec.strip().split("\n") if l.strip() and not l.strip().startswith(("TERRAIN", "PLACE TYPE", "VOID", "GROUND", "ORIENTATION", "EXPLOIT", "DIVINE", "GOLDIE", "SEELENTIER"))][:6]
        _friend_desc = " ".join(_friend_lines)
        _friend_note = f"\nSECOND WOMAN — {friend_char.upper()}: {_friend_desc}\nThis is her — match this description for the second woman in the frame."
    _vpl_note = ""
    if character_key in _VPL_CHARS and shot_type in _VPL_SHOTS:
        _vpl_note = "\nDETAIL: If fabric is tight or thin — a subtle outline of underwear through the material may be visible. Natural, incidental. Not the focus of the shot."
    return base + "\n\n" + addition.strip() + _expr_line + _friend_note + _vpl_note + "\n\n" + _exploit_framing + "\n" + EXPLOIT_FRAMING.strip() + style_line

def _place_slug(place: dict) -> str:
    """ASCII-safe storage slug from place name."""
    raw = place["name_en"].lower()
    raw = unicodedata.normalize("NFKD", raw).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", "_", raw).strip("_")

def upload_exploit_to_supabase(webp_bytes: bytes, place: dict, character_key: str, shot_type: str) -> str:
    place_name = _place_slug(place)
    country = place["country_code"].lower()
    filename = f"{place_name}_{country}_cast_{character_key}_exploit_{shot_type}_1.webp"
    storage_path = f"cast/exploit/{filename}"
    supabase.storage.from_("dedicated").upload(storage_path, webp_bytes, {"content-type": "image/webp"})
    supabase.table("place_hero_images").insert({
        "place_id": place["id"],
        "storage_path": storage_path,
        "character": character_key,
        "variant": "exploit",
    }).execute()
    return storage_path

def build_cinematic_prompt(place: dict, character_key: str, cinematic_key: str, noir_mode: bool = False, prestige_mode: bool = False, nightlife_mode: bool = False, viper_mode: bool = False, maxpower_mode: bool = False, eclipse_mode: bool = False, sidewinder_mode: bool = False, continental_mode: bool = False, us_mode: bool = False, eu_mode: bool = False) -> str:
    base = build_prompt(place, character_key, noir_mode=noir_mode, prestige_mode=prestige_mode, nightlife_mode=nightlife_mode, viper_mode=viper_mode, maxpower_mode=maxpower_mode, eclipse_mode=eclipse_mode, sidewinder_mode=sidewinder_mode, continental_mode=continental_mode, us_mode=us_mode, eu_mode=eu_mode)
    cinematic_spec = CINEMATIC_PROMPTS.get(cinematic_key, "")
    return base + f"""
─────────────────────────────────────
CINEMATIC DIRECTION ({cinematic_key}):
{cinematic_spec}
This is a CINEMATIC CHARACTER PORTRAIT — not an exploit, not a suggestive shot.
Atmosphere, character, place. Cinematic travel editorial quality.
Annie Leibovitz / Peter Lindbergh / Michael Mann depending on mood.
─────────────────────────────────────
"""

def upload_cinematic_to_supabase(webp_bytes: bytes, place: dict, character_key: str, cinematic_key: str) -> str:
    place_name = _place_slug(place)
    country = place["country_code"].lower()
    filename = f"{place_name}_{country}_cast_{character_key}_cinematic_{cinematic_key}_1.webp"
    storage_path = f"cast/cinematic/{filename}"
    supabase.storage.from_("dedicated").upload(storage_path, webp_bytes, {"content-type": "image/webp"})
    supabase.table("place_hero_images").insert({
        "place_id": place["id"],
        "storage_path": storage_path,
        "character": character_key,
        "variant": "cinematic",
    }).execute()
    return storage_path

# ══════════════════════════════════════════════
# FEMALE FRIENDSHIP PAIRS
# ══════════════════════════════════════════════

FEMALE_FRIENDSHIP_PAIRS = [
    ("ana", "sofia"),
    ("naomi", "valentina"),
    ("elena", "katja"),
    ("katja", "ana"),
    ("katja", "sofia"),
    ("katja", "naomi"),
    ("katja", "ingrid"),
    ("katja", "maya"),
    ("katja", "yosra"),
    ("katja", "elena"),
    ("ingrid", "kay"),
    ("maya", "kay"),
    ("yosra", "ana"),
    ("yosra", "sofia"),
    ("diaz", "katja"),
    ("diaz", "maya"),
    ("diaz", "elena"),
    ("stacy", "sofia"),
    ("charlotte", "valentina"),  # London meets Milano — different systems, same result
    ("charlotte", "naomi"),      # City meets Monaco
    ("charlotte", "katja"),      # Both know things they shouldn't
    ("charlotte", "elena"),      # Previous life. Different century. Same energy.
    ("charlotte", "maya"),       # Unlikely. Happened anyway.
    ("charlotte", "diaz"),
    ("thea", "diaz"),       # Both deal with idiots professionally
    ("thea", "elena"),      # Nihilism as common language
    ("thea", "katja"),      # No shared language. Understood anyway.       # Law meets law. Different jurisdictions.
]

# ══════════════════════════════════════════════
# MULTI-CHARACTER ROTATION
# ══════════════════════════════════════════════

MULTI_CHAR_ROTATION = {
    "coastal_med": {"valentina": 0.40, "naomi": 0.35, "luca": 0.25},
    "us_desert":   {"jade": 0.55, "diaz": 0.25, "ana": 0.20},
    "us_nature":   {"jade": 0.20, "amber": 0.18, "tammy": 0.16, "quinn": 0.14,
                    "maya": 0.10, "ingrid": 0.20, "stacy": 0.07, "werra": 0.05},
    "eu_nature":   {"ingrid": 0.20, "alessandra": 0.16, "katja": 0.13, "werra": 0.07,
                    "sofia": 0.14, "yosra": 0.08, "luca": 0.11, "quinn": 0.14, "stacy": 0.07},
    "us_south":    {"diaz": 0.36, "maya": 0.26, "tammy": 0.26, "rosa": 0.12},
    "nordic":      {"ingrid": 0.40, "katja": 0.25, "elena": 0.20, "sigrid": 0.15},
    "atlantic":    {"yosra": 0.35, "sofia": 0.35, "luca": 0.30},
    "metropolis":  {"katja": 0.25, "elena": 0.22, "naomi": 0.18, "charlotte": 0.15, "regina": 0.20},
    "alpine":      {"alessandra": 0.45, "ingrid": 0.25, "katja": 0.15, "elena": 0.15},
    "balkan":      {"katja": 0.35, "elena": 0.30, "yosra": 0.20, "ingrid": 0.15},
}

# eu_nature keeps werra in the pool — but only pick her where the G-Wagen/forest vibe fits
_EU_NATURE_WERRA_COUNTRIES = {
    "DE", "AT", "CH", "NO", "SE", "FI", "DK", "IS",
    "PL", "CZ", "SK", "HU", "RO", "BG", "RS", "BA", "SI", "ME", "MK", "HR",
}

# ── Home continent + transcontinental guest weighting ──
# Most chars: home continent only. Transcontinentals: both pools, reduced on guest continent.
# Stacy: exception — same weight in both nature pools (7%), no guest discount.
# Ana: beach/coastal, not a nature-pool char.
CHAR_HOME_CONTINENT = {
    "quinn": "us", "jade": "us", "amber": "us", "tammy": "us", "diaz": "us",
    "maya": "us", "kay": "us", "chad": "us", "stacy": "us", "zara": "us", "isabella": "us",
    "ingrid": "eu", "luca": "eu", "alessandra": "eu",
}
TRANScontinental_CHARS = {"quinn", "stacy", "chad", "amber", "zara", "ingrid", "luca"}
UNIFORM_GLOBAL_CHARS = {"stacy"}  # in pool at listed weight — no ×0.45 on guest continent
NATURE_US_GUEST_CHARS = {"werra"}  # small fixed weight in us_nature — not full transcontinental
NATURE_GUEST_WEIGHT = 0.45

# ── ROAD POV (not characters) ──
# CHARACTER_SPECS["driver_pov"]: dashboard POV — hands/road only, driver never fully visible.
# CHARACTER_SPECS["driver_van"]: exterior van shot — no driver visible.
# NOT in MULTI_CHAR_ROTATION or country char pools. Selected only via try_road_pov() or scenic PLACE_OVERRIDES.
# Shots: main (+ scenic-drive pack). Never day-hike / far / activity / road-identity.
POV_KEYS = frozenset({"driver_pov", "driver_van"})
_ROAD_POV_ROTATION_KEYS = {"us_desert", "us_south"}


def driver_pov_ok(country_code: str, terrain_type: str, place_type: str, place_name: str = "") -> bool:
    if place_name in SCENIC_DRIVE_PLACES:
        return True
    if (place_type or "").lower() == "scenic_drive":
        return True
    rot = get_rotation_key(country_code, terrain_type, place_type)
    if rot in _ROAD_POV_ROTATION_KEYS:
        return True
    if rot in NATURE_ROTATION_KEYS or rot in {"alpine", "nordic", "balkan", "atlantic", "metropolis", "coastal_med"}:
        return False
    if country_code in ["US", "CA"] and terrain_type in ["mountain", "lake"]:
        return False
    if country_code not in AMERICAS_CODES:
        pt_l = (place_type or "").lower()
        if pt_l in {"national_park", "wilderness", "nature_reserve", "natural_park"}:
            return False
        if terrain_type in {"mountain", "mountains", "high_mountains", "wilderness", "lake"}:
            return False
    return country_code in ["US", "CA", "MX"]


def try_road_pov(country_code: str, terrain_type: str, place_type: str, place_name: str = "") -> str | None:
    """Sole random path to POV_KEYS — never mixed into character weighted_choice pools."""
    if not driver_pov_ok(country_code, terrain_type, place_type, place_name):
        return None
    rot = get_rotation_key(country_code, terrain_type, place_type)
    if rot == "us_desert" and random.random() < 0.30:
        return "driver_pov"
    if rot == "us_south" and random.random() < 0.15:
        return "driver_pov"
    if country_code not in ["US", "CA", "MX"]:
        return None
    if terrain_type in ["mountain", "lake"]:
        return None
    if terrain_type == "desert" and random.random() < 0.12:
        return "driver_pov"
    if (place_type or "").upper() in ["PPLC", "PPLA", "PPL"] and random.random() < 0.10:
        return "driver_pov"
    if random.random() < 0.08:
        return "driver_pov"
    return None


def _nature_rotation_weights(key: str, country_code: str, weights: dict) -> dict:
    pool = "us" if key == "us_nature" else "eu"
    us_guests = NATURE_US_GUEST_CHARS if pool == "us" else set()
    w = {}
    for char, weight in weights.items():
        home = CHAR_HOME_CONTINENT.get(char, "eu")
        if home != pool and char not in TRANScontinental_CHARS and char not in us_guests:
            continue
        if char in TRANScontinental_CHARS and home != pool and char not in UNIFORM_GLOBAL_CHARS:
            weight *= NATURE_GUEST_WEIGHT
        w[char] = weight
    if key == "eu_nature" and country_code not in _EU_NATURE_WERRA_COUNTRIES:
        w.pop("werra", None)
    return w

NATURE_ROTATION_KEYS = {"eu_nature", "us_nature"}
NATURE_WILDCARD_CHANCE = 0.08
NATURE_WILDCARD_CHARS = [
    "naomi", "charlotte", "conrad", "diana", "terry",
    "diaz", "zara", "stacy", "chad", "djordje", "elena", "nadia", "carmela", "klara",
]
NATURE_WILDCARD_NO_DISCOMFORT = {"conrad", "terry"}
NATURE_WILDCARD_DISCOMFORT = """
OUT-OF-ELEMENT NOTE: She is slightly uncomfortable in this wild setting — not miserable, just not at home here.
Subtle cues only: light fatigue, swatting at insects, rubbing lower back, adjusting ill-suited shoes,
pausing to catch breath on a slope, mild annoyance at heat, wind, or uneven ground.
Understated and believable — a city or glamour character visiting nature, not a hiking influencer.
Do not exaggerate into comedy or misery.
"""
_nature_wildcard_char: str | None = None

def weighted_choice(weights: dict) -> str:
    w = {k: v for k, v in weights.items() if k not in DISABLED_CHARACTERS and v > 0}
    if not w:
        w = weights
    chars = list(w.keys())
    probs = list(w.values())
    return random.choices(chars, weights=probs, k=1)[0]

def get_rotation_key(country_code, terrain_type, place_type):
    if country_code in ["IT","GR","HR","ME","AL"] and terrain_type == "coastal":
        return "coastal_med"
    if country_code in ["US","CA"] and terrain_type == "desert":
        return "us_desert"
    if country_code in ["US","CA"] and terrain_type in ["mountain","lake"]:
        return "us_nature"
    if country_code == "US" and terrain_type in ["flatland",""] and (place_type or "") in ["PPL","PPLA","PPLA2","PPLA3"]:
        return "us_south"
    if country_code in ["NO","SE","FI","IS","DK"]:
        return "nordic"
    if country_code in ["FR","PT","ES"] and terrain_type == "coastal":
        return "atlantic"
    if country_code in ["AT","CH"] or (country_code == "IT" and terrain_type in ["mountain","hills","lake"]):
        return "alpine"
    if country_code in ["RS","BA","MK","SI","BG","RO"]:
        return "balkan"
    if (place_type or "").upper() in ["PPLC","PPLA"] and country_code in ["GB","FR","DE","IT","ES","NL","BE","PL","HU"]:
        return "metropolis"
    if country_code not in AMERICAS_CODES:
        pt_l = (place_type or "").lower()
        pt_u = (place_type or "").upper()
        if (pt_l in {"national_park", "wilderness", "nature_reserve", "natural_park", "scenic_drive"}
                or terrain_type in {"mountain", "mountains", "high_mountains", "wilderness", "lake", "desert"}
                or pt_u in {"PRK", "PRKX", "NPARK", "RESV", "DSRT", "MNTN"}):
            return "eu_nature"
    return None

def pick_primary_character(country_code, terrain_type, place_type):
    key = get_rotation_key(country_code, terrain_type, place_type)
    if key:
        weights = MULTI_CHAR_ROTATION[key]
        if key in NATURE_ROTATION_KEYS:
            weights = _nature_rotation_weights(key, country_code, weights)
        if weights:
            return weighted_choice(weights)
    return None

def get_multi_chars(place, primary_char, claude_overall, void_energy):
    db_score = place.get("attractiveness_score", 0)
    if not (db_score >= 90 and claude_overall >= 7.5 and void_energy >= 7):
        return []
    key = get_rotation_key(place["country_code"], place.get("terrain_type",""), place.get("place_type",""))
    if not key:
        return []
    weights = MULTI_CHAR_ROTATION[key]
    if key in NATURE_ROTATION_KEYS:
        weights = _nature_rotation_weights(key, place["country_code"], weights)
    weights.pop(primary_char, None)
    if void_energy >= 9 and db_score >= 95 and "regina" not in weights:
        weights["regina"] = 0.15
    return list(weights.keys())

def guess_terrain(terrain_type, place_type):
    if terrain_type:
        return terrain_type
    pt = (place_type or "").upper()
    if pt in ["BCH","COAS","HBR","BAY","GULF"]:
        return "coastal"
    if pt in ["MT","MTS","PKS","GRGE","CLF","VAL","PRK"]:
        return "mountain"
    if pt in ["LK","LKS","LKI","RSV"]:
        return "lake"
    if pt in ["DSR","DUNE","PLAT"]:
        return "desert"
    return ""

# Valentina: only prestige / high-signal places — never village beach or generic nature
_VALENTINA_MIN_SCORE = 92
_POWER_PLACE_NAMES = frozenset({
    "Capitol Hill", "Zurich", "Frankfurt", "Singapore", "Hong Kong", "Davos",
    "Luxembourg", "The Hague", "Strasbourg", "Monaco", "Milan", "Milano", "Venice", "Venezia",
    "Rome", "Roma", "Florence", "Firenze", "Paris", "London", "Geneva", "Genf", "Zürich",
    "Cannes", "Nice", "Saint-Tropez", "St. Tropez", "Cap Ferret", "Plage du Cap Ferret",
    "Portofino", "Amalfi Coast", "Taormina", "Capri", "Como", "Lake Como", "Ibiza", "Mykonos",
    "Santorini", "Saint Barthélemy", "St. Barth", "Gstaad", "Aspen", "Hamptons",
    "New York", "New York City", "Los Angeles", "Chicago", "Miami", "San Francisco",
    "Barcelona", "Madrid", "Dubai", "Marbella", "Saint-Tropez", "Monte Carlo",
})

def is_power_place(place: dict) -> bool:
    name = place.get("name_en", "")
    if name in _POWER_PLACE_NAMES:
        return True
    score = place.get("attractiveness_score", 0) or 0
    pt_l = (place.get("place_type") or "").lower()
    pt_u = (place.get("place_type") or "").upper()
    terrain = place.get("terrain_type", "") or ""
    if pt_l in ("village", "hamlet", "isolated_dwelling"):
        return False
    _nature_pt = {"national_park", "wilderness", "nature_reserve", "natural_park", "scenic_drive"}
    _nature_terrain = {"mountain", "mountains", "high_mountains", "wilderness", "lake", "desert"}
    if pt_l in _nature_pt or terrain in _nature_terrain or pt_u in {"PRK", "PRKX", "NPARK", "RESV", "DSRT", "MNTN"}:
        return False
    if score >= _VALENTINA_MIN_SCORE:
        return True
    if pt_u in ("PPLC", "PPLA") and score >= 90:
        return True
    return False

def _valentina_fallback(country_code: str, terrain_type: str, place_type: str) -> str:
    if country_code == "IT":
        return weighted_choice({"naomi": 0.35, "carmela": 0.35, "luca": 0.30})
    if country_code in {"FR", "MC", "CH"}:
        return weighted_choice({"naomi": 0.45, "charlotte": 0.30, "celine": 0.25})
    if country_code in {"ES", "PT", "GR", "HR", "ME", "TR"}:
        return weighted_choice({"naomi": 0.35, "sofia": 0.35, "lyra": 0.30})
    return weighted_choice({"naomi": 0.40, "charlotte": 0.35, "sofia": 0.25})

def _gate_valentina(char: str, place: dict, country_code: str, terrain_type: str, place_type: str) -> str:
    if char != "valentina" or is_power_place(place):
        return char
    return _valentina_fallback(country_code, terrain_type, place_type)

def select_character(country_code: str, terrain_type: str, place_type: str, place_name: str = "", place: dict | None = None) -> str:
    _ctx = place or {
        "name_en": place_name,
        "country_code": country_code,
        "terrain_type": terrain_type or "",
        "place_type": place_type or "",
        "attractiveness_score": 0,
    }

    def _pick(weights: dict) -> str:
        w = {k: v for k, v in weights.items() if k not in DISABLED_CHARACTERS}
        if not is_power_place(_ctx):
            w.pop("valentina", None)
        if not w:
            w = {k: v for k, v in weights.items() if k != "valentina" and k not in DISABLED_CHARACTERS}
        return _gate_valentina(weighted_choice(w), _ctx, country_code, terrain_type, place_type)

    # Regina 100% cities
    REGINA_CITIES = {"Berlin", "Brussels", "Brüssel", "Geneva", "Genf", "Washington", "Washington DC", "Vienna", "Wien"}
    if place_name in REGINA_CITIES:
        return "regina"

    # Power cities — only power characters
    POWER_CITIES = [
        "Capitol Hill", "Zurich", "Frankfurt", "Singapore", "Hong Kong", "Davos",
        "Luxembourg", "The Hague", "Strasbourg"
    ]
    if place_name in POWER_CITIES:
        return _pick({"charlotte": 0.30, "valentina": 0.20, "naomi": 0.15, "regina": 0.10, "werra": 0.10, "tammy": 0.05, "yosra": 0.05, "diaz": 0.05})

    terrain_type = guess_terrain(terrain_type, place_type)
    PLACE_OVERRIDES = {
        # Driver — scenic roads
        "Pacific Coast Highway": "driver_van" if random.random() < 0.25 else "driver_pov",
        "Transfăgărășan": "driver_van" if random.random() < 0.25 else "driver_pov",
        "Grossglockner": "driver_van" if random.random() < 0.25 else "driver_pov",
        "Atlantic Road": "driver_van" if random.random() < 0.25 else "driver_pov",
        "Stelvio Pass": "driver_van" if random.random() < 0.25 else "driver_pov",
        "Trollstigen": "driver_van" if random.random() < 0.25 else "driver_pov",
        "Amalfi Coast": "driver_van" if random.random() < 0.25 else "driver_pov",
        "Chapman's Peak": "driver_van" if random.random() < 0.25 else "driver_pov",
        "Col du Galibier": "driver_van" if random.random() < 0.25 else "driver_pov",
        # Chad hype spots
        "Tulum": "chad",
        "Marrakech": "chad",
        "Cairo": "chad" if random.random() < 0.30 else "yosra",
        "Barcelona": "chad",
        "Plovdiv": "chad",
        "Tallinn": "chad",
        "Chemnitz": "chad",  # GPS error. He posts anyway.
        "Roswell": "tammy",
    }
    if place_name in PLACE_OVERRIDES:
        return PLACE_OVERRIDES[place_name]

    _road_pov = try_road_pov(country_code, terrain_type, place_type, place_name)
    if _road_pov:
        return _road_pov

    global _nature_wildcard_char
    _nature_wildcard_char = None
    rot_key = get_rotation_key(country_code, terrain_type, place_type)
    if rot_key in NATURE_ROTATION_KEYS and random.random() < NATURE_WILDCARD_CHANCE:
        _pool = [c for c in NATURE_WILDCARD_CHARS if c not in DISABLED_CHARACTERS]
        if _pool:
            _nature_wildcard_char = random.choice(_pool)
            return _nature_wildcard_char

    # Regina and Valentina don't do wilderness / national parks / canyon/desert landscapes
    _NATURE_ONLY_CHARS_EXCLUDE = {"regina", "valentina"}
    _NATURE_PLACE_TYPES = {"PRK", "PRKX", "NPARK", "RESV", "MNTN", "DSRT"}
    _NATURE_TERRAINS = {"mountain", "desert", "national_park", "wilderness"}
    _NATURE_NAMES = {
        "Grand Canyon", "Monument Valley", "Yellowstone", "Yosemite",
        "Zion", "Bryce Canyon", "Death Valley", "Joshua Tree",
        "Arches", "Canyonlands", "Mesa Verde", "Sequoia",
        "Olympic National Park", "Glacier National Park",
        "Denali", "Everglades", "Rocky Mountain National Park",
        "Acadia", "Grand Teton", "Crater Lake",
    }
    _is_nature_only = (
        place_name in _NATURE_NAMES
        or (place_type or "").upper() in _NATURE_PLACE_TYPES
        or terrain_type in _NATURE_TERRAINS
    )

    weighted = pick_primary_character(country_code, terrain_type, place_type)
    if weighted:
        if weighted in _NATURE_ONLY_CHARS_EXCLUDE and _is_nature_only:
            weighted = pick_primary_character(country_code, terrain_type, place_type)
            if weighted in _NATURE_ONLY_CHARS_EXCLUDE:
                weighted = "ingrid"  # solid fallback for outdoors
        return _gate_valentina(weighted, _ctx, country_code, terrain_type, place_type)

    # ── Weighted character pools by region/terrain ──
    # Terrain shortcuts
    is_coastal  = terrain_type == "coastal"
    is_mountain = terrain_type in ["mountain", "high_mountains", "hills"]
    is_desert   = terrain_type == "desert"
    is_city     = (place_type or "").upper() in ["PPLC", "PPLA", "PPL"]

    # ── Global wildcards — checked before region logic ──
    # These fire outside home regions at lower rates than within home region.
    # Ordering matters: each check is independent.

    # Conrad — rare, major cities globally (5%)
    if is_city and random.random() < 0.05:
        return "conrad"
    # Quinn — sporty/outdoor globally (8%)
    if (is_coastal or is_mountain or is_desert) and random.random() < 0.08:
        return "quinn"
    # Alessandra — alpine/outdoor wildcard in US/CA mountain/lake (3%)
    if (country_code in ["US", "CA"] and terrain_type in ["mountain", "lake"]
            and random.random() < 0.03):
        return "alessandra"
    # Katja — urban wildcard in US/CA cities (3%)
    if country_code in ["US", "CA"] and is_city and random.random() < 0.03:
        return "katja"
    # Djordje — cappuccino lizard: coastal/city anywhere + desert cities outside pure Gulf/Sahara
    _djordje_no_go = is_desert and country_code in {"SA","AE","QA","KW","BH","OM","LY","SD","ML","NE","TD"}
    if not _djordje_no_go and (is_coastal or is_city or is_desert) and random.random() < 0.03:
        return "djordje"
    # Diana — gothic energy, old cities globally (3%)
    if is_city and random.random() < 0.03:
        return "diana"
    # Terry — cities globally outside FR/BE home (4%)
    if is_city and country_code not in {"FR","BE","LU"} and random.random() < 0.04:
        return "terry"
    # Charlotte — cities globally outside GB home (4%)
    if is_city and country_code != "GB" and random.random() < 0.04:
        return "charlotte"
    # Naomi — prestige/coastal cities globally outside MC/TN/FR home (4%)
    if (is_city or is_coastal) and country_code not in {"MC","TN","FR"} and random.random() < 0.04:
        return "naomi"
    # Valentina — power places only (prestige cities / score ≥92), outside IT home pools
    if (not _is_nature_only and is_power_place(_ctx)
            and (is_city or is_coastal) and country_code != "IT"):
        if country_code == "US":
            _us_top10 = {
                "New York", "New York City", "Los Angeles", "Chicago", "Houston", "Phoenix",
                "Philadelphia", "San Antonio", "San Diego", "Dallas", "San Jose", "Jacksonville",
            }
            if place_name in _us_top10 and random.random() < 0.02:
                return "valentina"
        elif random.random() < 0.04:
            return "valentina"
    # Luca — coastal globally outside IT/Med home (4%)
    if is_coastal and country_code not in {"IT","GR","HR","ES","PT","FR"} and random.random() < 0.04:
        return "luca"
    # Amber — warm coastal globally outside US home (3%)
    _warm_countries = {"ES","PT","IT","GR","HR","ME","AL","TR","MA","TN","MX","BR","CU","DO","TH","ID","MY"}
    if is_coastal and country_code in _warm_countries and random.random() < 0.03:
        return "amber"
    # Regina — globally, rare (3%) — never national parks / wilderness
    if not _is_nature_only and random.random() < 0.03:
        return "regina"
    # Diaz — urban globally outside US home (3%)
    if is_city and country_code not in {"US","CA","MX"} and random.random() < 0.03:
        return "diaz"
    # Zara — city globally outside US home (3%)
    if is_city and country_code not in {"US","CA"} and random.random() < 0.03:
        return "zara"
    # Stacy — global urban tourist, same rate everywhere (2%) — not wilderness/nature
    if not _is_nature_only and random.random() < 0.02:
        return "stacy"
    # Chad — digital nomad wildcard globally (2%)
    if random.random() < 0.02:
        return "chad"
    # Kelek — cartographer, coastal/city outside TR/Maghreb home pools (2%)
    if (is_city or is_coastal) and country_code not in {"TR", "MA", "TN", "DZ", "EG"} and random.random() < 0.02:
        return "kelek"

    # Brazil
    if country_code == "BR":
        return _pick({"ana": 0.65, "sofia": 0.20, "luca": 0.15})

    # Monaco / Tunisia
    if country_code == "MC":
        return _pick({"naomi": 0.55, "valentina": 0.30, "charlotte": 0.15})

    # North Africa — yosra & kelek primary territory
    if country_code in ["MA","TN","DZ","EG"]:
        if is_coastal:
            return _pick({"yosra": 0.38, "kelek": 0.38, "katja": 0.14, "sofia": 0.10})
        if is_city:
            return _pick({"yosra": 0.48, "kelek": 0.32, "katja": 0.20})
        return _pick({"yosra": 0.58, "kelek": 0.28, "sofia": 0.14})

    # Nordics
    if country_code in ["NO","SE","FI","IS","DK"]:
        if is_coastal:
            return _pick({"ingrid": 0.40, "werra": 0.25, "katja": 0.20, "sigrid": 0.15})
        if is_mountain:
            return _pick({"ingrid": 0.45, "werra": 0.35, "alessandra": 0.20})
        if is_city:
            return _pick({"sigrid": 0.30, "ingrid": 0.25, "katja": 0.20, "werra": 0.15, "elena": 0.10})
        return _pick({"ingrid": 0.35, "werra": 0.30, "katja": 0.20, "sigrid": 0.15})

    # UK
    if country_code == "GB":
        if is_coastal:
            return _pick({"werra": 0.35, "katja": 0.25, "charlotte": 0.20, "ingrid": 0.20})
        if is_mountain:
            return _pick({"werra": 0.45, "ingrid": 0.30, "katja": 0.25})
        if is_city:
            return _pick({"charlotte": 0.40, "terry": 0.25, "naomi": 0.20, "katja": 0.15})
        return _pick({"charlotte": 0.30, "werra": 0.25, "terry": 0.25, "katja": 0.20})

    # Germany
    if country_code == "DE":
        if is_coastal:
            return _pick({"ingrid": 0.30, "werra": 0.30, "katja": 0.25, "elena": 0.15})
        if is_mountain:
            return _pick({"alessandra": 0.35, "werra": 0.35, "ingrid": 0.20, "katja": 0.10})
        if is_city:
            return _pick({"elena": 0.25, "werra": 0.20, "katja": 0.20, "charlotte": 0.15, "sigrid": 0.10, "terry": 0.10})
        return _pick({"werra": 0.30, "elena": 0.25, "katja": 0.20, "sigrid": 0.15, "terry": 0.10})

    # Austria / Switzerland
    if country_code in ["AT","CH"]:
        if is_mountain:
            return _pick({"alessandra": 0.45, "ingrid": 0.25, "werra": 0.20, "katja": 0.10})
        return _pick({"alessandra": 0.35, "werra": 0.25, "katja": 0.20, "sigrid": 0.10, "elena": 0.10})

    # France
    if country_code == "FR":
        if is_coastal:
            return _pick({"yosra": 0.35, "naomi": 0.30, "sofia": 0.20, "valentina": 0.15})
        if is_city:
            return _pick({"yosra": 0.30, "celine": 0.25, "naomi": 0.20, "valentina": 0.15, "charlotte": 0.10})
        return _pick({"yosra": 0.40, "sofia": 0.25, "celine": 0.20, "werra": 0.15})

    # Spain / Portugal
    if country_code in ["ES","PT"]:
        if is_coastal:
            return _pick({"sofia": 0.35, "ana": 0.25, "lyra": 0.20, "luca": 0.10, "valentina": 0.10})
        if is_city:
            return _pick({"maria": 0.30, "sofia": 0.25, "yosra": 0.20, "valentina": 0.15, "stacy": 0.10})
        return _pick({"sofia": 0.35, "maria": 0.30, "yosra": 0.20, "luca": 0.15})

    # Italy
    if country_code == "IT":
        if is_coastal:
            return _pick({"valentina": 0.34, "naomi": 0.25, "luca": 0.19, "sofia": 0.11, "alessandra": 0.08, "djordje": 0.03})
        if is_mountain:
            return _pick({"alessandra": 0.45, "ingrid": 0.25, "valentina": 0.20, "luca": 0.10})
        if is_city:
            return _pick({"valentina": 0.30, "carmela": 0.20, "naomi": 0.20, "luca": 0.15, "stacy": 0.15})
        return _pick({"valentina": 0.35, "luca": 0.25, "alessandra": 0.20, "sofia": 0.20})

    # Greece
    if country_code == "GR":
        if is_coastal:
            return _pick({"lyra": 0.35, "thea": 0.30, "sofia": 0.19, "naomi": 0.13, "djordje": 0.03})
        return _pick({"thea": 0.40, "lyra": 0.35, "valentina": 0.15, "sofia": 0.10})

    # Southern Balkans / Adriatic — Kelek secondary (cartographer coast)
    if country_code in ["HR","ME","AL","MK"]:
        if is_coastal:
            return _pick({"valentina": 0.23, "naomi": 0.20, "thea": 0.19, "lyra": 0.16, "kelek": 0.18, "djordje": 0.04})
        return _pick({"katja": 0.30, "elena": 0.26, "mila": 0.17, "kelek": 0.15, "thea": 0.12})

    # Balkans (north/central — no Kelek pool)
    if country_code in ["RS","BA","SI"]:
        if is_coastal:
            return _pick({"mila": 0.32, "katja": 0.26, "elena": 0.24, "thea": 0.12, "djordje": 0.06})
        if is_city:
            return _pick({"mila": 0.32, "katja": 0.27, "elena": 0.26, "diaz": 0.08, "tammy": 0.07})
        return _pick({"katja": 0.36, "werra": 0.24, "elena": 0.20, "mila": 0.20})

    # Eastern Europe
    if country_code in ["PL","CZ","SK","HU","RO","BG","LV","LT","EE"]:
        if is_city:
            return _pick({"elena": 0.25, "katja": 0.25, "mila": 0.20, "sigrid": 0.15, "olga": 0.15})
        return _pick({"elena": 0.30, "katja": 0.25, "mila": 0.20, "werra": 0.15, "olga": 0.10})

    # Ukraine / Russia area
    if country_code in ["UA","BY","MD"]:
        if is_city:
            return _pick({"olga": 0.35, "elena": 0.25, "mila": 0.25, "katja": 0.15})
        return _pick({"olga": 0.40, "werra": 0.25, "elena": 0.25, "katja": 0.10})

    # Turkey — kelek primary for Aegean/Mediterranean coast
    if country_code == "TR":
        if is_coastal:
            return _pick({"kelek": 0.43, "yosra": 0.30, "sofia": 0.14, "valentina": 0.10, "djordje": 0.03})
        return _pick({"yosra": 0.45, "kelek": 0.30, "katja": 0.15, "naomi": 0.10})

    # US / Canada — characters only; road POV via try_road_pov() above
    if country_code in ["US","CA"]:
        if is_desert:
            return _pick({"jade": 0.40, "amber": 0.35, "maya": 0.25})
        if is_coastal:
            return _pick({"kay": 0.34, "ana": 0.22, "maya": 0.18, "zara": 0.26})
        if is_mountain:
            return _pick({"ingrid": 0.40, "jade": 0.30, "werra": 0.30})
        if is_city:
            return _pick({"diaz": 0.22, "charlotte": 0.17, "tammy": 0.17, "stacy": 0.13, "zara": 0.24, "rosa": 0.07})
        return _pick({"tammy": 0.28, "jade": 0.22, "maya": 0.14, "stacy": 0.14, "zara": 0.22})

    # Mexico
    if country_code == "MX":
        if is_coastal:
            return _pick({"luca": 0.25, "sofia": 0.22, "ana": 0.22, "diaz": 0.18, "rosa": 0.13})
        return _pick({"diaz": 0.38, "tammy": 0.22, "luca": 0.20, "rosa": 0.20})

    # Latin America (non-BR/MX)
    if country_code in ["CO","VE","PE","EC","BO","PY","AR","CL","UY","GT","CR","PA","HN","SV","NI","BZ"]:
        if is_coastal:
            return _pick({"ana": 0.30, "sofia": 0.25, "luca": 0.20, "diaz": 0.15, "isabella": 0.10})
        return _pick({"ana": 0.28, "sofia": 0.22, "luca": 0.18, "diaz": 0.15, "rosa": 0.10, "isabella": 0.07})

    # Caribbean — isabella primary (Cuban-American energy fits perfectly)
    if country_code in ["CU","JM","HT","DO","PR","TT","BB","LC","VC","GD","AG","DM","KN","BS"]:
        return _pick({"isabella": 0.35, "ana": 0.30, "sofia": 0.20, "naomi": 0.10, "luca": 0.05})

    # Middle East / Gulf
    if country_code in ["AE","SA","QA","BH","KW","OM","JO","LB","IL"]:
        return _pick({"naomi": 0.35, "yosra": 0.30, "valentina": 0.20, "charlotte": 0.15})

    # Southeast Asia
    if country_code in ["TH","VN","ID","MY","PH","SG","KH","LA","MM"]:
        return _pick({"sofia": 0.30, "lyra": 0.25, "naomi": 0.20, "yuki": 0.15, "luca": 0.10})

    # India / South Asia
    if country_code in ["IN","LK","NP","PK","BD","MV"]:
        return _pick({"sofia": 0.30, "naomi": 0.25, "ana": 0.25, "diaz": 0.20})

    # Default
    return _pick({"sofia": 0.30, "valentina": 0.20, "naomi": 0.20, "luca": 0.15, "ana": 0.15})

# ══════════════════════════════════════════════
# PIPELINE FUNCTIONS
# ══════════════════════════════════════════════

_location_brief_cache = {}

# ── cost tracking ──────────────────────────────────────────────────────────────
_cost = {"img_edit": 0, "img_gen": 0, "claude_vision": 0, "claude_text": 0}
# gpt-image-2 prices (USD): edit 1024x1536 medium ~0.07, generate medium ~0.04
# claude-sonnet-4: ~$0.003 per vision call (image ~1600 tok in + ~300 tok out), ~$0.0005 text
_COST_IMG_EDIT  = 0.07
_COST_IMG_GEN   = 0.04
_COST_CLAUDE_VIS = 0.003
_COST_CLAUDE_TXT = 0.0005

def _cost_summary() -> str:
    total = (
        _cost["img_edit"]     * _COST_IMG_EDIT +
        _cost["img_gen"]      * _COST_IMG_GEN +
        _cost["claude_vision"]* _COST_CLAUDE_VIS +
        _cost["claude_text"]  * _COST_CLAUDE_TXT
    )
    return (
        f"💸 Cost estimate: ${total:.2f}  "
        f"(img_edit×{_cost['img_edit']} + img_gen×{_cost['img_gen']} + "
        f"claude_vis×{_cost['claude_vision']} + claude_txt×{_cost['claude_text']})"
    )

def claude_location_brief(place_name: str, country: str) -> str:
    _cache_key = f"{place_name}_{country}"
    if _cache_key in _location_brief_cache:
        return _location_brief_cache[_cache_key]
    _result = _claude_location_brief_uncached(place_name, country)
    _location_brief_cache[_cache_key] = _result
    return _result

def _claude_location_brief_uncached(place_name: str, country: str) -> str:
    _cost["claude_text"] += 1
    message = claude_client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=150,
        messages=[{"role": "user", "content": f"""
You are a travel photography director.
In 2-3 sentences, describe what makes {place_name}, {country}
visually unmistakable in a photograph.
Name specific landmarks, colors, architectural details, light quality, unique geography.
Focus on visual elements only. No history or violence references.
Reply only with the visual description, no preamble.
"""}]
    )
    return message.content[0].text.strip()

def build_prompt(place: dict, character_key: str, noir_mode: bool = False, prestige_mode: bool = False, nightlife_mode: bool = False, viper_mode: bool = False, maxpower_mode: bool = False, outfit_override: str = None, eclipse_mode: bool = False, sidewinder_mode: bool = False, continental_mode: bool = False, dayhike_mode: bool = False, us_mode: bool = False, eu_mode: bool = False, layers_only: bool = False) -> str:
    _nails_lock = ""
    if not layers_only:
        _body_locks = [
            x for x in (
                get_character_nails_lock(character_key),
                get_character_marks_lock(character_key),
                get_character_piercings_lock(character_key),
            )
            if x
        ]
        if _body_locks:
            _nails_lock = "\n" + "\n".join(_body_locks)
    char_spec = _apply_vehicle_to_spec(CHARACTER_SPECS.get(character_key, ""), character_key, place.get("country_code", ""))
    name = place["name_en"]
    country = place["country_code"]
    terrain = place.get("terrain_type", "")
    # Metka swimwear override — sporty freediving cut, not fashion triangle
    _location_outfit = None
    if character_key == "metka" and not outfit_override and terrain in {"coastal", "lake"}:
        outfit_override = "SWIMWEAR OVERRIDE: sporty freediving bikini — black, narrow cross-back straps or tie-string top, no padding. Hipster-cut bottoms. NOT a fashion triangle bikini. Overrides reference image swimwear."

    if not layers_only and not dayhike_mode and not outfit_override:
        _location_outfit = get_location_outfit_override(character_key, place)
        if _location_outfit:
            outfit_override = _location_outfit
    if not layers_only and not dayhike_mode and not outfit_override:
        _street_outfit = get_city_street_outfit_override(character_key, place)
        if _street_outfit:
            outfit_override = _street_outfit
    _location_outfit_main = bool(_location_outfit and not layers_only and not dayhike_mode)

    # Towel rule — when character is in swimwear on hard surfaces
    _swimwear_chars = {"ana", "sofia", "maya", "kay", "tasha", "kiona", "metka", "amber", "ingrid", "quinn", "yuki", "elena", "alessandra", "werra"}
    _hard_surfaces = {"coastal", "lake"}
    _towel_note = ""
    if place.get("name_en") == "Abraham Lake":
        _towel_note = (
            "\nSURFACE (ABRAHAM LAKE): solid frozen ice only — bubbles under ice. "
            "Towel on ice ok. NOT liquid water, NOT swimming."
        )
    elif character_key in _swimwear_chars and terrain in _hard_surfaces:
        _swim_ctx = (outfit_override or "").lower()
        if any(s in _swim_ctx for s in ("bikini", "swimsuit", "swimwear", "one-piece", "sports bikini")):
            _towel_note = (
                "\nSURFACE DETAIL: if character sits or lies on rock, stone wall, dock, or concrete — "
                "towel underneath her, natural, not staged. Color: white, sand, or dark. "
                "On sand: towel present 50% of shots — sometimes she just sits directly in the sand."
            )

    _amber_coyote_note = ""
    if character_key == "amber" and not layers_only:
        _amber_coyote_note = (
            "\nCOYOTE TEST: Real wild coyote in mid-ground only — clearly visible, "
            "NOT in extreme foreground, NOT a blurred passer-by. Not tiny in the distance. "
            "Clearly a coyote, not a dog, not Goldie. "
            "~10% visual echo only: faint reddish-tan coat tint, slightly softer ear line than a typical coyote. No collar. "
            "~10% character echo: quiet watchful trickster calm like Goldie. "
            "Amber notices — friendly, unhurried reaction: soft glance, slight amused smile, relaxed acknowledgment. "
            "Bond, not predator-prey — never fleeing, never hunting the coyote. "
            "Not performing, not startled. A quiet moment between them."
        )

    setting_hints = {
        "coastal":  "ocean, beach, cliffs, harbor, sea light",
        "mountain": "dramatic peaks, alpine light, snow-capped summits",
        "mountains": "forest trails, limestone lakes, waterfalls, boardwalks, national park light",
        "desert":   "vast arid landscape, heat shimmer, red rock",
        "lake":     "turquoise or dark water, reflections, stillness",
        "hills":    "rolling landscape, golden fields, soft light",
        "flatland": "wide horizon, big sky, open road",
    }
    setting = setting_hints.get(terrain, "scenic landscape")
    _place_mandatory = PLACE_MANDATORY_NOTES.get(name, "")
    if _place_mandatory:
        setting = f"{setting}\n{_place_mandatory}"
    season = get_season_context(country)
    if name == "Abraham Lake":
        season = "Deep winter — frozen lake ice, sub-zero air, snow on mountain shores."

    if is_nature_place(place) or is_beach_place(place) or is_desert_place(place):
        noir_mode = prestige_mode = nightlife_mode = viper_mode = maxpower_mode = eclipse_mode = False

    _vehicle_block = get_vehicle_suppress_block(character_key, place)
    style_hint = CHARACTER_STYLE.get(character_key, "")
    terrain_type_val = place.get("terrain_type", "")
    camera_hint = get_camera_style(character_key, terrain_type_val, "main")
    style_line = ""
    if style_hint:
        style_line += f"\nPhotographic influence: {style_hint}"
    if camera_hint:
        style_line += f"\nCAMERA & STYLE: {camera_hint}"
    photo_detail = get_photo_style(character_key)
    if photo_detail:
        style_line += f"\nFILM & SKIN: {photo_detail}"
    time_of_day = CHARACTER_TIME_OF_DAY.get(character_key, "")
    if time_of_day:
        style_line += f"\nLIGHT & TIME: {time_of_day}"
    loc_mood = get_location_mood(terrain, place.get("place_type",""))
    if loc_mood:
        style_line += f"\nLOCATION MOOD: {loc_mood}"
    if get_character_group(character_key) == "candid":
        style_line += "\nSTREET ENERGY: Documentary street photography instinct — she exists in the city, the camera happens to be there."
    _cleo_period = get_cleo_period_note(place) if character_key == "cleo" else ""

    # Driver POV gets simplified prompt to avoid safety blocks
    if character_key in ["driver_pov", "driver_van"]:
        hand_variants = [
            "one hand on steering wheel — fingers loosely wrapped",
            "one hand on steering wheel — drumming lightly on the wheel",
            "one hand on steering wheel — arm slightly extended, relaxed grip",
        ]
        _rng = random.Random(name)
        hand = _rng.choice(hand_variants)
        state = place.get("state_name", "")
        _loc_name = f"{name}, DC" if name == "Washington" and country == "US" else f"{name}{(', ' + state) if state else ''}, {country}"
        location_brief = claude_location_brief(_loc_name, country)
        terrain_pov = place.get("terrain_type", "")
        _time_hint = CHARACTER_TIME_OF_DAY.get("driver_pov", "")
        windshield = pick_windshield(terrain_pov, _time_hint)
        windshield_desc = WINDSHIELD_VARIANTS.get(windshield, "")

        # Region-specific mulde clutter
        _is_us_region = country in AMERICAS_CODES
        _is_balkan = country in {"RS","BA","MK","SI","HR","BG","RO","HU","CZ","SK","PL","UA","MD","AL","ME","GR","TR"}
        _is_nordafrika = country in {"MA","TN","DZ","LY","EG"}

        if _is_us_region:
            _mulde_universal = [
                "diner receipt, coffee ring stain on it",
                "gas station receipt, pump number still visible",
                "crumpled Waffle House napkin",
                "motel key card, no name on it",
                "truck stop loyalty card, half punched",
                "baseball cap peak visible over dashboard edge",
                "gas station coffee cup, paper, slightly crushed",
                "two quarters and a dime",
                "parking stub from a city lot",
                "crumpled fast food bag corner",
                "AAA card, slightly bent",
                "stub of a pencil",
            ]
        elif _is_balkan:
            _mulde_universal = [
                "crumpled motorway toll ticket, Balkan highway",
                "small espresso cup, ceramic, no saucer",
                "corner torn from a paper map, handwritten route",
                "parking ticket from a coastal town",
                "crumpled cigarette pack, Marlboro or local brand",
                "small Orthodox icon or laminated saint card",
                "ferry ticket stub, folded twice",
                "two coins, different countries",
                "a single key on a worn keyring, no logo",
                "small glass of water, half empty — somehow still there",
                "old toll receipt, foreign country",
                "stub of a pencil",
            ]
        elif _is_nordafrika:
            _mulde_universal = [
                "crumpled toll receipt, Arabic text partly visible",
                "small ceramic ashtray, one cigarette's worth",
                "corner of a hand-drawn map, someone else's handwriting",
                "two coins, one dirham, one euro",
                "small Fatima hand pendant, hanging from mirror or lying flat",
                "sugar cube, loose, slightly damp",
                "folded bus or ferry ticket, local language",
                "stub of a pencil",
                "parking ticket from a medina",
                "small bottle of argan oil, half full, cork loose",
            ]
        else:
            # EU main — understated, lived-in
            _mulde_universal = [
                "small espresso cup receipt, cafe stamp on back",
                "crumpled motorway toll ticket",
                "old parking ticket, city name readable",
                "corner torn from a paper map, handwritten X",
                "two coins, different EU countries",
                "crumpled cigarette pack, half empty",
                "small wooden cross or saint medal",
                "ferry ticket stub, folded once",
                "a single key on a worn keyring, no fob",
                "stub of a pencil",
                "aspirin blister pack, two pills missing",
                "used book of matches from a bar",
            ]
        _mulde_terrain_items = {
            "coastal":       ["small seashell, pale", "a mussel shell, dried out", "handful of sand in one corner", "small smooth pebble from the shore"],
            "mountain":      ["small pine cone", "two smooth mountain stones", "dried edelweiss, pressed flat", "gravel dust in the corner"],
            "high_mountains":["ski lift ticket stub", "small pine cone", "two smooth stones", "dried wildflower"],
            "desert":        ["small reddish rock fragment", "fine red dust in the corner", "dried seed pod", "pale sand in one corner"],
            "lake":          ["small smooth lake stone", "dried reed stem", "two flat pebbles", "a mussel shell, freshwater"],
            "hills":         ["one dried wildflower", "small smooth stone", "acorn, dried out", "two coins"],
            "flatland":      ["small flat stone", "dried grass stem", "crumpled toll receipt"],
        }
        _terrain_specific = _mulde_terrain_items.get(terrain_pov, [])
        _mulde_everyday = _mulde_universal + _terrain_specific
        _mulde_mission = [
            "handwritten list of place names, some crossed out",
            "sealed envelope, no return address",
            "coordinates on a torn scrap of paper, handwritten",
            "newspaper clipping, folded multiple times",
            "small notebook with rubber band, never open",
            "visiting card, phone number only — no name",
            "key that fits nothing in this van",
            "old compass, glass slightly cracked",
        ]
        _mulde_roll = random.random()
        if _mulde_roll < 0.25:
            mulde_desc = "Small tray next to Jesus figurine: empty."
        elif _mulde_roll < 0.55:
            item = random.choice(_mulde_everyday)
            mulde_desc = f"Small tray next to Jesus figurine: {item}."
        elif _mulde_roll < 0.70:
            items = random.sample(_mulde_everyday, 2)
            mulde_desc = f"Small tray next to Jesus figurine: {items[0]}, {items[1]} — casually together."
        elif _mulde_roll < 0.80:
            items = random.sample(_mulde_everyday, 3)
            mulde_desc = f"Small tray next to Jesus figurine: {items[0]}, {items[1]}, {items[2]} — accumulated, not arranged."
        elif _mulde_roll < 0.875:
            item = random.choice(_mulde_mission)
            mulde_desc = f"Small tray next to Jesus figurine: {item}."
        else:
            mission = random.choice(_mulde_mission)
            everyday = random.choice(_mulde_everyday)
            mulde_desc = f"Small tray next to Jesus figurine: {mission}, {everyday} — sitting together without explanation."

        if _is_balkan:
            _jesus_desc = "small Orthodox icon — laminated, saint or Madonna, slightly faded"
        elif _is_nordafrika:
            _jesus_desc = "small Jesus figurine"  # stays — the Driver carries what he carries
        else:
            _jesus_desc = "small Jesus figurine"

        return f"""POV shot from inside a vintage campervan driving through {name}, {country}.
{hand}. Road ahead visible through windshield. The van drives ON A ROAD — always asphalt, highway, or street.
WINDSHIELD: {windshield_desc}
Dashboard: {_jesus_desc}, white chess king piece mostly lying down or half-leaning — never perfectly upright. {mulde_desc} Paper map half-folded on passenger seat.
90s car radio with LED display — station number faintly visible. Analog buttons, worn.
Polaroid photos clipped above windshield — one shows a small reddish-tan dog, rose ears, red collar. Podenco-Terrier mix. The only photo he keeps upright.
Small wooden rosary hanging from mirror.
Hands: capable, masculine, strong and lived-in but not old. Left hand stays on left side of wheel.
{location_brief}
Cinematic 35mm grain, natural light, golden hour. No face visible. Portrait 800x1200."""

    state = place.get("state_name", "")
    _loc_name = f"{name}, DC" if name == "Washington" and country == "US" else f"{name}{(', ' + state) if state else ''}, {country}"
    location_brief = claude_location_brief(_loc_name, country)

    nightlife_layer = """
REGISTER: residual late-90s European nightlife luxury translated into a timeless modern setting. Not retro revival. Not Y2K parody. These people never psychologically left 1999.
SETTING: Mediterranean luxury hotel, executive cocktail bar, marble penthouse, private members club, casino lounge, chauffeur-driven sedan, Monaco terrace, airport VIP lounge, upscale restaurant at midnight. Occasional rain on glass, chrome reflections, cigarette haze, pool light spill.
LIGHTING: Direct flash mixed with warm tungsten practicals and ambient architectural lighting. Hard Mediterranean highlights, deep warm shadows. Glossy reflections on marble, leather, chrome, silk, nylon. Never cold, blue, cyberpunk or clinically modern. Warm blacks. Slight overexposure in highlights acceptable.
COLOR PALETTE: Black dominates. Deep burgundy, espresso brown, champagne ivory, metallic silver, warm gold, dark olive, glossy white as accents. Bronzed skin tones. Red nails preferred.
OUTFIT PREFERENCE: Late-90s European power dressing with nightlife undertones. Tailored blazers, fitted turtlenecks, satin skirts, glossy bodycon dresses, structured tops, leather pencil skirts, subtle PVC details, sheer stockings, patent stilettos, elegant sleeveless silhouettes. Clothing expensive, slightly aggressive, sexually confident. Never streetwear. Never athleisure.
STYLING: Glossy lips, visible bronzer, clean eyeliner. Hair smooth, blown out, slightly humid or wind-touched. Jewelry understated but expensive. Possible tiny sunglasses indoors.
TEXTURE: 35mm or medium format film grain. Real skin texture. Real fabric tension. Glossy materials: silk, satin, leather, patent leather, nylon, marble, chrome, smoked glass. Slight flash bloom and analog imperfection welcome.
MOOD: Quiet social power. European nightlife wealth before social media fully existed. Confident, decadent, faintly dangerous. The atmosphere of people who own hotel floors, not startups.
REFERENCES: Late 90s Vogue Italia, Helmut Newton, Peter Lindbergh, MTV Europe after midnight, Mediterranean executive nightlife culture circa 1998–2003.
NOT: Instagram influencer, TikTok Y2K revival, modern minimalism, cheap latex, e-girl, Berlin techno, cyberpunk, cartoon glamour, hyper-clean AI beauty, visible modern trend culture.
A lost European luxury campaign from 1999 accidentally photographed in the present day.
""" if nightlife_mode else ""

    maxpower_layer = """
REGISTER: late-90s Eurotrash nightlife fantasy before social media existed. Not parody. Not ironic nostalgia. Full commitment to 1998 visual excess.
SETTING: Cheap nightclub parking lot, neon-lit garage, desert roadside diner, tuner-car meet, late-night gas station, low-budget action-movie warehouse, beach boulevard at sunset, arcade hall, import-car photoshoot, motel balcony, VHS-era glamour studio. Fog machines, colored gels, chrome rims, cheap smoke effects, wet asphalt, halogen lighting.
LIGHTING: Aggressive late-90s flash photography. Magenta-blue nightclub gels, sodium-vapor parking lot light, overexposed highlights, direct flash, warm sunset glow. Never modern cinematic grading. Never tasteful minimalism.
COLOR PALETTE: Candy-colored 90s excess. Glossy black, electric blue, hot pink, metallic silver, deep purple, chrome yellow, candy red, turquoise accents. Artificial nightlife colors welcome.
WARDROBE PREFERENCE: PVC catsuits, shiny leather pants, push-up tops, bikini tops under jackets, micro mini skirts, vinyl fabrics, lace-up pants, low-rise silhouettes, platform heels, metallic accessories, tinted sunglasses, cheap rhinestone glamour. Dangerous, playful, excessive, and slightly trashy in an authentic way.
CASTING: Late-90s promo girls, eurodance-video women, import-model aesthetics, cable-TV glamour photography. Stronger makeup, glossy lips, thinner eyebrows, visible bronzer, more exaggerated femininity, sharper posing energy. Beauty highly visual, physical, performative, very 90s.
STYLING: Big hair, crimped hair, blown-out hair, frosted makeup, body shimmer, glossy skin, visible lipliner. Artificial sex appeal embraced unapologetically.
BODY LANGUAGE: Direct eye contact. Predatory posing. Hip-heavy stance. One hand on car door, leaning over pool table, walking through neon haze, caught mid-turn, nightclub confidence. Women dominate the frame visually.
TEXTURE: VHS-era glamour photography. Cheap studio smoke, direct flash bloom, visible compression artifacts, analog noise, oversaturated nightclub tones, late-90s calendar shoot energy.
MOOD: Late-night Eurodance decadence. Cable-TV action fantasy. MTV after midnight. Fast cars, cheap champagne, fake danger, beautiful women, loud nightlife. The world feels synthetic, erotic, excessive, and strangely sincere.
REFERENCES: Late-99s Eurodance videos, Max Power magazine, import tuner culture, VHS action movies, late-night cable TV glamour, ActionGirls-era promo photography, Need for Speed intro cinematics, PlayStation 1-era nightlife fantasy.
NOT: Modern influencer aesthetics, muted realism, tasteful luxury minimalism, clean AI beauty, Instagram posing, Scandinavian design, modern streetwear, tactical realism, cyberpunk.
A forgotten 1999 European action-nightlife universe trapped forever between MTV and VHS.
""" if maxpower_mode else ""

    eclipse_layer = """
REGISTER: late-99s European nightlife thriller glamour before social media existed. Upscale, dark, glossy, cinematic. Not parody. Not Y2K revival. A 1998 European action-thriller campaign with hotel money and implied danger.
TIME PERIOD: World suspended between 1998 and 2018. Modern enough to feel real, visually detached from current trend culture. No nostalgia cosplay. These people never adapted psychologically to the modern world.
SETTING: Upscale cafes, espresso bars, hotel bars, executive cocktail bars, private members clubs, casino lounges, underground hotel garages, airport lounges, marble corridors, upscale restaurants at midnight, chauffeur-driven sedans, old-money offices, coastal terraces, Mediterranean hotel pools, Monaco streets at night, dark wood interiors, business hotels, leather booths, smoked mirrors, rain on glass.
LIGHTING: Warm cinematic nightlife lighting mixed with direct flash. Deep shadows, glossy highlights, tungsten practicals, sodium-vapor streetlight, bar lamps, wet reflections, marble bounce, cigarette haze, warm neon spill. Pool scenes: hard Mediterranean sun or warm sunset. Never cold blue, never ultra-clean commercial, never hyper-modern LED.
COLOR PALETTE: Black dominates. Champagne ivory, espresso brown, warm beige, charcoal, deep burgundy, dark olive, metallic silver, warm gold. Pool scenes may add turquoise water and pale stone — wardrobe stays black, white, beige, cream, leather brown, dark neutrals.
WARDROBE: Late-99s European power dressing with actionglam undertones. Tailored blazers, silk blouses, fitted shirts, ribbed turtlenecks, leather jackets, pencil skirts, tailored trousers, fitted knitwear, leather pants, sheer stockings, patent heels, pointed pumps. Pool: black one-piece or black bikini, white open shirt, wet hair, sunglasses. Avoid micro-miniskirts, constant cleavage, lingerie presentation.
CASTING: Late-99s European thriller women. Attractive, physical, composed, adult, slightly dangerous. Mediterranean, Central/Eastern European, mixed looks. Brunettes, blondes, curly, tied, short hair. Distinctive faces — sharper cheekbones, stronger eyes, bronzer, glossy lips, slight fatigue, social confidence. Cinematic, expensive, physically present.
STYLING: Glossy lips, bronzed skin, clean eyeliner, subtle smokey eyes, dark or red nails, realistic makeup. Hair blown out, wind-touched, nightlife-disheveled, or pool-wet. Understated expensive jewelry. Secretary-thriller styling welcome: desk lamps, hotel-office atmosphere, silk blouse slightly open, pencil skirt, stockings, late-night work energy.
BODY LANGUAGE: Controlled, confident, socially dominant. Occupied, experienced, psychologically composed. Leaning on cars, standing in garages, seated at desks, walking corridors, leaning at bars, driving at night, watching from balconies, sitting poolside in silence. Sensuality controlled and contextual.
TEXTURE: 35mm or medium-format film grain. Real skin texture, nylon sheen, wet asphalt reflections, marble gloss, chrome, dark wood, smoked glass. Subtle flash bloom and analog imperfection welcome. No hyper-clean AI beauty.
MOOD: European nightlife thriller glamour. Money, danger, coastlines, documents, late-night calls, hotel arrivals, cigarette smoke, black coffee, expensive fatigue. Women belong in expensive places and might disappear before anyone understands who they are.
REFERENCES: Late-99s Vogue Italia, Helmut Newton, Peter Lindbergh, European action thrillers, Mediterranean hotel noir, MTV Europe after midnight, Riviera crime cinema, executive nightlife 1998–2003.
NOT: Weapons, tactical gear, cheap latex, forced cleavage, constant lingerie, influencer posing, TikTok Y2K, Berlin techno, cyberpunk, hyper-modern architecture, cartoon glamour, tropical vacation aesthetics, retro nostalgia cosplay.
A lost European nightlife thriller campaign from 1999 accidentally photographed sometime before 2020.
""" if eclipse_mode else ""

    sidewinder_layer = """
REGISTER: late-99s North American nightlife thriller glamour before social media existed. Cinematic, physical, warm, mobile, slightly dangerous. HBO late-night thriller energy, Michael Mann side character, forgotten 1999 premium cable campaign.
TIME PERIOD: Suspended between 1998 and 2018. Modern enough to feel believable, detached from current trend culture. No retro cosplay, no nostalgia props. These people never emotionally transitioned into the social-media era.
SETTING: Late-night diners, rooftop bars, motel pools, marina restaurants, Palm Springs hotels, Miami cocktail bars, Vegas casino corridors, airport terminals, parking structures, gas stations at night, desert highways, coastal roads, convertible interiors, dark lounges, old business hotels, pool bars, beachside resorts, leather booths, rain on asphalt, warm California interiors, Vancouver night rain, Arizona heat haze. Timeless, slightly worn, pre-2020. Avoid hyper-modern architecture, Apple-store aesthetics, TikTok environments.
LIGHTING: Warm American nightlife lighting mixed with direct flash. Sodium-vapor parking lot glow, motel neon spill, diner fluorescence, sunset heat, marina reflections, warm tungsten interiors, wet asphalt, dashboard light, hotel bar lamps. Pool scenes: sun-heated, coastal, cinematic — Palm Springs or Miami after-hours. Never cold cyberpunk blue, never hyper-clean commercial, never Instagram resort.
COLOR PALETTE: Black, warm white, faded cream, espresso brown, dark denim, charcoal, metallic silver, leather brown, deep burgundy, olive, warm gold. Pool scenes may add faded turquoise, sun-bleached concrete, pale sand, sunset orange, motel-pool blue. Slightly analog and lived-in, not oversaturated.
WARDROBE: American late-99s thriller nightlife. Leather jackets, fitted ribbed tanks, black dresses, dark denim, fitted tees, tailored trousers, pencil skirts, back-seam stockings, heels, boots, pointed pumps, silk blouses, slightly open shirts. Pool: black bikini or one-piece, white oversized shirt, wet hair, sunglasses. Sexy is situational. No micro-miniskirts, no constant lingerie, no Instagram baddie proportions.
CASTING: American or Canadian late-99s thriller heroines. Physical, confident, mobile, experienced, emotionally self-contained. More athletic than European version. California brunettes, Miami blondes, Mediterranean-American, Latina, mixed North American looks. Distinct faces — visible bronzer, stronger eyes, slight fatigue, realistic beauty, healthy bodies, cinematic presence.
STYLING: Glossy lips, bronzed skin, soft smokey eyes, lightly humid skin. Hair wind-touched, heat-touched, slightly messy, pool-wet, blown-out, or naturally textured. Personal wearable jewelry: silver hoops, watches, thin necklaces, sunglasses.
BODY LANGUAGE: Relaxed but alert. Moving through the world, not posing for attention. Leaning against cars, sitting in diners, walking through parking garages, standing at marina bars, driving coastal highways, watching from motel balconies, poolside silence after midnight. Sensuality warm, physical, confident — not performative.
TEXTURE: 35mm film grain, motel neon glow, dashboard reflections, slight flash bloom, analog softness, real skin texture, wet pavement, leather shine, faded interiors, smoked glass, sodium-vapor light spill. No hyper-clean AI perfection.
MOOD: American nightlife mobility. Roads, heat, coastlines, diners, motels, late-night calls, airport terminals, convertibles, marina bars, motel pools, black coffee at 2am. Women always arriving or leaving somewhere. Less aristocratic than European version. More physical, mobile, emotionally alive, road-oriented.
REFERENCES: Michael Mann, Miami Vice, Out of Sight, 90s HBO thrillers, late-night cable glamour, Palm Springs nightlife, California coastal noir, Vegas after midnight, motel-pool Americana.
NOT: Weapons, tactical gear, hyper-curvy caricatures, Instagram influencer, TikTok Y2K, modern wellness luxury, cyberpunk, clean AI beauty, modern athleisure, forced empowerment posing, cartoon glamour, tropical influencer aesthetics.
A forgotten North American nightlife thriller universe that emotionally never left 1999.
""" if sidewinder_mode else ""

    us_layer = """
NORTH AMERICAN ROADLIFE OVERRIDE — contemporary North American travel atmosphere for American and North American audiences. Open, cinematic, warm, mobile, emotionally immediate. The world feels large, breathable, and full of movement.
SETTING: Roadside diners, gas stations at night, motel pools, marina restaurants, rooftop bars, desert highways, coastal roads, national parks, mountain towns, late-night parking lots, beach promenades, airport terminals, suburban bars, roadside cafes, convertible interiors, forest roads, lake towns, Palm Springs hotels, Miami nightlife, Vancouver rain, Arizona sunsets. Contemporary but detached from influencer culture.
LIGHTING: Golden-hour sunlight, sodium-vapor streetlight, motel neon, diner fluorescence, dashboard glow, sunset heat, wet asphalt reflections, marina light spill, hard California daylight, late-night parking-lot lighting. Natural and practical light sources preferred.
COLOR PALETTE: Warm whites, faded denim blue, black, leather brown, sun-faded reds, dusty beige, charcoal, motel-pool turquoise, sunset orange, chrome reflections, muted neon tones. Slightly weathered and physically real.
WARDROBE: Denim, leather jackets, ribbed tank tops, simple black dresses, boots, fitted tees, swimwear under oversized shirts, practical nightlife clothing, worn hoodies, caps, sunglasses, roadtrip layering. Physically alive and naturally attractive. No exaggerated influencer styling.
CASTING: American and North American people — believable, warm, independent, mobile, emotionally readable. More athletic and practical than fashion-editorial. California brunettes, surfers, roadtrip couples, Latina women, mountain-town people, older travelers, marina nightlife women, desert-road personalities. Beauty cinematic, approachable, real.
BODY LANGUAGE: Movement-oriented. Driving, arriving, waiting, carrying bags, leaning against cars, sitting in diners, walking through parking lots, watching sunsets, standing at overlooks, poolside silence after long drives. In motion through the world, not posing for content.
TEXTURE: 35mm film grain, dashboard reflections, motel neon glow, sun-faded textures, dust, worn leather, road grime, wet pavement reflections, analog softness. Real skin texture and natural imperfections welcome.
MOOD: Freedom, movement, heat, late-night coffee, summer storms, highways, temporary encounters, open landscapes, emotional immediacy, roadtrip melancholy, sunset arrivals.
REFERENCES: American road movies, Michael Mann atmospheres, 90s HBO travel/noir moods, California coast drives, Arizona desert highways, Pacific Northwest rain, motels, diners, marinas, national parks.
NOT: Influencer aesthetics, TikTok travel culture, sterile luxury minimalism, hyper-modern architecture obsession, algorithmic content creator energy, clean AI perfection, forced empowerment posing.
A cinematic North American world emotionally disconnected from social-media culture.
""" if us_mode else ""

    eu_layer = """
EUROPEAN / MEDITERRANEAN ATMOSPHERE OVERRIDE — contemporary European travel atmosphere for European audiences. Layered, atmospheric, emotionally restrained, culturally accumulated. The world feels lived-in, textured, and connected to place.
SETTING: Espresso bars, ferry ports, old train stations, coastal roads, mountain villages, terraces, weathered hotels, quiet plazas, harbor towns, night walks, old cafes, forest roads, Mediterranean coastlines, stone streets, market alleys, apartment balconies, rainy tram stops, late-night bars, roadside restaurants, small city hotels, old infrastructure, sea-facing promenades. Grounded, lived-in, emotionally real. Old and new coexist naturally.
LIGHTING: Warm apartment light, cloudy afternoons, Mediterranean sunset glow, ferry lighting, rain reflections, tungsten interiors, street lamps, cigarette haze, winter sunlight, sea reflections, cafe window glow. Natural and practical lighting preferred.
COLOR PALETTE: Warm stone, espresso brown, dark olive, weathered blue, charcoal, faded terracotta, cream, black, sea-grey, muted gold, Mediterranean dusk tones, aged textures. Atmospheric, slightly worn, emotionally grounded.
WARDROBE: Structured coats, knitwear, scarves, dark denim, leather jackets, boots, simple dresses, practical layering, linen shirts, wool textures, weather-appropriate clothing, subtle nightlife styling, understated elegance. Private, believable, aesthetically composed without being fashion-editorial.
CASTING: European, Mediterranean, Turkish, and North African people — regionally grounded, socially aware, emotionally restrained, connected to place. Mediterranean faces, Northern European faces, older travelers, ferry passengers, coastal-town people, mountain-road travelers, artists, cafe regulars, mixed regional identities. Beauty subtle, atmospheric, real.
BODY LANGUAGE: Stillness, observation, conversation, slow walking, sitting at cafes, watching ferries, leaning at railings, smoking outside bars, waiting at stations, quiet interaction with environments. Embedded in places rather than moving through content.
TEXTURE: 35mm grain, rain on windows, stone textures, weathered paint, aged wood, ferry metal, cafe glass reflections, fog, sea wind, analog softness, slightly imperfect lighting and framing.
MOOD: Memory, atmosphere, slow travel, sea wind, warm cafes, night ferries, quiet glamour, weather, conversation, melancholy, cultural layering, places that feel older than the people inside them.
REFERENCES: Mediterranean noir, European travel cinema, Adriatic coastlines, Italian cafes, Croatian ferries, Istanbul evenings, Moroccan coastal towns, mountain roads, old plazas, late-night espresso culture.
NOT: Influencer aesthetics, TikTok travel culture, sterile luxury minimalism, digital-native perfection, hyper-modern smart city environments, clean AI beauty, forced cinematic posing, tourist-postcard clichés.
A contemporary European world emotionally detached from algorithmic social-media culture.
""" if eu_mode else ""

    _pt_cont = (place.get("place_type") or "").lower()
    _terrain_cont = place.get("terrain_type", "") or ""
    _nature_cont = _pt_cont in _NATURE_PLACE_TYPES or _terrain_cont in _NATURE_TERRAINS
    _continental_setting = (
        "NATURE — wooden boardwalk, waterfall overlook, forest trail, lake shore, mountain pass parking, park entrance, mist on water. NO nightclub, NO urban gas station, NO hotel bar unless explicitly that place."
        if _nature_cont else
        "COAST — ferry deck, harbour promenade, coastal road pull-off, stone quay, wind on water, pier railing."
        if _terrain_cont == "coastal" else
        "URBAN — train platform, café terrace, wet cobblestone, stone plaza, tram stop, old town street."
        if _pt_cont in ("city", "medium_town", "small_town", "village") or (place.get("place_type") or "").upper() in ("PPLC", "PPLA", "PPL") else
        "TRAVEL — ferry, pass road, Raststätte, station forecourt, terrace, trailhead — match the actual location in VISUAL IDENTITY."
    )
    continental_layer = f"""
CONTINENTAL OVERRIDE — late-99s European overland travel before social media existed. EU counterpart to American road-mobility premium. Cinematic, restrained, mobile, place-bound. Not US highway noir. Not Monaco nightclub default.
TIME PERIOD: Suspended 1998–2018. Believable now. No trend cosplay. No nostalgia props.
TERRAIN MODE FOR THIS SHOT ({_terrain_cont or 'general'} / {_pt_cont or 'place'}):
{_continental_setting}
LIGHTING: Cloudy European daylight preferred; ferry lamps at dusk; tungsten café glow; rain on stone; alpine overcast; Mediterranean golden hour. Natural and practical. Night only if location brief implies it — never default to club neon.
COLOR PALETTE: Warm stone, espresso brown, charcoal, cream, sea-grey, faded terracotta, dark olive, weathered blue, muted gold. Black as accent, not uniform.
WARDROBE: Structured wool coat or worn leather jacket, dark denim or tailored trousers, boots, simple dress with coat, practical layering, linen shirt, optional wool scarf. Travel-worn quality — never nightclub latex, never influencer athleisure.
BODY LANGUAGE: Slow walking, waiting, leaning on railing, at overlook, map in hand, ferry rail, café table — embedded in place, not performing. Between destinations, not posing for content.
TEXTURE: 35mm grain, rain on glass, stone, aged wood, ferry metal, café reflections, fog, sea wind. Real skin, analog softness.
MOOD: Slow travel, pause between places, ferry wind, espresso stop, memory without performance. Culturally accumulated Europe — the traveler belongs IN this location.
REFERENCES: Wim Wenders road landscapes, European travel cinema, Adriatic ferry light, Lindbergh travel portraits, 90s Condé Nast Traveler.
NOT: US motel highway, generic gas station unless location IS a roadside stop, Monaco disco interior, Berlin techno club, Instagram travel, nightclub as default background, weapons, hyper-clean AI beauty.
COMPOSITION: No out-of-focus foreground props — no wine glass, coffee cup, flowers, candle, rope, or blurred frame-edge bokeh. Clean depth of field; location and character readable without foreground clutter.
LOCATION LOCK: VISUAL IDENTITY OF THIS LOCATION must dominate the frame (65%+). Character is a traveler inside THIS place — not imported from another country's aesthetic.
A forgotten European overland journey that never joined the social-media era.
""" if continental_mode else ""

    viper_layer = """
REGISTER: residual late-90s European nightlife luxury with action-thriller attitude. Timeless modern setting — these people never psychologically left 1999. No weapons. No tactical gear. Danger is implied, not displayed.
SETTING: Mediterranean luxury hotel, executive cocktail bar, marble penthouse, private members club, casino lounge, chauffeur-driven sedan, Monaco terrace, airport VIP lounge, upscale restaurant at midnight, underground hotel garage, coastal road overlook, wet pavement, hotel corridor. Occasional rain on glass, chrome reflections, cigarette haze, pool light spill.
LIGHTING: Direct flash mixed with warm tungsten practicals. Hard Mediterranean highlights, deep warm shadows. Glossy reflections on marble, leather, chrome, silk, nylon. Never cold, blue, cyberpunk or clinical. Warm blacks. Slight overexposure in highlights acceptable.
COLOR PALETTE: Black dominates. Deep burgundy, espresso brown, champagne ivory, metallic silver, warm gold, dark olive. Bronzed skin tones. Red nails preferred.
OUTFIT PREFERENCE: Late-90s European power dressing with nightlife undertones and implied physical competence. Tailored blazers, fitted turtlenecks, satin skirts, glossy bodycon dresses, leather pencil skirts, subtle high-gloss details, sheer stockings, patent stilettos, leather jackets, silk blouses. Expensive, slightly aggressive, socially and sexually confident. Never streetwear, never athleisure, never tactical gear.
CASTING: Women should feel physically competent, composed, and faintly dangerous. Distinctive European faces — not generic influencer beauty. Stronger noses, sharper cheek structure, deeper-set eyes, athletic posture. Beauty real, expensive, experienced, intimidating.
STYLING: Glossy lips, visible bronzer, clean eyeliner. Hair smooth, blown out, slightly humid or nightlife-disheveled. Jewelry understated but expensive. Possible narrow late-90s sunglasses indoors.
BODY LANGUAGE: Relaxed but ready. Direct posture. Functional movement. The body occupies space naturally rather than presenting itself. Sensuality controlled and strategic. No obvious posing. No pin-up energy.
CAMERA: Eye level, 50mm equivalent. Full body or 3/4 shot. Standard perspective — no distortion, no extreme angles, no low-angle body warping. Head, torso, and legs must be anatomically consistent.
TEXTURE: 35mm or medium format film grain. Real skin texture. Real fabric tension. Silk, satin, leather, patent leather, nylon, marble, chrome, smoked glass. Slight flash bloom and analog imperfection welcome.
MOOD: Quiet social power. European nightlife wealth before social media existed. Confident, decadent, faintly dangerous. Luxury espionage atmosphere without visible weapons. Women who own hotel floors, drive fast, negotiate calmly, and never explain themselves.
REFERENCES: Late 90s Vogue Italia, Helmut Newton, Peter Lindbergh, MTV Europe after midnight, Mediterranean executive nightlife 1998–2003, late-90s European action-thriller women, continental crime cinema.
NOT: Visible weapons, tactical gear, assassin cosplay, Instagram influencer, TikTok Y2K revival, cheap latex, e-girl, Berlin techno, cyberpunk, cartoon glamour, hyper-clean AI beauty, passive glamour, obvious posing.
A lost European luxury action-thriller campaign from 1999 accidentally photographed in the present day.
""" if viper_mode else ""

    _prestige_terrain = place.get("terrain_type", "") if prestige_mode else ""
    _prestige_wardrobe = (
        "Quality linen wide-leg trousers or a simple shift dress — ivory, champagne, or white. Leather sandals or espadrilles. Good leather tote or woven bag. Minimal gold jewelry. She has money. It shows in the quality, not the formality."
        if _prestige_terrain in ("coastal", "lake") else
        "Tailored blazer over silk camisole, satin shell top, or fitted corset-inspired knit. Luxury pencil skirts, sheer black stockings visible in daylight, patent stilettos. Gold watch, discreet diamond jewelry, leather handbag. Clothing communicates money, influence, and cultivated taste."
    )
    prestige_layer = f"""
REGISTER: European executive luxury before Instagram existed. Late 90s / early 2000s continental power dressing.
SETTING: Mediterranean luxury villa, Monaco hotel terrace, Milan executive rooftop, Zurich penthouse lounge, private resort restaurant, chauffeured Mercedes or yacht deck. Daytime preferred. Poolside business-meeting atmosphere. Quiet wealth everywhere. White stone, turquoise water, lacquered wood, chrome reflections, marble floors, palm shadows.
LIGHTING: Natural Mediterranean sunlight mixed with subtle direct flash. Elegant late-90s editorial contrast. Warm highlights, soft analog shadow rolloff. Never cyberpunk, never nightclub neon, never cold blue lighting.
COLOR PALETTE: Ivory, champagne, espresso brown, charcoal, black, deep emerald, burgundy, warm gold. Black may dominate but creams and warm neutrals are equally important. Avoid oversaturated modern colors.
WARDROBE: {_prestige_wardrobe}
TEXTURE: 35mm or medium-format film grain. Real skin texture, realistic fabric folds. Silk, satin, polished leather, marble, chrome, sheer hosiery. Slight analog bloom acceptable.
MOOD: Quiet authority. Controlled sensuality. Wealthy European businesswoman with nightlife connections. Calm confidence, expensive taste, social intelligence, old-money discretion. Feels like a confidential financial meeting ended ten minutes ago.
REFERENCES: Helmut Newton softer daylight work, late 90s Vogue Italia, Armani campaigns, European executive-resort editorials, Peter Lindbergh luxury photography.
NOT: Instagram influencer, LinkedIn corporate, cyberpunk, Berlin techno, cheap latex, modern fast-fashion, cartoon glamour, AI smoothness, post-2010 aesthetics.
A forgotten European luxury campaign from 1999 that quietly intimidated people.
""" if prestige_mode else ""

    _noir_has_own_style_main = character_key in {"diana", "terry"}
    _noir_char_outfit_main = {
        "valentina": "Tight black leather pencil skirt — at the knee. Black fitted top or silk blouse, slightly open collar. Back-seam stockings. Patent stilettos. She knows exactly what she is doing. Black chess queen present — on a table edge, railing, or barely visible in jacket pocket. Never prominent. Never explained.",
        "oksana":    "Micro black dress — body-skimming, short. Short genuine fur jacket worn open. Gold chains. Patent stilettos.",
        "elena":     "Fitted black wrap dress — mid-thigh. Back-seam stockings. Black heels.",
        "naomi":     "Black silk halter dress — body-skimming, floor-length with high slit. Back-seam stockings visible at the slit. Black stilettos. One thin gold bracelet. Nothing else.",
        "sigrid":    "Black leather trench coat — belted, mid-thigh length. Fitted black turtleneck underneath. Back-seam stockings. Black leather ankle boots with block heel. Hair loose. Cigarette in hand or between fingers — not lit, not posed. She is thinking about something else.",
        "charlotte": "Fitted black leather blazer over simple black slip dress — at the knee. Back-seam stockings. Pointed black heels. Small black clutch. Understated and exact.",
        "diana":     "Long black leather coat, belted. Black leather opera gloves — one or both. Back-seam stockings. Black heels. Cigarette — unlit, between gloved fingers.",
    }
    _noir_outfit_main = _noir_char_outfit_main.get(character_key, "tailored black blazer over fitted black top, or black leather pencil skirt — knee-length or just below. Back-seam stockings. Black heels or ankle boots.")
    noir_layer = ("""
ATMOSPHERE OVERRIDE — late 90s European luxury editorial mood.
LIGHTING: hard flash mixed with warm tungsten practicals. Deep shadows. Marble, chrome, dark wood catch the light.
MOOD: calm dominance, old money decadence, social power. Milan afterparty 1998. Monaco hotel bar at 2am.
SETTING PREFERENCE: interior luxury or rain-wet exterior at night. Character looks like she owns the room.
REFERENCES: Helmut Newton, late 90s Vogue Italia, Peter Lindbergh Pirelli 1997.
Character outfit follows their own specification — do not override.
""" if _noir_has_own_style_main else f"""
NOIR STYLE OVERRIDE — late 90s European power dressing. Interior luxury, hard flash, warm tungsten.
OUTFIT: {_noir_outfit_main}
POSTURE: standing or seated at bar/table — never crouching, never on the floor, never lying down. Upright. She owns the room.
MOOD: calm dominance, old money decadence. Monaco hotel bar 2am.
REFERENCES: Helmut Newton, late 90s Vogue Italia.
""") if noir_mode else ""


    # Shadow play — optional composition variant for hard-light conditions
    _shadow_chars_exclude = ["elena", "yuki", "carmela", "oksana", "lyra", "nina", "tammy", "regina"]
    _shadow_terrain_include = ["desert", "coastal", "hills", "flatland"]
    _shadow_time_exclude = ["Night", "night", "dusk", "blue hour"]
    _time_hint = CHARACTER_TIME_OF_DAY.get(character_key, "")
    _shadow_ok = (
        terrain in _shadow_terrain_include
        and character_key not in _shadow_chars_exclude
        and not any(t in _time_hint for t in _shadow_time_exclude)
        and place.get("attractiveness_score", 0) >= 80
        and random.random() < 0.33
    )
    if _shadow_ok:
        style_line += "\nCOMPOSITION OPTION: shadow present in frame — long afternoon or morning shadow falls naturally across ground or wall. Character fully visible, shadow adds depth. Natural, not staged."

    _dynamic_framing = get_dynamic_framing("main", terrain)
    _expression = get_dynamic_expression("main", character_key)
    _expression_line = f"\n{_expression}" if _expression else ""
    if character_key == "quinn" and not layers_only:
        _expression_line = (
            "\nEXPRESSION LOCK: Calm, assessing, earnest OK — NOT wide-eyed, NOT hard jaw, "
            "NOT psycho stare, NOT drilling intensity. Normal eye openness. Watching, not staring."
            + _expression_line
        )
    _fg_style_line = (
        "- Clean sightlines — no out-of-focus foreground props in frame edge; never a person or partial human in foreground\n"
        if continental_mode or dayhike_mode else
        "- No human in extreme foreground — no blurred hand, shoulder, passer-by, or second figure at frame edge; objects (cup, foliage) ok\n"
    )

    _layer_stack = f"{eu_layer}{us_layer}{continental_layer}{nightlife_layer}{maxpower_layer}{eclipse_layer}{sidewinder_layer}{viper_layer}{prestige_layer}{noir_layer}"
    if layers_only:
        return _layer_stack.strip()

    _wildcard_discomfort = nature_wildcard_discomfort_block(place)

    _wardrobe_lock = ""
    if _location_outfit_main:
        _wardrobe_lock = f"""
MANDATORY WARDROBE (main shot):
{_location_outfit}
Reference image outfit, CHARACTER spec clothing lines, and all premium-layer wardrobe hints above are superseded.
No evening gown, suit, smoking, leather jacket on sand, or nightclub clothes at this location.
"""

    return f"""
{_towel_note}
Editorial travel photography, shot on 35mm film, Kodak Portra 400, natural light only.
GLOBAL PHOTOGRAPHY DIRECTIVE:
Do not make this look impressive. Do not make it look like AI art.
Goal: believable travel photography with quiet emotional tension.

VISUAL STYLE:
- Natural imperfect light — slightly underexposed, cloudy daylight, haze, humidity
- Handheld realism — uneven composition, dead space allowed
{_fg_style_line}
- Faded colors, restrained contrast, no HDR
- Real texture, not hyper-detail

CHARACTER:
- Not performing for the camera — private moment accidentally photographed
- Emotionally contained, not overly attractive in presentation
- Practical wardrobe — slightly wrinkled fabrics, worn objects

AVOID:
- Cinematic masterpiece energy
- Glossy AI aesthetics or fashion campaign look
- Hyperreal skin or dramatic lighting
- Perfect composition or luxury influencer vibe
- Anyone looking at a phone screen, scrolling, or texting — phones appear only if held to ear during a call
- Any other person, man, woman, hand, shoulder, or partial human body in the extreme foreground — no blurred stranger, no foreground passer-by, no second figure blocking the frame edge
- Nipple piercings — none unless specified. Navel/belly-button piercings only on Rosa (gold navel ring) unless specified

ANTI-AI SIGNALS — apply sparingly, only when contextually natural, never forced:
These are the imperfections that make a photo feel real. One per image maximum. Most images have none.
- Slightly off frame — subject drifts toward edge, small dead space on wrong side
- Head or limb cut by frame edge — not dramatic, just slightly too close
- Motion blur on hair or hands — she moved a fraction before shutter
- Reflection in glass, water, or wet surface — partial, unexpected
- Half face — turned away, or edge of frame clips one side
- Wrong focus plane — foreground sharp, subject slightly soft, or reverse
- Hard shadow falling across face or body — midday, unavoidable
- Eyes half-shadowed by hat brim, hair, or overhang
- Lens flare that slightly degrades the image rather than beautifying it
- One element slightly out of place compositionally — a pole, a sign (never a person, hand, or shoulder in foreground)

WHEN TO APPLY: movement shots, candid contexts, harsh light situations, crowded urban scenes.
NEVER on: deliberate portrait shots, editorial character shots, formal framing.

ANALOG WORLD PROPS (this timeline has no smartphones except Chad — props reflect it):
When props appear naturally in the scene, they should be analog:
- Handwritten notes, postcards, letters — never typed
- Paper maps, folded, worn, annotated in pen
- Polaroid or printed photographs — never a phone screen showing photos
- Leather notebooks, journals with visible wear
- Film cameras (35mm, disposable) — not DSLRs, never a mirrorless with screen
- Printed train/ferry tickets, boarding passes on paper
- Guidebooks, paperbacks, physical books
- Cigarettes, wine, coffee cups — real objects with weight
CRITICAL: Use these props extremely sparingly — one per image maximum, only when it appears completely natural to the scene. Most shots have no props at all. Never crowded, never illustrative. A prop that draws attention to itself has failed.
CONTEXT GATE: beach/swimming/hiking/active shots have NO props — hands are free, bags are off. Props only in stationary contexts: café, station, van interior, bar, terrace.

ALTERNATIVE TIMELINE — WORLD CONTEXT (subtle, never stated explicitly):
Mobile social media does not exist in this world. Instagram was never invented.
Nobody is performing for an audience. Nobody is building a personal brand.
Travel is private. Moments are not content. Beauty is not posted.
People go places because they want to be there — not to prove they were there.

Visual consequence: no one poses. No one holds up a phone to photograph food.
No ring lights. No influencer stances. No "candid" shots that are obviously staged for followers.
The camera that took this photo is the only camera here.

Reference: travel photography from the 1990s and early 2000s — Condé Nast Traveler, early Wallpaper*, National Geographic.
Colors slightly faded or cross-processed. Grain preferred over digital clean.
Compositions feel accidental rather than composed. Moments feel stolen, not staged.
The place exists without needing to be documented. It existed before. It will exist after.

TARGET FEELING:
Like a real travel photo from a coherent world. Like someone was genuinely there.
Closer to Wim Wenders / documentary Leica photography than Midjourney showcase.{style_line}
Location: {name}, {country}. This is specifically {name}.

VISUAL IDENTITY OF THIS LOCATION:
{location_brief}

These specific visual elements MUST be present and recognizable in the image.
{setting}.

Climate and season: {season}. Outfit must match — never tropical clothing in cold climates.
{(f"OUTFIT OVERRIDE — character now wears: {outfit_override}. Ignore canonical outfit for this shot." if outfit_override else "")}{_vehicle_block}

Keep the character from the reference image — same face, same hair, same style.
Place her/him in this new location naturally. Not posing.{_expression_line}
{_wildcard_discomfort}
For Valentina in editorial character shots: blazer may be open, silk blouse visible underneath.

{_wardrobe_lock}
{char_spec}{_nails_lock}{_cleo_period}{_amber_coyote_note}
{_wardrobe_lock if _location_outfit_main else ""}

{_dynamic_framing}
Character always in lower third. Upper 25% calm for UI overlay.
No text, no watermarks. No studio lighting. Portrait orientation 800x1200.
IDENTITY: Preserve exact facial features from reference image — bone structure, lip shape, eye spacing, nose. Do not smooth, genericize, or average the face.
{_layer_stack}{_wardrobe_lock if _location_outfit_main else ""}
""".strip()

def load_canonical(character_key: str, context: str = "land"):
    """Load canonical. For maya, switches between grey (land) and swim (water) canonical."""
    if character_key == "maya":
        if context in ["water", "swim", "beach", "coastal"]:
            swim = Path("canonicals/maya_swim_canonical.jpg")
            if not swim.exists():
                swim = Path("canonicals/maya_swim_canonical.webp")
            if swim.exists():
                return swim.read_bytes()
        # Default: grey/land canonical
        grey = Path("canonicals/maya_grey_canonical.jpg")
        if not grey.exists():
            grey = Path("canonicals/maya_grey_canonical.webp")
        if grey.exists():
            return grey.read_bytes()
    base = Path(CANONICAL_IMAGES.get(character_key, "canonical_missing"))
    stem = base.with_suffix("")  # strip extension
    for ext in [".webp", ".png", ".jpg", ".jpeg"]:
        p = stem.with_suffix(ext)
        if p.exists():
            return p.read_bytes()
    print(f"  ⚠️  No canonical for {character_key}: tried {stem}.*")
    return None

def _maya_context(place: dict, activity_key: str = None, shot_type: str = None) -> str:
    """Determine if maya should use swim or grey canonical."""
    terrain = place.get("terrain_type", "")
    water_activities = {"kajak_sup", "surf_paddle", "beach_walk_distance", "muscheln_sammeln"}
    water_shots = {"wet_skin", "emerging_from_water", "arch_back"}
    if activity_key and activity_key in water_activities:
        return "water"
    if shot_type and shot_type in water_shots:
        return "water"
    if terrain in ["coastal", "lake"]:
        return "water"
    return "land"

def generate_image(prompt: str, reference_bytes=None) -> bytes:
    import tempfile
    if reference_bytes:
        img = Image.open(io.BytesIO(reference_bytes)).convert("RGB")
        tmp = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
        img.save(tmp.name, format="PNG")
        tmp.close()
        _cost["img_edit"] += 1  # count attempt, including ones that get blocked
        try:
            with open(tmp.name, "rb") as img_file:
                response = openai_client.images.edit(
                    model="gpt-image-2", image=img_file, prompt=prompt, n=1, size="1024x1536",
                )
        finally:
            os.unlink(tmp.name)
    else:
        _cost["img_gen"] += 1  # count attempt, including ones that get blocked
        response = openai_client.images.generate(
            model="gpt-image-2", prompt=prompt, n=1, size="1024x1536", quality="medium",
        )
    item = response.data[0]
    if getattr(item, "url", None):
        return requests.get(item.url).content
    elif getattr(item, "b64_json", None):
        import base64 as _b64
        return _b64.b64decode(item.b64_json)
    raise ValueError(f"No image data in response: {item}")


def _soften_prompt_for_moderation(prompt: str) -> str:
    return (prompt
        .replace("OUTFIT OVERRIDE", "STYLE NOTE")
        .replace("slightly unzipped", "half-open at collar")
        .replace("fitted top visible underneath", "dark top at collar")
        .replace("nothing underneath", "minimal styling")
        .replace("open at chest", "slightly open")
        .replace("back-seam stockings", "dark stockings")
        .replace("thigh-high boots", "tall boots")
        .replace("tight black leather", "fitted black")
        .replace("tight leather", "fitted")
        .replace("leather pencil skirt", "pencil skirt")
        .replace("patent stilettos", "black heels")
        .replace("Patent stilettos", "Black heels")
        .replace("body-skimming", "fitted")
        .replace("high slit", "side slit")
        .replace("micro black dress", "short black dress")
        .replace("Micro black dress", "Short black dress")
        .replace("near foreground", "mid-ground")
        .replace("SWIM/BEACH OUTFIT", "OUTDOOR DAY OUTFIT")
        .replace("bikini", "trail top")
        .replace("Bikini", "Trail top")
        .replace("swimwear", "day layers")
    )


def generate_image_safety_retry(prompt: str, reference_bytes=None) -> bytes:
    try:
        return generate_image(prompt, reference_bytes=reference_bytes)
    except Exception as e1:
        if "safety" not in str(e1).lower() and "moderation" not in str(e1).lower():
            raise
        print("  ⚠️  Safety block — retrying with softened prompt...")
        soft = _soften_prompt_for_moderation(prompt)
        try:
            return generate_image(soft, reference_bytes=reference_bytes)
        except Exception as e2:
            if "safety" not in str(e2).lower() and "moderation" not in str(e2).lower():
                raise
            print("  ⚠️  Still blocked — retrying without reference...")
            return generate_image(soft, reference_bytes=None)


def claude_analyze(image_bytes: bytes) -> str:
    _cost["claude_vision"] += 1
    b64 = base64.standard_b64encode(image_bytes).decode("utf-8")
    message = claude_client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=200,
        messages=[{"role": "user", "content": [
            {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": b64}},
            {"type": "text", "text": """Travel photography art director. Review this AI hero image.
Check:
1. Location dominant (65%+ of frame)?
2. Character natural, lower third, not posing?
3. Upper 20% calm for text overlay?
4. Cinematic quality, natural light?
Reply ONLY: APPROVED or one short fix (max 30 words)."""}
        ]}]
    )
    return message.content[0].text.strip()

def claude_score(image_bytes: bytes) -> dict:
    _cost["claude_vision"] += 1
    b64 = base64.standard_b64encode(image_bytes).decode("utf-8")
    message = claude_client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=300,
        messages=[{"role": "user", "content": [
            {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": b64}},
            {"type": "text", "text": """Score this travel hero image. Reply ONLY with JSON:
{
  "overall": 8.5,
  "void_energy": 7,
  "exploit_potential": 6,
  "escapism_score": 8,
  "one_line": "She arrived before the season did."
}
overall: 1-10 overall quality for travel app
void_energy: 1-10 mysterious/cinematic quality
exploit_potential: 1-10 potential for editorial fashion follow-up shot
escapism_score: 1-10 makes viewer want to be there
one_line: one evocative sentence about the image, internal metadata only"""}
        ]}]
    )
    try:
        return json.loads(message.content[0].text.strip())
    except:
        return {"overall": 7.0, "void_energy": 6, "exploit_potential": 5, "escapism_score": 7, "one_line": ""}

def convert_to_webp(image_bytes: bytes) -> bytes:
    img = Image.open(io.BytesIO(image_bytes))
    img = img.resize((800, 1200), Image.LANCZOS)
    out = io.BytesIO()
    img.save(out, "WEBP", quality=88)
    return out.getvalue()

def upload_to_supabase(webp_bytes: bytes, place: dict, character_key: str, style_tag: str = "") -> str:
    place_name = _place_slug(place)
    country = place["country_code"].lower()
    filename = f"{place_name}_{country}_cast_{character_key}{style_tag}_1.webp"
    storage_path = f"cast/{filename}"
    supabase.storage.from_("dedicated").upload(
        storage_path, webp_bytes, {"content-type": "image/webp", "upsert": "true"},
    )
    try:
        supabase.table("place_hero_images").insert({
            "place_id": place["id"],
            "storage_path": storage_path,
            "character": character_key,
            "variant": "main",
        }).execute()
    except Exception:
        pass  # storage upload succeeded; DB tracking optional
    return storage_path

# ══════════════════════════════════════════════
# GOLDIE SYSTEM
# ══════════════════════════════════════════════

GOLDIE_SCORE_PROMPT = """
Rate this location for Goldie — smooth-coated reddish-tan Podenco-Terrier mix, rose ears, red collar.
Reply ONLY with JSON:
{"dog_friendliness": 8, "cuteness_backdrop": 9, "goldie_fit": 8, "viral_potential": 9, "goldie_overall": 8.5, "goldie_line": "She found the best spot before anyone else arrived."}
goldie_overall = dog_friendliness*0.25 + cuteness_backdrop*0.30 + goldie_fit*0.25 + viral_potential*0.20
"""

GOLDIE_ACTIONS = [
    "sitting and looking directly at camera, ears forward",
    "running along the shoreline, ears flying",
    "sniffing something interesting, tail up",
    "lying in the sun, completely relaxed",
    "looking back over shoulder mid-walk",
    "standing at the water's edge, one paw in",
    "sitting next to a backpack or van wheel",
    "head out of Jeep window, wind in ears",
    "chasing a raven that is hopping just out of reach — the raven is not impressed, Goldie is fully committed",
    "watching two ravens on a wall above her — ears up, tail wagging, they ignore her completely",
    "a single raven sitting nearby, both looking in the same direction — unlikely truce",
    "trotting along, slightly ahead of where she should be, tail up",
    "mid-shake after getting wet — ears flying, water everywhere",
    "nose down, following a scent trail along the ground, tail wagging slowly",
    "sitting sideways, head turned to look at something off-frame",
]
GOLDIE_MIN_SCORE = 7.5

def claude_goldie_score(place_name: str, country: str, terrain: str) -> dict:
    _cost["claude_text"] += 1
    message = claude_client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=200,
        messages=[{"role": "user", "content": f"Location: {place_name}, {country}. Terrain: {terrain or 'general'}.\n{GOLDIE_SCORE_PROMPT}"}]
    )
    try:
        return json.loads(message.content[0].text.strip())
    except:
        return {"goldie_overall": 5.0, "goldie_line": ""}

def build_goldie_prompt(place: dict, location_brief: str, outfit_override: str = None) -> str:
    name = place["name_en"]
    country = place["country_code"]
    action = random.choice(GOLDIE_ACTIONS)
    _scene = f"SCENE OVERRIDE: {outfit_override}" if outfit_override else ""

    return f"""
Editorial travel photography, cinematic 35mm film grain, natural light.
Location: {name}, {country}.
{location_brief}
{_scene}

SUBJECT: Goldie — smooth-coated reddish-tan Podenco-Terrier mix.
Rose ears. Red collar. Always the red collar.
She is {action}.
She is not posing. She never poses.
Natural stance — weight on one side, slight lean, mid-motion or at rest.
Never stiff four-square frontal stand. Never perfectly symmetrical.
If facing camera: head slightly tilted, one ear forward, caught mid-sniff or mid-look.

{FRAMING_GOLDIE}
No text, no watermarks. Natural light only.
Portrait orientation 800x1200.
Goldie is very good girl. The best girl.
""".strip()

def upload_goldie_to_supabase(webp_bytes: bytes, place: dict) -> str:
    place_name = _place_slug(place)
    country = place["country_code"].lower()
    storage_path = f"cast/goldie/{place_name}_{country}_cast_goldie_main_1.webp"
    supabase.storage.from_("dedicated").upload(storage_path, webp_bytes, {"content-type": "image/webp"})
    supabase.table("place_hero_images").insert({
        "place_id": place["id"], "storage_path": storage_path, "variant": "goldie",
    }).execute()
    return storage_path

# ══════════════════════════════════════════════
# ROAD IDENTITY SYSTEM
# ══════════════════════════════════════════════

ROAD_IDENTITY_SPECS = {
    "ana":        "She swam here. Walking out of the water onto the shore, wet, unhurried. Or stepping off a ferry, one hand on the railing, looking at the horizon.",
    "naomi":      "Black car pulls up at a harbour, hotel entrance, or marina. She steps out — composed, unhurried. Looks at the location briefly. Already knows where she is going.",
    "valentina":  "Black limousine or taxi pulls up. Door opens. She emerges. The street adjusts.",
    "sofia":      "OCEAN COAST ONLY: arrives on foot, surfboard under arm, barefoot, salt in hair. LAKES/CITIES/INLAND: steps off local bus or taxi, linen shirt, sandals, no surfboard. She immediately looks for the nearest water. Never a dress, never luggage with wheels.",
    "yosra":      "Cream Renault van with orange stripe pulls up dusty road. Engine off. She sits a moment. Then the door opens.",
    "elena":      "Night train. Window seat. Rain outside. Steps onto platform with black duffel over one shoulder — never a trolley, never wheels. Or: arrives in black hatchback, parks without ceremony, engine off, sits a moment before getting out. The duffel comes with her everywhere.",
    "katja":      "Intercity train, window seat, map on table. Arrives with ticket still in hand.",
    "alessandra": "Road bike or gravel bike crests the hill. She unclips one foot. Looks at what is ahead. Helmet still on.",
    "ingrid":     "BMW rolls to a stop on the viewpoint. Engine off. She swings leg over. Helmet under arm, hair tumbling out.",
    "jade":       "Camaro pulls off the highway, dust cloud behind it. Door swings open. She gets out slowly. She has been here before.",
    "luca":       "COASTAL ONLY: VW Transporter at harbour or beach — board comes out first, then him. INLAND/LAKE/MOUNTAIN: VW at car park or lakeside pull-off — he steps out in jeans and faded tee, NO surfboard.",
    "chad":       "Uber arrives. He is already looking at his phone when he gets out.",
    "kay":        "Comes from the water — wetsuit half-unzipped, board under arm. Or walks up from the beach, barefoot, board under arm, wetsuit still dripping.",
    "maya":       "Old Jeep Wrangler pulls into the lot. She gets out, stretches, looks around. Still has the coffee cup.",
    "diaz":       "She is already out of the car. Standing on the pavement beside the open door — driver's door open behind her, not in front. Both feet on the ground. She faces the location and scans it. The car is behind her. She is already there. Not arriving — arrived.",
    "stacy":      "Arrives on bicycle, slightly breathless, slightly lost. Or rolls up on longboard, stops by putting one foot down. Looks at map, looks up, grins.",
    "olga":       "Intercity train, first class, window seat. She is already there before the train stops.",
    "mila":       "Arrives on foot or out of a taxi, door still moving. Was already there before you noticed.",
    "sigrid":     "Arrives on foot, fast, from the right direction. Already knows where she is going inside.",
    "quinn":      "Gets out of a car that is already moving slowly. Closes the door without sound.",
    "isabella":   "Black car pulls up. She gets out unhurried. The driver waits.",
    "maria":      "Was already there. Or walks in from a narrow street, unhurried, heels on stone.",
    "yuki":       "Steps off a night train or U-Bahn. Platform empty. She looks at the exit, not at the city.",
    "celine":     "Arrives on foot from around the corner. She lives nearby. She always lives nearby.",
    "rosa":       "Black car or taxi. Gets out first, looks around once — confirms, then moves.",
    "vera":       "Walks in from the street — wrap dress moving, red nails around a small bag or coffee cup. She has been in this city two weeks or two years. Impossible to tell which. She finds a table at the edge.",
    "camille":    "The 2CV parks two streets over — she never parks in front. Walks in from the side, a playing card already somewhere on her. She knows at least one person here. She always does.",
    "carmela":    "Was already there. Or walks out of a narrow street into the light, fur over one shoulder.",
    "oksana":     "Black car pulls up. Door opens. She steps out — unhurried. The driver waits.",
    "driver_pov": "POV approaching the location — road narrows, destination appears through windshield. The Driver slows. This is where the road ends for now.",
    "werra":      "Steps off a regional train at a small rural station — platform empty, grey sky, forest behind. Or walks out from the treeline onto a road. No luggage except a worn canvas pack. No ceremony. She has been here before in a different century.",
    "lyra":       "Arrives at dusk or evening — walks along a harbour or narrow street, approaching a lit terrace or taverna. Loose dress, relaxed pace. The location is warm and old. She belongs here.",
    "tammy":      "Steps off a Greyhound at a small town stop — energy drink in hand, already scanning the area. Or the Ford Crown Victoria pulls into a gas station or diner lot — Montana plates. She gets out slowly, stretches, looks around like she is confirming something. Marlboro already lit.",
    "thea":       "Arrives on Vespa — parks it wherever, doesn't check if it's allowed. Old scratched Vespa, Greek plates (GR), small Spartan helmet sticker on the rear. Sunglasses on, cigarette nearly finished. She has been here before. She lives here.",
    "charlotte":  "CITY: Black cab pulls up. Door opens. She steps out — long legs in back-seam nylons first, phone to ear, still finishing a call. She doesn't look up. She doesn't need to. COUNTRYSIDE: She arrives on horseback. The horse is better behaved than most people she meets. She dismounts without drama.",
    "noir":       "She was already there. Standing under the streetlamp in the rain, cigarette holder in hand, not waiting for anything. She has been here for an hour. Or a decade. The taxi that brought her is already gone.",
    "regina":     "She was already there. No arrival. She was always already there.",
}

MALE_CHARACTERS = {"luca", "chad", "conrad", "djordje", "driver_pov", "driver_van"}


def get_road_identity_arrival(character_key: str, place: dict) -> str:
    terrain = place.get("terrain_type", "") or ""
    base = ROAD_IDENTITY_SPECS.get(character_key, "Character arrives by road.")
    if character_key == "luca":
        if terrain == "coastal":
            return (
                "Volkswagen Transporter T3 or T4 at harbour or beach. Italian plates (IT), salt-stained. "
                "Board comes out first, then him — coastal surf context only."
            )
        return (
            "Volkswagen Transporter T3 or T4 at lakeside car park, trailhead, or mountain pull-off. "
            "Italian plates (IT). He steps out in worn jeans and faded tee — NO surfboard, NO wetsuit. "
            "Optional: Moka pot or beer at the open van door. He looks at the water — hiking visitor, not surfer."
        )
    return base


# ══════════════════════════════════════════════
# ACTIVITY SYSTEM
# ══════════════════════════════════════════════

ACTIVITY_SPECS = {
    "hiking_back": """
ACTIVITY SHOT: Character hiking, back to camera, on a trail or mountain path.
She walks away from us — full body, natural stride, pack or no pack.
The landscape fills 65%+ of frame above and around her.
Trail winds ahead into the scenery. She is mid-step, not pausing.
Natural light, no pose. She does not know the camera is there.
""",
    "beach_walk_distance": """
ACTIVITY SHOT: Long beach walk, character small in frame.
Wide shot — beach fills 80% of frame, character 15-20% height in lower third.
She walks along the waterline, parallel to camera, not toward it.
Wet sand, soft light, horizon visible. Nobody else on the beach.
The scale makes the beach the subject. She is the anchor.
""",
    "muscheln_sammeln": """
ACTIVITY SHOT: Character collecting shells or mussels at low tide.
She is bent forward or crouching at the waterline — picking something up.
Caught mid-gesture, not posing. Casual clothing or beach outfit.
Rocks, wet sand, tidal pools in frame. Location visible behind her.
Shot from slightly above or eye level, medium distance.
Natural candid moment — she is focused on what she found, not the camera.
""",
    "kajak_sup": """
ACTIVITY SHOT: Character on a stand-up paddleboard (SUP) on calm water — not a sit-in kayak.
She paddles — mid-stroke or paddle resting across the board. Exact stance is set by the POSE block below.
OUTFIT: Entirely from the MANDATORY SUP OUTFIT override (character BEACH/SWIM spec) — ignore generic swim defaults when override is present.
FOOTWEAR: Barefoot on the board. If feet visible at shore before launch: barefoot or simple outdoor sport sandals (Teva-style) — never heels, boots, or trainers on the water.
Water reflects sky or surrounding landscape. Location visible behind/around her.
Shot from shore or dock at water level. Natural light.
She is fully in her element — no performance, just movement. Eyes on the water, not the camera.
""",
    "going_for_a_run": """
ACTIVITY SHOT: Character mid-run or just starting — not posed, not staged.
Captured in motion or just about to move. Earphones in or around neck. Not smiling for the camera.
OUTFIT: running shorts, fitted athletic top, trail runners or road shoes. No cotton.
CONTEXT: street, coastal path, forest trail, mountain road — whatever fits the location.
Location visible and dominant — she is running through it, not posing in front of it.
Slight sweat or effort visible. Hair tied back or loose and moving.
She is not performing a run. She is on one.
LOCALE: any signage in local language of the location.
""",
    "van_morning_coffee": """
ACTIVITY SHOT: Character with morning coffee beside her vehicle.
She sits on the vehicle step, a camp chair, or leans against the open door.
Coffee cup in both hands. Looking out at the view — not at camera.
Vehicle partially visible — whatever she drives: van, Jeep, truck, or car. Use her actual vehicle from the character description.
Location and landscape behind. Soft morning light. Hair loose, casual outfit, barefoot or sandals.
The quietest moment of the day. She has not yet decided anything.
""",
    "van_getting_dressed": """
ACTIVITY SHOT: Character getting dressed or adjusting gear at her vehicle.
Vehicle door or tailgate open wide. She is half in, half out — pulling on a shirt or adjusting something.
Use her actual vehicle from the character description — van, Jeep, truck, or car.
Shot from outside at slight distance. Not explicit — the moment of transition.
Location visible around the vehicle. Natural candid energy.
""",
    "quay_fishing": """
ACTIVITY SHOT: Character fishing from a quay, pier, or harbour wall.
Simple rod or line — not sport fishing, just sitting with a line in the water. No equipment display.
Sitting on the edge, legs possibly hanging over, looking at the water.
Old harbour or working quay — fishing boats, nets, salt-worn stone. Not a tourist pier.
They are not performing fishing. They are just here, and this is what you do here.
No hurry. Could be early morning or late afternoon. Local light.
""",
    "river_fishing": """
ACTIVITY SHOT: Character fishing from a riverbank, bridge edge, or riverside rock.
Simple rod or handline. River visible — slow or fast depending on region.
They stand or sit, looking at the water. Not a sport fishing competition — just a person and a river.
Trees, banks, or old bridge stonework in background. Nobody watching.
Early morning mist acceptable. Late golden light acceptable.
No hurry. No catch necessary. The fishing is the activity, not the fish.
""",
    "campfire_sit": """
ACTIVITY SHOT: Character sitting at a campfire — night or late dusk.
Low fire, real flames, not a fire pit in a park. Desert, forest, or open land.
She sits on a log, camp chair, or directly on the ground. Something in her hand — can, mug, or nothing.
Looking into the fire or at the sky. Not at the camera.
No tents, no gear visible unless it adds to the scene. Just fire, person, and what surrounds them.
Stars visible if night. Wide shot acceptable — she can be small in the frame.
Natural firelight only — warm orange-red on face and hands.
""",
    "desert_walk": """
ACTIVITY SHOT: Character walking through open desert or barren landscape — no destination visible.
No trail, no sign, no infrastructure. Just terrain and her.
Back to camera, or three-quarter — she is moving away from us or alongside.
Flat or gently rolling desert floor, distant mountains or nothing on the horizon.
She carries nothing that doesn't fit in a pocket. No luggage. No drama.
Hard midday light or late afternoon long shadow. Heat is present — in the light, in the dust.
Wide shot — she is small in this space. The emptiness is the point.
""",
    "sunset_beer": """
ACTIVITY SHOT: Character with a cold beer at sunset — can, bottle, or local brand.
Sitting on a rock, van step, dock edge, or just standing. Not a terrace, not a restaurant.
Somewhere informal — wherever the view is good and nobody cares.
Beer held loosely, not posed. One hand or both. Label visible if local brand.
Golden hour light. They are watching the sunset, not the camera.
Clothes: whatever they wore all day. Sand, dust, or salt possible.
LOCALE: beer label or can in local language/brand of the location.
""",
    "sunset_wine": """
ACTIVITY SHOT: Character with wine glass at golden hour.
She sits on a camp chair, rock, or van bumper — facing the view, not the camera.
Wine glass in hand, slightly raised or resting on knee.
The view fills 60%+ of frame behind her — sea, mountains, or valley.
She does not look at the camera. Head faces forward toward the horizon — NEVER turned back over her shoulder.
Body and face both oriented toward the sunset. She is absorbed in the view, not posing.
Slow, quiet, earned moment. The light is everything here.
""",
    "surf_paddle": """
ACTIVITY SHOT: Character carrying surfboard toward or away from water.
Surfboard under one arm — walking on beach path, sand, or rocky approach.
She looks ahead or slightly to the side — not at camera.
Beach and ocean visible behind her. Barefoot, bikini or rashguard.
Natural movement, salt in the air implied.
""",
    "cycling_road": """
ACTIVITY SHOT: Character on bicycle on a road or path with scenic backdrop.
She rides away from camera or passes in profile — mid-pedal, natural posture.
Road winds through landscape. Location visible behind.
Casual cycling outfit — linen, light jacket, or athletic.
Shot from slightly low angle, wide. Movement implied.
""",
    "market_browse": """
ACTIVITY SHOT: Character browsing at a local market — food market, fish market, or farmers market.
She looks at produce, fish, or goods — slightly leaning forward, engaged.
Market stalls, local color in background (blurred).
She holds something — a fruit, vegetable, or item — examining it.
Natural candid moment. Local atmosphere dominant.
CRITICAL: The market must match the country and location exactly.
US/CA/MX: American farmers market, roadside produce stand, or Latin American mercado — English or Spanish signage only. No Arabic, no Cyrillic, no Asian script unless the location is explicitly in that country.
EU: European market hall or open-air market — local language signage.
Never substitute a generic Middle Eastern bazaar aesthetic for a US or European location.
FRAMING: Character occupies 40-50% of frame height. Market, stalls, and location fill 55%+.
""",
    "apres_ski_bar": """
ACTIVITY SHOT: Character at an apres-ski bar or mountain hut interior.
She sits or leans at a wooden bar — ski boots or warm boots visible.
Gluhwein or hot drink in hand. Warm interior light — lanterns, fire glow.
Other blurred figures in background. Mountain through window optional.
She is relaxed, slightly wind-flushed from outside.
""",
    "snowshoe_hike": """
ACTIVITY SHOT: Character snowshoeing or walking in deep snow — back to camera.
She walks away through a winter landscape — boots leaving tracks in snow.
Snow-covered trees or mountain peaks ahead. She is mid-stride.
Warm winter outfit — insulated jacket, hat, gloves. Natural winter light.
The silence of a snow landscape implied. She walks into it.
""",
    "beer_crate": """
ACTIVITY SHOT: Character carrying a crate of local beer bottles — she works here or lives here.
She is on a narrow street, staircase, or bar back entrance — clearly knows where she is going.
Outfit: worn shorts or cutoffs, old t-shirt or tank top, sandals or bare feet — working clothes, not tourist clothes.
Crate: local brand, label in local language of the location. Bottles visible, slightly sweaty from heat.
She is not struggling. This is not the first crate today.
Expression: focused, maybe slight annoyance if someone is in the way. She lives here.
Background: Mediterranean village street, steps, or bar entrance — not a scenic viewpoint.
LOCALE: any signage or bottle labels in local language only.

IF THEA: cigarette or toothpick in the corner of her mouth — she didn't put it down for this. Dark vintage sunglasses on. She is not impressed by the weight. She is not impressed by anything.
""",
    "watchmaker_window": """
ACTIVITY SHOT: Character standing outside a watchmaker's shop window, evening or dusk.
Inside: small illuminated workbench, loupes, watch parts on cloth, clocks on the wall showing different times.
The watchmaker — old man, absorbed — visible in background, soft focus.
Her reflection partially in the glass. She is looking at one specific watch in the display.
She has been standing here longer than she planned.
If any signage visible: local language only.
""",
    "cobbler_window": """
ACTIVITY SHOT: Character pausing outside a cobbler's workshop window.
Inside: shoes on wooden lasts, tools hanging on wall, leather scraps, warm work-light.
The cobbler visible in background — working, not looking up.
Her reflection in the glass. One pair of finished shoes on display — clearly worth the repair.
Something about the window stopped her. She is not sure what.
If any signage visible: local language only.
""",
    "reisebuero_inside": """
ACTIVITY SHOT: Character inside a small travel agency — the kind that still exists and is busy.
Paper timetables on the wall, destination posters, a rubber stamp on the counter.
She leans over the counter or sits across from an agent — paper map or brochure in hand.
Warm interior light. The agent is background, soft focus.
She is planning something. What exactly is not clear.
If any signage or posters visible: local language only.
""",
    "helmet_off": """
ACTIVITY SHOT — INGRID ONLY.
She has just removed her full-face or open-face motorcycle helmet.
Hair tumbles out — compressed from hours inside, now loosening in the air.
She shakes it loose or runs one hand through it — eyes half-closed, catching the light.
Helmet under one arm or set on the BMW seat beside her.
Leather jacket still on. She stands at a viewpoint, roadside, or parking area.
This is the most human she gets in public. She does not know it shows.
Shot from medium distance, slight low angle. Golden hour or overcast Nordic light preferred.
Location visible — road, coast, mountain — whatever she just came through.
""",
    "photo_lab": """
ACTIVITY SHOT: Character at a small photo lab or film development kiosk — the kind that still exists in old town streets, markets, or side roads.
She waits for or collects developed photos. Holds one print up to look at it — slightly squinting, slight smile or surprise.
The lab is small, local, slightly run-down. Stacks of envelopes, chemical smell implied.
Her own camera — analogue, film — either around her neck or on the counter.
Natural or indoor shop light. Warm, slightly overexposed.
Not nostalgia performance — just practical. This is how she works.
""",
    "reisebuero_window": """
ACTIVITY SHOT: Character standing outside a travel agency at dusk or evening.
She looks through the illuminated shop window — destination posters inside, warm interior glow.
Her reflection partially visible in the glass — street and shop superimposed.
Posters show places: coastlines, mountains, cities — not readable, just visible as colour and shape.
She has been standing here a moment. Not rushing. Something caught her attention.
Expression: somewhere between remembering and deciding.
If any signage visible: local language only.
""",
    "bag_rummage": """
ACTIVITY SHOT: Character rummaging through her handbag — looking for something.
Standing or sitting. Bag open, she looks inside or pulls something out.
Keys, phone, wallet, lipstick — whatever it is, she hasn't found it yet.
Slight focused expression — not stressed, just occupied.
The bag is hers: worn leather, canvas tote, or structured — matches her character.
Shot from side or slight angle. Location visible behind her.
Street, café entrance, market, hotel lobby — anywhere natural.
LOCALE: any visible signage in local language.
""",
    "menu_study": """
ACTIVITY SHOT: Character studying the menu at a restaurant or café table.
Menu in hand or on table — paper, leather-bound, or chalkboard visible.
She leans slightly forward, reads, considers. Not performing — actually deciding.
One hand on the menu, other on the table or holding a drink.
Interior or terrace. Local restaurant atmosphere — not tourist trap, not fancy.
Waiter not visible or blurred in background.
Expression: focused, slightly amused at something on the menu, or quietly calculating.
LOCALE: menu in local language of the location. No English menus in non-English speaking countries.
""",
    "harbour_walk": """
ACTIVITY SHOT: Character walking along a harbour promenade or waterfront.
She walks in profile or slightly away — parallel to the water.
Boats, masts, or harbour buildings visible behind. Water catches the light.
Casual outfit, easy stride. She may carry a coffee or small bag.
""",
    "weinlese": """
ACTIVITY SHOT: Character harvesting grapes in a vineyard.
She picks grapes by hand — small scissors or by hand, basket nearby.
Rows of vines stretch behind her. Late summer or early autumn light — golden, warm.
Slight effort visible — reaching, bending, focused on the work.
Hands possibly stained. Not performing. Actually working.
Wide shot preferred — vineyard fills the frame, she is part of it.
""",
    "olivenernte": """
ACTIVITY SHOT: Character harvesting olives — on a ladder or reaching up into branches.
Old olive trees, gnarled trunks. Net on the ground catching fallen olives.
Autumn light — softer, golden. She reaches up, focused on the work.
Simple clothing — nothing precious. This is work.
Shot from slightly below or at ground level — tree and sky above her.
""",
    "boot_streichen": """
ACTIVITY SHOT: Character painting or maintaining a boat hull.
Boat pulled out of water — dry dock, beach, or harbour slipway.
She crouches or kneels with a brush or roller. Paint on hands.
Practical clothing — old shirt, work trousers or shorts.
The boat is the subject. She is working on it.
Harbour or coastal setting visible. Natural light, no glamour.
""",
    "cafe_terrace": """
ACTIVITY SHOT: Character at a cafe terrace — seated, looking out.
Coffee or drink on the table. She looks away from camera — at the street, the view.
Cafe chairs, umbrellas, local street visible behind.
Natural light, not staged. She has been here a while.
""",
    "notebook_outside": """
ACTIVITY SHOT — TAMMY ONLY.
She sits outside — on a step, a low wall, the hood of the Crown Vic, or a cheap plastic chair.
The notebook is open. It is dense with handwriting — dates, names, arrows. Not a journal. Evidence.
Pen in hand or behind ear. Sunglasses on. Energy Drink or beer beside her.
She reads what she wrote and adds something. She is not performing this — she has been doing it for years.
Nobody else around, or people passing without looking at her.
Natural light — midday harsh or late afternoon. She doesn't care about the light.
Shot from medium distance — full body or three-quarter. The notebook is visible but not readable.
""",
    "field_repair": """
ACTIVITY SHOT — WERRA ONLY.
She kneels or crouches beside the Mercedes 240GD — something is being fixed or adjusted on the underside, wheel, or door.
Tool in hand — wrench, wire, or ratchet. She knows what she is doing. No frustration. Just work.
Practical outfit: field trousers, worn fleece or shirt. Hands possibly dirty.
Location: dirt road, forest clearing, gravel track, or open land — not a mechanic workshop.
The car is the right car for this terrain. That is the point.
Shot from low angle or side — she is focused on the task, not the camera.
Natural light — overcast or late afternoon. Central/Northern European landscape behind.
""",
    "kayak_entry": """
CANDID MOMENT: A woman is shoving a canoe off a rocky lakeshore into the water.
She stands beside the canoe on the shore — leaning forward, both hands on the gunwale, pushing the boat toward the lake. Her weight is into it. The canoe slides forward.
Shot from behind and to the side — three-quarter angle, slightly low. Her figure in the lower frame, lake and mountains behind her.
GAZE (MANDATORY): she does NOT look at the camera. Eyes on the canoe, the gunwale, the shoreline, or the lake ahead — profile, back three-quarter, or head tipped down into the push. Face may be partly turned away from lens.
NOT gaze: direct eye contact, facing the lens, portrait stare, smiling at camera, head turned back toward viewer.
OUTFIT: Hiking shorts or leggings, tank top or light shirt. Flannel tied at waist optional — only if it fits the character. Fully clothed. No swimwear. Leggings or shorts fitted enough that leg muscles read in effort — not baggy.
FOOTWEAR: Trail runners or hiking boots.
BODY / MUSCLE: Real effort — hamstrings, glutes, and calves engaged in the push (posterior chain, not a gym flex). Subtle natural definition visible through fabric on the back of the thighs and seat; one leg may be braced behind her. Athletic but candid — she is moving the boat, not posing for muscle.
NOT: bodybuilder flex, double-biceps pose, oiled skin, mirror-gym aesthetic, exaggerated vascularity, facing camera to show abs.
Wet rocks under her feet. Arms and legs working, boat moving.
Wide shot — lake, mountains, trees dominate the background. Candid, no awareness of camera.
""",
    "rope_coil": """
ACTIVITY SHOT: She stands on a dock or boat deck, coiling a thick rope by hand — looping it arm over arm.
The rope is heavy. Her hands work without hurry. She knows what she is doing.
Hair moving slightly in the harbour wind. Boat, water, or quay wall behind her.
Not posed. Caught working. She does not look at the camera.
Shot from medium distance — full figure, arms active, location readable behind.
""",
    "map_hood": """
ACTIVITY SHOT: She leans over the hood of her car, studying a paper road map spread flat on the warm metal.
One finger traces a route on the paper. Engine still ticking from the drive. A junction or mountain road visible behind.
She is working out where she is, or where she is going. Not anxious — methodical.
GAZE (MANDATORY): eyes open, head tipped down toward the map. She is READING the map — gaze on the paper, on route lines and folds. Face in profile or three-quarter so we see her looking at the map.
NOT: eyes closed, face tilted up to sky, basking in sun, looking at horizon, looking at camera, dreamy upward pose. The story is navigation, not reverie.
Car visible: hood prominent, unfolded map on metal, her figure bent over it, location behind her.
Shot from slight angle — map, her eyes on the map, and hands all readable in frame.
""",
    "tire_change": """
ACTIVITY SHOT: She is changing a flat tire by the side of the road. Car jacked up. Wheel brace in hand or on the ground.
She kneels or crouches beside the wheel — not helpless, not dramatic. She is doing the job.
Practical clothing. Hands dirty. Maybe a crease in her expression — concentration, mild irritation, not distress.
Empty road behind her. Gravel, tarmac, or a pull-off. The flat tire visible.
Shot from medium distance — car, tire, and character all in frame. She is competent. That is the point.
""",
    "metal_horns": """
ACTIVITY SHOT — YUKI / MILA / STACY.
She stands in a crowd or at the barrier — one fist raised, throwing the horns. 🤘
Not performed for the camera. She is in the moment. Eyes on the stage or closed.
Slayer t-shirt or band shirt. Leather jacket open or tied at waist. Festival wristbands.
Crowd behind her — lighters, fists, other horns. Stage light from the front, warm and hard.
Shot from slight low angle — her raised hand in frame, crowd and light behind.
Candid. She does not know the camera is there. The music is louder than everything else.
""",
    "tarot_read": """
ACTIVITY SHOT — CAMILLE ONLY.
She sits at a small café table with two or three tarot cards laid face-up on the table.
Not a full spread. Not a performance. Three cards, maybe two — placed with the calm of someone who does this privately.
A coffee cup somewhere nearby. Her eyes on the cards, or looking away — already past them.
The cards are old, slightly worn. Their backs a faded pattern.
She is not mystical. She is not performing. This is private habit made visible only because she is in a public space.
No crystals, no candles, no velvet. The café is ordinary. That is the point.
Shot from medium distance — cards visible on the table but not readable.
Expression: quiet, slightly inward. Like reading a letter from someone who knew her before she was this.
""",
    "cinema_program": """
ACTIVITY SHOT: She stands on the pavement outside an old independent cinema, studying the program board or poster display.
The cinema is traditional — classic marquee lettering, old-school poster frames, worn facade. Not a multiplex.
Think: Babylon Berlin, Phenomena Barcelona, Odeon-style, old French cinema with hand-lettered titles.
She reads the program — what's showing, when, in what language. She is deciding.
Evening light from the marquee catches her face and the posters. Warm practical light in the cold air.
She is alone. No phone. Just the program board and the question of whether to go in.
Shot from slight side or three-quarter — her figure and the cinema facade both in frame.
Urban street behind her, city sound implied. She is a regular here, or she might become one.
""",
    "kiosk_stop": """
ACTIVITY SHOT: Character at a street kiosk — the kind that sells everything and closes late.
She buys something: cigarettes, a newspaper, a scratch card, a lighter, a bottle of water.
The kiosk is small, functional, slightly cluttered — stickers, magazine covers, bottle racks.
She is mid-transaction: money in hand, or taking something from the counter.
Not lingering — she came for something specific. She knows exactly what.
Expression: neutral, brief. This is not an event. It is a stop.
Setting: street corner, station exit, narrow city passage. Not a supermarket.
LOCALE: kiosk signage, product labels, and any visible newspapers in local language only.
IF THEA: she probably already has a cigarette — or occasionally a toothpick — in her mouth.
IF TAMMY: cash only. She has exact change. She always has exact change.
IF KELEK: she picks up a local paper without looking at the headlines. She already knows.
""",
    "cigarette_roll": """
ACTIVITY SHOT — MILA, DJORDJE, OR THEA ONLY.
Quiet establishing beat: rolling a cigarette without looking at the hands.
Hands in lower frame — paper, filter, tobacco — competent, unhurried. Eyes and head elsewhere: street, sea, doorway, passing ferry, room being scanned.
Not posed for camera. Not glamour smoking — the roll is the action; lighting optional, unlit ok.
Setting: café exterior wall, harbour bench, van step, hotel entrance, old-town passage, camp chair edge — urban or coastal Balkan/Med/Greek, not wilderness trail center frame.
Late afternoon or night preferred. Natural practical light.

IF MILA: worn leather jacket, band tee or black top, dark jeans, boots. Festival wristbands stacked on one wrist — always. May have lollipop instead of tobacco — same gesture, same distraction. Anders Petersen grain — intimate Balkan street.
IF DJORDJE (male): linen shirt open collar, chinos, good loafers, tortoiseshell sunglasses on. Salt-pepper beard, textured face — prominent nose, do not beautify. Two or three dice on table ledge or dashboard nearby — never explained, not in use. Dice Man energy — unhurried, slight smile for something he just noticed, not for the camera.
IF THEA: old scratched Vespa nearby optional. Dark vintage sunglasses on. Simple summer top, jeans — off-duty not taverna uniform. Cigarette roll OR toothpick between lips instead — same attitude. Greek harbour or Cycladic wall. Contempt is in the gaze, not the hands.
NOT for luxury yacht poses, not on SUP/kayak, not in office uniform.
""",
    "newspaper_cafe": """
ACTIVITY SHOT: Character at a café table with a physical newspaper — not a phone, not a tablet.
She reads. Or she has read and the paper is folded on the table while she looks out at the street.
Coffee or small espresso visible. The cup is nearly empty or full — she has been here a while or just arrived.
The newspaper is local — broadsheet or tabloid, whatever the city has. Held or flat on the table.
No phone visible on the table. This is the point.
Setting: small local café, indoor or covered terrace. Not a chain. Not a tourist spot.
Shot from medium distance, slight angle — she is not aware of the camera.
LOCALE: newspaper masthead and any signage in local language only.
""",
    "postcard_write": """
ACTIVITY SHOT: Character writing a postcard — seated at a café table, on a harbour wall, or on a hotel terrace.
Postcard face-down or propped beside her. She writes on the back — pen moving, head slightly down.
The postcard exists. She is writing it to someone specific. She does not say who.
Stamp on the corner. She bought it at a tobacconist or kiosk, not a tourist shop.
Expression: focused, slightly private. This is not for Instagram. This is correspondence.
Shot from slight above or side — the postcard visible but not readable.
LOCALE: if any shop or signage visible: local language only.
""",
    "morning_run_urban": """
ACTIVITY SHOT — QUINN ONLY.
She runs. Not jogging — running. Hard, disciplined, efficient. No headphones, no phone visible.
Early morning city streets — barely anyone around. Wet asphalt from overnight rain preferred.
Running gear: dark compression tights or shorts, fitted technical top. No logo display.
Shot from slightly ahead or side — she passes through the frame or runs toward camera at distance.
Expression: zero. Not effort-face. Just operational. The run is not entertainment.
The city is backdrop — grey, empty, hers for this hour.
Shot wide — she is moving through a real space. Not posed, not slowing down.
""",
    "chin_up": """
ACTIVITY SHOT — QUINN ONLY.
She does a pull-up. Full extension at top — chin above bar, arms locked out.
Setting: outdoor fitness station in a park, or a bare metal bar mounted in a doorframe or alley.
NOT a gym. NOT indoor. The bar is incidental, functional — not a gym aesthetic.
Outfit: fitted crop top, shorts or compression tights. Arms and shoulders fully visible.
Shot from below or side — muscle engagement visible: triceps, lats, deltoids.
She is mid-rep or at the top. Expression: controlled effort — no grimace, just work.
This is maintenance. She does this every day.
""",
    "gear_haul": """
ACTIVITY SHOT — KAY ONLY.
She carries heavy equipment — dive bags, drysuits, fins, weights, tank — loading or unloading.
The gear is real and heavy. She carries it like it weighs nothing. One hand on a bag, other on something else.
Setting: quay, beach, boat ramp, van boot. Salt water context.
Outfit: minimal — bikini top or sports top, shorts, bare legs or neoprene bottoms.
Arms and shoulders fully loaded — muscle definition visible from the effort.
No posing. She is between two points. Getting it done.
Expression: focused, practical. She has done this a hundred times.
""",
    "tank_carry": """
ACTIVITY SHOT — METKA ONLY.
She carries two scuba tanks — one in each hand or both slung over a shoulder — walking toward water or a dive boat.
The tanks are heavy steel cylinders. Her grip is firm. Arms taut from the weight.
Setting: harbour, dive pier, rocky shore, boat deck.
Outfit: dive shorts, bikini top or rashguard top. Tanks visible with regulator attached.
The physical effort is the shot — arms, shoulders, forearms under load.
She looks ahead — not at camera. Moving with purpose.
Expression: flat, operational. This is prep, not performance.
""",
    "bike_push": """
ACTIVITY SHOT — INGRID ONLY.
She pushes her motorcycle — narrow alley, tight courtyard, bad surface, or light breakdown.
Both hands on bars, leaning into the weight, walking it forward or turning it around.
The bike is heavy. She handles it.
Outfit: fitted jacket open or removed — she's been riding. Arms visible.
Setting: cobblestone alley, gas station forecourt, gravel track.
Shot from the side — the push visible, the bike's mass implied.
Expression: mild concentration, slight annoyance. She prefers riding.
""",
    "board_carry": """
ACTIVITY SHOT — MAYA ONLY.
She carries a stand-up paddleboard overhead or under one arm, walking to or from the water.
The board is long and awkward — arms stretched wide or fully extended overhead. Full shoulder engagement.
Setting: beach, rocky shore, or wooden dock. Water visible.
Outfit: bikini or swimsuit — the physical effort makes it editorial, not staged.
Shot from in front or side — board overhead catches light, her silhouette clean underneath.
Expression: focused, slightly squinting in the sun. She's done this a thousand times.
""",
    "roadside_dusk": """
ACTIVITY SHOT — AMBER ONLY.
The Mustang is pulled over on an empty road — hood up, but nothing is wrong.
She stands beside it in the last light, looking at the horizon. Not at the engine. Not at her phone.
She stopped because something made her stop. She doesn't explain this to herself either.
Late dusk — sky still orange or deep blue above, dark below. Silhouette possible.
Outfit: whatever she wore all day. Boots. Hair moving in slight wind.
The Mustang is dark green or charcoal. The Coyote V8 is audible in the silence — it ticks as it cools.
Shot from distance — wide, she and the car are small in the landscape. The road goes on in both directions.
No other cars. No people. This is between her and whatever she is listening to.
""",
}

TERRAIN_ACTIVITIES = {
    "coastal":       ["beach_walk_distance", "muscheln_sammeln", "surf_paddle", "harbour_walk", "sunset_wine", "sunset_beer", "beer_crate", "going_for_a_run", "helmet_off", "notebook_outside", "gear_haul", "tank_carry", "board_carry", "rope_coil", "cigarette_roll"],
    "mountain":      ["hiking_back", "van_morning_coffee", "sunset_wine", "sunset_beer", "cycling_road", "snowshoe_hike", "going_for_a_run", "campfire_sit", "helmet_off", "field_repair", "notebook_outside", "map_hood", "tire_change"],
    "high_mountains": ["hiking_back", "snowshoe_hike", "apres_ski_bar", "van_morning_coffee", "going_for_a_run", "campfire_sit", "helmet_off", "field_repair", "map_hood", "tire_change"],
    "lake":          ["kayak_entry", "kajak_sup", "hiking_back"],
    "hills":         ["cycling_road", "hiking_back", "van_morning_coffee", "sunset_wine", "sunset_beer", "going_for_a_run", "campfire_sit", "river_fishing", "helmet_off", "field_repair", "notebook_outside", "map_hood", "tire_change"],
    "desert":        ["hiking_back", "van_morning_coffee", "sunset_wine", "sunset_beer", "going_for_a_run", "desert_walk", "campfire_sit", "helmet_off", "notebook_outside", "roadside_dusk", "map_hood", "tire_change"],
    "flatland":      ["cycling_road", "van_morning_coffee", "going_for_a_run", "helmet_off", "notebook_outside", "roadside_dusk", "field_repair", "map_hood", "tire_change", "cigarette_roll"],
    "national_park": ["hiking_back", "van_morning_coffee", "going_for_a_run", "campfire_sit", "desert_walk", "helmet_off", "notebook_outside", "roadside_dusk", "map_hood", "tire_change"],
    "wilderness":    ["hiking_back", "campfire_sit", "desert_walk", "helmet_off", "notebook_outside", "field_repair", "map_hood", "tire_change"],
}

PLACETYPE_ACTIVITIES = {
    "city":          ["cafe_terrace", "market_browse", "harbour_walk", "going_for_a_run", "menu_study", "photo_lab", "helmet_off", "morning_run_urban", "notebook_outside", "kiosk_stop", "newspaper_cafe", "postcard_write", "chin_up", "bike_push", "tarot_read", "rope_coil", "metal_horns", "cinema_program", "cigarette_roll"],
    "medium_town":   ["cafe_terrace", "market_browse", "harbour_walk", "going_for_a_run", "menu_study", "photo_lab", "helmet_off", "notebook_outside", "kiosk_stop", "newspaper_cafe", "postcard_write", "chin_up", "bike_push", "gear_haul", "tank_carry", "tarot_read", "rope_coil", "quay_fishing", "cigarette_roll"],
    "small_town":    ["cafe_terrace", "market_browse", "van_morning_coffee", "going_for_a_run", "menu_study", "helmet_off", "notebook_outside", "kiosk_stop", "postcard_write", "bike_push", "gear_haul", "tarot_read", "map_hood", "tire_change", "quay_fishing", "cigarette_roll"],
    "village":       ["van_morning_coffee", "market_browse", "sunset_wine", "going_for_a_run", "helmet_off", "notebook_outside", "postcard_write", "bike_push", "tarot_read", "map_hood", "tire_change", "quay_fishing", "cigarette_roll"],
    "beach":         ["beach_walk_distance", "muscheln_sammeln", "surf_paddle", "sunset_wine", "going_for_a_run", "notebook_outside", "postcard_write", "gear_haul", "tank_carry", "board_carry", "rope_coil"],
    "national_park": ["hiking_back", "van_morning_coffee", "snowshoe_hike", "going_for_a_run", "helmet_off", "notebook_outside", "roadside_dusk", "map_hood", "tire_change"],
    "nature_reserve": ["hiking_back", "kajak_sup", "van_morning_coffee", "going_for_a_run", "helmet_off", "field_repair", "rope_coil"],
    "natural_park":  ["hiking_back", "kajak_sup", "van_morning_coffee", "going_for_a_run", "helmet_off", "field_repair", "map_hood"],
}

_NO_VAN = ["van_morning_coffee", "van_getting_dressed"]
_NO_FISHING = ["quay_fishing"]  # chars who wouldn't fish by a quay

def _quay_fishing_ok(place_type: str, terrain_type: str = "") -> bool:
    pt = (place_type or "").lower()
    pt_u = (place_type or "").upper()
    if pt_u in {"HBR", "PRT"}:
        return True
    if pt_u in {"PPLC", "PPLA", "PPLA2"} or pt in {"city", "capital", "large_town"}:
        return False
    if pt not in {"small_town", "medium_town", "village", "hamlet"} and pt_u not in {"PPL", "PPLA3", "PPLA4"}:
        return False
    return terrain_type == "coastal"
_NO_PHOTO_LAB = ["photo_lab"]  # only yosra and tasha have analogue camera energy
_NO_HELMET = ["helmet_off"]  # only ingrid — motorcycle character
_NO_NOTEBOOK = ["notebook_outside"]  # only tammy — her Kassandra notebook
_NO_FIELD_REPAIR = ["field_repair"]  # only werra — she repairs her G300 in the field
_NO_MORNING_RUN = ["morning_run_urban"]  # only quinn — operational urban run
_NO_ROADSIDE_DUSK = ["roadside_dusk"]  # only amber — her Mustang, her silence
_NO_KIOSK = ["kiosk_stop"]  # not for luxury chars
_NO_NEWSPAPER = ["newspaper_cafe"]  # not for outdoor/action chars
_NO_CHIN_UP = ["chin_up"]  # only quinn
_NO_GEAR_HAUL = ["gear_haul"]  # only kay
_NO_TANK_CARRY = ["tank_carry"]  # only metka
_NO_BIKE_PUSH = ["bike_push"]  # only ingrid
_NO_BOARD_CARRY = ["board_carry"]  # only maya
_NO_TAROT = ["tarot_read"]  # only camille
_NO_METAL_HORNS = ["metal_horns"]  # only yuki
# rope_coil — coastal/dock chars only: naomi, sofia, thea, lyra
_NO_ROPE_COIL = ["rope_coil"]
# map_hood — road-trip chars with cars (not ingrid/motorcycle, not driver_pov/van, not pure outdoor)
_NO_MAP_HOOD = ["map_hood"]
# tire_change — practical/hands-on chars with cars
_NO_TIRE_CHANGE = ["tire_change"]
# kayak_entry — lake outdoor chars only; not luxury, not urban, not motorbike
_NO_KAYAK_ENTRY = ["kayak_entry"]
_CIGARETTE_ROLL_CHARS = {"mila", "djordje", "thea"}

_ALL_CHAR_EXCLUSIVE = (
    _NO_NOTEBOOK + _NO_FIELD_REPAIR + _NO_MORNING_RUN + _NO_ROADSIDE_DUSK + _NO_HELMET
    + _NO_CHIN_UP + _NO_GEAR_HAUL + _NO_TANK_CARRY + _NO_BIKE_PUSH + _NO_BOARD_CARRY
    + _NO_TAROT + _NO_METAL_HORNS
)

CHARACTER_ACTIVITY_EXCLUDE = {
    "valentina":  ["surf_paddle", "muscheln_sammeln", "snowshoe_hike", "kajak_sup", "going_for_a_run"] + _NO_VAN + _NO_FISHING + _ALL_CHAR_EXCLUSIVE + _NO_KIOSK + _NO_ROPE_COIL + _NO_MAP_HOOD + _NO_TIRE_CHANGE + _NO_KAYAK_ENTRY,
    "charlotte":  ["surf_paddle", "muscheln_sammeln", "snowshoe_hike", "kajak_sup", "going_for_a_run"] + _NO_VAN + _NO_FISHING + _ALL_CHAR_EXCLUSIVE + _NO_KIOSK + _NO_ROPE_COIL + _NO_TIRE_CHANGE + _NO_KAYAK_ENTRY,  # map_hood allowed (Triumph TR6)
    "naomi":      ["muscheln_sammeln", "snowshoe_hike"] + _NO_VAN + _NO_FISHING + _ALL_CHAR_EXCLUSIVE + _NO_KIOSK + _NO_MAP_HOOD + _NO_TIRE_CHANGE + _NO_KAYAK_ENTRY,  # rope_coil allowed; going_for_a_run ok
    "driver_pov": ["hiking_back", "beach_walk_distance", "muscheln_sammeln", "kajak_sup", "sunset_wine", "surf_paddle", "cycling_road", "market_browse", "apres_ski_bar", "snowshoe_hike", "reisebuero_inside", "reisebuero_window", "watchmaker_window", "cobbler_window", "harbour_walk", "cafe_terrace", "going_for_a_run"] + _NO_VAN + _ALL_CHAR_EXCLUSIVE + _NO_ROPE_COIL + _NO_MAP_HOOD + _NO_TIRE_CHANGE + _NO_KAYAK_ENTRY,
    "driver_van": ["hiking_back", "beach_walk_distance", "muscheln_sammeln", "kajak_sup", "sunset_wine", "surf_paddle", "cycling_road", "market_browse", "apres_ski_bar", "snowshoe_hike", "reisebuero_inside", "reisebuero_window", "watchmaker_window", "cobbler_window", "harbour_walk", "cafe_terrace", "going_for_a_run"] + _NO_VAN + _ALL_CHAR_EXCLUSIVE + _NO_ROPE_COIL + _NO_MAP_HOOD + _NO_TIRE_CHANGE + _NO_KAYAK_ENTRY,
    "chad":       ["hiking_back", "snowshoe_hike", "muscheln_sammeln"] + _NO_VAN + _ALL_CHAR_EXCLUSIVE + _NO_ROPE_COIL + _NO_MAP_HOOD + _NO_TIRE_CHANGE + _NO_KAYAK_ENTRY,  # going_for_a_run ok — content jog
    # Character-exclusive activities — each gets theirs, blocks all others
    "quinn":      _NO_VAN + _NO_FISHING + _NO_NOTEBOOK + _NO_FIELD_REPAIR + _NO_ROADSIDE_DUSK + _NO_HELMET + _NO_GEAR_HAUL + _NO_TANK_CARRY + _NO_BIKE_PUSH + _NO_BOARD_CARRY + _NO_TAROT + _NO_ROPE_COIL + _NO_MAP_HOOD + _NO_TIRE_CHANGE + _NO_KAYAK_ENTRY,  # morning_run_urban + chin_up allowed
    "tammy":      _NO_VAN + _NO_MORNING_RUN + _NO_FIELD_REPAIR + _NO_ROADSIDE_DUSK + _NO_HELMET + _NO_CHIN_UP + _NO_GEAR_HAUL + _NO_TANK_CARRY + _NO_BIKE_PUSH + _NO_BOARD_CARRY + _NO_TAROT + _NO_ROPE_COIL + _NO_KAYAK_ENTRY,  # notebook + map_hood + tire_change allowed
    "werra":      _NO_MORNING_RUN + _NO_NOTEBOOK + _NO_ROADSIDE_DUSK + _NO_HELMET + _NO_CHIN_UP + _NO_GEAR_HAUL + _NO_TANK_CARRY + _NO_BIKE_PUSH + _NO_BOARD_CARRY + _NO_TAROT + _NO_ROPE_COIL,  # field_repair + map_hood + tire_change + kayak_entry allowed
    "amber":      _NO_VAN + _NO_FISHING + _NO_NOTEBOOK + _NO_FIELD_REPAIR + _NO_MORNING_RUN + _NO_HELMET + _NO_CHIN_UP + _NO_GEAR_HAUL + _NO_TANK_CARRY + _NO_BIKE_PUSH + _NO_BOARD_CARRY + _NO_TAROT + _NO_ROPE_COIL + _NO_KAYAK_ENTRY,  # roadside_dusk + map_hood + tire_change allowed; no kayak (bikini canonical)
    "ingrid":     _NO_VAN + _NO_NOTEBOOK + _NO_FIELD_REPAIR + _NO_MORNING_RUN + _NO_ROADSIDE_DUSK + _NO_CHIN_UP + _NO_GEAR_HAUL + _NO_TANK_CARRY + _NO_BOARD_CARRY + _NO_TAROT + _NO_ROPE_COIL + _NO_MAP_HOOD + _NO_TIRE_CHANGE + _NO_KAYAK_ENTRY,  # helmet_off + bike_push allowed
    "kay":        _NO_VAN + _NO_NOTEBOOK + _NO_FIELD_REPAIR + _NO_MORNING_RUN + _NO_ROADSIDE_DUSK + _NO_HELMET + _NO_CHIN_UP + _NO_TANK_CARRY + _NO_BIKE_PUSH + _NO_BOARD_CARRY + _NO_NEWSPAPER + _NO_KIOSK + _NO_TAROT + _NO_ROPE_COIL + _NO_KAYAK_ENTRY,  # gear_haul + map_hood + tire_change allowed; no kayak (bikini canonical)
    "metka":      _NO_VAN + _NO_NOTEBOOK + _NO_FIELD_REPAIR + _NO_MORNING_RUN + _NO_ROADSIDE_DUSK + _NO_HELMET + _NO_CHIN_UP + _NO_GEAR_HAUL + _NO_BIKE_PUSH + _NO_BOARD_CARRY + _NO_TAROT + _NO_ROPE_COIL + _NO_KAYAK_ENTRY,  # tank_carry + map_hood + tire_change allowed; no kayak (bikini canonical)
    "maya":       _NO_NOTEBOOK + _NO_FIELD_REPAIR + _NO_MORNING_RUN + _NO_ROADSIDE_DUSK + _NO_HELMET + _NO_CHIN_UP + _NO_GEAR_HAUL + _NO_TANK_CARRY + _NO_BIKE_PUSH + _NO_NEWSPAPER + _NO_KIOSK + _NO_TAROT + _NO_ROPE_COIL + _NO_MAP_HOOD + _NO_TIRE_CHANGE + _NO_KAYAK_ENTRY,  # board_carry allowed; no kayak (bikini canonical)
    "diaz":       _NO_VAN + _NO_FISHING + _ALL_CHAR_EXCLUSIVE + ["harbour_walk", "muscheln_sammeln", "weinlese", "olivenernte", "boot_streichen", "sailing"] + _NO_ROPE_COIL + _NO_MAP_HOOD + _NO_TIRE_CHANGE + _NO_KAYAK_ENTRY,
    "sigrid":     _NO_VAN + _NO_FISHING + _ALL_CHAR_EXCLUSIVE + _NO_ROPE_COIL + _NO_MAP_HOOD + _NO_TIRE_CHANGE,  # kayak_entry allowed (Norwegian, lakes natural)
    "elena":      _NO_VAN + _NO_FISHING + _ALL_CHAR_EXCLUSIVE + _NO_ROPE_COIL,  # map_hood + tire_change + kayak_entry allowed (always travelling)
    "diana":      _NO_VAN + _NO_FISHING + _ALL_CHAR_EXCLUSIVE + _NO_ROPE_COIL + _NO_MAP_HOOD + _NO_TIRE_CHANGE + _NO_KAYAK_ENTRY,
    "regina":     _NO_VAN + _NO_FISHING + _ALL_CHAR_EXCLUSIVE + _NO_ROPE_COIL + _NO_MAP_HOOD + _NO_TIRE_CHANGE + _NO_KAYAK_ENTRY,
    "isabella":   _NO_VAN + _NO_FISHING + _ALL_CHAR_EXCLUSIVE + _NO_ROPE_COIL + _NO_MAP_HOOD + _NO_TIRE_CHANGE + _NO_KAYAK_ENTRY,
    "rosa":       _NO_VAN + _NO_FISHING + _ALL_CHAR_EXCLUSIVE + _NO_ROPE_COIL + _NO_MAP_HOOD + _NO_TIRE_CHANGE + _NO_KAYAK_ENTRY,
    "zara":       _NO_VAN + _NO_FISHING + _ALL_CHAR_EXCLUSIVE + _NO_ROPE_COIL + _NO_MAP_HOOD + _NO_TIRE_CHANGE + _NO_KAYAK_ENTRY,
    "stacy":      _NO_VAN + _NO_FISHING + _NO_NOTEBOOK + _NO_FIELD_REPAIR + _NO_MORNING_RUN + _NO_ROADSIDE_DUSK + _NO_HELMET + _NO_CHIN_UP + _NO_GEAR_HAUL + _NO_TANK_CARRY + _NO_BIKE_PUSH + _NO_BOARD_CARRY + _NO_TAROT + _NO_ROPE_COIL,  # map_hood + tire_change + kayak_entry + metal_horns allowed
    "jade":       _NO_VAN + _NO_FISHING + _ALL_CHAR_EXCLUSIVE + _NO_NEWSPAPER + _NO_ROPE_COIL,  # map_hood + tire_change + kayak_entry allowed (outdoorsy)
    "katja":      _NO_VAN + _NO_FISHING + _ALL_CHAR_EXCLUSIVE + _NO_ROPE_COIL,  # map_hood + tire_change + kayak_entry allowed (BMW 3er)
    "terry":      _NO_VAN + _NO_FISHING + _ALL_CHAR_EXCLUSIVE + _NO_ROPE_COIL + _NO_MAP_HOOD + _NO_TIRE_CHANGE + _NO_KAYAK_ENTRY,
    "alessandra": _NO_VAN + _ALL_CHAR_EXCLUSIVE + _NO_ROPE_COIL + _NO_MAP_HOOD + _NO_TIRE_CHANGE,
    "yosra":      _NO_VAN + _ALL_CHAR_EXCLUSIVE + _NO_ROPE_COIL + _NO_MAP_HOOD + _NO_TIRE_CHANGE + _NO_KAYAK_ENTRY,
    "tasha":      _NO_VAN + _ALL_CHAR_EXCLUSIVE + _NO_ROPE_COIL + _NO_KAYAK_ENTRY,  # map_hood + tire_change allowed; no kayak (bikini canonical)
    "bianca":     _NO_VAN + _NO_FISHING + _ALL_CHAR_EXCLUSIVE + _NO_ROPE_COIL + _NO_MAP_HOOD + _NO_TIRE_CHANGE + _NO_KAYAK_ENTRY,
    "kelek":      _NO_VAN + _ALL_CHAR_EXCLUSIVE + _NO_ROPE_COIL + _NO_MAP_HOOD + _NO_TIRE_CHANGE,  # kelek fishes; kayak_entry allowed
    "lyra":       _NO_VAN + _ALL_CHAR_EXCLUSIVE + _NO_MAP_HOOD + _NO_TIRE_CHANGE,  # rope_coil + kayak_entry allowed (near water)
    "vera":       _NO_VAN + _NO_FISHING + _ALL_CHAR_EXCLUSIVE + _NO_ROPE_COIL + _NO_MAP_HOOD + _NO_TIRE_CHANGE,  # kayak_entry allowed
    "camille":    _NO_VAN + _NO_FISHING + _NO_NOTEBOOK + _NO_FIELD_REPAIR + _NO_MORNING_RUN + _NO_ROADSIDE_DUSK + _NO_HELMET + _NO_CHIN_UP + _NO_GEAR_HAUL + _NO_TANK_CARRY + _NO_BIKE_PUSH + _NO_BOARD_CARRY + _NO_ROPE_COIL,  # tarot_read + map_hood + tire_change + kayak_entry allowed (2CV)
    "carmela":    _NO_VAN + _ALL_CHAR_EXCLUSIVE + _NO_ROPE_COIL + _NO_MAP_HOOD + _NO_TIRE_CHANGE + _NO_KAYAK_ENTRY,  # carmela fishes
    "ana":        _NO_VAN + _ALL_CHAR_EXCLUSIVE + _NO_ROPE_COIL + _NO_MAP_HOOD + _NO_TIRE_CHANGE + _NO_KAYAK_ENTRY,  # ana fishes
    "sofia":      _ALL_CHAR_EXCLUSIVE + _NO_NEWSPAPER + _NO_KIOSK + _NO_TIRE_CHANGE + _NO_KAYAK_ENTRY,  # rope_coil + map_hood allowed; no kayak (bikini canonical)
    "thea":       _NO_VAN + _NO_FISHING + _ALL_CHAR_EXCLUSIVE + _NO_TIRE_CHANGE,  # rope_coil + map_hood + kayak_entry allowed (Greek lakes/coast)
}

def pick_activity(character_key: str, terrain_type: str, place_type: str, n: int = 1) -> list:
    excluded = set(CHARACTER_ACTIVITY_EXCLUDE.get(character_key, []))
    candidates = set()
    if terrain_type in TERRAIN_ACTIVITIES:
        candidates.update(TERRAIN_ACTIVITIES[terrain_type])
    pt = (place_type or "").lower()
    for key in PLACETYPE_ACTIVITIES:
        if key in pt or pt in key:
            candidates.update(PLACETYPE_ACTIVITIES[key])
    if not candidates:
        candidates = {"van_morning_coffee", "cafe_terrace", "sunset_wine"}
    candidates -= excluded
    candidates -= DISABLED_ACTIVITIES
    if "quay_fishing" in candidates and not _quay_fishing_ok(place_type, terrain_type):
        candidates.discard("quay_fishing")
    # photo_lab only for yosra and tasha — analogue camera chars
    if character_key not in {"yosra", "tasha"}:
        candidates.discard("photo_lab")
    if character_key not in _CIGARETTE_ROLL_CHARS:
        candidates.discard("cigarette_roll")
    candidates = list(candidates)
    if not candidates:
        return []
    random.shuffle(candidates)
    return candidates[:n]


def get_character_activity_profile(character_key: str, activity_key: str) -> str:
    """Body/markers for water/outdoor activities; outfit via outfit_override in build_activity_prompt."""
    if activity_key == "going_for_a_run":
        run_note = CHARACTER_RUN_ACTIVITY_PROFILE.get(character_key)
        if run_note:
            return run_note
    if activity_key not in _PROFILE_ACTIVITIES:
        return ""
    parts = []
    anchor = CHARACTER_BODY_ANCHORS.get(character_key)
    if anchor:
        parts.append(f"CHARACTER BODY & MARKERS (MANDATORY): {anchor}")
    for _lock in (
        get_character_nails_lock(character_key),
        get_character_marks_lock(character_key),
        get_character_piercings_lock(character_key),
    ):
        if _lock:
            parts.append(_lock)
    if activity_key in _SWIM_OUTFIT_ACTIVITIES:
        water = get_character_water_outfit(character_key)
        if water:
            parts.append(f"SWIM/BEACH (MANDATORY): {water}")
    if activity_key == "surf_paddle" and character_key == "kay":
        parts.append(
            "SURF OUTFIT (MANDATORY): black 3mm wetsuit half-unzipped or peeled to waist, "
            "or black fitted tank — white orca logo on chest. Longboard nearby ok. Barefoot on sand/path."
        )
    elif activity_key == "surf_paddle" and character_key == "sofia":
        parts.append("SURF OUTFIT (MANDATORY): bikini or rashguard, board under arm, barefoot on approach.")
    return "\n".join(parts)


def build_activity_prompt(place: dict, character_key: str, activity_key: str, outfit_override: str = None, noir_mode: bool = False, prestige_mode: bool = False, nightlife_mode: bool = False, viper_mode: bool = False, maxpower_mode: bool = False, eclipse_mode: bool = False, sidewinder_mode: bool = False, continental_mode: bool = False, us_mode: bool = False, eu_mode: bool = False) -> str:
    activity_text = ACTIVITY_SPECS.get(activity_key, "")
    if activity_key == "going_for_a_run" and character_key in CHARACTER_RUN_ACTIVITY_PROFILE:
        activity_text += (
            "\nIGNORE the generic OUTFIT line in this activity — NOT fitted athletic kit, "
            "NOT professional runner. Obey RUN OUTFIT override and character run profile below."
        )
    _beach_activities = {"beach_walk_distance"}
    _no_swim_ctx = is_non_swim_context(place, activity_key)
    if not outfit_override and _no_swim_ctx:
        outfit_override = get_city_street_outfit_override(character_key, place, activity_key)
    if (
        activity_key in _SWIM_OUTFIT_ACTIVITIES
        and get_character_water_outfit(character_key)
        and not outfit_override
        and not _no_swim_ctx
    ):
        outfit_override = get_sup_outfit_override(character_key)
    elif activity_key == "kayak_entry" and not outfit_override:
        entry = CHARACTER_KAYAK_ENTRY_OUTFIT.get(character_key)
        if entry:
            outfit_override = f"KAYAK ENTRY OUTFIT: {entry}"
    elif activity_key == "going_for_a_run" and not outfit_override:
        _run_o = get_run_outfit_override(character_key, place, activity_key)
        if _run_o:
            outfit_override = _run_o
    elif (
        character_key == "metka"
        and not outfit_override
        and not _no_swim_ctx
        and activity_key in _SWIM_OUTFIT_ACTIVITIES
    ):
        _metka_swim = CHARACTER_SWIM_OUTFIT.get("metka", "")
        outfit_override = f"SWIMWEAR OVERRIDE: {_metka_swim} This overrides the reference image swimwear."
    if (
        character_key in BIKINI_CHARS
        and activity_key in _beach_activities
        and not outfit_override
        and not _no_swim_ctx
    ):
        outfit_override = "thin white or light linen shirt open over bikini — she just came from or is heading to the water. Cover-up natural, not posed."
    _char_profile = get_character_activity_profile(character_key, activity_key)
    _char_profile_line = f"\n{_char_profile}" if _char_profile else ""
    base = build_prompt(place, character_key, outfit_override=outfit_override, noir_mode=noir_mode, prestige_mode=prestige_mode, nightlife_mode=nightlife_mode, viper_mode=viper_mode, maxpower_mode=maxpower_mode, eclipse_mode=eclipse_mode, sidewinder_mode=sidewinder_mode, continental_mode=continental_mode, us_mode=us_mode, eu_mode=eu_mode)
    terrain_val = place.get("terrain_type", "")
    camera_hint = get_camera_style(character_key, terrain_val, "main")
    style_line = ""
    if camera_hint and character_key != "valentina":
        style_line += "\nCAMERA & STYLE: " + camera_hint
    photo_detail = get_photo_style(character_key)
    if photo_detail:
        style_line += "\nFILM & SKIN: " + photo_detail
    if activity_key == "kajak_sup" and character_key == "diana":
        style_line += (
            "\nLIGHT (DIANA SUP): overcast, blue hour, or heavy cloud on lake — hard shadows, goth-elegant. "
            "Not cheerful midday resort sun. Swim outfit from override, not night-street coat."
        )
    _act_expression = get_dynamic_expression("activity", character_key, activity_key=activity_key)
    if activity_key == "going_for_a_run" and character_key == "elena":
        _act_expression = (
            "EXPRESSION LOCK: bored, flat, unbothered — NOT focused runner, NOT gritted effort. "
            "She is doing this because she might as well, not because she trains."
        )
    elif activity_key == "going_for_a_run" and character_key == "lyra":
        _act_expression = (
            "EXPRESSION LOCK: lustlos — listless, half-amused, zero drive. NOT athlete concentration, "
            "NOT endorphin smile. Could abandon the run mid-stride without drama."
        )
    elif activity_key == "going_for_a_run" and character_key == "stacy":
        _act_expression = "EXPRESSION LOCK: happy, open, preppy grin — genuine wonder at her own legs still working."
    elif activity_key == "going_for_a_run" and character_key == "metka":
        _act_expression = "EXPRESSION LOCK: flat, unbothered — 20km is nothing; barely trying."
    elif activity_key == "going_for_a_run" and character_key == "quinn":
        _act_expression = "EXPRESSION LOCK: calm operational — iron discipline, NOT fun-run smile."
    elif activity_key == "going_for_a_run" and character_key == "camille":
        _act_expression = "EXPRESSION LOCK: mild reluctance — not thrilled, doing it anyway. NOT cheerleader joy."
    elif activity_key == "going_for_a_run" and character_key == "tasha":
        _act_expression = "EXPRESSION LOCK: focused maintenance — body is the job. NOT goofy tourist laugh on this shot."
    elif activity_key == "going_for_a_run" and character_key == "diaz":
        _act_expression = "EXPRESSION LOCK: alert, assessing — cop scan even off duty. NOT relaxed vacation face."
    elif activity_key == "going_for_a_run" and character_key == "terry":
        _act_expression = "EXPRESSION LOCK: easy early smile — run is easier than it looks on her."
    elif activity_key == "going_for_a_run" and character_key == "amber":
        _act_expression = (
            "EXPRESSION LOCK: soft bond with coyote — amused relaxed glance sideways, unhurried. "
            "NOT fear, NOT hunt, NOT panic."
        )
    elif activity_key == "going_for_a_run" and character_key == "naomi":
        _act_expression = "EXPRESSION LOCK: calm, normal effort — mildly bored competence, not athlete grimace."
    elif activity_key == "going_for_a_run" and character_key == "thea":
        _act_expression = "EXPRESSION LOCK: lustlos — slight annoyance, pushes through anyway. NOT joy."
    elif activity_key == "going_for_a_run" and character_key == "maria":
        _act_expression = "EXPRESSION LOCK: engaged, inward fire — hat Bock, still composed not goofy."
    elif activity_key == "going_for_a_run" and character_key == "isabella":
        _act_expression = "EXPRESSION LOCK: focused self-assessment — body as asset, measuring the run."
    elif activity_key == "going_for_a_run" and character_key == "zara":
        _act_expression = "EXPRESSION LOCK: easy normal run — unbothered, already half elsewhere."
    elif activity_key == "going_for_a_run" and character_key == "cleo":
        _act_expression = (
            "FRAMING LOCK: back to camera only — face never visible. Slow witness jog at historical edge. "
            "NOT portrait, NOT eye contact."
        )
    elif activity_key == "going_for_a_run" and character_key == "sofia":
        _act_expression = (
            "GOLDIE LOCK (mandatory): Goldie beside Sofia — reddish-tan Podenco-Terrier, folded rose ears, "
            "red collar, tongue out, easy jog pace. NOT absent, NOT another dog breed."
        )
    elif activity_key == "going_for_a_run" and character_key == "chad":
        _act_expression = (
            "EXPRESSION LOCK: almost stopped — eyes on lit fitness watch, heel-heavy bro shuffle or phone-arm. "
            "Vuori/Nike clean kit, white AirPods one ear. NO vest. "
            "NOT efficient runner form, NOT meditative, NOT horizon-only gaze."
        )
    if activity_key == "map_hood":
        _act_expression = (
            "GAZE LOCK: eyes open, head angled down — she is reading the paper map on the car hood. "
            "Gaze on map lines, not sky, not horizon, not camera. NOT eyes closed."
        )
    elif activity_key == "kayak_entry":
        _act_expression = (
            "GAZE LOCK: no direct eye contact with camera. "
            "Gaze on canoe, water, or trail ahead — profile, back three-quarter, or head down into the push. "
            "NOT facing lens, NOT portrait stare."
        )
    _sup_pose_line = ""
    if activity_key == "kajak_sup":
        if random.random() < 0.70:
            _sup_pose_line = (
                "\nPOSE (MANDATORY): Standing upright on the SUP — feet on the board, slight knee bend for balance, "
                "paddle mid-stroke or trailing in the water. Classic stand-up paddle posture. "
                "NOT kneeling, NOT sitting, NOT kayak."
            )
        else:
            _sup_pose_line = (
                "\nPOSE (MANDATORY): Kneeling on the SUP — one or both knees on the board, paddling on calm water. "
                "NOT standing upright, NOT sitting in a kayak cockpit."
            )
    _act_expr_line = f"\n{_act_expression}" if _act_expression else ""
    locale_rule = "\nLOCALE: Any visible text — signs, menus, price tags, labels, brand names — must be in the local language of the location. No English text in non-English speaking countries."
    _act_subj = "he" if character_key in MALE_CHARACTERS else "she"
    _clothing_rule = get_activity_clothing_rule(character_key, activity_key, place)
    _clothing_block = f"\n{_clothing_rule}" if _clothing_rule else ""
    _activity_framing = (
        f"\nFRAMING: Character max 50% of frame height — action and location both readable. Upper 25% calm for UI overlay. "
        f"No other person or partial human in extreme foreground — no blurred man/woman, hand, or shoulder at frame edge. "
        f"No text, no watermarks. Portrait orientation 800x1200.{_clothing_block}\n"
        f"DIRECTION: Caught mid-action — {_act_subj} does not know the camera is there. Not posed, not performing. "
        f"Real moment, not a photoshoot. The location is the subject. Character is part of it."
    )
    # Noir activity modifier — tone down formal styling for believable activity context
    _noir_activity_note = ""
    if noir_mode and activity_key == "kajak_sup":
        _noir_activity_note = """
NOIR SUP: Noir via lighting and atmosphere only — obey MANDATORY SUP OUTFIT (character BEACH/SWIM spec).
No wool coat, opera gloves, leather jacket, or street clothes over swim on the board.
"""
        if character_key == "diana":
            _noir_activity_note += (
                "Diana: goth-elegant swim visible — high-neck black one-piece or high-waist black bikini, red lips. "
                "Blue hour or overcast lake, hard shadows.\n"
            )
    elif noir_mode:
        _noir_char_note = ""
        if character_key == "diana":
            _noir_char_note = "Diana: black wool coat over simple dark dress. Shorter gloves or bare hands. Boots. She is doing something ordinary. The gloves make it strange."
        elif character_key == "terry":
            _noir_char_note = "Terry: dark trousers, fitted black turtleneck or simple dark top, coat. Tote bag — linen, slightly overfull, completely wrong for someone this calibrated. She doesn't notice. Or she noticed and chose it anyway. A playing card visible at the top of the bag — not intentional. Or is it. Whisky flask in coat pocket, just barely visible. She is doing something completely normal. That is the joke."
        _noir_activity_note = f"""
NOIR ACTIVITY STYLING: This is a noir activity shot — not an editorial portrait.
Clothing must be believable for the activity. Noir comes through lighting and atmosphere, not through formal styling.
{_noir_char_note}
General: black wool coat, simple dark knit, dark trousers. Boots. Tote bag or small bag. Slight disheveledness — wet hair, collar turned up, real movement.
"""
    _swim_repeat = ""
    if character_key == "sigrid" and activity_key in _SWIM_OUTFIT_ACTIVITIES:
        _swim_repeat = (
            "\nSIGRID HEL SWIM (FINAL — non-negotiable): one-shoulder bikini or one-shoulder one-piece, "
            "one strap only, other shoulder bare, ice-grey or black. NOT symmetric triangle bikini. "
            "NOT trench coat, NOT linen cover-up on water."
        )
    return (
        base + "\n\n" + activity_text.strip() + _sup_pose_line + _char_profile_line + _act_expr_line
        + _noir_activity_note + style_line + locale_rule + _activity_framing + _swim_repeat
    )

def upload_activity_to_supabase(webp_bytes: bytes, place: dict, character_key: str, activity_key: str) -> str:
    place_name = _place_slug(place)
    country = place["country_code"].lower()
    storage_path = f"cast/activity/{place_name}_{country}_cast_{character_key}_activity_{activity_key}_1.webp"
    supabase.storage.from_("dedicated").upload(storage_path, webp_bytes, {"content-type": "image/webp"})
    try:
        supabase.table("place_hero_images").insert({
            "place_id": place["id"],
            "storage_path": storage_path,
            "character": character_key,
            "variant": "main",
        }).execute()
    except Exception:
        pass  # variant constraint — storage upload succeeded, tracking skipped
    return storage_path



WINDSHIELD_VARIANTS = {
    "rain":              "windshield covered in raindrops — individual drops catching light, streaks where wiper missed",
    "streaks":           "windshield with faint wiper streaks — slightly smeared, driven-through look",
    "dusty":             "windshield lightly coated in fine dust or road grime — matte surface, edges more than center",
    "glare":             "direct sun or golden hour hitting windshield — lens flare, strong backlight wash",
    "fog_inside":        "windshield misted from inside — soft condensation, slightly blurred view, morning energy",
    "frost":             "light frost or ice crystals on edges of windshield — center cleared by defroster",
    "night_reflections": "night driving — dashboard instruments reflected in glass, oncoming headlights as streaks",
    "clean":             "windshield clean and clear — sharp view through, recently washed or just rained off",
    "bug_splatter":      "one or two dried insect impacts on windshield — subtle, highway summer detail only",
}

WINDSHIELD_BY_TERRAIN = {
    "desert":        ["dusty", "dusty", "glare", "glare", "clean", "bug_splatter"],
    "coastal":       ["rain", "rain", "clean", "glare", "streaks"],
    "mountain":      ["rain", "streaks", "glare", "fog_inside", "clean"],
    "high_mountains":["frost", "frost", "fog_inside", "streaks", "clean"],
    "hills":         ["rain", "streaks", "glare", "clean"],
    "flatland":      ["rain", "streaks", "clean", "glare", "bug_splatter"],
    "lake":          ["rain", "fog_inside", "clean", "streaks"],
}

def pick_windshield(terrain_type: str, time_of_day_hint: str = "") -> str:
    if "night" in time_of_day_hint.lower():
        return "night_reflections"
    if "morning" in time_of_day_hint.lower():
        return random.choice(["fog_inside", "fog_inside", "clean"])
    pool = WINDSHIELD_BY_TERRAIN.get(terrain_type or "", ["clean", "streaks", "glare", "rain"])
    return random.choice(pool)


# ── VAST LANDSCAPE FAR SHOT ──────────────────────────────────────────────────

_VAST_LANDSCAPE_TERRAINS = {"desert", "mountain", "high_mountains", "national_park", "wilderness"}
_VAST_LANDSCAPE_PLACE_TYPES = {"PRK", "PRKX", "NPARK", "RESV", "DSRT", "MNTN"}

NATURE_DAY_HIKE_OUTFIT = (
    "light day-hike outfit for a short trail visit — not expedition gear. "
    "Trail runners or low hiking shoes. Lightweight hiking pants or durable leggings, "
    "or simple shorts if the climate fits. Breathable tee or thin long-sleeve, "
    "optional unzipped windbreaker or light fleece. "
    "NO backpack, NO trekking poles, NO hydration pack, NO mountaineering shell, NO heavy boots. "
    "Hands empty — she came from the car park for a day walk. "
    "On boardwalk, forest trail, lake path, or overlook — embedded in the location."
)


def is_nature_place(place: dict) -> bool:
    pt_u = (place.get("place_type") or "").upper()
    pt_l = (place.get("place_type") or "").lower()
    terrain = place.get("terrain_type", "")
    if pt_u in _VAST_LANDSCAPE_PLACE_TYPES:
        return True
    if terrain in _VAST_LANDSCAPE_TERRAINS:
        return True
    if pt_l in _NATURE_PLACE_TYPES:
        return True
    if terrain in _NATURE_TERRAINS:
        return True
    return False


def suppress_urban_premium_for_place(place: dict, **modes) -> dict:
    """No bar/club/night premium at nature, beach, or desert — outdoor daylight, not Monaco hotel bar."""
    if not (is_nature_place(place) or is_beach_place(place) or is_desert_place(place)):
        return modes
    out = dict(modes)
    for key in ("noir_mode", "nightlife_mode", "viper_mode", "prestige_mode", "maxpower_mode", "eclipse_mode"):
        out[key] = False
    return out


def suppress_urban_premium_for_nature(place: dict, **modes) -> dict:
    """Alias — use suppress_urban_premium_for_place."""
    return suppress_urban_premium_for_place(place, **modes)


def nature_wildcard_discomfort_block(place: dict) -> str:
    if (_nature_wildcard_char
            and _nature_wildcard_char not in NATURE_WILDCARD_NO_DISCOMFORT
            and is_nature_place(place)):
        return NATURE_WILDCARD_DISCOMFORT
    return ""


# Canonical looks already fine for trails/lakes — leather-club chars excluded
_NATURE_OUTDOOR_OK = {
    "jade", "quinn", "tammy", "amber", "alessandra", "katja", "werra",
    "luca", "chad", "goldie", "stacy", "djordje", "driver_pov", "driver_van",
}

# Evening / city glamour defaults — need outdoor adaptation at nature places
_NATURE_GLAMOUR_CHARS = {
    "valentina", "naomi", "regina", "charlotte", "carmela", "diana",
    "isabella", "camille", "elena", "sigrid", "nadia", "vera", "conrad", "terry",
}


def get_nature_outfit_override(character_key: str, place: dict) -> str | None:
    """Swap swimwear / evening wear for believable outdoor day clothes at nature places."""
    if not is_nature_place(place):
        return None
    if place.get("name_en") == "Abraham Lake":
        return (
            "ABRAHAM LAKE WINTER (MANDATORY): heavy coat or parka, wool trousers, winter boots — "
            "cold weather only. Subject ON FROZEN ICE; methane bubbles under clear ice plane. "
            "NO bikini, NO swimwear, NO open water, NO sitting in liquid. Ignore reference swimsuit."
        )
    terrain = place.get("terrain_type", "") or ""
    # Trail/lake nature — no bikini main shot (canonical swim chars included).
    if character_key in _NATURE_OUTDOOR_OK:
        if terrain == "lake":
            return (
                "NATURE OUTFIT (MANDATORY): lakeside trail day — linen shirt or light long-sleeve, "
                "shorts or trail pants, trainers, aviators ok. No bikini, no swimwear on shore. "
                "Ignore reference-image swimsuit."
            )
        return None
    # Lake/coastal nature — swim spec only where allowed (Maghreb/TR: coastal beach only, not inland lake).
    if terrain in {"lake", "coastal"} and CHARACTER_SWIM_OUTFIT.get(character_key):
        if terrain == "coastal" and allows_swimwear_at_place(place, None) and not is_urban_place(place):
            return get_character_water_outfit_override(character_key)
        if terrain == "lake" and not requires_modest_wardrobe(place):
            return get_character_water_outfit_override(character_key)

    if character_key in BIKINI_CHARS:
        if requires_modest_wardrobe(place) and not allows_swimwear_at_place(place, None):
            return (
                "NATURE OUTFIT (MAGHREB/TR): modest trail/day clothes — long-sleeve shirt or blouse, "
                "trousers or long skirt, trainers. No bikini, no swimwear. Ignore reference swimsuit."
            )
        if terrain == "coastal":
            return (
                "NATURE OUTFIT: linen shirt or light cover-up over top, shorts or skirt, sandals — "
                "shore walk, not posed bikini shot. Ignore reference swimwear if too beach-studio."
            )
        return (
            "NATURE OUTFIT: practical day clothes — tee or light long-sleeve, shorts or trail pants, "
            "trainers or hiking shoes. No bikini, no swimwear. Ignore reference swimsuit."
        )

    if character_key in _NATURE_GLAMOUR_CHARS:
        return (
            "NATURE OUTFIT: smart-casual outdoors — jeans or wool trousers, flat boots or trainers, "
            "coat or jacket over simple top. No evening gown, no stilettos on dirt. Elegant but believable for a day trip."
        )

    if character_key in NATURE_WILDCARD_CHARS:
        return (
            "NATURE OUTFIT: travel-practical — chinos or jeans, jacket, flat shoes. "
            "Not club wear, not swimwear. Dressed for leaving the city for a few hours."
        )

    if character_key == "ingrid":
        return (
            "NATURE OUTFIT: trail-practical — athletic shorts or trail pants, fitted tank or tee, "
            "trainers. Leather jacket on rock or backpack, not worn on hike. No motorcycle on trail. "
            "Helmet off, hair loose."
        )

    return (
        "NATURE OUTFIT: casual outdoor layers suited to the trail or lakeside — "
        "no formal wear, no swimwear unless actively in water. Match weather, stay understated."
    )


def is_beach_place(place: dict) -> bool:
    """Coastal terrain but urban place_type (Rabat, Tunis) is a city — not a beach shoot."""
    if is_urban_place(place):
        return False
    return (place.get("terrain_type") or "") == "coastal"


# Beach-plausible without override — do NOT inherit _NATURE_OUTDOOR_OK wholesale
_BEACH_OUTDOOR_OK = BIKINI_CHARS | {
    "luca", "chad", "stacy", "kay", "tasha", "amber", "jade", "maya", "ana", "sofia", "lyra",
    "quinn", "tammy", "alessandra", "metka", "cleo", "rosa", "maria", "goldie", "katja", "kelek",
}

# Canonical = urban leather / club — spec has explicit beach variant, reference won't
_BEACH_FORCE_CHARS = {"mila", "yuki", "ingrid", "elena", "werra"}

_BEACH_GLAMOUR_CHARS = _NATURE_GLAMOUR_CHARS


def get_beach_outfit_override(character_key: str, place: dict) -> str | None:
    """Swap evening / urban / club wear for believable coastal day clothes at beaches."""
    if not is_beach_place(place) or is_nature_place(place):
        return None
    if requires_modest_wardrobe(place) and not allows_swimwear_at_place(place, None):
        return None
    # Character BEACH/SWIM spec wins over generic BEACH LIGHT glamour (e.g. Sigrid HEL one-shoulder).
    if CHARACTER_SWIM_OUTFIT.get(character_key):
        return get_character_water_outfit_override(character_key)
    if character_key in _BEACH_OUTDOOR_OK and character_key not in _BEACH_FORCE_CHARS:
        return None

    if character_key in _BEACH_FORCE_CHARS:
        if character_key == "ingrid":
            return (
                "BEACH LIGHT OUTFIT: dark navy functional one-piece swimsuit, or athletic shorts + "
                "fitted tank. Leather jacket on a rock nearby — NOT on body. Barefoot. No motorcycle "
                "on sand. Wet hair, no helmet. Ignore reference biker-leather look."
            )
        if character_key == "elena":
            return (
                "BEACH LIGHT OUTFIT: black tank and dark shorts, or simple black bikini top — "
                "whatever was in the bag. Pale skin, horizontal on sand, slightly uncomfortable. "
                "Duffel beside her. No leather jacket on body in this heat."
            )
        if character_key == "werra":
            return (
                "BEACH LIGHT OUTFIT: dark shorts and plain dark tee, or simple one-piece — "
                "functional, not tactical boots on sand. Work boots off. Forest jacket on towel if visible."
            )
        return (
            "BEACH LIGHT OUTFIT: simple black bikini or one-piece — leather jacket OFF body "
            "(on rock or towel if visible). Band tee or light cover-up nearby. Bare feet or sandals. "
            "No boots on sand. Ignore reference urban jacket-and-jeans look."
        )

    if character_key == "conrad":
        return (
            "BEACH LIGHT OUTFIT: linen shirt open over swim shorts, or rolled chinos and espadrilles — "
            "no suit, no tie, no dress shirt. Relaxed coastal day, not boardroom."
        )

    if character_key in _BEACH_GLAMOUR_CHARS:
        return (
            "BEACH LIGHT OUTFIT: linen shirt or light sundress, sandals, optional sun hat — "
            "swimwear OK under cover-up. No evening gown, no smoking/tuxedo, no stilettos on sand, "
            "no pencil skirt. Elegant shore walk, not hotel bar."
        )

    if character_key in NATURE_WILDCARD_CHARS:
        return (
            "BEACH LIGHT OUTFIT: linen trousers or shorts, light blouse or tee, flat sandals — "
            "not club wear, not formal suit. Came from the city for a few hours at the sea."
        )

    return (
        "BEACH LIGHT OUTFIT: casual coastal day wear — shorts or linen pants, light top, sandals. "
        "No formal wear, no nightclub outfit. Match the heat and the sand."
    )


def get_location_outfit_override(character_key: str, place: dict) -> str | None:
    if requires_modest_wardrobe(place) and not allows_swimwear_at_place(place, None):
        _modest = get_maghreb_tr_modest_override(character_key, place, None)
        if _modest:
            return _modest
    if is_urban_place(place):
        _city = get_city_street_outfit_override(character_key, place, None)
        if _city:
            return _city
    return (
        get_nature_outfit_override(character_key, place)
        or get_beach_outfit_override(character_key, place)
        or get_desert_outfit_override(character_key, place)
    )


def is_desert_place(place: dict) -> bool:
    return (place.get("terrain_type") or "") == "desert"


# Heat/dust — same urban-canonical problem as beach
_DESERT_OUTDOOR_OK = _BEACH_OUTDOOR_OK | {"werra", "diaz", "tammy"}

_DESERT_FORCE_CHARS = _BEACH_FORCE_CHARS

_DESERT_GLAMOUR_CHARS = _NATURE_GLAMOUR_CHARS


def get_desert_outfit_override(character_key: str, place: dict) -> str | None:
    """Swap evening / urban / club wear for believable desert day clothes."""
    if not is_desert_place(place) or is_nature_place(place) or is_beach_place(place):
        return None
    if character_key in _DESERT_OUTDOOR_OK and character_key not in _DESERT_FORCE_CHARS:
        return None

    if character_key in _DESERT_FORCE_CHARS:
        if character_key == "ingrid":
            return (
                "DESERT LIGHT OUTFIT: athletic shorts or light trail pants, fitted tank, trainers or "
                "sandals. Leather jacket tied at waist or on rock — NOT full biker leathers in heat. "
                "No motorcycle. Hat or squint against sun ok."
            )
        if character_key == "elena":
            return (
                "DESERT LIGHT OUTFIT: black tank, dark shorts, duffel on ground beside her. "
                "Pale skin, heat-visible. No leather jacket worn — too hot."
            )
        if character_key == "werra":
            return (
                "DESERT LIGHT OUTFIT: dark tee, loose trousers or shorts, boots off — "
                "functional, not layered for winter. Sun and dust, not forest cold."
            )
        return (
            "DESERT LIGHT OUTFIT: light tee, shorts or worn jeans, sandals — jacket off body. "
            "No boots in deep heat. Ignore reference urban leather look."
        )

    if character_key == "conrad":
        return (
            "DESERT LIGHT OUTFIT: linen shirt, lightweight trousers, desert boots or loafers — "
            "no suit, no tie. Heat-appropriate, still exact."
        )

    if character_key in _DESERT_GLAMOUR_CHARS:
        return (
            "DESERT LIGHT OUTFIT: linen wide-leg trousers or light sundress, flat sandals, "
            "optional hat and sunglasses. No evening gown, no stilettos on sand, no smoking/tuxedo."
        )

    if character_key in NATURE_WILDCARD_CHARS:
        return (
            "DESERT LIGHT OUTFIT: chinos or linen pants, light shirt, flat shoes — "
            "travel-practical in heat, not club wear."
        )

    return (
        "DESERT LIGHT OUTFIT: breathable layers — linen or cotton, shorts or light pants, "
        "sandals or trainers. No formal wear, no nightclub outfit. Match the heat."
    )


def is_vehicle_free_zone(place: dict) -> bool:
    """Beach, wilderness, desert heat — no luxury car / motorcycle in frame for flagged chars."""
    return is_beach_place(place) or is_nature_place(place) or is_desert_place(place)


_VEHICLE_SUPPRESS_CHARS = {"ingrid", "naomi"}


def vehicle_suppressed(character_key: str, place: dict) -> bool:
    return character_key in _VEHICLE_SUPPRESS_CHARS and is_vehicle_free_zone(place)


def get_vehicle_suppress_block(character_key: str, place: dict) -> str:
    if not vehicle_suppressed(character_key, place):
        return ""
    return (
        "\nVEHICLE RULE: No car, motorcycle, van, or limousine in frame — character on foot only. "
        "Ignore VEHICLE / MOTORCYCLE lines in character spec for this shot."
    )


def nature_shot_pack(place: dict, us_mode: bool, eu_mode: bool, continental_mode: bool) -> str | None:
    """Nature / national-park shot schedule — day-hike + far-shot for all nature places."""
    if is_nature_place(place):
        return "nature"
    return None


def build_far_shot_prompt(place: dict, character_key: str, location_brief: str, noir_mode: bool = False, prestige_mode: bool = False, nightlife_mode: bool = False, viper_mode: bool = False, maxpower_mode: bool = False, eclipse_mode: bool = False, sidewinder_mode: bool = False, continental_mode: bool = False, us_mode: bool = False, eu_mode: bool = False) -> str:
    name = place["name_en"]
    country = place["country_code"]
    terrain = place.get("terrain_type", "")
    char_brief = CHARACTER_SPECS.get(character_key, "")
    style = CHARACTER_STYLE.get(character_key, "")

    terrain_desc = {
        "desert":        "vast arid desert, red rock formations, heat shimmer, endless sky",
        "mountain":      "dramatic mountain peaks, rocky ridgelines, open sky above",
        "high_mountains":"high alpine terrain, snow-capped peaks, thin air, enormous scale",
        "national_park": "protected wilderness, untouched landscape, monumental natural features",
        "wilderness":    "remote wilderness, no infrastructure visible, raw natural terrain",
    }.get(terrain, "vast open landscape, monumental scale, untouched nature")

    # Vehicle foreground — 50% chance if character has an assigned vehicle
    _vehicle = get_character_vehicle(character_key, place.get("country_code", ""))
    _use_vehicle = _vehicle and random.random() < 0.5
    if _use_vehicle:
        vehicle_line = f"""FOREGROUND ELEMENT: {_vehicle} — parked or pulled over in the near foreground, slightly out of focus or sharp depending on depth of field. The vehicle anchors the shot. Character is beyond it, small in the landscape. We understand she drove here."""
        composition_line = "Wide or ultra-wide. Vehicle in foreground (lower 25%), character small in mid-ground, landscape dominant. Depth of field creates layers."
    else:
        vehicle_line = ""
        composition_line = "Wide or ultra-wide. Landscape fills 85%+ of frame. Character placed in lower third, slightly off-center. Sky or terrain above her is dominant."

    _layers = build_prompt(
        place, character_key,
        noir_mode=noir_mode, prestige_mode=prestige_mode, nightlife_mode=nightlife_mode,
        viper_mode=viper_mode, maxpower_mode=maxpower_mode, eclipse_mode=eclipse_mode,
        sidewinder_mode=sidewinder_mode, continental_mode=continental_mode,
        us_mode=us_mode, eu_mode=eu_mode, layers_only=True,
    )
    _layers_block = f"\n{_layers}" if _layers else ""
    _wildcard_discomfort = nature_wildcard_discomfort_block(place)
    _nature_outfit_fs = get_location_outfit_override(character_key, place)
    _nature_outfit_line = f"\n{_nature_outfit_fs}" if _nature_outfit_fs else ""

    return f"""VAST LANDSCAPE SHOT — {name.upper()}, {country}

FRAMING: Environmental portrait. Character occupies 10-15% of frame height maximum.
She is a small figure in an enormous landscape. Scale is the entire point.

LOCATION: {terrain_desc}
{location_brief}

CHARACTER: {char_brief}
She is not posing. She is simply present — standing, looking at the view, or sitting.
Her back may be to us. We are looking at what she is looking at.
{_wildcard_discomfort}{_nature_outfit_line}

{vehicle_line}
COMPOSITION: {composition_line}
No forced perspective tricks — just real scale.

IDENTITY: Preserve exact facial features from reference image. Even at small scale, keep her recognizable silhouette and build.

TECHNICAL: Natural light. {style}
No vignette. No heavy grade. Let the landscape speak.
Portrait orientation (4:5). Upper area clean for text overlay.{_layers_block}"""


# ── SCENIC DRIVE EXTERIOR SHOTS ──────────────────────────────────────────────

SCENIC_DRIVE_PLACES = {
    "Pacific Coast Highway", "Transfăgărășan", "Grossglockner", "Atlantic Road",
    "Stelvio Pass", "Trollstigen", "Amalfi Coast", "Chapman's Peak", "Col du Galibier",
}

SCENIC_DRIVE_VEHICLES = {
    "driver_pov":  "vintage convertible — 1970s, open top, faded paint, chrome details. German plates (DE). Rosary on mirror, white chess king half-leaning on dash, Polaroid of small dog above windshield. Dashboard worn, Jesus figurine, 90s radio. Lived-in, not restored.",
    "driver_van":  "Fiat Ducato 244, early 2000s high-roof — white with navy lower stripe and orange accent line. SunNomad logo on side panels. German plates (DE). Black roof rack. Wood-trim interior visible. Road dust on sills, one small scratch on rear door — everywhere, still running.",
    "default":     "regional car appropriate to location — correct country plates, one local or travel sticker, road-worn condition, not rental-clean",
    **CHARACTER_VEHICLES,
    **{k: v["EU"] for k, v in CHARACTER_VEHICLES_REGIONAL.items()},
}

SCENIC_DRIVE_SHOT_ANGLES = [
    "FROM THE SIDE — MOVING: car mid-bend on the road at speed, road curves ahead — shot from roadside embankment, telephoto compression. Slight motion blur on wheels and background, car body sharp. The vehicle is clearly in motion.",
    "FROM BEHIND — MOVING: car pulling away into the distance — rear of vehicle sharp, background road and landscape in gentle motion blur. Speed implied by blur and posture of the vehicle.",
    "FROM AHEAD — MOVING: car coming toward camera at speed — shot low, road rushing in foreground, car filling frame, front grille sharp, background blurred by motion. Engine presence felt.",
    "BIRDS EYE / DRONE: car visible on the road from high angle — road as ribbon through landscape, scale of environment dominant. Optional: slight motion trail or blur suggesting the car is moving, not parked.",
    "FAR WIDE — MOVING: car small in the distance on the road — massive landscape, epic terrain. A tiny object in motion across the frame. Sense of solitude and momentum.",
]

SCENIC_DRIVE_STOP_SHOT = """
ROADSIDE STOP SHOT: Character pulled over at the road's edge — not a petrol station, not a car park.
Just the road, the verge, and the decision to stop.
THE VEHICLE FROM THE VEHICLE DESCRIPTION ABOVE is pulled onto gravel or grass — engine off.
Character: standing at the front or side of their vehicle, looking at the view, or leaning against it.
Not posing — just stopped for a moment. The landscape is why she stopped.
CRITICAL: the vehicle must match exactly the VEHICLE description above — no substitutions.
"""

SCENIC_DRIVE_PETROL_SHOT = """
PETROL STATION STOP: Character filling tank or standing beside their vehicle at a pump.
The petrol station is small, regional, slightly run-down. Not a motorway service station.
Character: looking away at the road or the view. Present but thinking about the next stretch.
THE VEHICLE FROM THE VEHICLE DESCRIPTION ABOVE is clearly visible beside her.
CRITICAL: the vehicle must match exactly the VEHICLE description above — no substitutions.
"""

def build_scenic_drive_prompt(place: dict, character_key: str, angle: str, vehicle_desc: str, location_brief: str = "") -> str:
    name = place.get("name_en", "")
    country = place.get("country_code", "")
    char_spec = CHARACTER_SPECS.get(character_key, "")
    # Extract first few lines of char spec for identity
    _spec_lines = [l.strip() for l in char_spec.strip().split("\n") if l.strip()][:5]
    _char_brief = " ".join(_spec_lines)
    return f"""Editorial travel photography. Cinematic 35mm film grain, natural light.
Location: {name}, {country}.
{location_brief}

CHARACTER: {_char_brief}
IDENTITY: Preserve exact facial features from reference image.

SCENIC DRIVE EXTERIOR SHOT — the road is the subject.
VEHICLE: {vehicle_desc}
CRITICAL: The vehicle is EXACTLY as described above. Do not substitute or change the vehicle type.
{angle}

The road defines the composition. Character visible — present but not primary.
No text, no watermarks. Landscape fills at least 50% of frame. Portrait orientation 800x1200.
REFERENCES: car travel photography, road trip editorial, analog grain, natural colour.
""".strip()


ROAD_IDENTITY_TERRAIN_GATE = ["coastal", "mountain", "lake", "desert", "hills"]
ROAD_IDENTITY_PLACETYPE_GATE = ["PPLCH", "PPLA", "PPL", "HBR", "AIRP", "RSTN", "city", "medium_town"]

_NO_FERRY_ARRIVAL = {"Honolulu"}  # airport hubs — no ferry arrival hints

def get_arrival_context(place: dict) -> str:
    name = place.get("name_en", "")
    terrain = place.get("terrain_type", "")
    is_island = place.get("is_island", False)
    ferry_minutes = place.get("ferry_minutes")
    place_type = place.get("place_type", "")
    hints = []

    if name in _NO_FERRY_ARRIVAL:
        hints.append("Major city — arrives at airport (HNL) or taxi/hotel transfer. Coastal Waikiki context. No ferry arrival.")
        if terrain == "coastal":
            hints.append("Coastal — beach or palm-lined boulevard arrival, not a dock.")
        return " ".join(hints)

    island_nations = ["IS", "MT", "CY", "IE"]
    if is_island or place.get("country_code","") in island_nations or (ferry_minutes is not None and ferry_minutes > 0):
        hints.append("HIGH CHANCE OF FERRY ARRIVAL: island or ferry-accessible location. Character may arrive by ferry — stepping off onto dock. Very natural here.")
    if terrain == "coastal":
        hints.append("Coastal — harbour, dock, or beach arrival natural.")
    elif terrain == "mountain":
        hints.append("Mountain — road winds up, character arrives at viewpoint or village.")
    elif terrain == "lake":
        hints.append("Lake — arrive by small boat or road along shore.")
    elif terrain == "desert":
        hints.append("Desert — long straight road, dust, heat haze on arrival.")

    if place_type in ["PPLC","PPLA"] or place_type in ["city","capital","large_town"]:
        hints.append("Major city — character arrives at airport terminal, central train station, or ferry terminal IF the city has one. First moment of arrival — bags, crowds, taxis outside. If no obvious transport hub: she steps out of a taxi or black cab on a busy city street, bags at her feet, looking up at the city for the first time.")
    elif place_type in ["PPL","PPLA2","PPLA3"] or place_type in ["small_town","medium_town"]:
        hints.append("Small town — arrives on foot or by local bus on the main street. Quiet arrival. Locals notice.")
    elif place_type in ["HBR","PRT"]:
        hints.append("Harbour or port — ferry or boat arrival highly natural.")
    elif place_type == "RSTN":
        hints.append("Railway station — arrives by train, steps onto platform.")
    elif place_type in ["PRK","NRSR"]:
        hints.append("National park — arrives at entrance gate or trailhead.")
    elif place_type == "BCH":
        hints.append("Beach — arrives on foot or bicycle along the shore.")
    elif place_type in ["ISL","ISLS"]:
        hints.append("Island — ferry arrival, steps onto dock, looks around for the first time.")

    return " ".join(hints) if hints else ""

def should_generate_road_identity(place: dict, character_key: str) -> bool:
    if character_key in ["regina", "driver_pov", "driver_van"]:
        return False
    if character_key == "naomi":
        return place.get("attractiveness_score", 0) >= 90
    terrain = place.get("terrain_type", "")
    place_type = place.get("place_type", "")
    if place.get("is_island", False):
        return True
    if terrain in ROAD_IDENTITY_TERRAIN_GATE:
        return True
    if place_type in ROAD_IDENTITY_PLACETYPE_GATE:
        return True
    return False

def build_road_identity_prompt(place: dict, character_key: str, location_brief: str, noir_mode: bool = False, prestige_mode: bool = False, nightlife_mode: bool = False, viper_mode: bool = False, maxpower_mode: bool = False, outfit_override: str = None, eclipse_mode: bool = False, sidewinder_mode: bool = False, continental_mode: bool = False, us_mode: bool = False, eu_mode: bool = False) -> str:
    name = place["name_en"]
    country = place["country_code"]
    if is_nature_place(place) or is_beach_place(place) or is_desert_place(place):
        noir_mode = prestige_mode = nightlife_mode = viper_mode = maxpower_mode = eclipse_mode = False
    arrival = get_road_identity_arrival(character_key, place)
    style = CHARACTER_STYLE.get(character_key, "")
    terrain_ri = place.get("terrain_type", "")
    _subj = "He" if character_key in MALE_CHARACTERS else "She"
    camera_arrival = get_camera_style(character_key, terrain_ri, "arrival")
    style_line = ""
    if style:
        style_line += f"Photographic style: {style}"
    if camera_arrival:
        style_line += f"\nCAMERA & STYLE: {camera_arrival}"
    arrival_context = get_arrival_context(place)
    _noir_has_own_style = character_key in {"diana", "terry"}
    _noir_char_outfit = {
        "valentina": "Tight black leather pencil skirt — at the knee. Black fitted top or silk blouse, slightly open collar. Back-seam stockings. Patent stilettos. She knows exactly what she is doing.",
        "oksana":    "Micro black dress — body-skimming, short. Short genuine fur jacket worn open. Gold chains. Patent stilettos. She arrived in this.",
        "elena":     "Fitted black wrap dress — mid-thigh. Back-seam stockings. Black heels. Coat left somewhere.",
        "naomi":     "Black silk halter dress — body-skimming, floor-length with high slit. Back-seam stockings visible at the slit. Black stilettos. One thin gold bracelet. Nothing else. The room noticed when she walked in. She has not acknowledged this.",
        "sigrid":    "Black leather trench coat — belted, mid-thigh length. Fitted black turtleneck underneath. Back-seam stockings. Black leather ankle boots with block heel. Hair loose. Cigarette between fingers — not lit, not posed. She is thinking about something else.",
        "charlotte": "Fitted black leather blazer over simple black slip dress — at the knee. Back-seam stockings. Pointed black heels. Small black clutch. Understated and exact.",
        "diana":     "Long black leather coat, belted. Black leather opera gloves — one or both. Back-seam stockings. Black heels. Cigarette — unlit, between gloved fingers.",
    }
    _noir_outfit_line = _noir_char_outfit.get(character_key, "tailored black blazer over fitted black top, or black leather pencil skirt — knee-length or just below. Back-seam stockings. Black heels or ankle boots. Clothing as authority.")
    noir_layer = ("""
NOIR ATMOSPHERE — late 90s European luxury editorial. Hard flash + warm tungsten. Deep shadows.
Interior luxury or rain-wet exterior at night. Calm dominance, old money decadence.
REFERENCES: Helmut Newton, late 90s Vogue Italia, Peter Lindbergh Pirelli 1997.
Character outfit follows their own specification — do not override.
""" if _noir_has_own_style else f"""
NOIR STYLE OVERRIDE — European power dressing before Instagram existed. Late 90s / early 2000s luxury editorial.
SETTING: interior luxury — hotel bar, casino lounge, penthouse, chauffeured car interior, private members club. Rain on glass windows optional.
LIGHTING: hard flash mixed with warm tungsten practicals. Deep shadows, one key source. Marble and chrome catch the light. Never cold or clinical — warm blacks, not grey.
COLOR PALETTE: black dominates. Deep burgundy, dark champagne, warm gold acceptable as accents. Red nails always.
OUTFIT: {_noir_outfit_line}
TEXTURE: medium format grain. Glossy materials: black leather, patent leather, silk, marble floor, chrome fixtures.
MOOD: calm dominance, cold amusement, social power, old money decadence.
REFERENCES: Helmut Newton, late 90s Vogue Italia, Peter Lindbergh Pirelli 1997.
NOT: Instagram influencer, modern e-girl, cheap latex, Berlin techno, cartoon glamour, anything after 2005.
A lost luxury campaign from 1999 that made rich people quietly uncomfortable.
""") if noir_mode else ""

    prestige_road = """
European executive luxury before Instagram existed. Late 90s continental power dressing. Mediterranean light, warm flash, analog grain. Quiet authority. Helmut Newton daylight, Vogue Italia 1999, Armani. A forgotten 1999 European luxury campaign.
""" if prestige_mode else ""

    nightlife_road = """
Late 90s European nightlife luxury. Direct flash, warm tungsten, glossy materials. Confident, decadent, faintly dangerous. MTV Europe after midnight. A lost 1999 luxury campaign.
""" if nightlife_mode else ""

    viper_road = """
Late 90s European nightlife luxury with action-thriller attitude. Faintly dangerous women. Relaxed but ready. Functional movement. Luxury espionage atmosphere without weapons.
""" if viper_mode else ""

    maxpower_road = """
Late 90s Eurotrash nightlife fantasy. Aggressive flash photography, candy colors, VHS glamour energy. Synthetic, erotic, excessive, strangely sincere.
""" if maxpower_mode else ""

    continental_road = """
Late 90s European overland travel. Ferry, pass road, café terrace, trail parking. Restrained travel editorial — place dominates, she is between destinations. Not US highway noir, not nightclub default.
""" if continental_mode else ""

    outfit_line = f"OUTFIT OVERRIDE — character now wears: {outfit_override}." if outfit_override else ""

    # Arrival outfit note — layer + character-specific practical styling for arrival context
    _arrival_layer_base = {
        "noir":      "Dark wool coat over simple dark dress or trousers + turtleneck. Boots. Collar up. Small bag or nothing. She just arrived — not a photoshoot.",
        "prestige":  "Tailored travel coat, quality carry-on or structured leather bag. Dressed well but practically — she came off a plane or train. No evening wear.",
        "viper":     "Dark functional clothing — fitted jacket, dark jeans or trousers, boots. Minimal luggage. No explanation of where she came from.",
        "nightlife": "She is arriving for the evening — dress or fitted top + jacket, heels. Taxi just dropped her. She already knows the address.",
        "eclipse":   "Minimal presence. Dark coat, nothing that catches the eye. She could have been here for hours. Nobody noticed her arrive.",
        "continental": "Worn wool coat or leather jacket, practical bag, boots. Ferry or train — not unpacked, not evening wear.",
        "sidewinder":"Came from the road — worn denim jacket or flannel, dusty boots, battered bag. Practical, heat-adapted. Just parked.",
        "maxpower":  "Bold color or fitted black, heels, statement bag. She arrived and the street noticed.",
    }
    _active_layer = (
        "noir" if noir_mode else
        "prestige" if prestige_mode else
        "viper" if viper_mode else
        "nightlife" if nightlife_mode else
        "eclipse" if eclipse_mode else
        "continental" if continental_mode else
        "sidewinder" if sidewinder_mode else
        "maxpower" if maxpower_mode else
        None
    )
    _arrival_char_override = {
        ("noir", "diana"):  "Black wool coat, boots. The coat is long. She just arrived. No dramatic styling.",
        ("noir", "terry"):  "Dark trousers, fitted black turtleneck, long coat. Boots. Collar up. Small leather bag. She already knows where she is going.",
        ("viper", "quinn"): "Military surplus or dark jacket, dark jeans, boots. Nothing that would slow her down.",
        ("prestige", "valentina"): "Tailored camel coat, structured leather bag. First class, always.",
        ("prestige", "naomi"): "Long structured coat, minimal jewelry. The luggage is better than the hotel.",
    }
    # Terrain-specific overrides for arrival outfit — coastal/beach needs lighter clothing
    _arrival_terrain_override = {
        ("prestige", "coastal"):   "Quality linen or light cotton — wide trousers or a simple shift dress. Leather sandals or espadrilles. Good leather tote or woven bag. She arrived from somewhere with an airport, not from the sea.",
        ("prestige", "lake"):      "Light linen or cotton layers, quality but relaxed. Leather sandals. She drove here in something good.",
        ("noir", "coastal"):       "Dark linen or light cotton coat — not wool. Boots or leather sandals. She still looks like she knows something you don't.",
        ("viper", "coastal"):      "Dark linen shirt, rolled sleeves, dark shorts or trousers. Sandals. Still functional. Still viper.",
        ("nightlife", "coastal"):  "Light dress or fitted top, heels she can manage on stone. The sea surprised her but she doesn't show it.",
    }
    _arrival_outfit_note = ""
    if character_key == "ingrid":
        _ingrid_jacket = random.choice([
            "leather jacket fully open, dark tee visible",
            "leather jacket half-open",
            "leather jacket slightly open at collar only",
        ])
        _arrival_outfit_note = (
            f"\nARRIVAL OUTFIT: Canonical biker leathers — {_ingrid_jacket}, "
            "dark tee underneath. Motorcycle boots. No bag."
        )
    elif _active_layer:
        _override = _arrival_char_override.get((_active_layer, character_key))
        _terrain_override = _arrival_terrain_override.get((_active_layer, terrain_ri))
        _base = _arrival_layer_base.get(_active_layer, "")
        _arrival_outfit_note = f"\nARRIVAL OUTFIT: {_override or _terrain_override or _base}"

    # Shadow play — optional composition variant for hard-light conditions
    _shadow_chars_exclude = ["elena", "yuki", "carmela", "oksana", "lyra", "nina", "tammy", "regina"]
    _shadow_terrain_include = ["desert", "coastal", "hills", "flatland"]
    _shadow_time_exclude = ["Night", "night", "dusk", "blue hour"]
    _time_hint = CHARACTER_TIME_OF_DAY.get(character_key, "")
    _shadow_ok = (
        terrain_ri in _shadow_terrain_include
        and character_key not in _shadow_chars_exclude
        and not any(t in _time_hint for t in _shadow_time_exclude)
        and place.get("attractiveness_score", 0) >= 80
        and random.random() < 0.33
    )
    if _shadow_ok:
        style_line += "\nCOMPOSITION OPTION: shadow present in frame — long afternoon or morning shadow falls naturally across ground or wall. Character fully visible, shadow adds depth. Natural, not staged."

    _dynamic_framing = get_dynamic_framing("main", terrain_ri)
    _expression = get_dynamic_expression("main", character_key)
    _expression_line = f"\n{_expression}" if _expression else ""

    _goldie_note = "\nGOLDIE: Smooth-coated reddish-tan Podenco-Terrier mix, rose ears always folded/floppy — never erect. Red collar. Walks beside Sofia naturally, never posed. Present in ~50% of shots." if character_key == "sofia" else ""
    _identity_lock = ""
    if character_key == "luca":
        _identity_lock = "\nIDENTITY: Man, late 20s, Italian, sun-bleached blonde wavy hair, light stubble, strong jaw — match reference exactly. NOT a woman."

    return f"""
Editorial travel photography, cinematic 35mm film grain, natural light.
Location: {name}, {country}.
{location_brief}

ARRIVAL CONTEXT: {arrival_context}

ROAD IDENTITY SHOT — arrival moment:
{arrival}

ARRIVAL RULE: {_subj} has already arrived. Both feet on the ground. The vehicle/transport is behind {_subj.lower()} or stationary. {_subj} is not mid-climb, not half-in half-out, not reaching for a door. {_subj} is standing. The movement is complete. We catch {_subj.lower()} in the first moment after — looking at the place, not at the camera.

The location fills 60%+ of frame. Character is present — not posed, not settled yet.
{outfit_line}{_arrival_outfit_note}{_goldie_note}{_identity_lock}
This is the first second after arriving. {_subj} is already there.
{style_line}
{FRAMING_ARRIVAL}
No text, no watermarks. Portrait orientation 800x1200.
{noir_layer}
{prestige_road}
{nightlife_road}
{viper_road}
{maxpower_road}
{continental_road}
""".strip()

def upload_road_identity_to_supabase(webp_bytes: bytes, place: dict, character_key: str) -> str:
    place_name = _place_slug(place)
    country = place["country_code"].lower()
    storage_path = f"cast/road/{place_name}_{country}_cast_{character_key}_road_1.webp"
    supabase.storage.from_("dedicated").upload(storage_path, webp_bytes, {"content-type": "image/webp"})
    try:
        supabase.table("place_hero_images").insert({
            "place_id": place["id"], "storage_path": storage_path, "variant": "main",
        }).execute()
    except Exception:
        pass  # variant constraint — storage upload succeeded
    return storage_path

# ══════════════════════════════════════════════
# CORE GENERATION
# ══════════════════════════════════════════════


def _expr_tag(expression: str) -> str:
    """Convert expression string to short filename tag."""
    if not expression:
        return ""
    mapping = {
        "caught mid-laugh": "_laugh",
        "lips slightly parted": "_lips",
        "lost in thought": "_thought",
        "direct eye contact": "_eye",
        "slight smirk": "_smirk",
        "slight genuine smile": "_smile",
        "concentrated": "_focus",
        "face tilted": "_sun",
        "mouth slightly open": "_open",
        "calm, eyes slightly narrowed": "_calm",
    }
    for key, tag in mapping.items():
        if key in expression:
            return tag
    return "_expr"

def generate_one(place, character_key, dry_run, exploit, suffix="", no_review=False, exploit_only=False, goldie_only=False, noir_mode=False, prestige_mode=False, nightlife_mode=False, viper_mode=False, maxpower_mode=False, outfit_override=None, eclipse_mode=False, sidewinder_mode=False, continental_mode=False, outfit_light=None, us_mode=False, eu_mode=False, exploit_key=None, expression_override=None, time_override=None, wet_override=None, friend_char=None, safe_mode=False):
    name = place["name_en"]
    _dayhike_mode = suffix == "_dayhike"
    prompt = build_prompt(place, character_key, noir_mode=noir_mode, prestige_mode=prestige_mode, nightlife_mode=nightlife_mode, viper_mode=viper_mode, maxpower_mode=maxpower_mode, outfit_override=outfit_override, eclipse_mode=eclipse_mode, sidewinder_mode=sidewinder_mode, continental_mode=continental_mode, dayhike_mode=_dayhike_mode, us_mode=us_mode, eu_mode=eu_mode)
    if safe_mode:
        prompt += (
            "\nSAFE MODE: Natural, relaxed posture only. No twisting, arching, or contorting the body. "
            "Head and body face the same direction. No over-the-shoulder glances. "
            "Character is absorbed in the scene, not performing for the camera. "
            "FRAMING: No other person or partial human (man, woman, hand, shoulder, silhouette) in extreme foreground — single subject only. "
            "OUTFIT MUST MATCH LOCATION: athletic or sport clothing only where location context makes it plausible "
            "(trail, beach, park, open road). In towns, historic streets, cafes, restaurants, or any urban/cultural setting — "
            "wear appropriate street clothing. Never athletic wear in a contextually mismatched setting."
        )
    if outfit_light and not (suffix == "" and not _dayhike_mode and get_location_outfit_override(character_key, place)):
        prompt += f"\nOUTFIT SUGGESTION (adapt freely based on location and context): {outfit_light}"
    if expression_override:
        prompt += f"\nEXPRESSION OVERRIDE: {expression_override}"
    # Auto-align time with prem layer if no manual time set
    _auto_time = time_override
    if not _auto_time:
        if nightlife_mode or maxpower_mode:
            _auto_time = "night"
        elif eclipse_mode or viper_mode:
            _auto_time = "blue_hour"
        elif prestige_mode:
            _auto_time = "golden"
        elif sidewinder_mode:
            _auto_time = "golden"  # American highway golden hour
        elif continental_mode:
            _auto_time = "overcast" if place.get("terrain_type") in _NATURE_TERRAINS else "golden"

    _resolved_time, _resolved_wet = resolve_time_wet(
        _auto_time, wet_override,
        place.get("terrain_type",""), place.get("country_code",""), character_key
    )
    if _resolved_time and _resolved_time in TIME_PRESETS:
        prompt += f"\n{TIME_PRESETS[_resolved_time]}"
    if _resolved_wet and _resolved_wet in WET_PRESETS:
        prompt += f"\n{WET_PRESETS[_resolved_wet]}"
    # Auto foreground — disabled for continental and day-hike shots
    if not continental_mode and not _dayhike_mode:
        _terrain_fg = place.get("terrain_type", "")
        _time_hint = time_override or ""
        _fg = get_foreground(_terrain_fg, "main", _time_hint)
        if _fg:
            prompt += f"\n{_fg}"
    _style_tag = ("_noir" if noir_mode else "") + ("_prestige" if prestige_mode else "") + ("_nightlife" if nightlife_mode else "") + ("_viper" if viper_mode else "") + ("_maxpower" if maxpower_mode else "") + ("_eclipse" if eclipse_mode else "") + ("_sidewinder" if sidewinder_mode else "") + ("_continental" if continental_mode else "") + ("_us" if us_mode else "") + ("_eu" if eu_mode else "") + (f"_{time_override}" if time_override else "") + (f"_wet{wet_override}" if wet_override else "")
    _maya_ctx = _maya_context(place) if character_key == "maya" else "land"
    canonical = load_canonical(character_key, context=_maya_ctx)
    # maya on land: no exploit shots
    if character_key == "maya" and _maya_ctx == "land":
        exploit = False

    from datetime import datetime as _dt; _ts = _dt.now().strftime("%H%M%S")
    with open("/tmp/sunnomad_prompts.log", "a") as _log:
        _log.write(f"\n=== {name} / {character_key} ===\n{prompt}\n")
    if character_key in PROBATION_CHARACTERS:
        exploit = False
        exploit_only = False
    if exploit_only or goldie_only:
        claude_visual = {"overall": 10, "exploit_potential": 10, "void_energy": 5, "one_line": ""}
    if not exploit_only and not goldie_only:
        print(f"  🎨 Generating [{character_key}]...")
        image_bytes = generate_image_safety_retry(prompt, reference_bytes=canonical)
        track_cost()
        _is_driver = character_key in ["driver_pov", "driver_van"]
        _do_review = _is_driver and not no_review and not exploit_only and not dry_run
        if _do_review:
            _img_nr = generate_image(prompt, reference_bytes=canonical)
            _out_nr = Path(f"/Users/jorg/sunnomad_output/sunnomad_{name.replace(' ', '_')}_{character_key}{suffix}{_style_tag}_noreview_{_ts}.webp")
            _out_nr.write_bytes(convert_to_webp(_img_nr))
            print(f"  💾 No-review: {_out_nr}")
        feedback = claude_analyze(image_bytes)
        print(f"  💬 {feedback}")
        if dry_run:
            _etag = _expr_tag(expression_override or "")
            out = Path(f"/Users/jorg/sunnomad_output/sunnomad_{name.replace(' ', '_')}_{character_key}{suffix}{_style_tag}_main{_etag}_{_ts}.webp")
            out.write_bytes(convert_to_webp(image_bytes))
            print(f"  💾 {out}")
            claude_visual = {"overall": 7.5, "void_energy": 7, "exploit_potential": 6, "one_line": ""}
        else:
            webp = convert_to_webp(image_bytes)
            _out_local = Path(f"/Users/jorg/sunnomad_output/sunnomad_{name.replace(' ', '_')}_{character_key}{suffix}{_style_tag}_main_{_ts}.webp")
            _out_local.write_bytes(webp)
            print(f"  💾 {_out_local}")
            storage_path = upload_to_supabase(webp, place, character_key, style_tag=_style_tag)
            print(f"  ✅ {storage_path}")
            claude_visual = claude_score(image_bytes)
            print(f"  📊 overall={claude_visual.get('overall',0)} void={claude_visual.get('void_energy',0)} exploit_pot={claude_visual.get('exploit_potential',0)}")

    # Exploit
    if exploit and not safe_mode:
        overall = claude_visual.get("overall", 0)
        exploit_pot = claude_visual.get("exploit_potential", 0)
        use_exploit = (
            (exploit_only or (overall >= 7.5 and exploit_pot >= 6))
            and character_key not in ["driver_pov", "driver_van", "luca", "chad"]
            and character_key in EXPLOIT_REPERTOIRE
        )
        if character_key == "regina" and not exploit_only:
            use_exploit = overall >= 8.5 and exploit_pot >= 7

        if use_exploit:
            n_attempts = 4 if exploit_pot >= 9 else 3 if exploit_pot >= 7 else 2
            terrain = place.get("terrain_type", "")
            shot_sequence = [exploit_key] * n_attempts if exploit_key else pick_exploit_sequence(character_key, n_attempts, terrain, place)
            canonical = load_exploit_canonical(character_key) or load_canonical(character_key)
            for attempt, shot_type in enumerate(shot_sequence):
                exp_prompt = build_exploit_prompt(place, character_key, shot_type, noir_mode=noir_mode, prestige_mode=prestige_mode, nightlife_mode=nightlife_mode, viper_mode=viper_mode, maxpower_mode=maxpower_mode, outfit_override=outfit_override, eclipse_mode=eclipse_mode, sidewinder_mode=sidewinder_mode, continental_mode=continental_mode, us_mode=us_mode, eu_mode=eu_mode, friend_char=friend_char)
                print(f"  🔥 Exploit {attempt+1}/{n_attempts}: {shot_type}")
                try:
                    exp_bytes = generate_image(exp_prompt, reference_bytes=canonical)
                    if dry_run:
                        _spicy = SPICINESS.get(shot_type, "spicy1")
                        _etag = _expr_tag(expression_override or "")
                        ep = Path(f"/Users/jorg/sunnomad_output/sunnomad_{name.replace(' ', '_')}_{character_key}{_style_tag}_exploit_{shot_type}_{_spicy}{_etag}_{_ts}_{attempt+1}.webp")
                        ep.write_bytes(convert_to_webp(exp_bytes))
                        print(f"  💾 {ep}")
                    else:
                        exp_webp = convert_to_webp(exp_bytes)
                        ep = upload_exploit_to_supabase(exp_webp, place, character_key, shot_type)
                        print(f"  ✅ Exploit: {ep}")
                except Exception as e:
                    log_blocked(place, character_key, shot_type, "exploit", exp_prompt, e)
                    _is_sexual_block = "sexual" in str(e).lower()
                    print(f"  >> Exploit {shot_type} blocked — trying fallback...")
                    # Sexual block: try one step less spicy from char repertoire
                    _spicy_order = ["spicy1", "spicy2", "spicy3"]
                    _blocked_spicy = SPICINESS.get(shot_type, "spicy1")
                    if _is_sexual_block and _spicy_order.index(_blocked_spicy) > 0:
                        _target_spicy = _spicy_order[_spicy_order.index(_blocked_spicy) - 1]
                        fallback_pool = [s for s in EXPLOIT_REPERTOIRE.get(character_key, [])
                                         if SPICINESS.get(s, "spicy1") == _target_spicy and s != shot_type]
                    else:
                        SAFE_FALLBACKS = ["candid", "hand_in_hair", "tight_crop", "street_snap"]
                        fallback_pool = [s for s in SAFE_FALLBACKS if s in EXPLOIT_REPERTOIRE.get(character_key, []) and s != shot_type]
                    if fallback_pool:
                        fallback = fallback_pool[0]
                        try:
                            fb_prompt = build_exploit_prompt(place, character_key, fallback, noir_mode=noir_mode, prestige_mode=prestige_mode, nightlife_mode=nightlife_mode, viper_mode=viper_mode, maxpower_mode=maxpower_mode, outfit_override=outfit_override, eclipse_mode=eclipse_mode, sidewinder_mode=sidewinder_mode, continental_mode=continental_mode, us_mode=us_mode, eu_mode=eu_mode)
                            fb_bytes = generate_image(fb_prompt, reference_bytes=canonical)
                            _spicy_fb = SPICINESS.get(fallback, "spicy1")
                            if dry_run:
                                ep = Path(f"/Users/jorg/sunnomad_output/sunnomad_{name.replace(' ', '_')}_{character_key}{_style_tag}_exploit_{fallback}_{_spicy_fb}_{_ts}.webp")
                                ep.write_bytes(convert_to_webp(fb_bytes))
                                print(f"  💾 Fallback: {ep}")
                            else:
                                fb_webp = convert_to_webp(fb_bytes)
                                ep = upload_exploit_to_supabase(fb_webp, place, character_key, fallback)
                                print(f"  >> Fallback: {ep}")
                        except Exception as e2:
                            log_blocked(place, character_key, fallback, "exploit_fallback", fb_prompt, e2)
                            print(f"  >> Fallback also blocked — giving up on exploits for this place.")
                            break  # Stop trying further exploit shots
        else:
            print(f"  ⏭️  Exploit skipped (overall={claude_visual.get('overall',0):.1f} pot={exploit_pot})")

    return claude_visual

def is_goldie_only_place(place: dict) -> bool:
    return place.get("name_en") in GOLDIE_ONLY_PLACE_NAMES


def process_place(place: dict, dry_run: bool = False, exploit: bool = False,
                  exploit_only: bool = False, goldie: bool = False, goldie_only: bool = False,
                  multi_char: bool = False, road_identity: bool = False, no_review: bool = False, character_override: str = None, noir_mode: bool = False, prestige_mode: bool = False, nightlife_mode: bool = False, viper_mode: bool = False, maxpower_mode: bool = False, outfit_override: str = None, eclipse_mode: bool = False, sidewinder_mode: bool = False, continental_mode: bool = False, no_boost: bool = False, outfit_light: str = None, us_mode: bool = False, eu_mode: bool = False, activity: bool = False, activity_key: str = None, exploit_key: str = None, activity_only: bool = False, expression_override: str = None, time_override: str = None, wet_override: str = None,                   friend_char: str = None, cinematic_key: str = None, safe_mode: bool = False, dayhike_only: bool = False, main_only: bool = False, arrival_only: bool = False):
    name = place["name_en"]
    if is_goldie_only_place(place):
        goldie_only = True
    from datetime import datetime as _dt_pp; _ts = _dt_pp.now().strftime("%H%M%S")
    if goldie_only:
        character_key = "goldie"
    else:
        character_key = character_override if character_override else select_character(
            place["country_code"], place.get("terrain_type",""), place.get("place_type",""),
            place.get("name_en",""), place=place,
        )
    if character_override == "valentina" and not is_power_place(place):
        print(f"  ⏭️  Valentina skipped — not a power place ({name})")
        return {"overall": 0, "void_energy": 0, "exploit_potential": 0, "one_line": ""}
    if character_key in DISABLED_CHARACTERS:
        print(f"  ⏭️  {character_key} is disabled — skipping")
        return {"overall": 0, "void_energy": 0, "exploit_potential": 0, "one_line": ""}

    _had_urban_premium = any([noir_mode, nightlife_mode, viper_mode, prestige_mode, maxpower_mode, eclipse_mode])
    _prem = suppress_urban_premium_for_place(
        place,
        noir_mode=noir_mode, nightlife_mode=nightlife_mode, viper_mode=viper_mode,
        prestige_mode=prestige_mode, maxpower_mode=maxpower_mode, eclipse_mode=eclipse_mode,
    )
    if (is_nature_place(place) or is_beach_place(place) or is_desert_place(place)) and _had_urban_premium:
        print("  🌿 Outdoor location — urban premium suppressed (noir/nightlife/viper/prestige/maxpower/eclipse)")
    noir_mode = _prem["noir_mode"]
    nightlife_mode = _prem["nightlife_mode"]
    viper_mode = _prem["viper_mode"]
    prestige_mode = _prem["prestige_mode"]
    maxpower_mode = _prem["maxpower_mode"]
    eclipse_mode = _prem["eclipse_mode"]

    print(f"\n{'─'*50}")
    print(f"📍 {name} ({place['country_code']}) → {character_key}")
    _style_tag = ("_noir" if noir_mode else "") + ("_prestige" if prestige_mode else "") + ("_nightlife" if nightlife_mode else "") + ("_viper" if viper_mode else "") + ("_maxpower" if maxpower_mode else "") + ("_eclipse" if eclipse_mode else "") + ("_sidewinder" if sidewinder_mode else "") + ("_continental" if continental_mode else "") + ("_us" if us_mode else "") + ("_eu" if eu_mode else "") + (f"_{time_override}" if time_override else "") + (f"_wet{wet_override}" if wet_override else "")
    # No exploit for lakes and national parks — overrides exploit_only too
    _place_type = (place.get("place_type") or "").upper()
    _terrain = place.get("terrain_type", "")
    if _terrain == "lake" or _place_type in ["PRK", "PRKX", "NPARK", "RESV"]:
        exploit = False
        exploit_only = False

    # When focused on a specific shot type, suppress road identity
    if activity_only or exploit_only or cinematic_key or dayhike_only or main_only:
        road_identity = False
    if arrival_only:
        road_identity = True

    # Skip main shot if activity_only, goldie_only, dayhike_only, or arrival_only
    if activity_only or goldie_only or dayhike_only or arrival_only:
        claude_visual = {"overall": 7.5, "void_energy": 7, "exploit_potential": 6, "one_line": ""}
    else:
        # Venice special: double exploits, always include cleavage
        claude_visual = generate_one(place, character_key, dry_run, exploit, no_review=no_review, exploit_only=exploit_only, goldie_only=goldie_only, noir_mode=noir_mode, prestige_mode=prestige_mode, nightlife_mode=nightlife_mode, viper_mode=viper_mode, maxpower_mode=maxpower_mode, outfit_override=outfit_override, eclipse_mode=eclipse_mode, sidewinder_mode=sidewinder_mode, continental_mode=continental_mode, outfit_light=outfit_light, us_mode=us_mode, eu_mode=eu_mode, exploit_key=exploit_key, expression_override=expression_override, time_override=time_override, wet_override=wet_override, friend_char=friend_char, safe_mode=safe_mode)

    if goldie_only:
        print("  🐕 Generating Goldie shot...")
        location_brief = claude_location_brief(place["name_en"], place["country_code"])
        goldie_prompt = build_goldie_prompt(place, location_brief, outfit_override=outfit_override)
        try:
            goldie_canonical = load_canonical("goldie")
            goldie_bytes = generate_image(goldie_prompt, reference_bytes=goldie_canonical)
            if dry_run:
                gp = Path(f"/Users/jorg/sunnomad_output/sunnomad_{name.replace(' ', '_')}_goldie{_style_tag}_main_{_ts}.webp")
                gp.write_bytes(convert_to_webp(goldie_bytes))
                print(f"  💾 Goldie: {gp}")
            else:
                goldie_webp = convert_to_webp(goldie_bytes)
                gp = upload_goldie_to_supabase(goldie_webp, place)
                print(f"  ✅ Goldie: {gp}")
        except Exception as e:
            log_blocked(place, "goldie", "goldie", "goldie", goldie_prompt, e)
            print(f"  ⚠️  Goldie failed: {e}")
        return claude_visual

    if goldie:
        print("  🐕 Scoring Goldie...")
        goldie_data = claude_goldie_score(place["name_en"], place["country_code"], place.get("terrain_type",""))
        goldie_score = goldie_data.get("goldie_overall", 0)
        print(f"  🐕 Goldie score: {goldie_score:.1f} — {goldie_data.get('goldie_line','')}")
        if goldie_score >= GOLDIE_MIN_SCORE:
            location_brief = claude_location_brief(place["name_en"], place["country_code"])
            goldie_prompt = build_goldie_prompt(place, location_brief, outfit_override=outfit_override)
            print("  🐕 Generating Goldie shot...")
            try:
                goldie_canonical = load_canonical("goldie")
                goldie_bytes = generate_image(goldie_prompt, reference_bytes=goldie_canonical)
                if dry_run:
                    gp = Path(f"/Users/jorg/sunnomad_output/sunnomad_{name.replace(' ', '_')}_goldie{_style_tag}_main_{_ts}.webp")
                    gp.write_bytes(convert_to_webp(goldie_bytes))
                    print(f"  💾 Goldie: {gp}")
                else:
                    goldie_webp = convert_to_webp(goldie_bytes)
                    gp = upload_goldie_to_supabase(goldie_webp, place)
                    print(f"  ✅ Goldie: {gp}")
            except Exception as e:
                log_blocked(place, "goldie", "goldie", "goldie", goldie_prompt, e)
                print(f"  ⚠️  Goldie failed: {e}")
        else:
            print(f"  ⏭️  Goldie score too low ({goldie_score:.1f})")

    # Driver always gets one additional character
    if character_key in ["driver_pov","driver_van"] and not exploit_only and not goldie_only:
        extra = select_character(
            place["country_code"], place.get("terrain_type",""), place.get("place_type",""),
            place.get("name_en",""), place=place,
        )
        if extra in ["driver_pov","driver_van"]:
            extra = "jade" if place["country_code"] in ["US","CA"] else "sofia"
        print(f"\n  🔄 Driver bonus: {extra}")
        generate_one(place, extra, dry_run, exploit, suffix=f"_{extra}", exploit_key=exploit_key)

    # Multi-char rotation
    if multi_char and not dry_run:
        overall = claude_visual.get("overall", 0)
        void_e = claude_visual.get("void_energy", 0)
        extra_chars = get_multi_chars(place, character_key, overall, void_e)
        extra_chars = [c for c in extra_chars if c != character_key]
        for i, extra_char in enumerate(extra_chars):
            print(f"\n  🔄 Multi-char [{i+1}/{len(extra_chars)}]: {extra_char}")
            generate_one(place, extra_char, dry_run, exploit, suffix=f"_{extra_char}", exploit_key=exploit_key)

    # ── PLACE BOOST EXPLOITS ──
    _boost_shots = get_place_boost(place.get("name_en",""), character_key) if (exploit and not no_boost) else []
    if _boost_shots:
        _boost_canonical = load_canonical(character_key)
        print(f"  ⭐ Place boost — {len(_boost_shots)} special shots for {place.get('name_en','')}")
        _boost_blocked = 0
        for bi, bshot in enumerate(_boost_shots):
            if _boost_blocked >= 2:
                print(f"  ⏭️  Boost auto-skip — 2 consecutive blocks")
                break
            bp = build_exploit_prompt(place, character_key, bshot)
            try:
                from datetime import datetime as _dbt; _tbs = _dbt.now().strftime("%H%M%S")
                _use_can = _boost_canonical if bi % 2 == 0 else None
                bb = generate_image(bp, reference_bytes=_use_can)
                _spicy_b = SPICINESS.get(bshot, "spicy1")
                _boost_blocked = 0
                if dry_run:
                    bep = Path(f"/Users/jorg/sunnomad_output/sunnomad_{name.replace(' ', '_')}_{character_key}_boost_{bshot}_{_spicy_b}_{_tbs}.webp")
                    bep.write_bytes(convert_to_webp(bb))
                    print(f"  💾 Boost: {bep}")
                else:
                    bwebp = convert_to_webp(bb)
                    upload_exploit_to_supabase(bwebp, place, character_key, bshot)
                    print(f"  ✅ Boost: {bshot}")
            except Exception as be:
                _boost_blocked += 1
                log_blocked(place, character_key, bshot, "boost", bp, be)
                print(f"  ⚠️  Boost {bshot} blocked ({_boost_blocked}/2): {be}")


    # ── ROAD IDENTITY ──
    if road_identity and not goldie_only and should_generate_road_identity(place, character_key) and character_key not in ["driver_pov","driver_van"]:
        from datetime import datetime as _dt3; _ts3 = _dt3.now().strftime("%H%M%S")
        _arrival_ctx = get_arrival_context(place)
        print(f"  🚗 Road Identity: {_arrival_ctx[:50]}...")
        ri_brief = claude_location_brief(place["name_en"], place["country_code"])
        ri_prompt = build_road_identity_prompt(place, character_key, ri_brief, noir_mode=noir_mode, prestige_mode=prestige_mode, nightlife_mode=nightlife_mode, viper_mode=viper_mode, maxpower_mode=maxpower_mode, outfit_override=outfit_override, eclipse_mode=eclipse_mode, sidewinder_mode=sidewinder_mode, continental_mode=continental_mode, us_mode=us_mode, eu_mode=eu_mode)
        _ri_ctx = _maya_context(place) if character_key == "maya" else "land"
        ri_canonical = load_canonical(character_key, context=_ri_ctx)
        try:
            ri_bytes = generate_image_safety_retry(ri_prompt, reference_bytes=ri_canonical)
            if dry_run:
                rp = Path(f"/Users/jorg/sunnomad_output/sunnomad_{name.replace(' ', '_')}_{character_key}{_style_tag}_arrival_{_ts3}.webp")
                rp.write_bytes(convert_to_webp(ri_bytes))
                print(f"  💾 Road: {rp}")
            else:
                ri_webp = convert_to_webp(ri_bytes)
                rp = upload_road_identity_to_supabase(ri_webp, place, character_key)
                print(f"  ✅ Road: {rp}")
        except Exception as e:
            log_blocked(place, character_key, "road_identity", "road", ri_prompt, e)
            print(f"  ⚠️  Road Identity failed: {e}")
    elif road_identity and not goldie_only:
        print(f"  ⏭️  Road Identity skipped — terrain/location not suitable")



    # ── ACTIVITY ──
    _skip_activity_terrain = (place.get("terrain_type", "") in _VAST_LANDSCAPE_TERRAINS or
                               (place.get("place_type") or "").upper() in _VAST_LANDSCAPE_PLACE_TYPES or
                               place.get("place_type") == "scenic_drive")
    if activity and not main_only and not dayhike_only and not goldie_only and not arrival_only and character_key not in ["driver_pov", "driver_van"] and not _skip_activity_terrain:
        from datetime import datetime as _dta; _tsa = _dta.now().strftime("%H%M%S")
        terrain_a = place.get("terrain_type", "")
        pt_a = place.get("place_type", "")
        # For noir/nightlife/viper: exclude outdoor sport activities — only urban/indoor fit
        _dark_mode = noir_mode or nightlife_mode or viper_mode or eclipse_mode or maxpower_mode
        _outdoor_sport_activities = {
            "kajak_sup", "hiking_back", "beach_walk_distance",
            "snowshoe_hike", "surfing", "muscheln_sammeln", "weinlese", "olivenernte",
            "boot_streichen", "sailing", "cycling_road", "sunset_beer", "beer_crate",
        }
        _prestige_blacklist = {"kajak_sup", "surfing", "boot_streichen", "muscheln_sammeln", "weinlese", "olivenernte", "snowshoe_hike", "sunset_beer", "beer_crate"}
        # Sidewinder = US road trip — European market/harvest/harbour activities don't fit
        # market_browse exception: MX (mercados iconic) + specific US cities with landmark markets
        _sidewinder_market_ok_countries = {"mx"}
        _sidewinder_market_ok_cities = {
            "seattle", "san francisco", "portland", "new orleans", "santa fe",
            "albuquerque", "tucson", "santa barbara", "los angeles", "oaxaca",
            "mexico city", "guadalajara", "monterrey", "san miguel de allende",
        }
        _place_name_lower = place.get("name_en", "").lower()
        _place_country_lower = place.get("country_code", "").lower()
        _market_ok = (
            _place_country_lower in _sidewinder_market_ok_countries
            or any(c in _place_name_lower for c in _sidewinder_market_ok_cities)
        )
        _sidewinder_blacklist = {
            "weinlese", "olivenernte", "muscheln_sammeln", "boot_streichen",
            "reisebuero_inside", "reisebuero_window", "harbour_walk", "apres_ski_bar",
            "sunset_beer", "beer_crate", "postcard_write", "newspaper_cafe", "kiosk_stop",
        }
        if not _market_ok:
            _sidewinder_blacklist.add("market_browse")
        # No market for villages and tiny places — no infrastructure
        if pt_a in ("village", "hamlet", "isolated_dwelling"):
            _sidewinder_blacklist.add("market_browse")
        _nature_pack_mode = nature_shot_pack(place, us_mode, eu_mode, continental_mode)
        if activity_key in DISABLED_ACTIVITIES:
            acts = []
        elif terrain_a == "lake" and not activity_key:
            _lake_excluded = set(CHARACTER_ACTIVITY_EXCLUDE.get(character_key, []))
            acts = [a for a in ("kayak_entry", "kajak_sup", "hiking_back")
                    if a not in _lake_excluded and a not in DISABLED_ACTIVITIES]
        elif _nature_pack_mode and not activity_key:
            _hike_excluded = "hiking_back" in set(CHARACTER_ACTIVITY_EXCLUDE.get(character_key, []))
            if not _hike_excluded:
                acts = ["hiking_back"]
            else:
                acts_pool = pick_activity(character_key, terrain_a, pt_a, n=5)
                acts = [a for a in acts_pool if a == "hiking_back"] or acts_pool[:1]
        elif _dark_mode and not activity_key:
            acts_pool = pick_activity(character_key, terrain_a, pt_a, n=3)
            acts = [a for a in acts_pool if a not in _outdoor_sport_activities] or \
                   [a for a in ["cafe_terrace", "menu_study", "sunset_wine"] if True][:1]
        elif prestige_mode and not activity_key:
            acts_pool = pick_activity(character_key, terrain_a, pt_a, n=3)
            acts = [a for a in acts_pool if a not in _prestige_blacklist] or \
                   [a for a in ["cafe_terrace", "menu_study", "hotel_lobby"] if True][:1]
        elif sidewinder_mode and not activity_key:
            acts_pool = pick_activity(character_key, terrain_a, pt_a, n=5)
            acts = [a for a in acts_pool if a not in _sidewinder_blacklist] or \
                   [a for a in ["cafe_terrace", "going_for_a_run", "sunset_wine"] if True][:1]
        elif continental_mode and not activity_key:
            _continental_ok = {
                "reisebuero_window", "reisebuero_inside", "harbour_walk", "hiking_back",
                "newspaper_cafe", "cafe_terrace", "postcard_write", "kiosk_stop", "menu_study",
                "going_for_a_run", "market_browse", "sunset_wine", "quay_fishing", "cigarette_roll",
            }
            acts_pool = pick_activity(character_key, terrain_a, pt_a, n=5)
            acts = [a for a in acts_pool if a in _continental_ok] or \
                   [a for a in ["cafe_terrace", "harbour_walk", "hiking_back"] if True][:1]
        elif safe_mode and not activity_key:
            _safe_pool = set(SAFE_ACTIVITIES)
            if terrain_a in ("coastal",) and _quay_fishing_ok(pt_a, terrain_a):
                _safe_pool.add("quay_fishing")
            if character_key == "thea":
                _safe_pool.add("beer_crate")
            acts_pool = pick_activity(character_key, terrain_a, pt_a, n=5)
            acts = [a for a in acts_pool if a in _safe_pool] or \
                   [a for a in ["cafe_terrace", "harbour_walk", "hiking_back"] if True][:1]
        else:
            acts = pick_activity(character_key, terrain_a, pt_a, n=1) if not activity_key else [activity_key]
            if acts and acts[0] == "quay_fishing" and not _quay_fishing_ok(pt_a, terrain_a):
                acts = pick_activity(character_key, terrain_a, pt_a, n=5)
                acts = [a for a in acts if a != "quay_fishing"][:1]
            # No market for villages
            if pt_a in ("village", "hamlet", "isolated_dwelling") and acts and acts[0] == "market_browse":
                acts = pick_activity(character_key, terrain_a, pt_a, n=5)
                acts = [a for a in acts if a != "market_browse"][:1]
        if activity_key in DISABLED_ACTIVITIES:
            print(f"  ⏭️  Activity '{activity_key}' disabled globally")
        elif acts:
            for act in acts:
                print(f"  🏄 Activity: {act}")
                act_prompt = build_activity_prompt(place, character_key, act, outfit_override=outfit_override, noir_mode=noir_mode, prestige_mode=prestige_mode, nightlife_mode=nightlife_mode, viper_mode=viper_mode, maxpower_mode=maxpower_mode, eclipse_mode=eclipse_mode, sidewinder_mode=sidewinder_mode, continental_mode=continental_mode, us_mode=us_mode, eu_mode=eu_mode)
                _act_ctx = _maya_context(place, activity_key=act) if character_key == "maya" else "land"
                act_canonical = load_canonical(character_key, context=_act_ctx)
                act_bytes = None
                try:
                    try:
                        act_bytes = generate_image(act_prompt, reference_bytes=act_canonical)
                        track_cost()
                    except Exception as e:
                        if "safety" in str(e).lower() or "moderation" in str(e).lower():
                            print(f"  ⚠️  Activity safety block — retrying without reference...")
                            act_bytes = generate_image(act_prompt, reference_bytes=None)
                            track_cost()
                        else:
                            raise e
                except Exception as e:
                    print(f"  ⚠️  Activity failed ({act}): {e}")
                    continue
                if act_bytes:
                    if dry_run:
                        ap = Path(f"/Users/jorg/sunnomad_output/sunnomad_{name.replace(' ', '_')}_{character_key}{_style_tag}_activity_{act}_{_tsa}.webp")
                        ap.write_bytes(convert_to_webp(act_bytes))
                        print(f"  💾 Activity: {ap}")
                    else:
                        act_webp = convert_to_webp(act_bytes)
                        ap = upload_activity_to_supabase(act_webp, place, character_key, act)
                        print(f"  ✅ Activity: {ap}")
        else:
            print(f"  ⏭️  Activity skipped — no suitable activity for this terrain/type")

    # ── CINEMATIC SHOT ──
    if cinematic_key:
        if character_key not in CINEMATIC_REPERTOIRE.get(cinematic_key, []):
            print(f"  ⏭️  Cinematic '{cinematic_key}' not in repertoire for {character_key}")
        else:
            from datetime import datetime as _dtcin; _tscin = _dtcin.now().strftime("%H%M%S")
            print(f"  🎬 Cinematic: {cinematic_key}")
            cin_prompt = build_cinematic_prompt(place, character_key, cinematic_key, noir_mode=noir_mode, prestige_mode=prestige_mode, nightlife_mode=nightlife_mode, viper_mode=viper_mode, maxpower_mode=maxpower_mode, eclipse_mode=eclipse_mode, sidewinder_mode=sidewinder_mode, continental_mode=continental_mode, us_mode=us_mode, eu_mode=eu_mode)
            cin_canonical = load_canonical(character_key)
            try:
                cin_bytes = generate_image(cin_prompt, reference_bytes=cin_canonical)
                track_cost()
                if dry_run:
                    cp = Path(f"/Users/jorg/sunnomad_output/sunnomad_{name.replace(' ','_')}_{character_key}{_style_tag}_cinematic_{cinematic_key}_{_tscin}.webp")
                    cp.write_bytes(convert_to_webp(cin_bytes))
                    print(f"  💾 Cinematic: {cp}")
                else:
                    cin_webp = convert_to_webp(cin_bytes)
                    cp = upload_cinematic_to_supabase(cin_webp, place, character_key, cinematic_key)
                    print(f"  ✅ Cinematic: {cp}")
            except Exception as e:
                print(f"  ⚠️  Cinematic failed: {e}")

    # ── NATURE DAY-HIKE ──
    _nature_pack = nature_shot_pack(place, us_mode, eu_mode, continental_mode)
    if (
        dayhike_only
        or _nature_pack
    ) and (
        not main_only
        and not arrival_only
        and not goldie_only
        and not activity_only
        and not exploit_only
        and not cinematic_key
        and character_key not in ["driver_pov", "driver_van"]
    ):
        _dh_continental = continental_mode or (eu_mode and not us_mode and bool(_nature_pack))
        print("  🥾 Nature day-hike outfit shot...")
        try:
            generate_one(
                place, character_key, dry_run, exploit=False, suffix="_dayhike",
                no_review=no_review, outfit_override=NATURE_DAY_HIKE_OUTFIT,
                noir_mode=noir_mode, prestige_mode=prestige_mode, nightlife_mode=nightlife_mode,
                viper_mode=viper_mode, maxpower_mode=maxpower_mode, eclipse_mode=eclipse_mode,
                sidewinder_mode=sidewinder_mode,
                continental_mode=_dh_continental,
                us_mode=us_mode, eu_mode=eu_mode, time_override=time_override or "golden",
                expression_override=expression_override, wet_override=wet_override,
                safe_mode=safe_mode,
            )
        except Exception as e:
            print(f"  ⚠️  Day-hike shot failed: {e}")

    # ── FAR SHOT (vast landscape or any nature place) ──
    _vl_terrain = place.get("terrain_type", "")
    _vl_pt = (place.get("place_type") or "").upper()
    _is_vast = _vl_terrain in _VAST_LANDSCAPE_TERRAINS or _vl_pt in _VAST_LANDSCAPE_PLACE_TYPES
    _nature_pack_fs = nature_shot_pack(place, us_mode, eu_mode, continental_mode)
    _do_farshot = (_is_vast and not _nature_pack_fs) or bool(_nature_pack_fs)
    if _do_farshot and not goldie_only and not activity_only and not dayhike_only and not main_only and not arrival_only and character_key not in ["driver_pov", "driver_van"]:
        from datetime import datetime as _dtvl; _tsvl = _dtvl.now().strftime("%H%M%S")
        print(f"  🏔️  Vast landscape far shot...")
        _vl_brief = claude_location_brief(place["name_en"], place.get("country_code", ""))
        _vl_prompt = build_far_shot_prompt(
            place, character_key, _vl_brief,
            noir_mode=noir_mode, prestige_mode=prestige_mode, nightlife_mode=nightlife_mode,
            viper_mode=viper_mode, maxpower_mode=maxpower_mode, eclipse_mode=eclipse_mode,
            sidewinder_mode=sidewinder_mode, continental_mode=continental_mode,
            us_mode=us_mode, eu_mode=eu_mode,
        )
        _vl_canonical = load_canonical(character_key)
        try:
            _vl_bytes = generate_image(_vl_prompt, reference_bytes=_vl_canonical)
            if dry_run:
                _vlp = Path(f"/Users/jorg/sunnomad_output/sunnomad_{name.replace(' ', '_')}_{character_key}{_style_tag}_farshot_{_tsvl}.webp")
                _vlp.write_bytes(convert_to_webp(_vl_bytes))
                print(f"  💾 Far shot: {_vlp}")
            else:
                _vl_webp = convert_to_webp(_vl_bytes)
                _vl_path = f"cast/farshot/{place['name_en'].lower().replace(' ','_')}_{place.get('country_code','').lower()}_cast_{character_key}_farshot.webp"
                supabase.storage.from_("dedicated").upload(_vl_path, _vl_webp, {"content-type": "image/webp"})
                print(f"  ✅ Far shot: {_vl_path}")
        except Exception as e:
            print(f"  ⚠️  Far shot failed: {e}")

    # ── SCENIC DRIVE EXTERIOR SHOTS ──
    _place_name = place.get("name_en", "")
    if _place_name in SCENIC_DRIVE_PLACES and not goldie_only and not activity_only and not dayhike_only and character_key not in ["driver_pov", "driver_van"]:
        from datetime import datetime as _dtsd; _tssd = _dtsd.now().strftime("%H%M%S")
        _sd_vehicle = get_character_vehicle(character_key, place.get("country_code", "")) or SCENIC_DRIVE_VEHICLES["default"]
        _sd_brief = claude_location_brief(_place_name, place.get("country_code", ""))
        # Pick 2 random angles + roadside stop + occasional petrol shot
        _sd_angles = random.sample(SCENIC_DRIVE_SHOT_ANGLES, min(2, len(SCENIC_DRIVE_SHOT_ANGLES)))
        _sd_stop = SCENIC_DRIVE_PETROL_SHOT if random.random() < 0.4 else SCENIC_DRIVE_STOP_SHOT
        _sd_shots = [("angle", a) for a in _sd_angles] + [("roadside", SCENIC_DRIVE_STOP_SHOT), ("stop", _sd_stop)]
        print(f"  🛣️  Scenic drive: {len(_sd_shots)} exterior shots")
        for _sdi, (_sd_type, _sd_angle) in enumerate(_sd_shots):
            _sd_prompt = build_scenic_drive_prompt(place, character_key, _sd_angle, _sd_vehicle, _sd_brief)
            _sd_canonical = load_canonical(character_key)
            try:
                _sd_bytes = generate_image(_sd_prompt, reference_bytes=_sd_canonical)
                if dry_run:
                    _sdp = Path(f"/Users/jorg/sunnomad_output/sunnomad_{name.replace(' ', '_')}_{character_key}_scenic_{_sd_type}_{_sdi+1}_{_tssd}.webp")
                    _sdp.write_bytes(convert_to_webp(_sd_bytes))
                    print(f"  💾 Scenic {_sd_type}: {_sdp}")
                else:
                    _sd_webp = convert_to_webp(_sd_bytes)
                    _sd_path = f"cast/scenic/{_place_name.lower().replace(' ','_')}_{place.get('country_code','').lower()}_cast_{character_key}_scenic_{_sd_type}_{_sdi+1}.webp"
                    supabase.storage.from_("dedicated").upload(_sd_path, _sd_webp, {"content-type": "image/webp"})
                    print(f"  ✅ Scenic {_sd_type}: {_sd_path}")
            except Exception as e:
                print(f"  ⚠️  Scenic drive shot failed: {e}")

    return claude_visual


# ══════════════════════════════════════════════
# AUTO LAYER SELECTION
# ══════════════════════════════════════════════

AMERICAS_CODES = {
    "US","CA","MX","GT","BZ","HN","SV","NI","CR","PA",
    "CU","JM","HT","DO","PR","TT","BB","LC","VC","GD","AG","DM","KN","BS",
    "CO","VE","GY","SR","BR","PE","EC","BO","PY","AR","CL","UY","GF",
}

def get_base_layer(country_code: str) -> str:
    """Returns 'us' or 'eu' based on country code."""
    return "us" if country_code in AMERICAS_CODES else "eu"

# ── Place-level hard overrides — highest priority, beats everything ──
# Use place name_en exactly as stored. Value: layer string or None to suppress premium.

# Characters on probation — still run, but no premium layer and no exploit
PROBATION_CHARACTERS: set = {
    "celine",
}

PLACE_PREMIUM_OVERRIDES: dict[str, str | None] = {
    # "Monaco":        "prestige",
    # "Las Vegas":     "sidewinder",
    # "Belgrade":      "viper",
}

# ── Character hard locks — always this layer regardless of geo ──
# Use None to always suppress premium for that character.
CHARACTER_PREMIUM_LOCK: dict[str, str | None] = {
    # "terry":   "eclipse",
    # "cleo":    None,       # no premium ever
}

# ── Character geo preferences — used as fallback when geo has no opinion ──
# List = random.choice among options. None = suppress.
CHARACTER_PREMIUM_PREFER: dict[str, list] = {
    "naomi":      ["prestige"],
    "valentina":  ["prestige"],
    "sofia":      [None],
    "yosra":      ["eclipse"],
    "elena":      ["nightlife"],
    "katja":      ["viper"],
    "alessandra": [None],
    "ingrid":     ["viper"],
    "regina":     ["eclipse"],
    "maya":       ["prestige"],
    "diaz":       ["viper", "maxpower"],
    "stacy":      [None],
    "tasha":      [None],
    "kay":        [None],
    "charlotte":  ["noir", "nightlife", "viper"],
    "thea":       ["nightlife", "eclipse"],
    "tammy":      [None],
    "lyra":       ["nightlife"],
    "werra":      ["viper"],
    "olga":       ["eclipse"],
    "nina":       ["eclipse"],
    "mila":       ["viper"],
    "sigrid":     ["eclipse", "viper"],
    "quinn":      ["viper", "eclipse"],
    "isabella":   ["prestige"],
    "maria":      ["eclipse"],
    "rosa":       ["viper", "maxpower"],
    "carmela":    ["nightlife", "maxpower"],
    "yuki":       ["eclipse", "viper"],
    "celine":     ["nightlife"],
    "ana":        ["prestige"],
    "amber":      ["sidewinder"],
    "zara":       ["eclipse", "nightlife"],
    "cleo":       [None],
    "diana":      ["noir", "viper", "eclipse"],
    "terry":      ["noir", "eclipse"],
    "conrad":     ["prestige", "eclipse"],
    # natural / no premium layer
    "metka":      [None],
    "luca":       [None],
    "chad":       [None],
    "djordje":    [None],
    "goldie":     [None],
    "klara":      [None],
    "nadia":      [None],
    # assigned premium
    "jade":       ["sidewinder", "maxpower"],
    "kelek":      ["eclipse", "viper"],
}


_NATURE_PLACE_TYPES = {"national_park", "wilderness", "nature_reserve", "natural_park", "scenic_drive"}
_NATURE_TERRAINS = {"mountain", "mountains", "high_mountains", "wilderness", "lake"}
_URBAN_PREMIUM_LAYERS = {"nightlife", "maxpower", "prestige", "noir", "viper"}


def _finalize_premium_layer(layer: str | None, place: dict, is_us: bool) -> str | None:
    """US: sidewinder only. EU nature: no auto premium (continental is day-hike only)."""
    if not layer:
        return None
    if is_us:
        return "sidewinder"
    if is_nature_place(place):
        return None
    return layer


def pick_premium_layer(place: dict, character_key: str, void_energy: float = 0) -> str | None:
    """Auto-select premium layer based on place, character, and void_energy score."""
    country = place.get("country_code", "")
    terrain = place.get("terrain_type", "")
    place_type = (place.get("place_type") or "").lower()
    score = place.get("attractiveness_score", 0)
    place_name = place.get("name_en", "")
    is_us = country in AMERICAS_CODES

    # Threshold check
    if score < 85 and void_energy < 7:
        return None
    # Driver chars and probation chars don't get premium layer
    if character_key in ["driver_pov", "driver_van"] or character_key in PROBATION_CHARACTERS:
        return None

    # EU nature: no auto premium on main/far/road — continental is day-hike only
    if not is_us and is_nature_place(place):
        return None

    chosen = None

    # 1. Place hard override — beats everything
    if place_name in PLACE_PREMIUM_OVERRIDES:
        chosen = PLACE_PREMIUM_OVERRIDES[place_name]

    # 2. Character hard lock — beats geo
    elif character_key in CHARACTER_PREMIUM_LOCK:
        chosen = CHARACTER_PREMIUM_LOCK[character_key]

    elif is_us:
        # US auto-premium: sidewinder only (road/nature/motel register)
        if terrain in ["coastal", "lake"] and character_key in ["sofia", "ana", "lyra"]:
            chosen = None
        else:
            chosen = "sidewinder"

    else:
        # EU premium selection

        # Cold/Nordic / alpine → eclipse or viper
        if country in ["NO", "SE", "FI", "IS", "DK"] or terrain in ("mountain", "mountains", "high_mountains"):
            if character_key in ["ingrid", "werra", "katja", "elena"]:
                chosen = "viper"
            else:
                chosen = "eclipse"

        # Mediterranean coastal → prestige
        elif terrain == "coastal" and country in ["IT", "GR", "HR", "ME", "AL", "ES", "PT", "FR", "MC", "TR", "MA", "TN"]:
            if character_key in ["sofia", "ana"] and score < 93:
                chosen = None
            elif character_key in CHARACTER_PREMIUM_PREFER:
                pref = CHARACTER_PREMIUM_PREFER[character_key]
                if pref != ["prestige"] and pref != [None]:
                    chosen = random.choice(pref)
                else:
                    chosen = "prestige"
            else:
                chosen = "prestige"

        # Urban European → nightlife or eclipse
        elif place_type.upper() in ["PPLC", "PPLA", "PPL"] and score >= 85:
            if character_key in CHARACTER_PREMIUM_PREFER:
                chosen = random.choice(CHARACTER_PREMIUM_PREFER[character_key])
            else:
                chosen = "eclipse"

        # Spanish/Mediterranean → eclipse for maria
        elif country in ["ES", "PT"] and character_key in ["maria"]:
            chosen = "eclipse"

        # Balkan/Eastern European → viper
        elif country in ["RS", "BA", "MK", "SI", "BG", "RO", "HU", "CZ", "PL", "UA", "HR"]:
            if character_key in CHARACTER_PREMIUM_PREFER:
                chosen = random.choice(CHARACTER_PREMIUM_PREFER[character_key])
            else:
                chosen = "viper"

        # Mexico → viper for rosa
        elif country == "MX" and character_key == "rosa":
            chosen = "viper"

        # Character preference — geo fallback
        elif character_key in CHARACTER_PREMIUM_PREFER:
            chosen = random.choice(CHARACTER_PREMIUM_PREFER[character_key])

        else:
            chosen = "eclipse"

    return _finalize_premium_layer(chosen, place, is_us)


def track_cost():
    pass  # replaced by _cost dict in generate_image()


def pick_premium_outfit_light(place: dict, character_key: str, premium_layer: str) -> str | None:
    """Auto-select soft outfit suggestion for premium layer run."""
    terrain = place.get("terrain_type", "")
    country = place.get("country_code", "")
    is_coastal = terrain == "coastal"
    is_mountain = terrain in ["mountain", "high_mountains"]
    is_cold = country in ["NO","SE","FI","IS","DK","AT","CH","GB","DE","PL","CZ","HU"]
    is_desert = terrain == "desert"

    if premium_layer == "continental":
        if is_mountain:
            return "wool coat, dark trousers, hiking boots, practical scarf — trailhead or pass"
        if is_coastal:
            return "worn leather jacket, dark denim, boots, ferry or harbour wind"
        return "structured wool coat or leather jacket, dark trousers, boots, travel-worn European layers"

    if premium_layer == "sidewinder":
        if is_desert:
            return "worn denim shorts, fitted tank, dusty boots, desert heat"
        if is_coastal:
            return "black bikini or swimwear under open flannel shirt, coastal California"
        if is_mountain:
            return "hiking shorts, fitted tee, trail boots, golden light"
        return "worn leather jacket, dark denim, boots, road-worn American styling"

    if premium_layer == "eclipse":
        if is_coastal:
            return "dark satin slip or tailored blazer, harbour evening"
        return "tailored dark wool coat or blazer, pencil skirt, back-seam stockings if interior setting"

    if premium_layer == "viper":
        if is_cold:
            return "black leather trench or fitted leather jacket, thigh-high boots, rain-appropriate"
        return "structured black blazer, fitted turtleneck, leather trousers, controlled"

    if premium_layer == "nightlife":
        return "dark silk blouse or satin dress, slightly open, nightlife-appropriate"

    if premium_layer == "prestige":
        if character_key == "lyra":
            return "deep burgundy or emerald silk slip dress, bare shoulders, gold jewelry — not white, not boho"
        if is_coastal:
            return "luxury swimwear or silk halter dress, gold jewelry, Mediterranean"
        return "ivory silk blouse, tailored trousers, quiet Mediterranean luxury"

    if premium_layer == "noir":
        return "structured black coat, minimal underneath, patent stilettos"

    return None



# ══════════════════════════════════════════════
# SECONDARY CHARACTERS
# ══════════════════════════════════════════════

SECONDARY_CHARACTERS = {
    "umarell": {
        "desc": "Elderly Italian man, hands clasped behind back, peering intently into a construction hole or at ongoing work. Hard hat not worn — he is not working. He is supervising. He has always supervised.",
        "placement": "background, slightly out of focus, side profile or three-quarter view",
        "terrain": ["any"], "place_type": ["city", "medium_town", "village"], "country_hint": ["IT"],
    },
    "kafeneion_greis": {
        "desc": "Greek man, 70s, seated at a small café table that has been his since before you were born. Coffee untouched. Nothing to prove. Watching the square.",
        "placement": "background, seated, soft focus",
        "terrain": ["any"], "place_type": ["village", "small_town", "medium_town"], "country_hint": ["GR"],
    },
    "el_jubilado": {
        "desc": "Spanish retiree, 65-75, on a bench on the plaza. Positioned with an unobstructed view of everything. Has been here since ten. Will be here at two. Nods at people he has known for forty years.",
        "placement": "background bench, ambient figure",
        "terrain": ["any"], "place_type": ["city", "medium_town", "small_town"], "country_hint": ["ES"],
    },
    "lokalmatador": {
        "desc": "Middle-aged local man — could be owner, could be regular, nobody is sure. Stands or sits slightly apart. Knows what is happening before it happens. Says little. Misses nothing.",
        "placement": "background, leaning on wall or bar, soft focus",
        "terrain": ["any"], "place_type": ["any"],
    },
    "letzter_seiner_art": {
        "desc": "Old man doing something by hand that machines replaced decades ago — mending nets, weaving, sharpening knives, carving. Slow, precise, unhurried. He knows he is the last.",
        "placement": "background or mid-ground, absorbed in work",
        "terrain": ["coastal", "mountain", "village"], "place_type": ["village", "small_town"],
    },
    "o_saudoso": {
        "desc": "Portuguese man, late 60s, facing the sea or a window. Not waiting for anything. Not remembering anything specific. Just standing with the weight of time.",
        "placement": "background, facing away, still",
        "terrain": ["coastal"], "place_type": ["village", "small_town", "medium_town"], "country_hint": ["PT"],
    },
    "pub_philosopher": {
        "desc": "British man, 55-65, last one at the bar or first one in. Pint in hand. Explains both sides of everything. Nobody asked. He is not wrong.",
        "placement": "background at bar, warm interior light",
        "terrain": ["any"], "place_type": ["city", "medium_town", "small_town"], "country_hint": ["GB"],
    },
    "babushka": {
        "desc": "Eastern European woman, 70s, selling sunflowers or produce from a small bundle at a roadside or market stall. She has seen governments come and go. She prices things correctly.",
        "placement": "background or edge of frame, standing still",
        "terrain": ["any"], "place_type": ["village", "small_town", "medium_town"],
    },
    "plattenbau_patriarch": {
        "desc": "Man, 60s, on a communist-era apartment balcony in undershirt, beer in hand. Full visual command of the street below. Has opinions. Shares them with anyone within earshot.",
        "placement": "upper background, balcony level",
        "terrain": ["flatland", "hills"], "place_type": ["city", "medium_town"],
    },
    "grenzbeamte_ad": {
        "desc": "Former border official, unmistakeable posture — café chair positioned facing the entrance. Watches everyone who enters and leaves. Old habit. Probably harmless. Probably.",
        "placement": "background table, facing door",
        "terrain": ["any"], "place_type": ["city", "medium_town"],
    },
    "birdwatcher": {
        "desc": "British man or woman, 60s, binoculars raised. Tweed jacket, field notebook. Technically watching birds. Binoculars not always pointed at trees.",
        "placement": "background, slightly elevated position preferred",
        "terrain": ["coastal", "mountain", "hills", "lake"], "place_type": ["any"],
    },
    "il_fotografo": {
        "desc": "Italian or Mediterranean man, 50s, film camera hanging around neck. Never raises it to photograph landscape. Present wherever interesting things are not not happening.",
        "placement": "background, standing, camera visible but unused",
        "terrain": ["any"], "place_type": ["city", "medium_town", "village"],
    },
    "ferry_regular": {
        "desc": "Scandinavian man, 50s-60s, on the same ferry he takes every day. Does not read. Looks at the water. Or at something near the water.",
        "placement": "background, railing, facing water",
        "terrain": ["coastal", "lake"], "place_type": ["any"], "country_hint": ["NO", "SE", "FI", "DK"],
    },
    "diner_regular": {
        "desc": "American man or woman, 60s, same stool at the counter since Reagan. Coffee cup never empty. Order never changes. Knows everyone. Watches the door.",
        "placement": "background counter seat, soft focus",
        "terrain": ["flatland", "hills"], "place_type": ["small_town", "medium_town"],
    },
    "porch_sitter": {
        "desc": "American South, 60s-70s, rocking chair or porch steps. Not idle — watching. Nods at some people. Does not nod at others. The distinction matters.",
        "placement": "background porch or stoop",
        "terrain": ["flatland", "hills"], "place_type": ["small_town", "village"],
    },
    "desert_hermit": {
        "desc": "Man, indeterminate age, 40 miles from anything. Appears near his truck or structure. Not threatening. Not welcoming. Just present in a place most people are not.",
        "placement": "mid-distance, standing alone",
        "terrain": ["desert"], "place_type": ["any"],
    },
    "ultra_runner": {
        "desc": "5am or 6pm. Headlamp or no headlamp. Running past at pace. Does not greet. He is in a state. You are an obstacle he has already factored in and dismissed.",
        "placement": "passing through frame, motion blur",
        "terrain": ["mountain", "high_mountains", "hills", "coastal"], "place_type": ["any"],
    },
    "ubermotivierter_rennradler": {
        "desc": "Man, 45-55, full aero kit, Strava GPS visible on bars, helmet with mirror. Passes at 38kmh on a slight incline and looks at his numbers, not at the view. This is suffering. He calls it a hobby.",
        "placement": "passing through frame in profile",
        "terrain": ["hills", "mountain", "coastal", "flatland"], "place_type": ["any"],
    },
    "gravel_hipster": {
        "desc": "Late 30s, titanium gravel bike with bikepacking bags, merino wool, handlebar bag with paper map sticking out. Looks like he's going somewhere important. He is going to a very good coffee shop 80km away.",
        "placement": "background or passing, leaning on bike",
        "terrain": ["hills", "mountain", "coastal"], "place_type": ["any"],
    },
    "reisebuero_mann": {
        "desc": "Man, 50s, in a small travel agency that still exists and is busy. Paper timetables, rubber stamp, carbon copy receipts. He knows every train connection in Europe. He has never heard of Booking.com. Business is good.",
        "placement": "visible through shop window or behind counter",
        "terrain": ["any"], "place_type": ["city", "medium_town", "small_town"],
    },
    "off_gridder": {
        "desc": "Man or woman, 40s, clearly van or off-grid dwelling. Pays cash, no phone visible, slight knowing look. In this timeline, not an outsider — just someone who made a different choice slightly earlier than most.",
        "placement": "background, transacting in cash or loading van",
        "terrain": ["any"], "place_type": ["any"],
    },
    "verschwoerungstheoretiker": {
        "desc": "Man, 50s, alone at a café table. Small coffee, no phone, no newspaper. Slight smile. In this timeline, several things he said in 2009 turned out to be true. He does not say I told you so. He does not need to.",
        "placement": "background café table, alone, facing outward",
        "terrain": ["any"], "place_type": ["city", "medium_town", "small_town"],
    },
    "zeitungsverkäufer": {
        "desc": "Kiosk or corner stand, newspapers and magazines still relevant in this timeline. Knows every headline. Says nothing about them. Watches who buys what.",
        "placement": "kiosk corner, background",
        "terrain": ["any"], "place_type": ["city", "medium_town", "small_town"],
    },
}

SECONDARY_BY_TERRAIN = {
    "coastal":       ["letzter_seiner_art", "o_saudoso", "birdwatcher", "ferry_regular", "il_fotografo", "lokalmatador"],
    "mountain":      ["letzter_seiner_art", "birdwatcher", "ultra_runner", "gravel_hipster", "ubermotivierter_rennradler"],
    "high_mountains":["ultra_runner", "ubermotivierter_rennradler", "gravel_hipster"],
    "desert":        ["desert_hermit", "off_gridder"],
    "lake":          ["birdwatcher", "ferry_regular", "letzter_seiner_art"],
    "hills":         ["ubermotivierter_rennradler", "gravel_hipster", "ultra_runner", "porch_sitter"],
    "flatland":      ["diner_regular", "porch_sitter", "ubermotivierter_rennradler", "zeitungsverkäufer"],
}

SECONDARY_BY_PLACETYPE = {
    "city":          ["lokalmatador", "il_fotografo", "reisebuero_mann", "zeitungsverkäufer", "verschwoerungstheoretiker", "pub_philosopher", "grenzbeamte_ad", "plattenbau_patriarch"],
    "medium_town":   ["lokalmatador", "el_jubilado", "kafeneion_greis", "reisebuero_mann", "zeitungsverkäufer", "verschwoerungstheoretiker"],
    "small_town":    ["lokalmatador", "diner_regular", "porch_sitter", "babushka", "reisebuero_mann"],
    "village":       ["letzter_seiner_art", "babushka", "lokalmatador", "porch_sitter", "o_saudoso"],
    "beach":         ["letzter_seiner_art", "birdwatcher", "il_fotografo"],
    "national_park": ["ultra_runner", "birdwatcher", "gravel_hipster"],
    "nature_reserve":["birdwatcher", "ultra_runner"],
}

def pick_secondary(terrain_type: str, place_type: str, country_code: str = "") -> str | None:
    """1 in 6 chance of including a secondary character. Returns prompt snippet or None."""
    if random.random() > (1/6):
        return None
    candidates = set()
    if terrain_type in SECONDARY_BY_TERRAIN:
        candidates.update(SECONDARY_BY_TERRAIN[terrain_type])
    pt = (place_type or "").lower()
    for key in SECONDARY_BY_PLACETYPE:
        if key in pt or pt in key:
            candidates.update(SECONDARY_BY_PLACETYPE[key])
    country_boosted = [k for k, v in SECONDARY_CHARACTERS.items()
                       if country_code in v.get("country_hint", [])]
    if country_boosted and random.random() < 0.4:
        key = random.choice(country_boosted)
    elif candidates:
        key = random.choice(list(candidates))
    else:
        key = random.choice(list(SECONDARY_CHARACTERS.keys()))
    char = SECONDARY_CHARACTERS[key]
    return f"""BACKGROUND FIGURE (do not focus, do not explain — ambient only):
{char['desc']}
Placement: {char['placement']}. Soft focus, never competing with main subject."""


def run_pipeline(limit=50, offset=0, dry_run=False, no_review=False, character_override=None, exploit=False, exploit_only=False, expression_override=None, time_override=None, wet_override=None, no_auto_premium=False,
                 goldie=False, goldie_only=False, multi_char=False, road_identity=False,
                 only_ids=None, exclude_ids=None, noir_mode=False, prestige_mode=False, nightlife_mode=False, viper_mode=False, maxpower_mode=False, outfit_override=None, eclipse_mode=False, sidewinder_mode=False, continental_mode=False, no_boost=False, outfit_light=None, activity=False, activity_key=None, exploit_key=None, premium_only=False, eu_override=False, us_override=False, activity_only=False, friend_char=None, cinematic_key=None,
                 exploit_all=False, cinematic_all=False, activity_all=False, specials_only=False, safe_mode=False, place_name_filter=None, dayhike_only=False, main_only=False, arrival_only=False):
    query = supabase.table("places").select(
        "id, name_en, country_code, terrain_type, place_type, attractiveness_score, is_island, ferry_minutes"
    ).eq("is_active", True).order("attractiveness_score", desc=True)
    if eu_override and not us_override:
        query = query.not_.in_("country_code", list(AMERICAS_CODES))
    elif us_override and not eu_override:
        query = query.in_("country_code", list(AMERICAS_CODES))
    if only_ids:
        query = query.in_("id", only_ids)
    elif offset:
        query = query.range(offset, offset + limit - 1)
    else:
        query = query.limit(limit)
    if exclude_ids:
        query = query.not_.in_("id", exclude_ids)
    if place_name_filter:
        query = query.ilike("name_en", f"%{place_name_filter}%")
    result = query.execute()
    places = [
        p for p in (result.data or [])
        if p.get("name_en") not in BATCH_EXCLUDE_PLACE_NAMES
    ]
    if BATCH_EXCLUDE_PLACE_NAMES and len(places) < len(result.data or []):
        print(f"  ⏭️  Batch exclude: {', '.join(sorted(BATCH_EXCLUDE_PLACE_NAMES))}")
    print(f"Pipeline: {len(places)} places | offset={offset} | dry_run={dry_run} | exploit={exploit} | activity={activity} | road_identity={road_identity}{' | 🐕 GOLDIE ONLY' if goldie_only else ''}{' | 🥾 DAYHIKE ONLY' if dayhike_only else ''}{' | 🚗 ARRIVAL ONLY' if arrival_only else ''}{' | ⛨ SAFE MODE' if safe_mode else ''}")

    ok, failed = 0, 0
    for i, place in enumerate(places):
        print(f"\n[{i+1}/{len(places)}]", end="")
        try:
            _base = get_base_layer(place["country_code"])
            # us and eu are mutually exclusive — explicit override wins, us takes priority if both set
            if us_override and eu_override:
                _us, _eu = True, False  # --us wins over --eu if both passed
            elif us_override:
                _us, _eu = True, False
            elif eu_override:
                _us, _eu = False, True
            else:
                _us = _base == "us"
                _eu = _base == "eu"
            _char = None if goldie_only else (character_override or select_character(
                place["country_code"], place.get("terrain_type",""), place.get("place_type",""),
                place.get("name_en",""), place=place,
            ))
            if character_override == "valentina" and not is_power_place(place):
                print(f"  ⏭️  Valentina skipped — not a power place ({place.get('name_en','')})")
                continue
            if character_override:
                global _nature_wildcard_char
                if (is_nature_place(place)
                        and character_override in NATURE_WILDCARD_CHARS
                        and character_override not in NATURE_WILDCARD_NO_DISCOMFORT):
                    _nature_wildcard_char = character_override
                else:
                    _nature_wildcard_char = None

            _place_goldie_only = goldie_only or is_goldie_only_place(place)
            if _place_goldie_only:
                process_place(place, dry_run=dry_run, goldie_only=True,
                              no_review=no_review, outfit_override=outfit_override,
                              us_mode=_us, eu_mode=_eu)
                ok += 1
                continue

            _score = place.get("attractiveness_score", 0)
            _manual_premium = any([noir_mode, prestige_mode, nightlife_mode, viper_mode, maxpower_mode, eclipse_mode, sidewinder_mode, continental_mode])

            if premium_only:
                # Skip base — run only premium layer with auto char/layer/outfit
                _premium = pick_premium_layer(place, _char, void_energy=7)
                if not _premium and not is_nature_place(place):
                    _premium = "eclipse" if not _us else "sidewinder"
                elif not _premium and is_nature_place(place):
                    _premium = "sidewinder" if _us else None
                _prem_outfit = pick_premium_outfit_light(place, _char, _premium) if _premium else None
                print(f"  ✨ Premium-only: {_premium} | char={_char} | outfit={_prem_outfit}")
                _pm = {k: _premium == v for k, v in [
                    ("noir_mode","noir"), ("prestige_mode","prestige"), ("nightlife_mode","nightlife"),
                    ("viper_mode","viper"), ("maxpower_mode","maxpower"), ("eclipse_mode","eclipse"), ("sidewinder_mode","sidewinder"),
                ]} if _premium else {}
                _pm = suppress_urban_premium_for_place(place, **_pm)
                process_place(place, dry_run=dry_run, exploit=exploit, exploit_only=exploit_only,
                              goldie=False, goldie_only=False, multi_char=False, road_identity=True,
                              no_review=no_review, character_override=_char,
                              no_boost=True, outfit_light=_prem_outfit,
                              us_mode=_us, eu_mode=_eu, activity=True, activity_key=None,
                              exploit_key=exploit_key, **_pm)
            else:
                # Standard run: premium baked into main; activity + arrival on unless --no-activities / focus flags
                _auto_premium_raw = None
                if not _manual_premium and not no_auto_premium and _score >= 85:
                    _auto_premium_raw = pick_premium_layer(place, _char, void_energy=6)  # 6 = reasonable default
                    _is_us_place = place["country_code"] in AMERICAS_CODES
                    _auto_premium = _finalize_premium_layer(_auto_premium_raw, place, _is_us_place)
                    _prem_outfit = pick_premium_outfit_light(place, _char, _auto_premium or _auto_premium_raw) if (_auto_premium or _auto_premium_raw) else outfit_light
                else:
                    _auto_premium = None
                    _prem_outfit = outfit_light

                _pm = {}
                if _auto_premium:
                    print(f"  ✨ Premium baked in: {_auto_premium} | char={_char}")
                elif _auto_premium_raw:
                    print(f"  ⏭️  Premium suppressed for outdoor place (was {_auto_premium_raw}) | char={_char}")
                if _auto_premium:
                    _pm = {k: _auto_premium == v for k, v in [
                        ("noir_mode","noir"), ("prestige_mode","prestige"), ("nightlife_mode","nightlife"),
                        ("viper_mode","viper"), ("maxpower_mode","maxpower"), ("eclipse_mode","eclipse"), ("sidewinder_mode","sidewinder"),
                    ]}

                # Merge manual layer flags on top
                if noir_mode:      _pm["noir_mode"] = True
                if prestige_mode:  _pm["prestige_mode"] = True
                if nightlife_mode: _pm["nightlife_mode"] = True
                if viper_mode:     _pm["viper_mode"] = True
                if maxpower_mode:  _pm["maxpower_mode"] = True
                if eclipse_mode:   _pm["eclipse_mode"] = True
                if sidewinder_mode: _pm["sidewinder_mode"] = True
                if continental_mode: _pm["continental_mode"] = True

                _pm = suppress_urban_premium_for_place(place, **_pm)

                if not exploit_all and not cinematic_all and not activity_all:
                    process_place(place, dry_run=dry_run, exploit=exploit, exploit_only=exploit_only,
                                  goldie=goldie, goldie_only=goldie_only, multi_char=multi_char,
                                  road_identity=arrival_only or (not activity_only and not exploit_only and not cinematic_key and not dayhike_only and not main_only),
                                  no_review=no_review, character_override=character_override or _char,
                                  outfit_override=outfit_override, no_boost=no_boost, outfit_light=_prem_outfit,
                                  us_mode=_us, eu_mode=_eu,
                                  activity=activity,
                                  activity_key=activity_key, exploit_key=exploit_key,
                                  activity_only=activity_only, dayhike_only=dayhike_only, main_only=main_only,
                                  arrival_only=arrival_only,
                                  expression_override=expression_override,
                                  time_override=time_override, wet_override=wet_override, friend_char=friend_char,
                                  cinematic_key=cinematic_key, safe_mode=safe_mode, **_pm)

                if exploit_all:
                    _keys = EXPLOIT_REPERTOIRE.get(_char, [])
                    print(f"  🔁 exploit-all: {len(_keys)} keys for {_char}")
                    for _k in _keys:
                        try:
                            process_place(place, dry_run=dry_run, exploit=True, exploit_only=True,
                                          no_review=no_review, character_override=_char,
                                          us_mode=_us, eu_mode=_eu, exploit_key=_k, **_pm)
                        except Exception as _e:
                            print(f"    ❌ {_k}: {_e}")

                if cinematic_all:
                    _ckeys = [k for k, chars in CINEMATIC_REPERTOIRE.items() if _char in chars]
                    print(f"  🔁 cinematic-all: {len(_ckeys)} keys for {_char}")
                    for _k in _ckeys:
                        try:
                            process_place(place, dry_run=dry_run, exploit=False, exploit_only=False,
                                          no_review=no_review, character_override=_char,
                                          us_mode=_us, eu_mode=_eu, cinematic_key=_k,
                                          activity=False, road_identity=False, **_pm)
                        except Exception as _e:
                            print(f"    ❌ {_k}: {_e}")

                if activity_all:
                    _terrain = place.get("terrain_type", "")
                    _pt = (place.get("place_type") or "").lower()
                    _akeys = pick_activity(_char, _terrain, _pt, n=99)
                    print(f"  🔁 activity-all: {len(_akeys)} keys for {_char}")
                    for _k in _akeys:
                        try:
                            process_place(place, dry_run=dry_run, exploit=False, exploit_only=False,
                                          no_review=no_review, character_override=_char,
                                          us_mode=_us, eu_mode=_eu, activity=True, activity_key=_k,
                                          activity_only=True, road_identity=False, **_pm)
                        except Exception as _e:
                            print(f"    ❌ {_k}: {_e}")

                if specials_only:
                    _specials = CHAR_SPECIALS.get(_char, [])
                    if not _specials:
                        print(f"  ⏭️  No char specials defined for {_char}")
                    else:
                        print(f"  ⭐ specials-only: {len(_specials)} for {_char}")
                        for _stype, _sk in _specials:
                            try:
                                if _stype == "exploit":
                                    process_place(place, dry_run=dry_run, exploit=True, exploit_only=True,
                                                  no_review=no_review, character_override=_char,
                                                  us_mode=_us, eu_mode=_eu, exploit_key=_sk, **_pm)
                                elif _stype == "cinematic":
                                    process_place(place, dry_run=dry_run, exploit=False, exploit_only=False,
                                                  no_review=no_review, character_override=_char,
                                                  us_mode=_us, eu_mode=_eu, cinematic_key=_sk,
                                                  activity=False, road_identity=False, **_pm)
                                elif _stype == "activity":
                                    process_place(place, dry_run=dry_run, exploit=False, exploit_only=False,
                                                  no_review=no_review, character_override=_char,
                                                  us_mode=_us, eu_mode=_eu, activity=True, activity_key=_sk,
                                                  activity_only=True, road_identity=False, **_pm)
                            except Exception as _e:
                                print(f"    ❌ {_stype}/{_sk}: {_e}")

            ok += 1
        except Exception as e:
            print(f"\n  ❌ {e}")
            failed += 1
    print(f"\n{'='*50}")
    print(f"✅ {ok} done  ❌ {failed} failed")
    print(_cost_summary())

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=50)
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument("--dry-run", action="store_true", default=True)
    parser.add_argument("--no-dry-run", dest="dry_run", action="store_false")
    parser.add_argument("--safe", action="store_true", help="Safe mode: no exploits, curated activity pool, anti-distortion prompt")
    parser.add_argument("--no-review", action="store_true")
    parser.add_argument("--exploit", action="store_true")
    parser.add_argument("--exploit-only", action="store_true")
    parser.add_argument("--goldie", action="store_true")
    parser.add_argument("--goldie-only", action="store_true")
    parser.add_argument("--multi-char", action="store_true")
    parser.add_argument("--road-identity", action="store_true")
    parser.add_argument("--character", type=str, default=None, help="Force specific character")
    parser.add_argument("--place", type=str, default=None, help="Filter places by name (case-insensitive substring match)")
    parser.add_argument("--noir", action="store_true", help="Apply 90s Euro erotic noir style layer to any character")
    parser.add_argument("--prestige", action="store_true", help="Apply late 90s European executive luxury style layer")
    parser.add_argument("--nightlife", action="store_true", help="Apply late 90s European nightlife luxury style layer")
    parser.add_argument("--viper", action="store_true", help="Apply late 90s European nightlife action-thriller style layer")
    parser.add_argument("--no-boost", action="store_true", help="Disable place-specific boost shots")
    parser.add_argument("--outfit", type=str, default=None, help="Outfit override for all shots")
    parser.add_argument("--outfit-light", type=str, default=None, help="Soft outfit suggestion — model may adapt based on location/context")
    parser.add_argument("--maxpower", action="store_true", help="Apply late 90s Eurotrash nightlife excess style layer")
    parser.add_argument("--eclipse", action="store_true", help="Apply late 90s European nightlife thriller glamour style layer")
    parser.add_argument("--premium-only", action="store_true", help="Skip base run, only premium layer pass with auto char/layer/outfit")
    parser.add_argument("--activity-only", action="store_true", help="Skip main shot, only run activity")
    parser.add_argument("--dayhike-only", action="store_true", help="Only nature day-hike outfit shot (no main/activity/arrival)")
    parser.add_argument("--main-only", action="store_true", help="Only main hero shot")
    parser.add_argument("--arrival-only", action="store_true", help="Only road identity / arrival shot")
    parser.add_argument("--time", type=str, default=None, help="Light override: golden, blue_hour, midday, overcast, night, dawn")
    parser.add_argument("--wet", type=str, default=None, help="Wet level: light, medium, heavy")
    parser.add_argument("--no-auto-premium", action="store_true", help="Disable automatic premium layer selection")
    parser.add_argument("--expression", type=str, default=None, help="Force expression e.g. 'lips slightly parted' or 'caught mid-laugh'")
    parser.add_argument("--no-activities", action="store_true", help="Skip activity shot (standard run includes one activity by default)")
    parser.add_argument("--activity", action="store_true", help="Legacy alias — activities are on by default; use --no-activities to skip")
    parser.add_argument("--activity-key", type=str, default=None, help="Force specific activity e.g. hiking_back, kajak_sup")
    parser.add_argument("--friend-char", type=str, default=None, help="Second character for female_friendship exploit e.g. charlotte, ana")
    parser.add_argument("--exploit-key", type=str, default=None, help="Force specific exploit shot type e.g. nylon_stiletto, walk_away")
    parser.add_argument("--eu", action="store_true", help="Force European atmosphere layer (overrides auto geo)")
    parser.add_argument("--us", action="store_true", help="Force North American atmosphere layer (overrides auto geo)")
    parser.add_argument("--sidewinder", action="store_true", help="Apply late 90s North American nightlife thriller glamour style layer")
    parser.add_argument("--continental", action="store_true", help="EU overland travel premium layer (pairs with --eu); terrain-adaptive, not nightclub default")
    parser.add_argument("--only-ids", type=str, default=None)
    parser.add_argument("--exclude-ids", type=str, default=None)
    parser.add_argument("--cinematic-key", type=str, default=None, help="Force specific cinematic shot e.g. gas_station_night, staircase_shot")
    parser.add_argument("--exploit-all", action="store_true", help="Run all exploit keys in char's repertoire")
    parser.add_argument("--cinematic-all", action="store_true", help="Run all cinematic keys available for char")
    parser.add_argument("--activity-all", action="store_true", help="Run all available activity keys for place/char")
    parser.add_argument("--specials-only", action="store_true", help="Run only char-exclusive signature shots (exploit + cinematic + activity)")
    args = parser.parse_args()
    only_ids = [x.strip() for x in args.only_ids.split(",")] if args.only_ids else None
    exclude_ids = [x.strip() for x in args.exclude_ids.split(",")] if args.exclude_ids else None
    run_pipeline(
        no_review=args.no_review,
        expression_override=args.expression,
        no_auto_premium=args.no_auto_premium,
        time_override=args.time,
        wet_override=args.wet,
        character_override=args.character,
        limit=args.limit, offset=args.offset, dry_run=args.dry_run,
        exploit=args.exploit or args.exploit_only, exploit_only=args.exploit_only,
        goldie=args.goldie or args.goldie_only, goldie_only=args.goldie_only,
        multi_char=args.multi_char, road_identity=args.road_identity,
        only_ids=only_ids, exclude_ids=exclude_ids,
        noir_mode=args.noir,
        prestige_mode=args.prestige,
        nightlife_mode=args.nightlife,
        viper_mode=args.viper,
        maxpower_mode=args.maxpower,
        outfit_override=args.outfit,
        eclipse_mode=args.eclipse,
        sidewinder_mode=args.sidewinder,
        continental_mode=args.continental,
        no_boost=args.no_boost,
        outfit_light=args.outfit_light,
        activity=not args.no_activities and not args.dayhike_only and not args.main_only and not args.arrival_only,
        activity_key=args.activity_key,
        exploit_key=args.exploit_key,
        premium_only=args.premium_only,
        eu_override=args.eu,
        us_override=args.us,
        activity_only=args.activity_only and not args.dayhike_only and not args.main_only and not args.arrival_only,
        dayhike_only=args.dayhike_only,
        main_only=args.main_only,
        arrival_only=args.arrival_only,
        friend_char=args.friend_char,
        cinematic_key=args.cinematic_key,
        exploit_all=args.exploit_all,
        cinematic_all=args.cinematic_all,
        activity_all=args.activity_all,
        specials_only=args.specials_only,
        safe_mode=args.safe,
        place_name_filter=args.place,
    )
