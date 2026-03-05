import { supabase } from '../config/supabase';

/**
 * Places Service
 * Handles operations for places/destinations (simplified - weather-focused)
 */

/**
 * Get places within a radius from a location
 * @param {number} latitude - Center latitude
 * @param {number} longitude - Center longitude
 * @param {number} radiusKm - Radius in kilometers
 * @param {object} filters - Optional filters (place_type, country_code, region)
 * @returns {Promise<{places, error}>}
 */
export const getPlacesNearby = async (latitude, longitude, radiusKm, filters = {}) => {
  try {
    let query = supabase
      .from('places')
      .select('*')
      .eq('is_active', true);

    // Apply filters
    if (filters.place_type) {
      query = query.eq('place_type', filters.place_type);
    }
    if (filters.country_code) {
      query = query.eq('country_code', filters.country_code);
    }
    if (filters.region) {
      query = query.eq('region', filters.region);
    }

    const { data, error } = await query;

    if (error) throw error;

    // Filter by distance (client-side for now)
    // In production, use PostGIS for better performance
    const filtered = data.filter(place => {
      const distance = calculateDistance(
        latitude,
        longitude,
        place.latitude,
        place.longitude
      );
      return distance <= radiusKm;
    });

    return { places: filtered, error: null };
  } catch (error) {
    console.error('Get places nearby error:', error);
    return { places: [], error };
  }
};

/**
 * Get a single place by ID (with latest weather)
 * @param {string} placeId - Place ID
 * @returns {Promise<{place, error}>}
 */
export const getPlace = async (placeId) => {
  try {
    const { data, error } = await supabase
      .from('places_with_latest_weather')
      .select('*')
      .eq('id', placeId)
      .single();

    if (error) throw error;
    return { place: data, error: null };
  } catch (error) {
    console.error('Get place error:', error);
    return { place: null, error };
  }
};

/**
 * Determine region from coordinates
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @returns {string|null} - 'europe', 'north_america', or null
 */
const determineRegion = (lat, lon) => {
  // Europa: 35-70°N, -10-40°E
  if (lat >= 35 && lat <= 70 && lon >= -10 && lon <= 40) {
    return 'europe';
  }
  // Nordamerika: 25-70°N, -170 - -50°W
  if (lat >= 25 && lat <= 70 && lon >= -170 && lon <= -50) {
    return 'north_america';
  }
  return null; // Outside supported regions
};

/**
 * Create or get existing place by coordinates
 * @param {object} placeData - Place data (name, lat, lon, etc)
 * @returns {Promise<{place, error, created}>}
 */
export const createOrGetPlace = async (placeData) => {
  try {
    // Check if place already exists at these coordinates (within ~100m)
    const { data: existing } = await supabase
      .from('places')
      .select('*')
      .gte('latitude', placeData.latitude - 0.001)
      .lte('latitude', placeData.latitude + 0.001)
      .gte('longitude', placeData.longitude - 0.001)
      .lte('longitude', placeData.longitude + 0.001)
      .limit(1)
      .single();

    if (existing) {
      return { place: existing, error: null, created: false };
    }

    // Auto-determine region if not provided
    if (!placeData.region) {
      placeData.region = determineRegion(placeData.latitude, placeData.longitude);
    }

    // Check if place is in supported regions
    if (!placeData.region) {
      return {
        place: null,
        error: new Error('Location outside supported regions (Europe/North America)'),
        created: false,
      };
    }

    // Create new place
    const { data, error } = await supabase
      .from('places')
      .insert(placeData)
      .select()
      .single();

    if (error) throw error;
    return { place: data, error: null, created: true };
  } catch (error) {
    console.error('Create place error:', error);
    return { place: null, error, created: false };
  }
};

/**
 * Update a place
 * @param {string} placeId - Place ID
 * @param {object} updates - Place updates
 * @returns {Promise<{place, error}>}
 */
export const updatePlace = async (placeId, updates) => {
  try {
    const { data, error } = await supabase
      .from('places')
      .update(updates)
      .eq('id', placeId)
      .select()
      .single();

    if (error) throw error;
    return { place: data, error: null };
  } catch (error) {
    console.error('Update place error:', error);
    return { place: null, error };
  }
};

/**
 * Search places by name
 * @param {string} searchTerm - Search term
 * @param {number} limit - Max results
 * @returns {Promise<{places, error}>}
 */
export const searchPlaces = async (searchTerm, limit = 10) => {
  try {
    const { data, error } = await supabase
      .from('places')
      .select('*')
      .ilike('name', `%${searchTerm}%`)
      .eq('is_active', true)
      .limit(limit);

    if (error) throw error;
    return { places: data, error: null };
  } catch (error) {
    console.error('Search places error:', error);
    return { places: [], error };
  }
};

/**
 * Get popular places (most favourited)
 * @param {number} limit - Max results
 * @returns {Promise<{places, error}>}
 */
export const getPopularPlaces = async (limit = 10) => {
  try {
    const { data, error } = await supabase
      .from('places_with_latest_weather')
      .select('*')
      .order('favourite_count', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return { places: data, error: null };
  } catch (error) {
    console.error('Get popular places error:', error);
    return { places: [], error };
  }
};

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

/**
 * Calculate distance between two coordinates (Haversine formula)
 * @param {number} lat1 - Latitude 1
 * @param {number} lon1 - Longitude 1
 * @param {number} lat2 - Latitude 2
 * @param {number} lon2 - Longitude 2
 * @returns {number} Distance in kilometers
 */
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371; // Earth's radius in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const toRad = (degrees) => {
  return degrees * (Math.PI / 180);
};

export default {
  getPlacesNearby,
  getPlace,
  createOrGetPlace,
  updatePlace,
  searchPlaces,
  getPopularPlaces,
  trackDetailView,
  trackMapViews,
  determineRegion,
};

