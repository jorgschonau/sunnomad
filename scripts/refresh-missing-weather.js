#!/usr/bin/env node

/**
 * Fetch weather for places WITHOUT weather data
 * Run: node scripts/refresh-missing-weather.js
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const OPEN_METEO_API_KEY = process.env.OPEN_METEO_API_KEY || '';
const OPEN_METEO_BASE_URL = OPEN_METEO_API_KEY
  ? 'https://customer-api.open-meteo.com/v1'
  : 'https://api.open-meteo.com/v1';
const BATCH_SIZE = 20;
const RATE_LIMIT_DELAY = 100;

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
    45: 'Foggy', 61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain',
    71: 'Slight snow', 95: 'Thunderstorm',
  };
  return descriptions[code] || `Weather code ${code}`;
};

const getWeatherIcon = (code) => {
  if (code === 0) return '01d';
  if (code <= 3) return '02d';
  if (code <= 49) return '50d';
  if (code <= 69) return '10d';
  if (code <= 79) return '13d';
  if (code <= 99) return '11d';
  return '01d';
};

async function fetchWeather(place) {
  const params = new URLSearchParams({
    latitude: place.latitude,
    longitude: place.longitude,
    daily: ['temperature_2m_max', 'temperature_2m_min', 'weather_code', 'precipitation_sum', 'precipitation_probability_max', 'wind_speed_10m_max', 'sunrise', 'sunset'],
    timezone: 'auto',
    forecast_days: 16
  });

  const apiKeyParam = OPEN_METEO_API_KEY ? `&apikey=${OPEN_METEO_API_KEY}` : '';
  const response = await fetch(`${OPEN_METEO_BASE_URL}/forecast?${params}${apiKeyParam}`);
  if (!response.ok) throw new Error(`API error: ${response.status}`);
  return await response.json();
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
    .upsert(forecasts, { onConflict: 'place_id,forecast_date' });

  if (error) throw error;
}

async function main() {
  console.log('╔═══════════════════════════════════════════════════╗');
  console.log('║   Refresh Weather for Places WITHOUT weather     ║');
  console.log('╚═══════════════════════════════════════════════════╝\n');

  // Get places WITHOUT weather for today
  const today = new Date().toISOString().split('T')[0];
  
  const { data: placesWithoutWeather, error } = await supabase.rpc('get_places_without_weather_today', { today_date: today });
  
  // If function doesn't exist, use manual query
  let places;
  if (error) {
    console.log('Using manual query...');
    const { data: allPlaces } = await supabase
      .from('places')
      .select('id, name, latitude, longitude, country_code')
      .eq('is_active', true);
    
    const { data: weatherToday } = await supabase
      .from('weather_forecast')
      .select('place_id')
      .eq('forecast_date', today);
    
    const withWeatherIds = new Set(weatherToday.map(w => w.place_id));
    places = allPlaces.filter(p => !withWeatherIds.has(p.id));
  } else {
    places = placesWithoutWeather;
  }

  console.log(`📍 Found ${places.length} places without weather\n`);

  if (places.length === 0) {
    console.log('✅ All places already have weather!');
    return;
  }

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < places.length; i += BATCH_SIZE) {
    const batch = places.slice(i, i + BATCH_SIZE);
    
    const results = await Promise.allSettled(
      batch.map(async (place) => {
        try {
          const data = await fetchWeather(place);
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

    console.log(`   ✅ Progress: ${successCount}/${places.length} (${failCount} failed)`);

    if (i + BATCH_SIZE < places.length) {
      await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));
    }
  }

  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║   Complete!                                       ║');
  console.log('╚═══════════════════════════════════════════════════╝\n');
  console.log(`✅ Success: ${successCount}/${places.length}`);
  console.log(`❌ Failed:  ${failCount}/${places.length}\n`);
}

main();
