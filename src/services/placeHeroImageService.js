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

function heroResult(url, { hero_variant = null, hero_variant_index = null, hero_source = 'default' } = {}) {
  return { url, hero_variant, hero_variant_index, hero_source };
}

/**
 * Hero image URL: dedicated rows from `place_hero_images` (`place_id`), else generic rows from
 * `generic_hero_images` (`generic_key`, `storage_path`, `is_active`), else default.
 * @param {{ id?: string|null, generic_key?: string|null, name_en?: string|null }} place
 * @returns {Promise<{ url: string, hero_variant: string|null, hero_variant_index: number|null, hero_source: string }>}
 */
export async function getHeroImage(place) {
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
      const path = String(pick.storage_path || '').replace(/^\/+/, '');
      if (path) {
        const url = `${DEDICATED_BUCKET_URL}/${path}`;
        if (__DEV__) console.log('[getHeroImage] branch: dedicated, url:', url, 'name_en:', place?.name_en);
        return heroResult(url, {
          hero_variant: pick.variant ?? null,
          hero_variant_index: pick.sort_order ?? null,
          hero_source: 'dedicated',
        });
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
        });
      }
    }
  }

  if (__DEV__) console.log('[getHeroImage] branch: fallback, url:', DEFAULT_HERO_IMAGE_URL, 'name_en:', place?.name_en);
  return heroResult(DEFAULT_HERO_IMAGE_URL);
}
