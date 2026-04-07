#!/usr/bin/env node

/**
 * Full Weather Refresh for ALL Locations
 * Uses Open-Meteo API to fetch current + 16-day forecasts
 * 
 * Run: node scripts/refresh-all-weather.js
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
const BATCH_SIZE = 30; // Process 30 locations in parallel (avoids late-batch timeouts)
const RATE_LIMIT_DELAY = 500; // 500ms between batches
const MAX_RETRIES = 2; // Retry failed places twice
const FETCH_TIMEOUT = 15000; // 15s timeout per request

/**
 * Weather code mapping
 */
const getWeatherMain = (code) => {
  if (code <= 1) return 'sunny'; // 0 Clear sky, 1 Mainly clear
  if (code <= 3) return 'cloudy';
  if (code <= 49) return 'cloudy';
  if (code <= 59) return 'rainy';
  if (code <= 69) return 'rainy';
  if (code <= 79) return 'snowy';
  if (code <= 84) return 'rainy';
  if (code <= 94) return 'snowy';
  if (code <= 99) return 'rainy';
  return 'cloudy';
};

const getWeatherDescription = (code) => {
  const descriptions = {
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
 * Fetch weather for one location (current + 14 days forecast)
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
      'wind_direction_10m_dominant',
      'sunrise',
      'sunset',
      'sunshine_duration',
      'relative_humidity_2m_mean',
    ].join(','),
    forecast_days: 16,
    timezone: 'auto',
  });

  const apiKeyParam = OPEN_METEO_API_KEY ? `&apikey=${OPEN_METEO_API_KEY}` : '';
  const url = `${OPEN_METEO_BASE_URL}/forecast?${params}${apiKeyParam}`;
  
  // Add timeout using AbortController
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  
  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('Request timeout');
    }
    throw error;
  }
}

/**
 * Build all 16 forecast records (today + 15 days) for one place.
 * Today uses current weather data, future days use daily forecast.
 */
function buildForecastRecords(placeId, current, daily, fetchedAt) {
  const today = {
    place_id: placeId,
    forecast_date: daily.time[0],
    fetched_at: fetchedAt,
    temp_min: daily.temperature_2m_min[0],
    temp_max: daily.temperature_2m_max[0],
    weather_main: getWeatherMain(current.weather_code),
    weather_description: getWeatherDescription(current.weather_code),
    weather_icon: getWeatherIcon(current.weather_code),
    wind_speed: current.wind_speed_10m,
    humidity: current.relative_humidity_2m || null,
    precipitation_sum: current.precipitation || 0,
    precipitation_probability: daily.precipitation_probability_max?.[0] ? daily.precipitation_probability_max[0] / 100 : null,
    rain_volume: current.rain || 0,
    snow_volume: current.snowfall || 0,
    sunrise: daily.sunrise?.[0] ? new Date(daily.sunrise[0]).toISOString() : null,
    sunset: daily.sunset?.[0] ? new Date(daily.sunset[0]).toISOString() : null,
    sunshine_duration: daily.sunshine_duration?.[0] || null,
    data_source: 'open-meteo',
  };

  const future = daily.time.slice(1).map((time, i) => {
    const idx = i + 1;
    return {
      place_id: placeId,
      forecast_date: time,
      fetched_at: fetchedAt,
      temp_min: daily.temperature_2m_min[idx],
      temp_max: daily.temperature_2m_max[idx],
      weather_main: getWeatherMain(daily.weather_code[idx]),
      weather_description: getWeatherDescription(daily.weather_code[idx]),
      weather_icon: getWeatherIcon(daily.weather_code[idx]),
      wind_speed: daily.wind_speed_10m_max[idx],
      precipitation_sum: daily.precipitation_sum[idx],
      precipitation_probability: daily.precipitation_probability_max[idx] / 100,
      rain_volume: daily.rain_sum[idx],
      snow_volume: daily.snowfall_sum[idx],
      humidity: daily.relative_humidity_2m_mean?.[idx] ?? null,
      sunrise: daily.sunrise?.[idx] ? new Date(daily.sunrise[idx]).toISOString() : null,
      sunset: daily.sunset?.[idx] ? new Date(daily.sunset[idx]).toISOString() : null,
      sunshine_duration: daily.sunshine_duration?.[idx] || null,
      data_source: 'open-meteo',
    };
  });

  return [today, ...future];
}

/**
 * Process one batch of places
 */
async function processBatch(places, batchNum, totalBatches) {
  console.log(`📦 Batch ${batchNum}/${totalBatches} (${places.length} places)...`);

  const fetchedAt = new Date().toISOString();
  let allRecords = [];

  const results = await Promise.all(
    places.map(async (place) => {
      try {
        const data = await fetchWeather(place);
        const records = buildForecastRecords(place.id, data.current, data.daily, fetchedAt);
        return { success: true, name: place.name_en, temp: data.current.temperature_2m, records };
      } catch (error) {
        console.error(`  ❌ FAILED: ${place.name_en} (ID: ${place.id}) - ${error.message}`);
        return { success: false, name: place.name_en, id: place.id, error: error.message };
      }
    })
  );

  // Collect all records from successful fetches
  for (const r of results) {
    if (r.success) allRecords = allRecords.concat(r.records);
  }

  // Single bulk upsert for entire batch (typically ~480 records)
  if (allRecords.length > 0) {
    const { error: upsertError } = await supabase
      .from('weather_forecast')
      .upsert(allRecords, { onConflict: 'place_id,forecast_date' });

    if (upsertError) {
      console.error(`  ❌ Bulk upsert failed: ${upsertError.message}`);
    }
  }

  const successCount = results.filter(r => r.success).length;
  const failCount = results.filter(r => !r.success).length;
  const failedPlaces = results.filter(r => !r.success);

  const samples = results.filter(r => r.success).slice(0, 3);
  samples.forEach(s => {
    console.log(`  ✅ ${s.name}: ${s.temp} °C`);
  });

  if (failCount > 0) {
    console.log(`  ❌ ${failCount} failed in this batch`);
    failedPlaces.forEach(f => {
      console.log(`     - ${f.name}: ${f.error}`);
    });
  }

  console.log(`  📊 Success: ${successCount}/${places.length} (${allRecords.length} records saved)`);
  
  const failedPlaceObjects = places.filter((p, i) => !results[i].success);
  return { successCount, failCount, failedPlaces: failedPlaceObjects };
}

/**
 * Main function
 */
async function main() {
  console.log('╔═══════════════════════════════════════════════════╗');
  console.log('║   Full Weather Refresh (All Locations)            ║');
  console.log('╚═══════════════════════════════════════════════════╝\n');

  if (OPEN_METEO_API_KEY) {
    console.log('🔑 Using paid Open-Meteo customer API');
  } else {
    console.log('⚠️  No OPEN_METEO_API_KEY set – using free API (rate limited)');
  }
  console.log('');

  const startTime = Date.now();

  // 1. Get all active places (paginated to handle large datasets)
  console.log('📍 Fetching all active places...');
  
  let allPlaces = [];
  let page = 0;
  const PAGE_SIZE = 1000;
  let hasMore = true;
  
  while (hasMore) {
    const { data: pageData, error } = await supabase
      .from('places')
      .select('id, name_en, latitude, longitude, country_code')
      .eq('is_active', true)
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    
    if (error) {
      console.error(`❌ Failed to fetch page ${page + 1}:`, error.message);
      break;
    }
    
    if (pageData && pageData.length > 0) {
      allPlaces = allPlaces.concat(pageData);
      hasMore = pageData.length === PAGE_SIZE;
      page++;
      
      if (page % 5 === 0) {
        console.log(`   Fetched ${allPlaces.length} places so far...`);
      }
    } else {
      hasMore = false;
    }
  }
  
  const places = allPlaces;

  if (!places || places.length === 0) {
    console.error('❌ No places found!');
    process.exit(1);
  }

  console.log(`✅ Found ${places.length} places`);
  console.log(`📊 Expected API calls: ${places.length} (1 per location)`);
  console.log(`⏱️  Estimated time: ~${Math.ceil(places.length / BATCH_SIZE * (RATE_LIMIT_DELAY / 1000))}s\n`);

  // 2. Process in batches
  const batches = [];
  for (let i = 0; i < places.length; i += BATCH_SIZE) {
    batches.push(places.slice(i, i + BATCH_SIZE));
  }

  let totalSuccess = 0;
  let allFailedPlaces = [];

  for (let i = 0; i < batches.length; i++) {
    const { successCount, failedPlaces } = await processBatch(
      batches[i],
      i + 1,
      batches.length
    );

    totalSuccess += successCount;
    allFailedPlaces = allFailedPlaces.concat(failedPlaces || []);

    // Rate limiting with progressive cooldown
    if (i < batches.length - 1) {
      if ((i + 1) % 100 === 0) {
        // Every 100 batches: 5s cooldown to prevent API fatigue
        console.log(`\n⏸️  Cooldown after ${i + 1} batches (5s)...\n`);
        await new Promise(resolve => setTimeout(resolve, 5000));
      } else {
        await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));
      }
    }
  }

  // 3. Retry failed places
  let retrySuccess = 0;
  if (allFailedPlaces.length > 0) {
    for (let retry = 1; retry <= MAX_RETRIES; retry++) {
      if (allFailedPlaces.length === 0) break;
      
      console.log(`\n🔄 Retry ${retry}/${MAX_RETRIES}: ${allFailedPlaces.length} failed places...`);
      await new Promise(resolve => setTimeout(resolve, 3000)); // 3s delay before retry
      
      const RETRY_BATCH_SIZE = 15; // Smaller batches for retries
      const retryBatches = [];
      for (let i = 0; i < allFailedPlaces.length; i += RETRY_BATCH_SIZE) {
        retryBatches.push(allFailedPlaces.slice(i, i + RETRY_BATCH_SIZE));
      }
      
      let stillFailed = [];
      for (let i = 0; i < retryBatches.length; i++) {
        const { successCount, failedPlaces } = await processBatch(
          retryBatches[i],
          i + 1,
          retryBatches.length
        );
        
        retrySuccess += successCount;
        stillFailed = stillFailed.concat(failedPlaces || []);
        
        if (i < retryBatches.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000)); // 1s between retry batches
        }
      }
      
      allFailedPlaces = stillFailed;
      
      if (allFailedPlaces.length === 0) {
        console.log(`  ✅ All retries successful!`);
      } else {
        console.log(`  📊 Retry ${retry}: Still ${allFailedPlaces.length} failed`);
      }
    }
  }

  const totalFailed = allFailedPlaces.length;
  const finalSuccess = totalSuccess + retrySuccess;
  const duration = Math.round((Date.now() - startTime) / 1000);

  // 4. Summary
  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║   Summary                                         ║');
  console.log('╚═══════════════════════════════════════════════════╝\n');
  console.log(`  ✅ Success:  ${finalSuccess}/${places.length} locations`);
  if (retrySuccess > 0) {
    console.log(`     (${totalSuccess} first try + ${retrySuccess} retries)`);
  }
  console.log(`  ❌ Failed:   ${totalFailed}/${places.length} locations`);
  if (totalFailed > 0) {
    console.log(`  📋 Failed places:`);
    allFailedPlaces.slice(0, 20).forEach(p => {
      console.log(`     - ${p.name_en} (${p.id})`);
    });
    if (allFailedPlaces.length > 20) {
      console.log(`     ... and ${allFailedPlaces.length - 20} more`);
    }
  }
  console.log(`  📊 API Calls: ~${finalSuccess + totalFailed * (MAX_RETRIES + 1)}`);
  console.log(`  ⏱️  Duration: ${duration}s (${(finalSuccess / Math.max(duration, 1)).toFixed(1)} locations/sec)`);
  console.log('');

  if (finalSuccess > 0) {
    console.log('🎉 Weather refresh complete!');
    console.log('');
    console.log('💡 Next steps:');
    console.log('   1. Check Supabase Table Editor to verify data');
    console.log('   2. Restart your app - weather should be fresh!');
    console.log('   3. Test badges - they should calculate correctly');
    console.log('   4. Set up daily cron job for automatic updates');
    console.log('');
  } else {
    console.log('⚠️  All updates failed. Check errors above.');
  }
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
