#!/usr/bin/env node

/**
 * Run Weather Update - Manual Trigger
 * 
 * Fetches weather data from Open-Meteo for all places in DB
 * and saves to weather_data + weather_forecast tables
 * 
 * Run: node scripts/run-weather-update.js
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Check environment variables
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
  console.error('❌ Error: Supabase credentials not found in .env file!');
  console.error('');
  console.error('Make sure your .env contains:');
  console.error('  SUPABASE_URL=https://your-project.supabase.co');
  console.error('  SUPABASE_ANON_KEY=your_anon_key_here');
  console.error('');
  process.exit(1);
}

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const OPEN_METEO_API_KEY = process.env.OPEN_METEO_API_KEY || '';
const OPEN_METEO_BASE_URL = OPEN_METEO_API_KEY
  ? 'https://customer-api.open-meteo.com/v1'
  : 'https://api.open-meteo.com/v1';

/**
 * Fetch weather data from Open-Meteo for a single place
 */
async function fetchWeatherForPlace(place) {
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
        'weather_code',
        'cloud_cover',
        'pressure_msl',
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
        'precipitation_probability_max',
        'wind_speed_10m_max',
        'wind_gusts_10m_max',
        'wind_direction_10m_dominant',
        'uv_index_max',
        'snowfall_sum',
      ].join(','),
      
      forecast_days: 16,
      timezone: 'auto',
    });

    const apiKeyParam = OPEN_METEO_API_KEY ? `&apikey=${OPEN_METEO_API_KEY}` : '';
    const url = `${OPEN_METEO_BASE_URL}/forecast?${params}${apiKeyParam}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error(`  ❌ Failed to fetch weather for ${place.name_en}:`, error.message);
    return null;
  }
}

/**
 * Map weather code to icon code (compatible with OpenWeatherMap style)
 */
function getWeatherIcon(code) {
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
}

/**
 * Map weather code to description
 */
function getWeatherDescription(code) {
  const descriptions = {
    0: 'Clear sky',
    1: 'Mainly clear',
    2: 'Partly cloudy',
    3: 'Overcast',
    45: 'Foggy',
    48: 'Depositing rime fog',
    51: 'Light drizzle',
    53: 'Moderate drizzle',
    55: 'Dense drizzle',
    56: 'Light freezing drizzle',
    57: 'Dense freezing drizzle',
    61: 'Slight rain',
    63: 'Moderate rain',
    65: 'Heavy rain',
    66: 'Light freezing rain',
    67: 'Heavy freezing rain',
    71: 'Slight snow',
    73: 'Moderate snow',
    75: 'Heavy snow',
    77: 'Snow grains',
    80: 'Slight rain showers',
    81: 'Moderate rain showers',
    82: 'Violent rain showers',
    85: 'Slight snow showers',
    86: 'Heavy snow showers',
    95: 'Thunderstorm',
    96: 'Thunderstorm with slight hail',
    99: 'Thunderstorm with heavy hail',
  };
  return descriptions[code] || `Unknown weather (code ${code})`;
}

/**
 * Map weather code to main category
 */
function getWeatherMain(code) {
  if (code === 0) return 'Clear';
  if (code <= 3) return 'Clouds';
  if (code <= 49) return 'Fog';
  if (code <= 59) return 'Drizzle';
  if (code <= 69) return 'Rain';
  if (code <= 79) return 'Snow';
  if (code <= 99) return 'Thunderstorm';
  return 'Unknown';
}

/**
 * Save current weather to database
 */
async function saveCurrentWeather(placeId, placeName, current) {
  if (!current || !current.time) {
    console.log(`  ⚠️  ${placeName}: No current weather data`);
    return false;
  }
  
  try {
    const { error } = await supabase
      .from('weather_data')
      .insert({
        place_id: placeId,
        weather_timestamp: new Date(current.time).toISOString(),
        
        // Temperature
        temperature: current.temperature_2m,
        feels_like: current.apparent_temperature,
        temp_min: current.temperature_2m, // Current doesn't have min/max, use current
        temp_max: current.temperature_2m,
        dew_point: null, // Open-Meteo doesn't provide this in current
        
        // Weather conditions
        weather_main: getWeatherMain(current.weather_code),
        weather_description: getWeatherDescription(current.weather_code),
        weather_icon: getWeatherIcon(current.weather_code),
        
        // Humidity & Pressure
        humidity: current.relative_humidity_2m,
        pressure: current.pressure_msl,
        pressure_sea_level: current.pressure_msl,
        pressure_ground_level: null,
        
        // Wind
        wind_speed: current.wind_speed_10m,
        wind_deg: current.wind_direction_10m,
        wind_gust: current.wind_gusts_10m,
        
        // Clouds & Visibility
        clouds: current.cloud_cover,
        visibility: null, // Open-Meteo doesn't provide visibility in free tier
        
        // Precipitation
        rain_1h: current.precipitation,
        rain_3h: null,
        rain_24h: null,
        snow_1h: null,
        snow_3h: null,
        snow_24h: null,
        
        // UV & Sun
        uv_index: null, // Not in current endpoint
        sunrise: null, // Not in current endpoint
        sunset: null,
        
        data_source: 'open-meteo',
      });

    if (error) {
      // Check if it's a duplicate (already exists)
      if (error.code === '23505') {
        console.log(`  ℹ️  ${placeName}: Current weather already exists (skipped)`);
        return true;
      }
      throw error;
    }

    console.log(`  ✅ ${placeName}: ${current.temperature_2m} °C (${getWeatherDescription(current.weather_code)})`);
    return true;
  } catch (error) {
    console.error(`  ❌ Failed to save current weather for ${placeName}:`, error.message);
    return false;
  }
}

/**
 * Save forecast data to database
 */
async function saveForecast(placeId, placeName, daily) {
  if (!daily || !daily.time || daily.time.length === 0) {
    console.log(`  ⚠️  ${placeName}: No forecast data`);
    return false;
  }
  
  try {
    const fetchedAt = new Date().toISOString();
    
    const records = daily.time.map((time, i) => ({
      place_id: placeId,
      forecast_date: time, // Use forecast_date instead of timestamp
      fetched_at: fetchedAt,
      
      // Temperature
      temperature: (daily.temperature_2m_max[i] + daily.temperature_2m_min[i]) / 2,
      feels_like: (daily.apparent_temperature_max[i] + daily.apparent_temperature_min[i]) / 2,
      temp_min: daily.temperature_2m_min[i],
      temp_max: daily.temperature_2m_max[i],
      
      // Weather conditions
      weather_main: getWeatherMain(daily.weather_code[i]),
      weather_description: getWeatherDescription(daily.weather_code[i]),
      weather_icon: getWeatherIcon(daily.weather_code[i]),
      
      // Wind
      wind_speed: daily.wind_speed_10m_max[i],
      wind_deg: daily.wind_direction_10m_dominant ? daily.wind_direction_10m_dominant[i] : null,
      wind_gust: daily.wind_gusts_10m_max[i],
      
      // Clouds & Humidity
      humidity: null, // Not in daily forecast
      pressure: null, // Not in daily forecast
      clouds: null,   // Not in daily forecast
      visibility: null,
      
      // Precipitation
      rain_probability: (daily.precipitation_probability_max[i] || 0) / 100,
      rain_volume: daily.precipitation_sum[i],
      snow_volume: daily.snowfall_sum ? daily.snowfall_sum[i] : null,
      
      // UV Index
      uv_index: daily.uv_index_max ? daily.uv_index_max[i] : null,
      
      data_source: 'open-meteo',
    }));

    // Delete old forecasts first (only keep latest)
    await supabase
      .from('weather_forecast')
      .delete()
      .eq('place_id', placeId);
    
    // Insert new forecasts
    const { error } = await supabase
      .from('weather_forecast')
      .insert(records);

    if (error) throw error;

    console.log(`  ✅ ${placeName}: 16-day forecast saved`);
    return true;
  } catch (error) {
    console.error(`  ❌ Failed to save forecast for ${placeName}:`, error.message);
    return false;
  }
}

/**
 * Update last_weather_fetch timestamp
 */
async function updateLastFetch(placeId) {
  await supabase
    .from('places')
    .update({ last_weather_fetch: new Date().toISOString() })
    .eq('id', placeId);
}

/**
 * Main function
 */
async function main() {
  console.log('╔════════════════════════════════════════════════════╗');
  console.log('║   Weather Update Script (Open-Meteo)              ║');
  console.log('╚════════════════════════════════════════════════════╝\n');
  
  const startTime = Date.now();
  
  // 1. Get all active places from database
  console.log('📍 Fetching places from database...\n');
  
  const { data: places, error: fetchError } = await supabase
    .from('places')
    .select('id, name_en, latitude, longitude')
    .eq('is_active', true);
  
  if (fetchError) {
    console.error('❌ Failed to fetch places:', fetchError.message);
    process.exit(1);
  }
  
  if (!places || places.length === 0) {
    console.log('⚠️  No places found in database!');
    console.log('');
    console.log('Add some places first:');
    console.log('  1. Go to Supabase Dashboard → SQL Editor');
    console.log('  2. Run the INSERT statements from NEXT_STEPS.md');
    console.log('');
    process.exit(0);
  }
  
  console.log(`Found ${places.length} place(s)\n`);
  console.log('🌦️  Fetching weather data...\n');
  
  let successCount = 0;
  let failCount = 0;
  const failedPlaces = []; // Track failed places with reasons
  
  const BATCH_SIZE = 20; // Process 20 places in parallel
  
  // 2. Process in parallel batches
  for (let i = 0; i < places.length; i += BATCH_SIZE) {
    const batch = places.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(places.length / BATCH_SIZE);
    
    console.log(`📦 Batch ${batchNum}/${totalBatches} (${i + 1}-${Math.min(i + BATCH_SIZE, places.length)} of ${places.length})...`);
    
    // Fetch weather for all places in batch PARALLEL
    const weatherPromises = batch.map(place => fetchWeatherForPlace(place));
    const weatherResults = await Promise.all(weatherPromises);
    
    // Save to database
    for (let j = 0; j < batch.length; j++) {
      const place = batch[j];
      const weatherData = weatherResults[j];
      
      if (!weatherData) {
        console.log(`  ❌ ${place.name_en}: Failed to fetch weather data`);
        failedPlaces.push({
          name: place.name_en,
          reason: 'Failed to fetch from API'
        });
        failCount++;
        continue;
      }
      
      if (!weatherData.current || !weatherData.daily) {
        console.log(`  ❌ ${place.name_en}: Incomplete weather data`);
        failedPlaces.push({
          name: place.name_en,
          reason: 'Incomplete data from API'
        });
        failCount++;
        continue;
      }
      
      // Save current weather
      const currentSaved = await saveCurrentWeather(
        place.id,
        place.name_en,
        weatherData.current
      );
      
      // Save forecast
      const forecastSaved = await saveForecast(
        place.id,
        place.name_en,
        weatherData.daily
      );
      
      // Update last fetch timestamp
      if (currentSaved && forecastSaved) {
        await updateLastFetch(place.id);
        successCount++;
      } else {
        const reasons = [];
        if (!currentSaved) reasons.push('current weather save failed');
        if (!forecastSaved) reasons.push('forecast save failed');
        
        console.log(`  ⚠️  ${place.name_en}: Partial save (${reasons.join(', ')})`);
        failedPlaces.push({
          name: place.name_en,
          reason: reasons.join(', ')
        });
        failCount++;
      }
    }
    
    console.log(`  ✅ Batch complete: ${batch.length} places processed\n`);
    
    // Rate limiting between batches
    if (i + BATCH_SIZE < places.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  const duration = Math.round((Date.now() - startTime) / 1000);
  
  console.log('════════════════════════════════════════════════════\n');
  
  if (failCount === 0) {
    console.log('✅ Update complete! All places successful!\n');
  } else {
    console.log('⚠️  Update complete with some failures\n');
  }
  
  console.log(`   Success: ${successCount}/${places.length} (${((successCount/places.length)*100).toFixed(1)}%)`);
  console.log(`   Failed:  ${failCount}/${places.length} (${((failCount/places.length)*100).toFixed(1)}%)`);
  console.log(`   Duration: ${duration}s`);
  console.log('');
  
  if (failedPlaces.length > 0) {
    console.log('❌ Failed Places:\n');
    failedPlaces.forEach((place, i) => {
      console.log(`   ${i + 1}. ${place.name}`);
      console.log(`      Reason: ${place.reason}`);
    });
    console.log('');
  }
  
  console.log('💡 Check your data:');
  console.log('   Supabase Dashboard → Table Editor → weather_data');
  console.log('   Supabase Dashboard → Table Editor → weather_forecast');
  console.log('');
}

// Run it!
main().catch(error => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});

