import { supabase } from '../config/supabase';

const GENERIC_BUCKET_URL =
  'https://skkkoxdobvimqpfqzbdx.supabase.co/storage/v1/object/public/generic';
const DEDICATED_BUCKET_URL =
  'https://skkkoxdobvimqpfqzbdx.supabase.co/storage/v1/object/public/dedicated';

export const DEFAULT_HERO_IMAGE_URL = `${GENERIC_BUCKET_URL}/default/eu_north_smalltown.webp`;

/**
 * Hero image URL: dedicated rows from `place_hero_images` (`place_id`), else generic rows from
 * `generic_hero_images` (`generic_key`, `storage_path`, `is_active`), else default.
 * @param {{ id?: string|null, generic_key?: string|null, name_en?: string|null }} place
 */
export async function getHeroImage(place) {
  const id = place?.id ?? null;
  const genericKey = place?.generic_key ?? null;

  if (id) {
    const { data: dedicated, error } = await supabase
      .from('place_hero_images')
      .select('storage_path')
      .eq('place_id', id)
      .eq('is_active', true);

    if (error && __DEV__) {
      console.warn('place_hero_images (dedicated):', error.message);
    } else if (dedicated?.length) {
      const pick = dedicated[Math.floor(Math.random() * dedicated.length)];
      const path = String(pick.storage_path || '').replace(/^\/+/, '');
      if (path) {
        const url = `${DEDICATED_BUCKET_URL}/${path}`;
        console.log('[getHeroImage] branch: dedicated, url:', url, 'name_en:', place?.name_en);
        return url;
      }
    }
  }

  if (genericKey) {
    console.log('[getHeroImage] place.generic_key (before generic query):', place?.generic_key);
    const { data: generic, error: genericError } = await supabase
      .from('generic_hero_images')
      .select('storage_path')
      .eq('generic_key', genericKey)
      .eq('is_active', true);

    console.log('[getHeroImage] generic_hero_images response:', { data: generic, error: genericError });

    if (genericError && __DEV__) {
      console.warn('generic_hero_images:', genericError.message);
    } else if (generic?.length) {
      const pick = generic[Math.floor(Math.random() * generic.length)];
      const path = String(pick.storage_path || '').replace(/^\/+/, '');
      if (path) {
        const url = `${GENERIC_BUCKET_URL}/${path}`;
        console.log('[getHeroImage] generic image full constructed URL:', url, 'name_en:', place?.name_en);
        return url;
      }
    }
  }

  console.log('[getHeroImage] branch: fallback, url:', DEFAULT_HERO_IMAGE_URL, 'name_en:', place?.name_en);
  return DEFAULT_HERO_IMAGE_URL;
}
