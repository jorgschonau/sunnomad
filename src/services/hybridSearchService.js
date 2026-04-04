import Constants from 'expo-constants';
import { supabase } from '../config/supabase';
import { getCountryName } from '../utils/countryNames';
import { getPlaceName } from '../utils/localization';

const GOOGLE_API_KEY = Constants.expoConfig?.extra?.googleMapsApiKey;

// Google Places API allows max 180° wide rectangle, so we split into
// Europe+Africa and Americas. searchGoogle tries the user's region first.
const BOUNDS_EUROPE = { north: 75, south: 15, west: -25, east: 50 };
const BOUNDS_AMERICAS = { north: 75, south: 15, west: -175, east: -25 };

const ALLOWED_COUNTRIES = new Set([
  'DE', 'FR', 'ES', 'PT', 'IT', 'GB', 'NL', 'BE', 'AT', 'CH',
  'SE', 'NO', 'DK', 'FI', 'PL', 'CZ', 'GR', 'IE', 'HR', 'SI',
  'HU', 'SK', 'RO', 'BG', 'TR', 'CY', 'MT', 'IS', 'LU', 'MC',
  'AL', 'ME', 'RS', 'BA', 'MK', 'XK', 'LV', 'LT', 'EE', 'UA',
  'MD', 'US', 'CA', 'MX', 'CR', 'PA', 'CU', 'JM', 'DO', 'PR',
]);

const GEO_TYPES = new Set([
  'locality', 'sublocality', 'sublocality_level_1',
  'administrative_area_level_1', 'administrative_area_level_2',
  'administrative_area_level_3', 'administrative_area_level_4',
  'postal_town', 'natural_feature', 'island', 'archipelago',
  'park', 'national_park', 'town_square', 'neighborhood',
  'city_hall', 'colloquial_area', 'continent', 'country',
]);

function isGeographicPlace(types) {
  return types.some(t => GEO_TYPES.has(t));
}

/**
 * Hybrid search: DB first, Google fallback if <3 DB results.
 * @param {string} query - Search text
 * @param {{ latitude: number, longitude: number }} center - Current map center for distance sorting
 * @param {string} language - Language code (e.g. 'de')
 * @returns {Promise<{ dbPlaces: Array, googlePlaces: Array }>}
 */
export const hybridSearch = async (query, center, language = 'de') => {
  if (!query || query.length < 2) return { dbPlaces: [], googlePlaces: [] };

  // Run DB and Google in parallel (Google only when API key is available)
  const bounds = (center && center.longitude < -25) ? BOUNDS_AMERICAS : BOUNDS_EUROPE;
  const [dbPlaces, rawGooglePlaces] = await Promise.all([
    searchDB(query, center, language),
    GOOGLE_API_KEY ? searchGoogle(query, language, bounds) : Promise.resolve([]),
  ]);

  // Deduplicate Google results against DB; promote DB matches the name search missed
  let googlePlaces = [];
  if (rawGooglePlaces.length > 0) {
    const dbIds = new Set(dbPlaces.map(p => p.id));
    const { unique, promoted } = await deduplicateAndPromote(rawGooglePlaces, dbIds, center, language);
    googlePlaces = unique;
    if (promoted.length > 0) {
      dbPlaces.push(...promoted);
      __DEV__ && console.log(`🔍 Promoted ${promoted.length} DB places from Google coord match:`, promoted.map(p => p.name_en));
    }
  }

  __DEV__ && console.log(`🔍 hybridSearch "${query}": ${dbPlaces.length} DB, ${rawGooglePlaces.length} Google raw, ${googlePlaces.length} Google after dedup`);
  return { dbPlaces, googlePlaces };
};

/**
 * Search the places table by name, sorted by distance to center.
 */
async function searchDB(query, center, language = 'en') {
  try {
    const { data, error } = await supabase
      .from('places')
      .select('id, name_en, name_de, name_fr, latitude, longitude, place_type, country_code, attractiveness_score')
      .ilike('name_en', `%${query}%`)
      .eq('is_active', true)
      .order('attractiveness_score', { ascending: false, nullsFirst: false })
      .limit(10);

    if (error) throw error;
    if (!data?.length) return [];

    return data.map(p => {
      const lat = parseFloat(p.latitude);
      const lng = parseFloat(p.longitude);
      const dist = center ? haversineKm(center.latitude, center.longitude, lat, lng) : 0;
      const countryName = getCountryName(p.country_code, language);
      const localName = getPlaceName(p, language);
      return {
        id: p.id,
        name: localName,
        description: countryName ? `${localName}, ${countryName}` : localName,
        latitude: lat,
        longitude: lng,
        place_type: p.place_type || null,
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
async function searchGoogle(query, language, bounds = BOUNDS_EUROPE) {
  try {
    __DEV__ && console.log(`🔍 Google search: query="${query}", key=${GOOGLE_API_KEY ? 'present' : 'MISSING'}`);
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_API_KEY,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.location,places.addressComponents,places.formattedAddress,places.types',
      },
      body: JSON.stringify({
        textQuery: query,
        languageCode: language,
        locationBias: {
          rectangle: {
            low: { latitude: bounds.south, longitude: bounds.west },
            high: { latitude: bounds.north, longitude: bounds.east },
          },
        },
        maxResultCount: 20,
      }),
    });
    const json = await res.json();
    __DEV__ && console.log(`🔍 Google response: status=${res.status}, places=${json.places?.length || 0}, error=${json.error?.message || 'none'}`);
    if (!res.ok || json.error) {
      console.warn('Google Places API error:', json.error?.message || res.status);
      return [];
    }
    if (!json.places?.length) return [];

    const allMapped = json.places.map(p => {
      const types = p.types || [];
      const countryComponent = p.addressComponents?.find(c => c.types?.includes('country'));
      const cc = countryComponent?.shortText || null;
      const geo = isGeographicPlace(types);
      const allowed = !cc || ALLOWED_COUNTRIES.has(cc);
      return {
        googlePlaceId: p.id,
        name: p.displayName?.text || '',
        description: p.formattedAddress || p.displayName?.text || '',
        latitude: p.location?.latitude,
        longitude: p.location?.longitude,
        country_code: cc,
        source: 'google',
        _types: types,
        _geo: geo,
        _allowed: allowed,
      };
    });
    const rejected = allMapped.filter(p => !p._geo || !p._allowed);
    if (rejected.length > 0) {
      __DEV__ && console.log(`🔍 Google filtered out ${rejected.length}:`, rejected.map(p => `${p.name} [geo=${p._geo}, cc=${p.country_code}, allowed=${p._allowed}, types=${p._types.slice(0, 3).join(',')}]`));
    }
    return allMapped
      .filter(p => p._geo && p._allowed && p.latitude && p.longitude)
      .map(({ _types, _geo, _allowed, ...rest }) => rest);
  } catch (e) {
    if (__DEV__) console.warn('Google search failed:', e);
    return [];
  }
}

/**
 * Deduplicate Google results against DB. Single batch query instead of N sequential ones.
 * If a Google result matches a DB place by coordinates but wasn't found by the name search, promote it.
 */
async function deduplicateAndPromote(googlePlaces, existingDbIds, center, language) {
  if (!googlePlaces.length) return { unique: [], promoted: [] };

  const MARGIN = 0.05;
  const lats = googlePlaces.map(p => p.latitude);
  const lons = googlePlaces.map(p => p.longitude);

  const { data: nearbyPlaces } = await supabase
    .from('places')
    .select('id, name_en, name_de, name_fr, latitude, longitude, place_type, country_code')
    .gte('latitude', Math.min(...lats) - MARGIN)
    .lte('latitude', Math.max(...lats) + MARGIN)
    .gte('longitude', Math.min(...lons) - MARGIN)
    .lte('longitude', Math.max(...lons) + MARGIN)
    .eq('is_active', true);

  const dbPlaces = nearbyPlaces || [];
  const unique = [];
  const promoted = [];

  for (const gp of googlePlaces) {
    const match = dbPlaces.find(db =>
      Math.abs(db.latitude - gp.latitude) < MARGIN &&
      Math.abs(db.longitude - gp.longitude) < MARGIN
    );
    if (match) {
      if (!existingDbIds.has(match.id)) {
        const lat = parseFloat(match.latitude);
        const lng = parseFloat(match.longitude);
        const dist = center ? haversineKm(center.latitude, center.longitude, lat, lng) : 0;
        const countryName = getCountryName(match.country_code, language);
        const localName = getPlaceName(match, language);
        promoted.push({
          id: match.id,
          name: localName,
          description: countryName ? `${localName}, ${countryName}` : localName,
          latitude: lat,
          longitude: lng,
          place_type: match.place_type || null,
          country_code: match.country_code,
          distLabel: dist > 0 ? `${Math.round(dist)} km` : '',
          _dist: dist,
          source: 'db',
        });
        existingDbIds.add(match.id);
      }
    } else {
      unique.push(gp);
    }
  }
  return { unique, promoted };
}

/**
 * Check if a place already exists in DB at given coordinates (±0.05° ≈ 5.5km).
 */
const findExistingPlace = async (lat, lon) => {
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
    if (__DEV__) console.log('✅ Place already in DB:', existing.name_en);
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
        name_en: googlePlace.name,
        latitude: googlePlace.latitude,
        longitude: googlePlace.longitude,
        country_code: googlePlace.country_code || null,
        region,
        place_type: 'city',
        is_active: true,
        source: 'user_search',
        attractiveness_score: 50,
      })
      .select()
      .single();

    if (error) throw error;
    if (__DEV__) console.log('🆕 Added place to DB:', data.name_en, data.id);
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
