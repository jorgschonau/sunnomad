import { supabase } from '../config/supabase';

/**
 * Open-Meteo Weather API Service
 * Paid customer API with dedicated servers
 * 
 * Documentation: https://open-meteo.com/en/docs
 */

const OPEN_METEO_API_KEY = process.env.EXPO_PUBLIC_OPEN_METEO_KEY;
const OPEN_METEO_BASE_URL = 'https://customer-api.open-meteo.com/v1';
const BATCH_SIZE = 20; // Process 20 locations in parallel
const RATE_LIMIT_DELAY = 100; // 100ms between batches

/**
 * Fetch current + forecast weather for a single location
 * @param {object} place - Place object with latitude, longitude, id
 * @returns {Promise<{current, forecast, error}>}
 */
export const fetchWeatherForPlace = async (place) => {
  try {
    const params = new URLSearchParams({
      latitude: place.latitude,
      longitude: place.longitude,
      
      // Current weather
      current: [
        'temperature_2m',
        'relative_humidity_2m',
        'apparent_temperature',
        'precipitation',
        'rain',
        'snowfall',
        'weather_code',
        'cloud_cover',
        'pressure_msl',
        'surface_pressure',
        'wind_speed_10m',
        'wind_direction_10m',
        'wind_gusts_10m',
      ].join(','),
      
      // Daily forecast (16 days)
      daily: [
        'weather_code',
        'temperature_2m_max',
        'temperature_2m_min',
        'apparent_temperature_max',
        'apparent_temperature_min',
        'sunrise',
        'sunset',
        'precipitation_sum',
        'rain_sum',
        'snowfall_sum',
        'precipitation_probability_max',
        'wind_speed_10m_max',
        'wind_gusts_10m_max',
        'wind_direction_10m_dominant',
        'relative_humidity_2m_mean',
      ].join(','),
      
      forecast_days: 16,
      timezone: 'auto',
    });

    const url = `${OPEN_METEO_BASE_URL}/forecast?${params}&apikey=${OPEN_METEO_API_KEY}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Open-Meteo API error: ${response.status}`);
    }

    const data = await response.json();

    return {
      current: data.current,
      forecast: data.daily,
      timezone: data.timezone,
      error: null,
    };
  } catch (error) {
    console.error(`Fetch weather for place ${place.id} failed:`, error);
    return {
      current: null,
      forecast: null,
      error,
    };
  }
};

/**
 * Save current weather data to database
 * @param {string} placeId - Place ID
 * @param {object} currentWeather - Open-Meteo current weather data
 * @param {string} timezone - Timezone string
 */
const saveWeatherData = async (placeId, currentWeather, timezone) => {
  if (!currentWeather) return;

  const record = {
    place_id: placeId,
    weather_timestamp: new Date(currentWeather.time).toISOString(),
    
    // Temperature
    temperature: currentWeather.temperature_2m,
    feels_like: currentWeather.apparent_temperature,
    
    // Conditions (map weather_code to description)
    weather_main: getWeatherMain(currentWeather.weather_code),
    weather_description: getWeatherDescription(currentWeather.weather_code),
    weather_icon: getWeatherIcon(currentWeather.weather_code),
    
    // Humidity & Pressure
    humidity: currentWeather.relative_humidity_2m,
    pressure: currentWeather.pressure_msl,
    pressure_sea_level: currentWeather.pressure_msl,
    pressure_ground_level: currentWeather.surface_pressure,
    
    // Wind
    wind_speed: currentWeather.wind_speed_10m,
    wind_deg: currentWeather.wind_direction_10m,
    wind_gust: currentWeather.wind_gusts_10m,
    
    // Clouds & Visibility
    clouds: currentWeather.cloud_cover,
    
    // Precipitation
    rain_1h: currentWeather.rain,
    snow_1h: currentWeather.snowfall,
    
    data_source: 'open-meteo',
  };

  await supabase
    .from('weather_data')
    .upsert(record, { onConflict: 'place_id,weather_timestamp' });
};

/**
 * Save forecast data to database
 * @param {string} placeId - Place ID
 * @param {object} forecastData - Open-Meteo daily forecast data
 */
const saveForecastData = async (placeId, forecastData) => {
  if (!forecastData || !forecastData.time) return;

  const fetchedAt = new Date().toISOString();
  
  const records = forecastData.time.map((time, i) => ({
    place_id: placeId,
    forecast_date: time, // Already YYYY-MM-DD from Open-Meteo API
    fetched_at: fetchedAt,
    
    // Temperature
    temperature: (forecastData.temperature_2m_max[i] + forecastData.temperature_2m_min[i]) / 2,
    feels_like: (forecastData.apparent_temperature_max[i] + forecastData.apparent_temperature_min[i]) / 2,
    temp_min: forecastData.temperature_2m_min[i],
    temp_max: forecastData.temperature_2m_max[i],
    
    // Conditions
    weather_main: getWeatherMain(forecastData.weather_code[i]),
    weather_description: getWeatherDescription(forecastData.weather_code[i]),
    weather_icon: getWeatherIcon(forecastData.weather_code[i]),
    
    // Wind
    wind_speed: forecastData.wind_speed_10m_max[i],
    wind_deg: forecastData.wind_direction_10m_dominant[i],
    wind_gust: forecastData.wind_gusts_10m_max[i],
    
    // Precipitation
    rain_probability: forecastData.precipitation_probability_max[i] / 100, // Convert % to 0-1
    rain_volume: forecastData.rain_sum[i],
    snow_volume: forecastData.snowfall_sum[i],
    
    // Humidity
    humidity: forecastData.relative_humidity_2m_mean?.[i] ?? null,
    
    // Sunrise/Sunset (if available)
    sunrise: forecastData.sunrise?.[i] ? new Date(forecastData.sunrise[i]).toISOString() : null,
    sunset: forecastData.sunset?.[i] ? new Date(forecastData.sunset[i]).toISOString() : null,
    
    data_source: 'open-meteo',
  }));

  await supabase
    .from('weather_forecast')
    .upsert(records, { onConflict: 'place_id,forecast_date' });
};

/**
 * Update weather for a batch of places (parallel requests)
 * @param {Array} places - Array of place objects
 * @returns {Promise<{success, failed}>}
 */
export const updateBatchWeather = async (places) => {
  console.log(`📦 Updating weather for batch of ${places.length} places`);

  let success = 0;
  let failed = 0;

  // Fetch weather for all places in parallel
  const weatherPromises = places.map(place => fetchWeatherForPlace(place));
  const weatherResults = await Promise.all(weatherPromises);

  // Save to database
  for (let i = 0; i < places.length; i++) {
    const place = places[i];
    const weather = weatherResults[i];

    try {
      if (weather.error) {
        throw weather.error;
      }

      // Save current weather
      await saveWeatherData(place.id, weather.current, weather.timezone);

      // Save forecast
      await saveForecastData(place.id, weather.forecast);

      // Update last_weather_fetch
      await supabase
        .from('places')
        .update({ last_weather_fetch: new Date().toISOString() })
        .eq('id', place.id);

      success++;
    } catch (err) {
      console.error(`Failed to save weather for place ${place.id}:`, err);
      failed++;
    }
  }

  console.log(`✅ Batch complete: ${success} success, ${failed} failed`);
  return { success, failed };
};

/**
 * Update all places in batches
 * @param {string} region - Optional: 'europe' or 'north_america'
 * @returns {Promise<{totalSuccess, totalFailed, batches, duration}>}
 */
export const updateAllPlaces = async (region = null) => {
  try {
    const startTime = Date.now();

    let query = supabase
      .from('places')
      .select('id, latitude, longitude, name')
      .eq('is_active', true);

    if (region) {
      query = query.eq('region', region);
    }

    const { data: places, error } = await query;

    if (error) throw error;

    console.log(`🌍 Starting update for ${places.length} places`);

    let totalSuccess = 0;
    let totalFailed = 0;
    let batches = 0;

    // Process in batches
    for (let i = 0; i < places.length; i += BATCH_SIZE) {
      const batch = places.slice(i, i + BATCH_SIZE);
      batches++;

      console.log(`📦 Processing batch ${batches} (${i + 1}-${Math.min(i + BATCH_SIZE, places.length)} of ${places.length})`);

      const { success, failed } = await updateBatchWeather(batch);
      
      totalSuccess += success;
      totalFailed += failed;

      // Rate limiting: Wait between batches (be nice to the free API)
      if (i + BATCH_SIZE < places.length) {
        await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));
      }
    }

    const duration = Math.round((Date.now() - startTime) / 1000);

    console.log(`✅ Update complete: ${totalSuccess} success, ${totalFailed} failed across ${batches} batches in ${duration}s`);

    return {
      totalSuccess,
      totalFailed,
      batches,
      duration,
      error: null,
    };
  } catch (error) {
    console.error('Update all places error:', error);
    return {
      totalSuccess: 0,
      totalFailed: 0,
      batches: 0,
      duration: 0,
      error,
    };
  }
};

/**
 * Map Open-Meteo weather code to main category
 * https://open-meteo.com/en/docs
 */
const getWeatherMain = (code) => {
  if (code === 0) return 'Clear';
  if (code <= 3) return 'Clouds';
  if (code <= 49) return 'Fog';
  if (code <= 59) return 'Drizzle';
  if (code <= 69) return 'Rain';
  if (code <= 79) return 'Snow';
  if (code <= 84) return 'Rain';
  if (code <= 94) return 'Snow';
  if (code <= 99) return 'Thunderstorm';
  return 'Unknown';
};

/**
 * Map Open-Meteo weather code to description
 */
const getWeatherDescription = (code) => {
  const descriptions = {
    // Clear & Cloudy
    0: 'Clear sky',
    1: 'Mainly clear',
    2: 'Partly cloudy',
    3: 'Overcast',
    
    // Fog
    45: 'Foggy',
    48: 'Depositing rime fog',
    
    // Drizzle
    51: 'Light drizzle',
    53: 'Moderate drizzle',
    55: 'Dense drizzle',
    56: 'Light freezing drizzle',
    57: 'Dense freezing drizzle',
    
    // Rain
    61: 'Slight rain',
    63: 'Moderate rain',
    65: 'Heavy rain',
    66: 'Light freezing rain',
    67: 'Heavy freezing rain',
    
    // Snow
    71: 'Slight snow',
    73: 'Moderate snow',
    75: 'Heavy snow',
    77: 'Snow grains',
    
    // Showers
    80: 'Slight rain showers',
    81: 'Moderate rain showers',
    82: 'Violent rain showers',
    85: 'Slight snow showers',
    86: 'Heavy snow showers',
    
    // Thunderstorm
    95: 'Thunderstorm',
    96: 'Thunderstorm with slight hail',
    99: 'Thunderstorm with heavy hail',
  };
  
  // Return description or a generic fallback (should rarely happen now)
  return descriptions[code] || `Unknown weather (code ${code})`;
};

/**
 * Map Open-Meteo weather code to icon code (compatible with OpenWeatherMap style)
 */
const getWeatherIcon = (code) => {
  if (code === 0) return '01d'; // Clear
  if (code <= 2) return '02d'; // Partly cloudy
  if (code === 3) return '03d'; // Overcast
  if (code <= 49) return '50d'; // Fog
  if (code <= 59) return '09d'; // Drizzle
  if (code <= 69) return '10d'; // Rain
  if (code <= 79) return '13d'; // Snow
  if (code <= 84) return '09d'; // Showers
  if (code <= 94) return '13d'; // Snow showers
  if (code <= 99) return '11d'; // Thunderstorm
  return '01d';
};

export default {
  fetchWeatherForPlace,
  updateBatchWeather,
  updateAllPlaces,
};

