import { supabase } from '../config/supabase';
import { getHeroImageUri, prefetchHeroImageUris } from '../utils/heroImageDiskCache';

const GENERIC_BUCKET_URL =
  'https://skkkoxdobvimqpfqzbdx.supabase.co/storage/v1/object/public/generic';
const DEDICATED_BUCKET_URL =
  'https://skkkoxdobvimqpfqzbdx.supabase.co/storage/v1/object/public/dedicated';

export const DEFAULT_HERO_IMAGE_URL = `${GENERIC_BUCKET_URL}/default/eu_north_smalltown.webp`;

/** TEMP (showcase): Goldie artwork promo — delete block + pickDedicatedRow branch when done. */
const GOLDIE_ONLY_PLACE_NAMES = new Set(['Dogtown', 'Dublin', 'Dresden']);

/** Käffer / backwater pool — only when no dedicated hero. */
const BACKWATER_PLACE_TYPES = new Set(['village', 'small_town', 'hamlet', 'isolated']);
/** Parks / remote landscape — separate wild pool (no attr cap). */
const BACKWATER_WILD_PLACE_TYPES = new Set([
  'national_park', 'natural_park', 'nature_reserve', 'mountain', 'scenic_drive', 'natural_feature',
]);
/** Skip scenic/high-attr Käffer — backwater is for the ordinary ones. */
const BACKWATER_MAX_ATTR = 80;
const BACKWATER_LATAM = new Set([
  'MX', 'GT', 'BZ', 'SV', 'HN', 'NI', 'CR', 'PA',
  'CO', 'VE', 'EC', 'PE', 'BO', 'PY', 'UY', 'AR', 'CL', 'BR', 'GY', 'SR',
  'CU', 'DO', 'HT', 'JM', 'TT',
]);
const BACKWATER_ANATOLIA = new Set(['TR']);
const BACKWATER_MAGHREB = new Set(['MA', 'TN', 'DZ', 'LY', 'EG']);
const BACKWATER_BY_IMAGE_REGION = {
  eu_north: 'backwater_eu_north',
  eu_south: 'backwater_eu_south',
  eu_east: 'backwater_eu_east',
  eu_balkan: 'backwater_eu_east',
  na: 'backwater_na',
  nafrica: 'backwater_maghreb',
};

/**
 * Optional terrain gate by filename stem (no .webp).
 * Untagged = any terrain. Only tag scenes that look wrong otherwise.
 * require = place terrain must be one of these; exclude = must not be.
 */
const BACKWATER_TERRAIN_RULES = {
  // --- require coastal ---
  backwater_eu_south_harbor: { require: ['coastal'] },
  backwater_eu_south_harbor_ferry: { require: ['coastal'] },
  backwater_eu_south_harbor_quay: { require: ['coastal'] },
  backwater_eu_north_dune_path: { require: ['coastal'] },
  backwater_eu_north_crab_dock: { require: ['coastal'] },
  backwater_eu_east_adriatic_quay: { require: ['coastal'] },
  backwater_na_lobster_pier: { require: ['coastal'] },
  // --- require lake ---
  backwater_eu_north_lake_volvo: { require: ['lake'] },
  backwater_eu_north_lake_ferry: { require: ['lake'] },
  backwater_na_lakeside_lodge: { require: ['lake'] },
  // --- require desert/flatland ---
  backwater_na_last_chance_gas: { require: ['desert', 'flatland'] },
  // --- inland lifestyle / street (no coastal/lake/desert) ---
  backwater_eu_north_canal_lock: { exclude: ['desert', 'high_mountains'] },
  backwater_eu_north_misty_lane: { exclude: ['desert', 'coastal'] },
  backwater_eu_north_farmstand: { exclude: ['desert', 'coastal', 'lake'] },
  backwater_eu_north_bakery: { exclude: ['desert', 'coastal', 'lake'] },
  backwater_eu_north_biergarten: { exclude: ['desert', 'coastal', 'lake'] },
  backwater_eu_north_biergarten_mugs: { exclude: ['desert', 'coastal', 'lake'] },
  backwater_eu_north_metzgerei: { exclude: ['desert', 'coastal', 'lake'] },
  backwater_eu_north_train_platform: { exclude: ['desert'] },
  backwater_eu_north_roadtrip_couple: { exclude: ['desert', 'coastal', 'lake'] },
  backwater_eu_north_bread_run: { exclude: ['desert', 'coastal', 'lake'] },
  backwater_eu_north_inn_yard: { exclude: ['desert', 'coastal', 'lake'] },
  backwater_eu_north_cottage_hof: { exclude: ['desert', 'coastal', 'lake'] },
  backwater_eu_south_olive_harvest: { exclude: ['desert', 'coastal', 'lake'] },
  backwater_eu_south_ape_alley: { exclude: ['desert', 'coastal', 'lake'] },
  backwater_eu_south_ferramenta: { exclude: ['desert', 'coastal', 'lake'] },
  backwater_eu_south_petanque: { exclude: ['desert'] },
  backwater_eu_south_edicola: { exclude: ['desert', 'coastal', 'lake'] },
  backwater_eu_south_garage: { exclude: ['desert', 'coastal', 'lake'] },
  backwater_eu_south_pueblo_cards: { exclude: ['desert', 'coastal', 'lake'] },
  backwater_eu_south_net_plaza: { exclude: ['desert', 'coastal', 'lake'] },
  backwater_eu_south_wine_crate: { exclude: ['desert', 'coastal', 'lake'] },
  backwater_eu_east_shepherd: { exclude: ['desert', 'coastal'] },
  backwater_eu_east_square_day: { exclude: ['desert', 'coastal', 'lake'] },
  backwater_eu_east_square_night: { exclude: ['desert', 'coastal', 'lake'] },
  backwater_eu_east_kneipe_night: { exclude: ['desert', 'coastal', 'lake'] },
  backwater_eu_east_kiosk: { exclude: ['desert', 'coastal', 'lake'] },
  backwater_eu_east_burek_stand: { exclude: ['desert', 'coastal', 'lake'] },
  backwater_eu_east_kafeneio: { exclude: ['desert', 'coastal', 'lake'] },
  backwater_eu_east_orthodox_church: { exclude: ['desert', 'coastal', 'lake'] },
  backwater_na_south_porch: { exclude: ['coastal', 'lake', 'desert'] },
  backwater_na_logging_stop: { exclude: ['desert', 'coastal'] },
  backwater_na_rodeo_arena: { exclude: ['coastal', 'lake'] },
  backwater_na_grain_street: { exclude: ['coastal', 'lake', 'desert'] },
  backwater_na_feed_store: { exclude: ['coastal', 'lake', 'desert'] },
  backwater_na_peach_stand: { exclude: ['coastal', 'lake', 'desert'] },
  backwater_na_amtrak_station: { exclude: ['coastal', 'lake'] },
  backwater_na_baseball_field: { exclude: ['coastal', 'lake', 'desert'] },
  backwater_na_general_store: { exclude: ['coastal', 'lake', 'desert'] },
  backwater_na_porch_net: { exclude: ['desert', 'high_mountains'] },
  backwater_na_bbq_patio: { exclude: ['coastal', 'lake', 'desert'] },
  // wild / parks
  backwater_wild_wind_ridge: { exclude: ['coastal', 'desert'] },
  backwater_wild_radar_dome: { exclude: ['coastal', 'desert'] },
  backwater_wild_rail_dogs: { exclude: ['coastal', 'desert', 'flatland'] },
};

/** Soft preference by stem — narrow the terrain-filtered pool, then stable-pick. */
const BACKWATER_PREF_COUNTRIES = {
  // Balkan (eu_east pool)
  backwater_eu_east_kafeneio: ['GR'],
  backwater_eu_east_adriatic_quay: ['HR', 'ME', 'AL', 'BA'],
  backwater_eu_east_burek_stand: ['BA', 'RS', 'MK'],
  backwater_eu_east_orthodox_church: ['RO', 'BG', 'RS', 'MK', 'BA'],
  // EU north lifestyle
  backwater_eu_north_biergarten: ['DE', 'AT', 'CH'],
  backwater_eu_north_biergarten_mugs: ['DE', 'AT', 'CH'],
  backwater_eu_north_metzgerei: ['DE', 'AT', 'CH'],
  backwater_eu_north_bakery: ['DE', 'AT', 'CH', 'NL', 'BE', 'FR'],
  backwater_eu_north_bread_run: ['DE', 'AT', 'CH', 'NL', 'BE', 'FR'],
  backwater_eu_north_inn_yard: ['DE', 'AT', 'CH', 'NL', 'BE'],
  backwater_eu_north_cottage_hof: ['DE', 'DK', 'SE', 'NO', 'NL', 'BE'],
  backwater_eu_north_roadtrip_couple: ['FR', 'BE', 'NL', 'DE', 'GB', 'IE'],
  backwater_eu_north_farmstand: ['DE', 'AT', 'CH', 'FR', 'NL', 'BE'],
  // EU south lifestyle
  backwater_eu_south_net_plaza: ['IT', 'ES', 'PT', 'FR', 'HR', 'GR'],
  backwater_eu_south_wine_crate: ['IT', 'ES', 'PT', 'FR'],
  backwater_eu_south_petanque: ['FR'],
  backwater_eu_south_olive_harvest: ['IT', 'ES', 'PT', 'GR'],
  backwater_eu_south_ape_alley: ['IT'],
  backwater_eu_south_ferramenta: ['IT'],
  backwater_eu_south_edicola: ['IT'],
  backwater_eu_south_pueblo_cards: ['ES', 'PT'],
  // wild / parks (soft — same global pool)
  backwater_wild_rail_dogs: ['DE', 'AT', 'CH', 'NO', 'SE', 'CA', 'US'],
  backwater_wild_wind_ridge: ['DE', 'DK', 'NL', 'GB', 'ES', 'US'],
  backwater_wild_radar_dome: ['NO', 'SE', 'IS', 'CA', 'US', 'GB'],
};
const US_SOUTH = [
  'Alabama', 'Arkansas', 'Florida', 'Georgia', 'Kentucky', 'Louisiana',
  'Mississippi', 'North Carolina', 'South Carolina', 'Tennessee', 'Texas',
  'Virginia', 'West Virginia', 'Oklahoma',
];
const US_MIDWEST = [
  'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Michigan', 'Minnesota',
  'Missouri', 'Nebraska', 'North Dakota', 'Ohio', 'South Dakota', 'Wisconsin',
];
const BACKWATER_PREF_STATES = {
  backwater_na_lobster_pier: [
    'Maine', 'New Hampshire', 'Massachusetts', 'Rhode Island', 'Connecticut',
  ],
  backwater_na_south_porch: US_SOUTH,
  backwater_na_peach_stand: US_SOUTH,
  backwater_na_bbq_patio: US_SOUTH,
  backwater_na_general_store: [...US_MIDWEST, ...US_SOUTH],
  backwater_na_porch_net: [
    ...US_SOUTH,
    'Maine', 'New Hampshire', 'Massachusetts', 'Rhode Island', 'Connecticut',
    'New York', 'Pennsylvania', 'Maryland', 'Delaware',
  ],
  backwater_na_logging_stop: [
    'Washington', 'Oregon', 'Idaho', 'Montana', 'Alaska', 'British Columbia',
  ],
};

function isGoldieOnlyPlace(place) {
  const name = place?.name_en || place?.name;
  return !!name && GOLDIE_ONLY_PLACE_NAMES.has(name);
}

function normalizeTerrain(terrain) {
  const t = String(terrain || '').toLowerCase();
  if (t === 'mountain') return 'mountains';
  return t;
}

function backwaterStem(storagePath) {
  const base = String(storagePath || '').split('/').pop() || '';
  const dot = base.lastIndexOf('.');
  return dot >= 0 ? base.slice(0, dot) : base;
}

function backwaterMatchesTerrain(storagePath, terrain) {
  const rule = BACKWATER_TERRAIN_RULES[backwaterStem(storagePath)];
  if (!rule) return true;
  const t = normalizeTerrain(terrain);
  if (!t) {
    // Unknown terrain: keep untagged + exclude-only rules; skip require-* scenes
    return !rule.require;
  }
  if (rule.require?.length && !rule.require.includes(t)) return false;
  if (rule.exclude?.length && rule.exclude.includes(t)) return false;
  return true;
}

function stablePoolIndex(seed, len) {
  if (len <= 1) return 0;
  let h = 2166136261;
  const s = String(seed || '0');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % len;
}

function backwaterHintScore(stem, place) {
  const cc = String(place?.country_code || place?.countryCode || '').toUpperCase();
  const state = String(place?.state_name || place?.stateName || '').trim().toLowerCase();
  let score = 0;
  const countries = BACKWATER_PREF_COUNTRIES[stem];
  if (countries?.includes(cc)) score += 2;
  const states = BACKWATER_PREF_STATES[stem];
  if (state && states?.some((s) => s.toLowerCase() === state)) score += 2;
  return score;
}

/** Prefer hint-matching stems, then stable hash — no random rotation. */
function pickBackwaterRow(pool, place) {
  let best = -1;
  const top = [];
  for (const row of pool) {
    const score = backwaterHintScore(backwaterStem(row.storage_path), place);
    if (score > best) {
      best = score;
      top.length = 0;
      top.push(row);
    } else if (score === best) {
      top.push(row);
    }
  }
  const seed = place?.id || place?.name_en || place?.name || '';
  const index = stablePoolIndex(seed, top.length);
  return { row: top[index], index };
}

/** @returns {string|null} generic_hero_images.generic_key for backwater pool */
function backwaterKeyForPlace(place) {
  const pt = String(place?.place_type || place?.placeType || '').toLowerCase();

  // Parks / remote landscape — not the village Käffer pool
  if (BACKWATER_WILD_PLACE_TYPES.has(pt)) return 'backwater_wild';

  if (!BACKWATER_PLACE_TYPES.has(pt)) return null;

  const attr = place?.attractiveness_score ?? place?.attractivenessScore ?? 0;
  if (Number(attr) >= BACKWATER_MAX_ATTR) return null;

  const cc = String(place?.country_code || place?.countryCode || '').toUpperCase();
  if (BACKWATER_ANATOLIA.has(cc)) return 'backwater_anatolia';
  if (BACKWATER_MAGHREB.has(cc)) return 'backwater_maghreb';
  if (BACKWATER_LATAM.has(cc)) return 'backwater_latam';

  const region = place?.image_region || place?.imageRegion || '';
  return BACKWATER_BY_IMAGE_REGION[region] || null;
}

async function heroFromGenericKey(genericKey, place, heroSource) {
  if (!genericKey) return null;

  const { data: generic, error } = await supabase
    .from('generic_hero_images')
    .select('storage_path')
    .eq('generic_key', genericKey)
    .eq('is_active', true);

  if (error) {
    if (__DEV__) console.warn('generic_hero_images:', error.message);
    return null;
  }
  if (!generic?.length) return null;

  let pool = generic;
  let index;
  let pick;

  if (heroSource === 'backwater') {
    const terrain = place?.terrain_type || place?.terrainType;
    const filtered = generic.filter((row) => backwaterMatchesTerrain(row.storage_path, terrain));
    pool = filtered.length ? filtered : generic.filter((row) => !BACKWATER_TERRAIN_RULES[backwaterStem(row.storage_path)]);
    if (!pool.length) return null;
    ({ row: pick, index } = pickBackwaterRow(pool, place));
  } else {
    index = stablePoolIndex(place?.id || place?.name_en || '', pool.length);
    pick = pool[index];
  }

  const path = String(pick?.storage_path || '').replace(/^\/+/, '');
  if (!path) return null;

  const url = `${GENERIC_BUCKET_URL}/${path}`;
  if (__DEV__) {
    console.log(`[getHeroImage] branch: ${heroSource}, url:`, url, 'name_en:', place?.name_en);
  }
  return heroResult(url, {
    hero_variant_index: index,
    hero_source: heroSource,
    hero_image_name: heroImageNameFromPath(path),
  });
}

function pickDedicatedRow(dedicated, place) {
  if (!dedicated?.length) return null;
  const sorted = [...dedicated].sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
  );
  if (!isGoldieOnlyPlace(place)) {
    return sorted[0];
  }
  const goldieRows = sorted.filter(
    (r) =>
      r.variant === 'goldie' || String(r.storage_path || '').includes('/goldie/')
  );
  return goldieRows[0] ?? sorted[0];
}

/** Pexels / stock landscape — not cast or curated artwork. */
function isStockDedicatedRow(row) {
  const path = String(row?.storage_path || '').toLowerCase();
  const variant = String(row?.variant || '').toLowerCase();
  if (variant === 'cast' || variant === 'goldie' || row?.character) return false;
  if (variant === 'pexels' || path.includes('/pexels/') || path.startsWith('pexels/')) return true;
  if (variant === 'unsplash' || variant === 'stock' || variant === 'landscape') return true;
  if (path.includes('unsplash') || path.includes('/landscape/')) return true;
  return false;
}

function isStockOnlyDedicated(rows) {
  return !!rows?.length && rows.every(isStockDedicatedRow);
}

async function maybeBackwaterHero(place) {
  return heroFromGenericKey(backwaterKeyForPlace(place), place, 'backwater');
}

/** Stock-only dedicated + backwater-eligible → mix rural into the rotate pool. */
async function withBackwaterIfStockOnly(dedicatedRows, place, dedicatedHeroes) {
  if (!isStockOnlyDedicated(dedicatedRows) || !backwaterKeyForPlace(place)) {
    return dedicatedHeroes;
  }
  const backwaterHero = await maybeBackwaterHero(place);
  if (!backwaterHero) return dedicatedHeroes;
  return [...dedicatedHeroes, backwaterHero];
}

function heroImageNameFromPath(path) {
  if (!path) return null;
  const base = String(path).split('/').pop() || path;
  const dot = base.lastIndexOf('.');
  return dot >= 0 ? base.slice(0, dot) : base;
}

function heroResult(url, {
  hero_variant = null,
  hero_variant_index = null,
  hero_source = 'default',
  hero_image_name = null,
  character = null,
} = {}) {
  return { url, hero_variant, hero_variant_index, hero_source, hero_image_name, character };
}

function dedicatedRowToHero(row) {
  const path = String(row.storage_path || '').replace(/^\/+/, '');
  if (!path) return null;
  return heroResult(`${DEDICATED_BUCKET_URL}/${path}`, {
    hero_variant: row.variant ?? null,
    hero_variant_index: row.sort_order ?? null,
    hero_source: 'dedicated',
    hero_image_name: heroImageNameFromPath(path),
    character: row.character ?? null,
  });
}

/** Active dedicated heroes for a place (+ backwater when stock-only Käffer). */
export async function listDedicatedHeroImages(place) {
  const id = place?.id ?? null;
  if (!id) return [];

  const { data, error } = await supabase
    .from('place_hero_images')
    .select('storage_path, variant, sort_order, character')
    .eq('place_id', id)
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  if (error) {
    if (__DEV__) console.warn('place_hero_images (list):', error.message);
    return [];
  }

  const heroes = (data ?? []).map(dedicatedRowToHero).filter(Boolean);
  return withBackwaterIfStockOnly(data, place, heroes);
}

// Last resolved hero per place id (session-only). Not used to skip the lookup —
// only as an instant base layer to cross-fade from. Open pick = lowest sort_order.
const heroCache = new Map();

/** Sync lookup of the last hero shown for this place, or null. */
export function getCachedHeroImage(place) {
  const id = place?.id ?? null;
  return (id && heroCache.get(id)) || null;
}

/** Remember the hero the user last saw (browse or initial pick) for instant base on revisit. */
export function rememberHeroImage(placeId, hero) {
  if (placeId && hero?.url) heroCache.set(String(placeId), hero);
}

/** Resolve meta.url to a local file:// URI when cached on disk. */
export async function resolveHeroMetaForDisplay(meta) {
  if (!meta?.url) return meta;
  const remoteUrl = meta.remoteUrl || (meta.url.startsWith('http') ? meta.url : null);
  const sourceUrl = remoteUrl || meta.url;
  const localUri = await getHeroImageUri(sourceUrl);
  if (localUri === sourceUrl) return meta;
  return { ...meta, url: localUri, remoteUrl: sourceUrl };
}

/** Warm on-disk cache for hero URLs (background). */
export function prefetchHeroUrls(heroes, { excludeUrl = null } = {}) {
  prefetchHeroImageUris(
    (heroes || []).map((h) => h?.url).filter(Boolean),
    { excludeUrl },
  );
}

/** Download one hero URL to disk; returns display URI (file:// or remote fallback). */
export async function prefetchHeroUrl(url) {
  if (!url?.startsWith('http')) return url;
  return getHeroImageUri(url);
}

function dedicatedRowToUrl(row) {
  const path = String(row?.storage_path || '').replace(/^\/+/, '');
  return path ? `${DEDICATED_BUCKET_URL}/${path}` : null;
}

/** List strip: pexels/landscape first — cast close-ups look odd at 88px height. */
function pickListHeroRow(rows) {
  const pathOf = (r) => String(r.storage_path || '').toLowerCase();
  const pexels = rows.find(
    (r) => r.variant === 'pexels' || pathOf(r).includes('/pexels/') || pathOf(r).startsWith('pexels/')
  );
  if (pexels) return pexels;

  const noPeople = rows.find(
    (r) => !r.character && r.variant !== 'cast' && r.variant !== 'goldie'
  );
  if (noPeople) return noPeople;

  return null;
}

// Favourites list thumbs — session cache (cleared when Favourites screen unmounts).
const listThumbCache = new Map();

export function invalidateListThumbCache(placeId) {
  if (placeId) listThumbCache.delete(String(placeId));
  else listThumbCache.clear();
}

function urlFromRows(rows) {
  if (!rows?.length) return null;
  return dedicatedRowToUrl(pickListHeroRow(rows));
}

/** Batch-resolve list thumb URLs; uses cache, one DB query for uncached ids. */
export async function resolveListThumbUrls(placeIds) {
  const ids = [...new Set((placeIds || []).filter(Boolean).map(String))];
  const result = new Map();
  const missing = [];

  for (const id of ids) {
    if (listThumbCache.has(id)) result.set(id, listThumbCache.get(id));
    else missing.push(id);
  }

  if (missing.length === 0) return result;

  const { data, error } = await supabase
    .from('place_hero_images')
    .select('place_id, storage_path, variant, character, sort_order')
    .in('place_id', missing)
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  if (error) {
    if (__DEV__) console.warn('place_hero_images (list thumbs):', error.message);
    for (const id of missing) {
      listThumbCache.set(id, null);
      result.set(id, null);
    }
    return result;
  }

  const byPlace = new Map();
  for (const row of data ?? []) {
    const pid = String(row.place_id);
    if (!byPlace.has(pid)) byPlace.set(pid, []);
    byPlace.get(pid).push(row);
  }

  for (const id of missing) {
    const url = urlFromRows(byPlace.get(id));
    listThumbCache.set(id, url);
    result.set(id, url);
  }

  return result;
}

/** Single-place helper (uses cache). */
export async function getDedicatedHeroUrl(placeId) {
  if (!placeId) return null;
  const map = await resolveListThumbUrls([placeId]);
  return map.get(String(placeId)) ?? null;
}

/**
 * Hero image URL: dedicated (cast/curated exclusive; stock-only mixes backwater) →
 * backwater (Käffer attr < 80, or parks/wild) → place generic_key → default.
 * Remembers the result per place id for transitions.
 * @param {{ id?: string|null, generic_key?: string|null, name_en?: string|null, place_type?: string|null, image_region?: string|null, country_code?: string|null, attractiveness_score?: number|null, terrain_type?: string|null, state_name?: string|null }} place
 * @returns {Promise<{ url: string, hero_variant: string|null, hero_variant_index: number|null, hero_source: string }>}
 */
export async function getHeroImage(place) {
  const hero = await resolveHeroImage(place);
  const id = place?.id ?? null;
  if (id) heroCache.set(id, hero);
  return hero;
}

async function resolveHeroImage(place) {
  const id = place?.id ?? null;
  const genericKey = place?.generic_key ?? null;

  if (id) {
    const { data: dedicated, error } = await supabase
      .from('place_hero_images')
      .select('storage_path, variant, sort_order, character')
      .eq('place_id', id)
      .eq('is_active', true);

    if (error && __DEV__) {
      console.warn('place_hero_images (dedicated):', error.message);
    } else if (dedicated?.length) {
      if (isStockOnlyDedicated(dedicated) && backwaterKeyForPlace(place)) {
        const dedicatedHeroes = dedicated.map(dedicatedRowToHero).filter(Boolean);
        const pool = await withBackwaterIfStockOnly(dedicated, place, dedicatedHeroes);
        if (pool.length) {
          const hero = pool[Math.floor(Math.random() * pool.length)];
          if (__DEV__) {
            console.log('[getHeroImage] branch: stock+backwater, source:', hero.hero_source, 'name_en:', place?.name_en);
          }
          return hero;
        }
      } else {
        const pick = pickDedicatedRow(dedicated, place);
        const hero = dedicatedRowToHero(pick);
        if (hero) {
          if (__DEV__) console.log('[getHeroImage] branch: dedicated, url:', hero.url, 'name_en:', place?.name_en);
          return hero;
        }
      }
    }
  }

  const backwaterHero = await maybeBackwaterHero(place);
  if (backwaterHero) return backwaterHero;

  const genericHero = await heroFromGenericKey(genericKey, place, 'generic');
  if (genericHero) return genericHero;

  if (__DEV__) console.log('[getHeroImage] branch: fallback, url:', DEFAULT_HERO_IMAGE_URL, 'name_en:', place?.name_en);
  return heroResult(DEFAULT_HERO_IMAGE_URL, { hero_image_name: 'default_eu_north_smalltown' });
}
