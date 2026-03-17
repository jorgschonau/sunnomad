#!/usr/bin/env node

/**
 * Refresh Weather for Places Without Weather Data
 * Only fetches for places that have never been updated
 * 
 * Run: node scripts/refresh-new-places.js
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
  console.error('❌ Supabase not configured! Check .env file');
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const OPEN_METEO_API_KEY = process.env.OPEN_METEO_API_KEY || '';
const OPEN_METEO_BASE_URL = OPEN_METEO_API_KEY
  ? 'https://customer-api.open-meteo.com/v1'
  : 'https://api.open-meteo.com/v1';
const BATCH_SIZE = 20;
const RATE_LIMIT_DELAY = 100;

// Import weather code mapping from test-openmeteo.js
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

async function fetchWeather(place) {
  const params = new URLSearchParams({
    latitude: place.latitude,
    longitude: place.longitude,
    current: ['temperature_2m', 'relative_humidity_2m', 'weather_code', 'wind_speed_10m', 'cloud_cover'],
    daily: ['temperature_2m_max', 'temperature_2m_min', 'weather_code', 'precipitation_sum', 'precipitation_probability_max', 'wind_speed_10m_max', 'sunrise', 'sunset'],
    timezone: 'auto',
    forecast_days: 16
  });

  const apiKeyParam = OPEN_METEO_API_KEY ? `&apikey=${OPEN_METEO_API_KEY}` : '';
  const response = await fetch(`${OPEN_METEO_BASE_URL}/forecast?${params}${apiKeyParam}`);
  if (!response.ok) throw new Error(`API error: ${response.status}`);
  return await response.json();
}

async function saveWeatherData(placeId, current, daily) {
  const weatherCode = current.weather_code || daily.weather_code[0];
  
  const weatherData = {
    place_id: placeId,
    forecast_date: new Date().toISOString().split('T')[0],
    temp_min: daily.temperature_2m_min[0],
    temp_max: daily.temperature_2m_max[0],
    weather_main: getWeatherMain(weatherCode),
    weather_description: getWeatherDescription(weatherCode),
    weather_icon: getWeatherIcon(weatherCode),
    wind_speed: daily.wind_speed_10m_max[0],
    precipitation_sum: daily.precipitation_sum[0],
    precipitation_probability: daily.precipitation_probability_max[0],
    sunrise: daily.sunrise[0],
    sunset: daily.sunset[0],
    fetched_at: new Date().toISOString(),
    data_source: 'open-meteo'
  };

  const { error } = await supabase
    .from('weather_forecast')
    .upsert(weatherData, {
      onConflict: 'place_id,forecast_date'
    });

  if (error) throw error;
}

async function saveForecast(placeId, daily) {
  const forecasts = [];
  
  for (let i = 0; i < daily.time.length; i++) {
    forecasts.push({
      place_id: placeId,
      forecast_date: daily.time[i],
      temp_min: daily.temperature_2m_min[i],
      temp_max: daily.temperature_2m_max[i],
      weather_main: getWeatherMain(daily.weather_code[i]),
      weather_description: getWeatherDescription(daily.weather_code[i]),
      weather_icon: getWeatherIcon(daily.weather_code[i]),
      wind_speed: daily.wind_speed_10m_max[i],
      precipitation_sum: daily.precipitation_sum[i],
      precipitation_probability: daily.precipitation_probability_max[i],
      sunrise: daily.sunrise[i],
      sunset: daily.sunset[i],
      fetched_at: new Date().toISOString(),
      data_source: 'open-meteo'
    });
  }

  const { error } = await supabase
    .from('weather_forecast')
    .upsert(forecasts, {
      onConflict: 'place_id,forecast_date'
    });

  if (error) throw error;
}

async function main() {
  console.log('╔═══════════════════════════════════════════════════╗');
  console.log('║   Refresh Weather for New Places                  ║');
  console.log('╚═══════════════════════════════════════════════════╝\n');

  // Get places WITHOUT weather data
  console.log('📍 Fetching places without weather data...');
  
  const { data: places, error } = await supabase
    .from('places')
    .select('id, name, latitude, longitude, country_code')
    .eq('is_active', true)
    .not('to_remove', 'eq', true)
    .is('last_weather_fetch', null); // Only places never fetched

  if (error) {
    console.error('❌ Failed to fetch places:', error.message);
    process.exit(1);
  }

  console.log(`📊 Found ${places.length} places without weather\n`);

  if (places.length === 0) {
    console.log('✅ All places already have weather data!');
    return;
  }

  let successCount = 0;
  let failCount = 0;

  // Process in batches
  for (let i = 0; i < places.length; i += BATCH_SIZE) {
    const batch = places.slice(i, i + BATCH_SIZE);
    
    const results = await Promise.allSettled(
      batch.map(async (place) => {
        try {
          const data = await fetchWeather(place);
          await saveWeatherData(place.id, data.current, data.daily);
          await saveForecast(place.id, data.daily);
          
          await supabase
            .from('places')
            .update({ last_weather_fetch: new Date().toISOString() })
            .eq('id', place.id);
          
          return { success: true, name: place.name };
        } catch (error) {
          return { success: false, name: place.name, error: error.message };
        }
      })
    );

    results.forEach(result => {
      if (result.status === 'fulfilled' && result.value.success) {
        successCount++;
      } else {
        failCount++;
      }
    });

    console.log(`   ✅ Processed: ${successCount}/${places.length} (${failCount} failed)`);

    // Rate limiting
    if (i + BATCH_SIZE < places.length) {
      await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));
    }
  }

  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║   Complete!                                       ║');
  console.log('╚═══════════════════════════════════════════════════╝\n');
  console.log(`✅ Success: ${successCount}/${places.length} locations`);
  console.log(`❌ Failed:  ${failCount}/${places.length} locations\n`);
}

main();
