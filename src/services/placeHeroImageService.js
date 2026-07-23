import { supabase } from '../config/supabase';
import { getHeroImageUri, prefetchHeroImageUris } from '../utils/heroImageDiskCache';

const GENERIC_BUCKET_URL =
  'https://skkkoxdobvimqpfqzbdx.supabase.co/storage/v1/object/public/generic';
const DEDICATED_BUCKET_URL =
  'https://skkkoxdobvimqpfqzbdx.supabase.co/storage/v1/object/public/dedicated';

export const DEFAULT_HERO_IMAGE_URL = `${GENERIC_BUCKET_URL}/default/eu_north_smalltown.webp`;

/** TEMP (showcase): Goldie artwork promo — delete block + pickDedicatedRow branch when done. */
const GOLDIE_ONLY_PLACE_NAMES = new Set(['Dogtown', 'Dublin', 'Dresden']);

function isGoldieOnlyPlace(place) {
  const name = place?.name_en || place?.name;
  return !!name && GOLDIE_ONLY_PLACE_NAMES.has(name);
}

function pickDedicatedRow(dedicated, place) {
  if (!isGoldieOnlyPlace(place)) {
    return dedicated[Math.floor(Math.random() * dedicated.length)];
  }
  const goldieRows = dedicated
    .filter(
      (r) =>
        r.variant === 'goldie' || String(r.storage_path || '').includes('/goldie/')
    )
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  return goldieRows[0] ?? dedicated[0];
}

function heroImageNameFromPath(path) {
  if (!path) return null;
  const base = String(path).split('/').pop() || path;
  const dot = base.lastIndexOf('.');
  return dot >= 0 ? base.slice(0, dot) : base;
}

function heroResult(url, { hero_variant = null, hero_variant_index = null, hero_source = 'default', hero_image_name = null } = {}) {
  return { url, hero_variant, hero_variant_index, hero_source, hero_image_name };
}

function dedicatedRowToHero(row) {
  const path = String(row.storage_path || '').replace(/^\/+/, '');
  if (!path) return null;
  return heroResult(`${DEDICATED_BUCKET_URL}/${path}`, {
    hero_variant: row.variant ?? null,
    hero_variant_index: row.sort_order ?? null,
    hero_source: 'dedicated',
    hero_image_name: heroImageNameFromPath(path),
  });
}

/** Dev: all active dedicated hero images for a place, sorted by sort_order. */
export async function listDedicatedHeroImages(place) {
  const id = place?.id ?? null;
  if (!id) return [];

  const { data, error } = await supabase
    .from('place_hero_images')
    .select('storage_path, variant, sort_order')
    .eq('place_id', id)
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  if (error) {
    if (__DEV__) console.warn('place_hero_images (list):', error.message);
    return [];
  }

  return (data ?? []).map(dedicatedRowToHero).filter(Boolean);
}

// Last resolved hero per place id (session-only). Not used to skip the lookup (variant
// rotation stays random per open) — only as an instant base layer to cross-fade from.
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
 * Hero image URL: dedicated rows from `place_hero_images` (`place_id`), else generic rows from
 * `generic_hero_images` (`generic_key`, `storage_path`, `is_active`), else default.
 * Always resolves fresh (variant rotation); remembers the result per place id for transitions.
 * @param {{ id?: string|null, generic_key?: string|null, name_en?: string|null }} place
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
      .select('storage_path, variant, sort_order')
      .eq('place_id', id)
      .eq('is_active', true);

    if (error && __DEV__) {
      console.warn('place_hero_images (dedicated):', error.message);
    } else if (dedicated?.length) {
      const pick = pickDedicatedRow(dedicated, place);
      const hero = dedicatedRowToHero(pick);
      if (hero) {
        if (__DEV__) console.log('[getHeroImage] branch: dedicated, url:', hero.url, 'name_en:', place?.name_en);
        return hero;
      }
    }
  }

  if (genericKey) {
    const { data: generic, error: genericError } = await supabase
      .from('generic_hero_images')
      .select('storage_path')
      .eq('generic_key', genericKey)
      .eq('is_active', true);

    if (genericError && __DEV__) {
      console.warn('generic_hero_images:', genericError.message);
    } else if (generic?.length) {
      const index = Math.floor(Math.random() * generic.length);
      const pick = generic[index];
      const path = String(pick.storage_path || '').replace(/^\/+/, '');
      if (path) {
        const url = `${GENERIC_BUCKET_URL}/${path}`;
        if (__DEV__) console.log('[getHeroImage] generic image full constructed URL:', url, 'name_en:', place?.name_en);
        return heroResult(url, {
          hero_variant_index: index,
          hero_source: 'generic',
          hero_image_name: heroImageNameFromPath(path),
        });
      }
    }
  }

  if (__DEV__) console.log('[getHeroImage] branch: fallback, url:', DEFAULT_HERO_IMAGE_URL, 'name_en:', place?.name_en);
  return heroResult(DEFAULT_HERO_IMAGE_URL, { hero_image_name: 'default_eu_north_smalltown' });
}
