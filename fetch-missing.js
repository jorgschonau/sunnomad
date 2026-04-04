#!/usr/bin/env node
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const OPEN_METEO_API_KEY = process.env.OPEN_METEO_API_KEY || '';
const OPEN_METEO_BASE_URL = OPEN_METEO_API_KEY
  ? 'https://customer-api.open-meteo.com/v1'
  : 'https://api.open-meteo.com/v1';
const BATCH_SIZE = 10;
const RATE_LIMIT_DELAY = 200;

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
    current: ['temperature_2m', 'relative_humidity_2m', 'apparent_temperature', 'precipitation', 'rain', 'snowfall', 'weather_code', 'cloud_cover', 'pressure_msl', 'surface_pressure', 'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m'].join(','),
    daily: ['weather_code', 'temperature_2m_max', 'temperature_2m_min', 'precipitation_sum', 'rain_sum', 'snowfall_sum', 'precipitation_probability_max', 'wind_speed_10m_max', 'wind_gusts_10m_max', 'wind_direction_10m_dominant', 'sunrise', 'sunset'].join(','),
    forecast_days: 16,
    timezone: 'auto',
  });

  const apiKeyParam = OPEN_METEO_API_KEY ? `&apikey=${OPEN_METEO_API_KEY}` : '';
  const url = `${OPEN_METEO_BASE_URL}/forecast?${params}${apiKeyParam}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`API error: ${response.status}`);
  return await response.json();
}

async function saveWeatherData(placeId, current) {
  const record = {
    place_id: placeId,
    weather_timestamp: new Date(current.time).toISOString(),
    temperature: current.temperature_2m,
    feels_like: current.apparent_temperature,
    temp_min: current.temperature_2m,
    temp_max: current.temperature_2m,
    humidity: current.relative_humidity_2m,
    pressure: current.pressure_msl,
    wind_speed: current.wind_speed_10m,
    wind_deg: current.wind_direction_10m,
    wind_gust: current.wind_gusts_10m,
    clouds: current.cloud_cover,
    rain_1h: current.rain || 0,
    snow_1h: current.snowfall || 0,
    weather_main: getWeatherMain(current.weather_code),
    weather_description: getWeatherDescription(current.weather_code),
    weather_icon: getWeatherIcon(current.weather_code),
    data_source: 'open-meteo',
  };
  await supabase.from('weather_data').upsert(record, { onConflict: 'place_id,weather_timestamp' });
}

async function saveForecast(placeId, daily) {
  const fetchedAt = new Date().toISOString();
  const records = daily.time.map((time, i) => ({
    place_id: placeId,
    forecast_date: time, // Already YYYY-MM-DD from Open-Meteo API
    fetched_at: fetchedAt,
    temp_min: daily.temperature_2m_min[i],
    temp_max: daily.temperature_2m_max[i],
    weather_main: getWeatherMain(daily.weather_code[i]),
    weather_description: getWeatherDescription(daily.weather_code[i]),
    weather_icon: getWeatherIcon(daily.weather_code[i]),
    wind_speed: daily.wind_speed_10m_max[i],
    precipitation_sum: daily.precipitation_sum[i],
    precipitation_probability: daily.precipitation_probability_max[i] / 100,
    rain_probability: daily.precipitation_probability_max[i] / 100,
    rain_volume: daily.rain_sum[i],
    snow_volume: daily.snowfall_sum[i],
    sunrise: daily.sunrise?.[i] ? new Date(daily.sunrise[i]).toISOString() : null,
    sunset: daily.sunset?.[i] ? new Date(daily.sunset[i]).toISOString() : null,
    data_source: 'open-meteo',
  }));
  await supabase.from('weather_forecast').upsert(records, { onConflict: 'place_id,forecast_date' });
}

async function main() {
  console.log('🔧 Fetching missing weather data...\n');
  
  const { data: missing } = await supabase
    .from('places')
    .select('id, name_en, latitude, longitude, country_code')
    .eq('is_active', true)
    .is('last_weather_fetch', null);

  console.log(`Found ${missing.length} places without weather\n`);

  const batches = [];
  for (let i = 0; i < missing.length; i += BATCH_SIZE) {
    batches.push(missing.slice(i, i + BATCH_SIZE));
  }

  let success = 0;
  let failed = 0;

  for (let i = 0; i < batches.length; i++) {
    const results = await Promise.all(
      batches[i].map(async (place) => {
        try {
          const data = await fetchWeather(place);
          await saveWeatherData(place.id, data.current);
          await saveForecast(place.id, data.daily);
          await supabase.from('places').update({ last_weather_fetch: new Date().toISOString() }).eq('id', place.id);
          return { success: true, name: place.name_en };
        } catch (error) {
          return { success: false, name: place.name_en, error: error.message };
        }
      })
    );

    success += results.filter(r => r.success).length;
    failed += results.filter(r => !r.success).length;

    if ((i + 1) % 10 === 0) {
      console.log(`Progress: ${i + 1}/${batches.length} batches (${success}/${missing.length} places)`);
    }

    if (i < batches.length - 1) {
      await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));
    }
  }

  console.log(`\n✅ Done: ${success} success, ${failed} failed`);
}

main();
