import Constants from 'expo-constants';
import { supabase } from '../config/supabase';
import { getCountryName } from '../utils/countryNames';

const GOOGLE_API_KEY = Constants.expoConfig?.extra?.googleMapsApiKey;

// Same bounds as MapScreen MAP_BOUNDS
const SEARCH_BOUNDS = {
  north: 75,
  south: 15,
  west: -175,
  east: 50,
};

/**
 * Hybrid search: DB first, Google fallback if <3 DB results.
 * @param {string} query - Search text
 * @param {{ latitude: number, longitude: number }} center - Current map center for distance sorting
 * @param {string} language - Language code (e.g. 'de')
 * @returns {Promise<{ dbPlaces: Array, googlePlaces: Array }>}
 */
export const hybridSearch = async (query, center, language = 'de') => {
  if (!query || query.length < 2) return { dbPlaces: [], googlePlaces: [] };

  // 1. DB search (fast, free)
  const dbPlaces = await searchDB(query, center);

  // 2. Google fallback only if few DB results
  let googlePlaces = [];
  if (dbPlaces.length < 3 && GOOGLE_API_KEY) {
    googlePlaces = await searchGoogle(query, language);
    // Remove Google results that already exist in DB (by proximity)
    googlePlaces = await deduplicateAgainstDB(googlePlaces);
  }

  return { dbPlaces, googlePlaces };
};

/**
 * Search the places table by name, sorted by distance to center.
 */
async function searchDB(query, center) {
  try {
    const { data, error } = await supabase
      .from('places')
      .select('id, name, latitude, longitude, country_code, country_name, attractiveness_score')
      .ilike('name', `%${query}%`)
      .eq('is_active', true)
      .order('attractiveness_score', { ascending: false, nullsFirst: false })
      .limit(15);

    if (error) throw error;
    if (!data?.length) return [];

    return data.map(p => {
      const lat = parseFloat(p.latitude);
      const lng = parseFloat(p.longitude);
      const dist = center ? haversineKm(center.latitude, center.longitude, lat, lng) : 0;
      return {
        id: p.id,
        name: p.name,
        description: p.country_name ? `${p.name}, ${p.country_name}` : p.name,
        latitude: lat,
        longitude: lng,
        country_code: p.country_code,
        distLabel: dist > 0 ? `${Math.round(dist)} km` : '',
        _dist: dist,
        source: 'db',
      };
    }).sort((a, b) => a._dist - b._dist).slice(0, 8);
  } catch (e) {
    if (__DEV__) console.warn('DB search failed:', e);
    return [];
  }
}

/**
 * Search Google Places Text Search API (New), restricted to app bounds.
 */
async function searchGoogle(query, language) {
  try {
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_API_KEY,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.location,places.addressComponents,places.formattedAddress',
      },
      body: JSON.stringify({
        textQuery: query,
        languageCode: language,
        includedType: 'locality',
        locationBias: {
          rectangle: {
            low: { latitude: SEARCH_BOUNDS.south, longitude: SEARCH_BOUNDS.west },
            high: { latitude: SEARCH_BOUNDS.north, longitude: SEARCH_BOUNDS.east },
          },
        },
        maxResultCount: 5,
      }),
    });
    const json = await res.json();
    if (!json.places?.length) return [];

    return json.places.map(p => {
      const countryComponent = p.addressComponents?.find(c => c.types?.includes('country'));
      return {
        googlePlaceId: p.id,
        name: p.displayName?.text || '',
        description: p.formattedAddress || p.displayName?.text || '',
        latitude: p.location?.latitude,
        longitude: p.location?.longitude,
        country_code: countryComponent?.shortText || null,
        country_name: countryComponent?.longText || null,
        source: 'google',
      };
    }).filter(p => p.latitude && p.longitude);
  } catch (e) {
    if (__DEV__) console.warn('Google search failed:', e);
    return [];
  }
}

/**
 * Remove Google results that already exist in DB (within ~1km).
 */
async function deduplicateAgainstDB(googlePlaces) {
  if (!googlePlaces.length) return [];

  const deduplicated = [];
  for (const gp of googlePlaces) {
    const existing = await findExistingPlace(gp.latitude, gp.longitude);
    if (!existing) deduplicated.push(gp);
  }
  return deduplicated;
}

/**
 * Check if a place already exists in DB at given coordinates (±0.05° ≈ 5.5km).
 */
export const findExistingPlace = async (lat, lon) => {
  try {
    const { data } = await supabase
      .from('places')
      .select('*')
      .gte('latitude', lat - 0.05)
      .lte('latitude', lat + 0.05)
      .gte('longitude', lon - 0.05)
      .lte('longitude', lon + 0.05)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();
    return data;
  } catch (e) {
    if (__DEV__) console.warn('findExistingPlace failed:', e);
    return null;
  }
};

/**
 * Auto-add a Google Place to the DB. Returns existing place if duplicate found.
 * @param {Object} googlePlace - Place from Google search results
 * @returns {Promise<Object|null>} - The DB place row, or null on failure
 */
export const ensurePlaceInDB = async (googlePlace) => {
  if (!googlePlace?.latitude || !googlePlace?.longitude) return null;

  // Check for existing
  const existing = await findExistingPlace(googlePlace.latitude, googlePlace.longitude);
  if (existing) {
    if (__DEV__) console.log('✅ Place already in DB:', existing.name);
    return existing;
  }

  // Determine region
  const region = determineRegion(googlePlace.latitude, googlePlace.longitude);
  if (!region) {
    if (__DEV__) console.warn('Place outside supported regions:', googlePlace.name);
    return null;
  }

  // Insert new place
  try {
    const { data, error } = await supabase
      .from('places')
      .insert({
        name: googlePlace.name,
        latitude: googlePlace.latitude,
        longitude: googlePlace.longitude,
        country_code: googlePlace.country_code || null,
        country_name: googlePlace.country_name || getCountryName(googlePlace.country_code, 'en') || null,
        region,
        place_type: 'city',
        is_active: true,
      })
      .select()
      .single();

    if (error) throw error;
    if (__DEV__) console.log('🆕 Added place to DB:', data.name, data.id);
    return data;
  } catch (e) {
    if (__DEV__) console.warn('Failed to insert place:', e);
    return null;
  }
};

function determineRegion(lat, lon) {
  if (lat >= 35 && lat <= 70 && lon >= -10 && lon <= 40) return 'europe';
  if (lat >= 25 && lat <= 70 && lon >= -170 && lon <= -50) return 'north_america';
  return null;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
