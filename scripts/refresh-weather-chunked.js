#!/usr/bin/env node

/**
 * Chunked Weather Refresh - Process locations in manageable chunks
 * Use this for large datasets (10k+ locations)
 * 
 * Usage:
 *   node scripts/refresh-weather-chunked.js --chunk-size 5000 --start 0
 *   node scripts/refresh-weather-chunked.js --chunk-size 5000 --start 5000
 *   etc.
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
const BATCH_SIZE = 10; // Smaller batches for stability
const RATE_LIMIT_DELAY = 200; // 200ms between batches (be extra nice)

// Parse command line args
const args = process.argv.slice(2);
const chunkSizeArg = args.find(a => a.startsWith('--chunk-size='));
const startArg = args.find(a => a.startsWith('--start='));

const CHUNK_SIZE = chunkSizeArg ? parseInt(chunkSizeArg.split('=')[1]) : 5000;
const START_OFFSET = startArg ? parseInt(startArg.split('=')[1]) : 0;

/**
 * Weather code mapping
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
    95: 'Thunderstorm',
  };
  return descriptions[code] || `Weather code ${code}`;
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
    current: [
      'temperature_2m', 'relative_humidity_2m', 'apparent_temperature',
      'precipitation', 'rain', 'snowfall', 'weather_code', 'cloud_cover',
      'pressure_msl', 'surface_pressure', 'wind_speed_10m',
      'wind_direction_10m', 'wind_gusts_10m',
    ].join(','),
    daily: [
      'weather_code', 'temperature_2m_max', 'temperature_2m_min',
      'precipitation_sum', 'rain_sum', 'snowfall_sum',
      'precipitation_probability_max', 'wind_speed_10m_max',
      'wind_gusts_10m_max', 'wind_direction_10m_dominant',
      'sunrise', 'sunset',
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
}

async function saveWeatherData(placeId, current, daily) {
  const today = new Date().toISOString().split('T')[0];
  const fetchedAt = new Date().toISOString();
  
  const record = {
    place_id: placeId,
    forecast_date: today,
    fetched_at: fetchedAt,
    temp_min: daily.temperature_2m_min[0],
    temp_max: daily.temperature_2m_max[0],
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

async function saveForecast(placeId, daily) {
  const fetchedAt = new Date().toISOString();
  
  const records = daily.time.slice(1).map((time, i) => {
    const actualIndex = i + 1;
    return {
      place_id: placeId,
      forecast_date: time,
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

async function processBatch(places, batchNum, totalBatches) {
  const results = await Promise.all(
    places.map(async (place) => {
      try {
        const data = await fetchWeather(place);
        await saveWeatherData(place.id, data.current, data.daily);
        await saveForecast(place.id, data.daily);
        
        await supabase
          .from('places')
          .update({ last_weather_fetch: new Date().toISOString() })
          .eq('id', place.id);
        
        return { success: true, name: place.name, temp: data.current.temperature_2m };
      } catch (error) {
        return { success: false, name: place.name, error: error.message };
      }
    })
  );

  const successCount = results.filter(r => r.success).length;
  const failCount = results.filter(r => !r.success).length;

  return { successCount, failCount };
}

async function main() {
  console.log('╔═══════════════════════════════════════════════════╗');
  console.log('║   Chunked Weather Refresh                         ║');
  console.log('╚═══════════════════════════════════════════════════╝\n');

  const startTime = Date.now();

  // Get chunk of places
  console.log(`📍 Fetching places ${START_OFFSET} to ${START_OFFSET + CHUNK_SIZE}...`);
  
  const { data: places, error } = await supabase
    .from('places')
    .select('id, name, latitude, longitude')
    .eq('is_active', true)
    .range(START_OFFSET, START_OFFSET + CHUNK_SIZE - 1);

  if (error) {
    console.error('❌ Failed to fetch places:', error.message);
    process.exit(1);
  }

  if (!places || places.length === 0) {
    console.log('✅ No more places to process!');
    process.exit(0);
  }

  console.log(`✅ Found ${places.length} places in this chunk`);
  console.log(`⏱️  Estimated time: ~${Math.ceil(places.length / BATCH_SIZE * (RATE_LIMIT_DELAY / 1000))}s\n`);

  // Process in batches
  const batches = [];
  for (let i = 0; i < places.length; i += BATCH_SIZE) {
    batches.push(places.slice(i, i + BATCH_SIZE));
  }

  let totalSuccess = 0;
  let totalFailed = 0;

  for (let i = 0; i < batches.length; i++) {
    console.log(`📦 Batch ${i + 1}/${batches.length}...`);
    
    const { successCount, failCount } = await processBatch(
      batches[i],
      i + 1,
      batches.length
    );

    totalSuccess += successCount;
    totalFailed += failCount;

    console.log(`   ✅ ${successCount}/${batches[i].length} successful`);

    // Rate limiting
    if (i < batches.length - 1) {
      await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));
    }
    
    // Progress update every 50 batches
    if ((i + 1) % 50 === 0) {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      const rate = totalSuccess / elapsed;
      console.log(`\n   📊 Progress: ${totalSuccess}/${places.length} (${rate.toFixed(1)} places/sec)`);
      console.log(`   ⏱️  Elapsed: ${elapsed}s\n`);
    }
  }

  const duration = Math.round((Date.now() - startTime) / 1000);

  // Summary
  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║   Chunk Summary                                   ║');
  console.log('╚═══════════════════════════════════════════════════╝\n');
  console.log(`  ✅ Success:  ${totalSuccess}/${places.length} locations`);
  console.log(`  ❌ Failed:   ${totalFailed}/${places.length} locations`);
  console.log(`  ⏱️  Duration: ${duration}s`);
  console.log('');

  const nextStart = START_OFFSET + CHUNK_SIZE;
  console.log(`💡 Next chunk: node scripts/refresh-weather-chunked.js --chunk-size=${CHUNK_SIZE} --start=${nextStart}`);
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
