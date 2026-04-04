#!/usr/bin/env node

/**
 * Fetch REAL Weather Data for ALL Places
 * Uses Open-Meteo API (FREE, no API key needed)
 * 
 * Run: node scripts/fetch-real-weather.js
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
const BATCH_SIZE = 20; // Process 20 locations in parallel
const RATE_LIMIT_DELAY = 100; // 100ms between batches

/**
 * Weather code to description mapping (Open-Meteo)
 */
const WEATHER_CODE_MAP = {
  // Clear & Cloudy
  0: { main: 'Clear', description: 'Clear sky', icon: '01d' },
  1: { main: 'Clear', description: 'Mainly clear', icon: '01d' },
  2: { main: 'Clouds', description: 'Partly cloudy', icon: '02d' },
  3: { main: 'Clouds', description: 'Overcast', icon: '03d' },
  
  // Fog
  45: { main: 'Fog', description: 'Fog', icon: '50d' },
  48: { main: 'Fog', description: 'Depositing rime fog', icon: '50d' },
  
  // Drizzle
  51: { main: 'Drizzle', description: 'Light drizzle', icon: '09d' },
  53: { main: 'Drizzle', description: 'Moderate drizzle', icon: '09d' },
  55: { main: 'Drizzle', description: 'Dense drizzle', icon: '09d' },
  56: { main: 'Drizzle', description: 'Light freezing drizzle', icon: '09d' },
  57: { main: 'Drizzle', description: 'Dense freezing drizzle', icon: '09d' },
  
  // Rain
  61: { main: 'Rain', description: 'Slight rain', icon: '10d' },
  63: { main: 'Rain', description: 'Moderate rain', icon: '10d' },
  65: { main: 'Rain', description: 'Heavy rain', icon: '10d' },
  66: { main: 'Rain', description: 'Light freezing rain', icon: '10d' },
  67: { main: 'Rain', description: 'Heavy freezing rain', icon: '10d' },
  
  // Snow
  71: { main: 'Snow', description: 'Slight snow', icon: '13d' },
  73: { main: 'Snow', description: 'Moderate snow', icon: '13d' },
  75: { main: 'Snow', description: 'Heavy snow', icon: '13d' },
  77: { main: 'Snow', description: 'Snow grains', icon: '13d' },
  
  // Showers
  80: { main: 'Rain', description: 'Slight rain showers', icon: '09d' },
  81: { main: 'Rain', description: 'Moderate rain showers', icon: '09d' },
  82: { main: 'Rain', description: 'Violent rain showers', icon: '09d' },
  85: { main: 'Snow', description: 'Slight snow showers', icon: '13d' },
  86: { main: 'Snow', description: 'Heavy snow showers', icon: '13d' },
  
  // Thunderstorm
  95: { main: 'Thunderstorm', description: 'Thunderstorm', icon: '11d' },
  96: { main: 'Thunderstorm', description: 'Thunderstorm with slight hail', icon: '11d' },
  99: { main: 'Thunderstorm', description: 'Thunderstorm with heavy hail', icon: '11d' },
};

function getWeatherDescription(code) {
  return WEATHER_CODE_MAP[code] || { main: 'Unknown', description: `Unknown weather (code ${code})`, icon: '01d' };
}

/**
 * Fetch weather for a single place
 */
async function fetchWeatherForPlace(place) {
  try {
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
      timezone: 'auto',
    });

    const apiKeyParam = OPEN_METEO_API_KEY ? `&apikey=${OPEN_METEO_API_KEY}` : '';
    const url = `${OPEN_METEO_BASE_URL}/forecast?${params}${apiKeyParam}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    return { place, current: data.current, error: null };
  } catch (error) {
    return { place, current: null, error };
  }
}

/**
 * Save weather data to database
 */
async function saveWeatherData(placeId, currentWeather) {
  if (!currentWeather) return false;

  const weatherDesc = getWeatherDescription(currentWeather.weather_code);

  const record = {
    place_id: placeId,
    weather_timestamp: new Date(currentWeather.time).toISOString(),
    temperature: currentWeather.temperature_2m,
    feels_like: currentWeather.apparent_temperature,
    temp_min: currentWeather.temperature_2m, // Open-Meteo doesn't have min/max in current
    temp_max: currentWeather.temperature_2m,
    humidity: currentWeather.relative_humidity_2m,
    pressure: currentWeather.pressure_msl,
    pressure_sea_level: currentWeather.pressure_msl,
    pressure_ground_level: currentWeather.surface_pressure,
    wind_speed: currentWeather.wind_speed_10m,
    wind_deg: currentWeather.wind_direction_10m,
    wind_gust: currentWeather.wind_gusts_10m,
    clouds: currentWeather.cloud_cover,
    rain_1h: currentWeather.rain || 0,
    snow_1h: currentWeather.snowfall || 0,
    weather_main: weatherDesc.main,
    weather_description: weatherDesc.description,
    weather_icon: weatherDesc.icon,
    data_source: 'open-meteo',
  };

  const { error } = await supabase
    .from('weather_data')
    .insert(record);

  if (error) {
    console.error(`  ❌ Failed to save weather for place ${placeId}:`, error.message);
    return false;
  }

  return true;
}

/**
 * Process a batch of places
 */
async function processBatch(places, batchNumber, totalBatches) {
  console.log(`\n📦 Batch ${batchNumber}/${totalBatches} (${places.length} places)...`);

  const results = await Promise.all(
    places.map(place => fetchWeatherForPlace(place))
  );

  let successCount = 0;
  let failCount = 0;

  for (const result of results) {
    if (result.error) {
      console.log(`  ❌ ${result.place.name_en}: ${result.error.message}`);
      failCount++;
    } else {
      const saved = await saveWeatherData(result.place.id, result.current);
      if (saved) {
        console.log(`  ✅ ${result.place.name_en}: ${result.current.temperature_2m} °C`);
        successCount++;
      } else {
        failCount++;
      }
    }
  }

  console.log(`  📊 Success: ${successCount}, Failed: ${failCount}`);

  return { successCount, failCount };
}

/**
 * Main function
 */
async function main() {
  console.log('╔═══════════════════════════════════════════════════╗');
  console.log('║   Fetch REAL Weather Data (Open-Meteo)           ║');
  console.log('╚═══════════════════════════════════════════════════╝\n');

  // 1. Get all active places (LIMIT 100 for now to avoid timeout)
  console.log('📍 Fetching places from database (first 100)...');
  const { data: places, error } = await supabase
    .from('places')
    .select('id, name_en, latitude, longitude')
    .eq('is_active', true)
    .order('name_en')
    .limit(100);

  if (error) {
    console.error('❌ Failed to fetch places:', error.message);
    process.exit(1);
  }

  if (!places || places.length === 0) {
    console.log('⚠️  No active places found in database!');
    console.log('');
    console.log('💡 Tip: Import places first:');
    console.log('   node scripts/import-places.js');
    process.exit(0);
  }

  console.log(`✅ Found ${places.length} active places\n`);

  // 2. Process in batches
  const batches = [];
  for (let i = 0; i < places.length; i += BATCH_SIZE) {
    batches.push(places.slice(i, i + BATCH_SIZE));
  }

  console.log(`🚀 Processing ${batches.length} batches (${BATCH_SIZE} places per batch)...`);

  let totalSuccess = 0;
  let totalFail = 0;
  const startTime = Date.now();

  for (let i = 0; i < batches.length; i++) {
    const { successCount, failCount } = await processBatch(
      batches[i],
      i + 1,
      batches.length
    );

    totalSuccess += successCount;
    totalFail += failCount;

    // Rate limiting: wait between batches
    if (i < batches.length - 1) {
      await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));
    }
  }

  const duration = Date.now() - startTime;

  // 3. Summary
  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║   Summary                                         ║');
  console.log('╚═══════════════════════════════════════════════════╝\n');
  console.log(`  ✅ Success: ${totalSuccess} places`);
  console.log(`  ❌ Failed:  ${totalFail} places`);
  console.log(`  ⏱️  Duration: ${(duration / 1000).toFixed(1)}s`);
  console.log(`  📊 Rate: ${(totalSuccess / (duration / 1000)).toFixed(1)} places/second`);
  console.log('');

  if (totalSuccess > 0) {
    console.log('🎉 Weather data updated successfully!');
    console.log('');
    console.log('💡 Next steps:');
    console.log('   1. Restart your Expo app');
    console.log('   2. Check the map - you should see REAL weather data!');
    console.log('   3. Set up cron job for daily updates');
    console.log('');
  } else {
    console.log('⚠️  No weather data was saved. Check errors above.');
  }
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
