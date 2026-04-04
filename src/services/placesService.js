import { supabase } from '../config/supabase';

/**
 * Increment detail_view_count for a single place (fire-and-forget)
 */
export const trackDetailView = async (placeId) => {
  try {
    if (!placeId || !/^[0-9a-f]{8}-/i.test(placeId)) return;
    await supabase.rpc('increment_detail_view_count', { p_place_id: placeId });
  } catch (error) {
    if (__DEV__) console.warn('trackDetailView failed:', error);
  }
};

/**
 * Batch-increment map_view_count for newly visible markers (fire-and-forget)
 */
export const trackMapViews = async (placeIds) => {
  try {
    const validIds = placeIds.filter(id => id && /^[0-9a-f]{8}-/i.test(id));
    if (validIds.length === 0) return;
    await supabase.rpc('increment_map_view_counts', { p_place_ids: validIds });
  } catch (error) {
    if (__DEV__) console.warn('trackMapViews failed:', error);
  }
};
