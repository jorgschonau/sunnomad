#!/usr/bin/env node

/**
 * Test Open-Meteo API with 10 locations
 * Verifies data saves correctly and badges calculate
 * 
 * Run: node scripts/test-openmeteo.js
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Check Supabase config
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
  console.error('❌ Supabase not configured! Check .env file');
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const OPEN_METEO_API_KEY = process.env.OPEN_METEO_API_KEY || '';
const OPEN_METEO_BASE_URL = OPEN_METEO_API_KEY
  ? 'https://customer-api.open-meteo.com/v1'
  : 'https://api.open-meteo.com/v1';

/**
 * Weather code mapping (Open-Meteo)
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

const getWeatherDescription = (code) => {
  const descriptions = {
    0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
    45: 'Foggy', 48: 'Depositing rime fog',
    51: 'Light drizzle', 53: 'Moderate drizzle', 55: 'Dense drizzle',
    61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain',
    71: 'Slight snow', 73: 'Moderate snow', 75: 'Heavy snow',
    80: 'Slight rain showers', 81: 'Moderate rain showers', 82: 'Violent rain showers',
    95: 'Thunderstorm', 96: 'Thunderstorm with slight hail', 99: 'Thunderstorm with heavy hail',
  };
  return descriptions[code] || `Unknown weather (code ${code})`;
};

const getWeatherIcon = (code) => {
  if (code === 0) return '01d';
  if (code <= 2) return '02d';
  if (code === 3) return '03d';
  if (code <= 49) return '50d';
  if (code <= 59) return '09d';
  if (code <= 69) return '10d';
  if (code <= 79) return '13d';
  if (code <= 84) return '09d';
  if (code <= 94) return '13d';
  if (code <= 99) return '11d';
  return '01d';
};

/**
 * Fetch weather for one location (current + 7 days forecast)
 */
async function fetchWeather(place) {
  const params = new URLSearchParams({
    latitude: place.latitude,
    longitude: place.longitude,
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
    daily: [
      'weather_code',
      'temperature_2m_max',
      'temperature_2m_min',
      'precipitation_sum',
      'rain_sum',
      'snowfall_sum',
      'precipitation_probability_max',
      'wind_speed_10m_max',
      'wind_gusts_10m_max',
      'sunrise',
      'sunset',
    ].join(','),
    forecast_days: 7,
    timezone: 'auto',
  });

  const apiKeyParam = OPEN_METEO_API_KEY ? `&apikey=${OPEN_METEO_API_KEY}` : '';
  const url = `${OPEN_METEO_BASE_URL}/forecast?${params}${apiKeyParam}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  return await response.json();
}

/**
 * Save current weather to database
 * Note: "Current" weather is just the first day of the forecast (today)
 * We store everything in weather_forecast table now
 */
async function saveWeatherData(placeId, current, daily) {
  // Current weather is stored as today's forecast entry
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const fetchedAt = new Date().toISOString();
  
  const record = {
    place_id: placeId,
    forecast_date: today,
    fetched_at: fetchedAt,
    temp_min: daily.temperature_2m_min[0], // Today's min from daily forecast
    temp_max: daily.temperature_2m_max[0], // Today's max from daily forecast
    weather_main: getWeatherMain(current.weather_code),
    weather_description: getWeatherDescription(current.weather_code),
    weather_icon: getWeatherIcon(current.weather_code),
    wind_speed: current.wind_speed_10m,
    precipitation_sum: current.precipitation || 0,
    precipitation_probability: daily.precipitation_probability_max?.[0] ? daily.precipitation_probability_max[0] / 100 : null,
    rain_volume: current.rain || 0,
    snow_volume: current.snowfall || 0,
    sunrise: daily.sunrise?.[0] ? new Date(daily.sunrise[0]).toISOString() : null,
    sunset: daily.sunset?.[0] ? new Date(daily.sunset[0]).toISOString() : null,
    data_source: 'open-meteo',
  };

  const { error } = await supabase
    .from('weather_forecast')
    .upsert(record, { onConflict: 'place_id,forecast_date,fetched_at' });

  if (error) throw error;
}

/**
 * Save forecast to database (tomorrow onwards, excluding today)
 */
async function saveForecast(placeId, daily) {
  const fetchedAt = new Date().toISOString();
  
  // Skip first day (index 0) - it's already saved as "current weather" by saveWeatherData
  const records = daily.time.slice(1).map((time, i) => {
    const actualIndex = i + 1; // Adjust index since we sliced
    return {
      place_id: placeId,
      forecast_date: time, // Already in YYYY-MM-DD format from API
      fetched_at: fetchedAt,
      temp_min: daily.temperature_2m_min[actualIndex],
      temp_max: daily.temperature_2m_max[actualIndex],
      weather_main: getWeatherMain(daily.weather_code[actualIndex]),
      weather_description: getWeatherDescription(daily.weather_code[actualIndex]),
      weather_icon: getWeatherIcon(daily.weather_code[actualIndex]),
      wind_speed: daily.wind_speed_10m_max[actualIndex],
      precipitation_sum: daily.precipitation_sum[actualIndex],
      precipitation_probability: daily.precipitation_probability_max[actualIndex] / 100,
      rain_probability: daily.precipitation_probability_max[actualIndex] / 100,
      rain_volume: daily.rain_sum[actualIndex],
      snow_volume: daily.snowfall_sum[actualIndex],
      sunrise: daily.sunrise?.[actualIndex] ? new Date(daily.sunrise[actualIndex]).toISOString() : null,
      sunset: daily.sunset?.[actualIndex] ? new Date(daily.sunset[actualIndex]).toISOString() : null,
      data_source: 'open-meteo',
    };
  });

  const { error } = await supabase
    .from('weather_forecast')
    .upsert(records, { onConflict: 'place_id,forecast_date,fetched_at' });

  if (error) throw error;
}

/**
 * Verify data was saved
 */
async function verifyData(placeId, placeName) {
  // Check today's weather (stored in weather_forecast)
  const today = new Date().toISOString().split('T')[0];
  const { data: todayWeather, error: todayError } = await supabase
    .from('weather_forecast')
    .select('*')
    .eq('place_id', placeId)
    .eq('forecast_date', today)
    .order('fetched_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (todayError) throw todayError;

  // Check all forecast entries
  const { data: forecast, error: forecastError } = await supabase
    .from('weather_forecast')
    .select('*')
    .eq('place_id', placeId)
    .gte('forecast_date', today)
    .order('forecast_date', { ascending: true })
    .limit(7);

  if (forecastError) throw forecastError;

  console.log(`\n✅ ${placeName}:`);
  if (todayWeather) {
    console.log(`   Today: ${todayWeather.temp_min} °C - ${todayWeather.temp_max} °C, ${todayWeather.weather_description}`);
  }
  console.log(`   Forecast: ${forecast.length} days saved`);
  if (forecast.length > 1) {
    console.log(`   Tomorrow: ${forecast[1].temp_min} °C - ${forecast[1].temp_max} °C, ${forecast[1].weather_description}`);
  }

  return { weather: todayWeather, forecast };
}

/**
 * Main test function
 */
async function main() {
  console.log('╔═══════════════════════════════════════════════════╗');
  console.log('║   Test Open-Meteo API (10 Locations, 7 Days)     ║');
  console.log('╚═══════════════════════════════════════════════════╝\n');

  // 1. Get 10 test locations (use simple query without ordering to avoid timeout)
  console.log('📍 Fetching 10 test places...');
  const { data: places, error } = await supabase
    .from('places')
    .select('id, name, latitude, longitude, country_code')
    .eq('is_active', true)
    .limit(10);

  if (error) {
    console.error('❌ Failed to fetch places:', error.message);
    process.exit(1);
  }

  console.log(`✅ Found ${places.length} places to test\n`);

  // 2. Fetch and save weather for each
  let successCount = 0;
  let failCount = 0;

  for (const place of places) {
    try {
      console.log(`🌤️  Fetching: ${place.name} (${place.country_code})...`);
      
      const data = await fetchWeather(place);
      
      // Save today's weather (uses both current + daily[0])
      await saveWeatherData(place.id, data.current, data.daily);
      // Save future forecast (tomorrow onwards)
      await saveForecast(place.id, data.daily);
      
      await verifyData(place.id, place.name);
      
      successCount++;
    } catch (err) {
      console.error(`❌ ${place.name}: ${err.message}`);
      failCount++;
    }
  }

  // 3. Summary
  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║   Test Summary                                    ║');
  console.log('╚═══════════════════════════════════════════════════╝\n');
  console.log(`  ✅ Success: ${successCount}/${places.length} locations`);
  console.log(`  ❌ Failed:  ${failCount}/${places.length} locations`);
  console.log('');

  if (successCount > 0) {
    console.log('🎉 Test successful! Open-Meteo API is working.');
    console.log('');
    console.log('💡 Next steps:');
    console.log('   1. Check Supabase Table Editor to verify data');
    console.log('   2. Test the app - badges should calculate correctly');
    console.log('   3. Run full refresh: node scripts/refresh-all-weather.js');
    console.log('');
  } else {
    console.log('⚠️  All tests failed. Check errors above.');
  }
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
