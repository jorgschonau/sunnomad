import { supabase } from '../config/supabase';
import { getCountryName, getCountryFlag } from '../utils/countryNames';
import { mapWeatherMain } from '../domain/weatherPresentation';
import { getPlaceName } from '../utils/localization';

/**
 * Places + Weather Service
 * Core service: Fetches places WITH weather from database
 */

/**
 * Convert legacy "Weather code XX" to proper description
 * (for old database entries that weren't updated yet)
 */
const fixWeatherCodeDescription = (description) => {
  if (!description) return '';
  
  const match = description.match(/Weather code (\d+)/i);
  if (match) {
    const code = parseInt(match[1]);
    const codeDescriptions = {
      0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
      45: 'Foggy', 48: 'Depositing rime fog',
      51: 'Light drizzle', 53: 'Moderate drizzle', 55: 'Dense drizzle',
      56: 'Light freezing drizzle', 57: 'Dense freezing drizzle',
      61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain',
      66: 'Light freezing rain', 67: 'Heavy freezing rain',
      71: 'Slight snow', 73: 'Moderate snow', 75: 'Heavy snow', 77: 'Snow grains',
      80: 'Slight rain showers', 81: 'Moderate rain showers', 82: 'Violent rain showers',
      85: 'Slight snow showers', 86: 'Heavy snow showers',
      95: 'Thunderstorm', 96: 'Thunderstorm with slight hail', 99: 'Thunderstorm with heavy hail',
    };
    return codeDescriptions[code] || description;
  }
  
  return description;
};

/**
 * Get all places with latest weather
 * @param {object} filters - Filtering options
 * @param {number} filters.userLat - User latitude
 * @param {number} filters.userLon - User longitude
 * @param {number} filters.radiusKm - Search radius in km
 * @param {string[]} filters.regions - Array of regions (e.g., ['europe', 'north_america'])
 * @returns {Promise<{places, error}>}
 */
export const getPlacesWithWeather = async (filters = {}) => {
  try {
    // Date filter: defaults to today, can be 'today', 'tomorrow', or YYYY-MM-DD
    const now = new Date();
    let targetDate;
    
    if (filters.date === 'tomorrow') {
      targetDate = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    } else if (filters.date === 'in2days') {
      targetDate = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    } else if (filters.date === 'in3days') {
      targetDate = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    } else if (filters.date && /^\d{4}-\d{2}-\d{2}$/.test(filters.date)) {
      targetDate = filters.date; // Custom date in YYYY-MM-DD format
    } else {
      targetDate = now.toISOString().split('T')[0]; // Default: today
    }
    
    __DEV__ && console.log(`🌤️ Fetching places + weather for ${targetDate}...`);
    
    // Build bounding box
    let latMin, latMax, lonMin, lonMax;
    if (filters.userLat && filters.userLon && filters.radiusKm) {
      const box = getBoundingBox(filters.userLat, filters.userLon, filters.radiusKm);
      latMin = box.latMin; latMax = box.latMax; lonMin = box.lonMin; lonMax = box.lonMax;
    }

    // Query 1: Get places
    let placesQuery = supabase
      .from('places')
      .select('id, name_en, name_de, name_fr, latitude, longitude, country_code, place_type, image_region, population, attractiveness_score, dem, state_name')
      .eq('is_active', true);
    
    if (latMin !== undefined) {
      placesQuery = placesQuery
        .gte('latitude', latMin).lte('latitude', latMax)
        .gte('longitude', lonMin).lte('longitude', lonMax);
    }
    
    const { data: places, error: placesError } = await placesQuery
      .limit(2000)
      .order('attractiveness_score', { ascending: false });
    
    if (placesError) {
      console.error('❌ Places query failed:', placesError);
      throw placesError;
    }
    
    // Geographic diversity query: fill white spots by sampling places ordered by id (pseudo-random spatial spread)
    let mergedPlaces = places || [];
    if (latMin !== undefined) {
      const { data: diversePlaces } = await supabase
        .from('places')
        .select('id, name_en, name_de, name_fr, latitude, longitude, country_code, place_type, image_region, population, attractiveness_score, dem, state_name')
        .eq('is_active', true)
        .gte('latitude', latMin).lte('latitude', latMax)
        .gte('longitude', lonMin).lte('longitude', lonMax)
        .limit(400)
        .order('id');

      const allIds = new Set(mergedPlaces.map(p => p.id));
      mergedPlaces = [
        ...mergedPlaces,
        ...(diversePlaces || []).filter(p => !allIds.has(p.id))
      ];
      __DEV__ && console.log(`🗺️ Diversity merge: ${places?.length || 0} score-based + ${diversePlaces?.length || 0} diverse → ${mergedPlaces.length} total`);
    }

    __DEV__ && console.log(`📍 Got ${mergedPlaces.length} places`);
    if (mergedPlaces[0]) __DEV__ && console.log('[DEBUG] first place keys:', Object.keys(mergedPlaces[0]).join(', '), '| place_type:', mergedPlaces[0].place_type, '| image_region:', mergedPlaces[0].image_region);
    
    if (mergedPlaces.length === 0) {
      return { places: [], error: null };
    }
    
    // Query 2: Get weather for places (16 days)
    const placeIds = mergedPlaces.map(p => p.id);
    const fallbackDate = new Date(new Date(targetDate).getTime() + 16 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    __DEV__ && console.log(`🌤️ Fetching weather for ${placeIds.length} places (${targetDate} to ${fallbackDate})...`);
    
    let allWeather = [];
    const CHUNK_SIZE = 500;  // CHANGED: 200 → 500
    
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    
    for (let i = 0; i < placeIds.length; i += CHUNK_SIZE) {
      const chunk = placeIds.slice(i, i + CHUNK_SIZE);
      const { data: chunkWeather, error: chunkError } = await supabase
        .from('weather_forecast')
        .select('place_id, forecast_date, temp_min, temp_max, weather_main, weather_description, weather_icon, wind_speed, sunshine_duration, fetched_at, humidity, precipitation_sum')
        .in('place_id', chunk)
        .gte('forecast_date', targetDate)
        .lte('forecast_date', fallbackDate)  // 16 days for forecast + badge recalc at any offset
        .gte('fetched_at', sevenDaysAgo)
        .order('forecast_date', { ascending: true });
      
      if (!chunkError && chunkWeather) {
        allWeather.push(...chunkWeather);
      }
    }
    
    __DEV__ && console.log(`🌤️ Got ${allWeather.length} weather records (${targetDate} - ${fallbackDate})`);
    
    // Build weather map with forecast for multiple days (up to 16 days)
    const weatherMap = {};
    // Also build raw arrays per place (for date-offset badge recalculation)
    const forecastArrays = {};
    allWeather.forEach(w => {
      if (!weatherMap[w.place_id]) {
        weatherMap[w.place_id] = { today: null, tomorrow: null, day2: null, day3: null, day4: null, day5: null };
      }
      if (!forecastArrays[w.place_id]) {
        forecastArrays[w.place_id] = [];
      }
      forecastArrays[w.place_id].push(w);
      
      const entry = weatherMap[w.place_id];
      // Fill keyed map in order (still 6 keys for backward compat)
      if (!entry.today) entry.today = w;
      else if (!entry.tomorrow) entry.tomorrow = w;
      else if (!entry.day2) entry.day2 = w;
      else if (!entry.day3) entry.day3 = w;
      else if (!entry.day4) entry.day4 = w;
      else if (!entry.day5) entry.day5 = w;
    });
    
    // Combine places with weather (including forecast)
    let placesData = mergedPlaces.map(p => {
      const wData = weatherMap[p.id] || {};
      const today = wData.today || {};
      const tomorrow = wData.tomorrow;
      const day2 = wData.day2;
      const day3 = wData.day3;
      const day4 = wData.day4;
      const day5 = wData.day5;
      
      // Build forecast structure for badges AND UI display (5 days)
      // Include precipitation, windSpeed, sunshine_duration so badge calcs work at ALL date offsets
      const buildForecastEntry = (dayRecord) => {
        if (!dayRecord) return null;
        return {
          condition: mapWeatherMain(dayRecord.weather_main, dayRecord.weather_description),
          temp: dayRecord.temp_max,
          tempMax: dayRecord.temp_max,
          high: Math.round(dayRecord.temp_max),
          low: Math.round(dayRecord.temp_min),
          description: dayRecord.weather_description,
          precipitation: dayRecord.precipitation_sum || 0,
          windSpeed: Math.round(dayRecord.wind_speed || 0),
          sunshine_duration: dayRecord.sunshine_duration || 0,
        };
      };
      const forecast = {
        today: buildForecastEntry(today),
        tomorrow: buildForecastEntry(tomorrow),
        day2: buildForecastEntry(day2),
        day3: buildForecastEntry(day3),
        day4: buildForecastEntry(day4),
        day5: buildForecastEntry(day5),
      };
      
      // Build forecastArray from raw records (dedupe by forecast_date, keep order)
      const rawRecords = forecastArrays[p.id] || [];
      const seenDates = new Set();
      const uniqueRecords = rawRecords.filter(w => {
        const d = w.forecast_date;
        if (seenDates.has(d)) return false;
        seenDates.add(d);
        return true;
      });
      const forecastArray = uniqueRecords.map(w => ({
        condition: mapWeatherMain(w.weather_main, w.weather_description),
        temp: w.temp_max != null && w.temp_min != null ? Math.round((w.temp_min + w.temp_max) / 2) : null,
        high: w.temp_max != null ? Math.round(w.temp_max) : null,
        low: w.temp_min != null ? Math.round(w.temp_min) : null,
        description: w.weather_description,
        precipitation: w.precipitation_sum || 0,
        windSpeed: Math.round(w.wind_speed || 0),
        sunshine_duration: w.sunshine_duration || 0,
        humidity: w.humidity ?? null,
      }));

      return {
        ...p,
        temp_min: today.temp_min,
        temp_max: today.temp_max,
        weather_main: today.weather_main,
        weather_description: today.weather_description,
        weather_icon: today.weather_icon,
        wind_speed: today.wind_speed,
        humidity: today.humidity,
        forecast_date: today.forecast_date,
        sunshine_duration: today.sunshine_duration,
        forecast, // Keyed multi-day forecast (6 days)
        forecastArray, // Raw array (up to 9 days) for badge recalculation
      };
    });
    
    const withWeather = placesData.filter(p => p.temp_min != null).length;
    __DEV__ && console.log(`🔗 ${withWeather}/${placesData.length} places have weather`);
    
    // Transform places - ONLY include those with valid temperature!
    let finalPlaces = placesData
      .filter(place => place.temp_min != null && place.temp_max != null) // Skip places without temp!
      .map(place => {
        const condition = mapWeatherMain(place.weather_main, place.weather_description);
        
        return {
          id: place.id,
          name_en: place.name_en,
          name_de: place.name_de,
          name_fr: place.name_fr,
          latitude: place.latitude,
          longitude: place.longitude,
          lat: place.latitude,
          lon: place.longitude,
          country_code: place.country_code, // WICHTIG für Ländername!
          place_type: place.place_type,
          image_region: place.image_region,
          population: place.population,
          elevation: place.dem ?? null,
          attractiveness_score: place.attractiveness_score,
          attractivenessScore: place.attractiveness_score,
          
          // Weather data - guaranteed to exist! Always show MAX temp
          temperature: Math.round(place.temp_max),
          temp_min: place.temp_min,
          temp_max: place.temp_max,
          condition: condition,
          weather_main: place.weather_main || 'Clouds',
          weather_description: place.weather_description || '',
          weather_icon: place.weather_icon || '03d',
          wind_speed: place.wind_speed,
          sunshine_duration: place.sunshine_duration,
          forecast: place.forecast, // Multi-day forecast for badges!
          forecastArray: place.forecastArray, // Raw array (16 days) for date-offset shift in MapScreen + Detail
          precipitation_sum: null,
          precipitation_probability: null,
          sunrise: null,
          sunset: null,
          rain_1h: null,
          snow_1h: null,
          weather_timestamp: null,
          
          feels_like: null,
          humidity: place.humidity || null,
          cloud_cover: null,
          rain_3h: null,
          snow_3h: null,
          snow_24h: null,
          wind_gust: null,
          stability_score: null,
          weather_trend: null
        };
      });
    
    const withWeatherCount = finalPlaces.length;
    __DEV__ && console.log(`✅ ${withWeatherCount} places with valid temperature data`);
    
    // Sort by temp (warmest first)
    finalPlaces.sort((a, b) => (b.temp_max || 0) - (a.temp_max || 0));
    
    __DEV__ && console.log(`📊 ${finalPlaces.length} places with weather`);
    
    if (filters.userLat && filters.userLon) {
      finalPlaces = finalPlaces
        .map(place => {
          const distance = getDistanceKm(
            filters.userLat,
            filters.userLon,
            place.latitude,
            place.longitude
          );
          
          // Calculate bearing (direction from center)
          const dLon = (place.longitude - filters.userLon) * Math.PI / 180;
          const lat1 = filters.userLat * Math.PI / 180;
          const lat2 = place.latitude * Math.PI / 180;
          const y = Math.sin(dLon) * Math.cos(lat2);
          const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
          const bearing = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
          
          // Determine sector (16 directions for finer granularity)
          // N, NNE, NE, ENE, E, ESE, SE, SSE, S, SSW, SW, WSW, W, WNW, NW, NNW
          const sector = Math.floor((bearing + 11.25) / 22.5) % 16;
          
          return {
            ...place,
            distance,
            bearing,
            sector,
          };
        })
        .filter(place => !filters.radiusKm || place.distance <= filters.radiusKm);
      
      __DEV__ && console.log(`🗺️ Backend: ${finalPlaces.length} places in radius`);
    }
    
    // Sort by temp (warmest first)
    finalPlaces.sort((a, b) => (b.temp_max || 0) - (a.temp_max || 0));

    // Adapt to app format (pass locale for country name translation)
    const locale = filters.locale || 'en';
    const adaptedPlaces = finalPlaces.map(place => adaptPlaceToDestination(place, locale));

    return { places: adaptedPlaces, error: null };
  } catch (error) {
    console.error('Get places with weather error:', error);
    return { places: [], error };
  }
};

/**
 * Get single place with weather + forecast
 * @param {string} placeId - Place ID
 * @param {string} locale - Locale for translations (e.g. 'de', 'en')
 * @returns {Promise<{place, forecast, error}>}
 */
export const getPlaceDetail = async (placeId, locale = 'en') => {
  try {
    // Get place (separate query - no FK needed)
    const { data: place, error: placeError } = await supabase
      .from('places')
      .select('id, name_en, name_de, name_fr, latitude, longitude, country_code, place_type, image_region, population, attractiveness_score, dem, state_name')
      .eq('id', placeId)
      .maybeSingle();

    if (placeError) throw placeError;
    if (!place) {
      return { place: null, forecast: [], error: 'Place not found' };
    }
    
    // Get weather + forecast (16 days)
    const today = new Date().toISOString().split('T')[0];
    const { data: allWeather, error: weatherError } = await supabase
      .from('weather_forecast')
      .select('forecast_date, temp_min, temp_max, weather_main, weather_description, weather_icon, wind_speed, precipitation_sum, rain_volume, snow_volume, humidity')
      .eq('place_id', placeId)
      .gte('forecast_date', today)
      .order('forecast_date', { ascending: true })
      .limit(16);

    if (weatherError) console.warn('Weather fetch failed:', weatherError);

    const weather = allWeather?.[0] || {};
    const flatPlace = {
      id: place.id,
      name_en: place.name_en,
      name_de: place.name_de,
      name_fr: place.name_fr,
      latitude: place.latitude,
      longitude: place.longitude,
      country_code: place.country_code,
      place_type: place.place_type,
      image_region: place.image_region,
      population: place.population,
      elevation: place.dem ?? null,
      state_name: place.state_name || null,
      attractiveness_score: place.attractiveness_score,
      temperature: weather.temp_max != null ? Math.round(weather.temp_max) : null,
      temp_min: weather.temp_min,
      temp_max: weather.temp_max,
      weather_main: weather.weather_main,
      weather_description: weather.weather_description,
      weather_icon: weather.weather_icon,
      wind_speed: weather.wind_speed,
      humidity: weather.humidity,
      rain_1h: weather.rain_volume,
      snow_1h: weather.snow_volume,
    };

    const forecast = allWeather || [];

    return {
      place: adaptPlaceToDestination(flatPlace, locale),
      forecast: (forecast || []).map(adaptForecastEntry),
      error: null,
    };
  } catch (error) {
    console.error('Get place detail error:', error);
    return { place: null, forecast: [], error };
  }
};

/**
 * Search places by name
 * @param {string} searchTerm - Search term
 * @param {number} limit - Max results (default 20)
 * @param {string} locale - Locale for translations (e.g. 'de', 'en')
 * @returns {Promise<{places, error}>}
 */
// ==================== UTILITY FUNCTIONS ====================

/**
 * Calculate bounding box for radius search
 */
function getBoundingBox(lat, lon, radiusKm) {
  const latDelta = Math.min(89.9, radiusKm / 111.32);
  const lonMultiplier = Math.max(Math.cos(lat * Math.PI / 180), 0.1);
  const lonDelta = Math.min(179.9, radiusKm / (111.32 * lonMultiplier));

  return {
    latMin: lat - latDelta,
    latMax: lat + latDelta,
    lonMin: lon - lonDelta,
    lonMax: lon + lonDelta,
  };
}

/**
 * Calculate distance between two points (Haversine formula)
 */
function getDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth radius in km
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRadians(degrees) {
  return degrees * (Math.PI / 180);
}

/**
 * Adapt place + weather to destination format used by app
 */
function adaptPlaceToDestination(place, locale = 'en') {
  const condition = mapWeatherMain(place.weather_main, place.weather_description);

  return {
    // Core place data
    id: place.id,
    lat: place.latitude,
    lon: place.longitude,
    name: getPlaceName(place, locale),
    country: getCountryName(place.country_code, locale),
    countryCode: place.country_code,
    country_code: place.country_code, // Also include as country_code for compatibility
    countryFlag: getCountryFlag(place.country_code),
    place_type: place.place_type || null,
    image_region: place.image_region || null,

    // Weather data (from database)
    condition,
    temperature: place.temperature != null ? Math.round(place.temperature) : null,
    feelsLike: place.feels_like ? Math.round(place.feels_like) : null,
    humidity: place.humidity,
    windSpeed: place.wind_speed ? Math.round(place.wind_speed) : null,
    windGust: place.wind_gust ? Math.round(place.wind_gust) : null,
    precipitation: place.rain_1h || 0, // Use rain_1h as precipitation
    snowfall1h: place.snow_1h || 0, // mm Schnee letzte 1h
    snowfall3h: place.snow_3h || 0, // mm Schnee letzte 3h
    snowfall24h: place.snow_24h || 0, // mm Schnee letzte 24h
    cloudCover: place.cloud_cover, // View aliases clouds as cloud_cover
    
    // Calculated stability (simple version)
    stability: calculateStability(place),
    
    // Metadata
    weatherMain: place.weather_main,
    weatherIcon: place.weather_icon,
    weatherDescription: fixWeatherCodeDescription(place.weather_description),
    weatherTimestamp: place.weather_timestamp,
    
    // Weather trend (from DB: improving, stable, worsening)
    weatherTrend: place.weather_trend,
    
    // Attractiveness score
    attractivenessScore: place.attractiveness_score ?? 50,
    population: place.population || 0,
    elevation: place.dem ?? null,
    state_name: place.state_name || null,
    
    // Distance (filled in by getPlacesWithWeather if applicable)
    distance: place.distance || null,
    
    // Multi-day forecast for badge calculation!
    forecast: place.forecast || null,
    // Raw forecast array (16 days) for date-offset shift in MapScreen + Detail
    forecastArray: place.forecastArray || null,
    
    // Future: badges will be calculated based on weather + place attributes
    badges: [],
  };
}

// mapWeatherMain imported from domain/weatherPresentation.js (single source of truth)

/**
 * Calculate simple stability score (0-100)
 * Higher = better weather
 */
function calculateStability(place) {
  // Use stability_score if already calculated in DB, otherwise calculate
  if (place.stability_score) {
    return place.stability_score;
  }

  // Calculate from cloud_cover and wind_speed
  const cloudCover = place.cloud_cover || place.clouds || 50; // Fallback to 50 if missing
  const windSpeed = place.wind_speed || 5; // Fallback to 5 m/s if missing

  // Less clouds = better
  // Less wind = better
  const cloudScore = 100 - cloudCover;
  const windScore = Math.max(0, 100 - windSpeed * 2);
  
  return Math.round((cloudScore + windScore) / 2);
}

/**
 * Adapt forecast entry to app format
 */
function adaptForecastEntry(entry) {
  return {
    timestamp: entry.forecast_date, // Using forecast_date now
    date: new Date(entry.forecast_date + 'T12:00:00Z').toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }),
    condition: mapWeatherMain(entry.weather_main, entry.weather_description),
    tempMin: entry.temp_min != null ? Math.round(entry.temp_min) : null,
    tempMax: entry.temp_max != null ? Math.round(entry.temp_max) : null,
    precipitation: entry.precipitation_sum || entry.rain_volume || 0,
    precipitationProbability: entry.precipitation_probability || entry.rain_probability,
    windSpeed: entry.wind_speed ? Math.round(entry.wind_speed) : null,
    weatherMain: entry.weather_main,
    weatherIcon: entry.weather_icon,
    weatherDescription: fixWeatherCodeDescription(entry.weather_description),
  };
}

export default {
  getPlacesWithWeather,
  getPlaceDetail,
};

