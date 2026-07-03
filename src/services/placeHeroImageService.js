import { supabase } from '../config/supabase';

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
