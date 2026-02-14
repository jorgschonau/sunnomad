#!/usr/bin/env node

/**
 * Open-Meteo API Test Script
 * 
 * Tests the Open-Meteo API with sample locations
 * Uses paid customer API if OPEN_METEO_API_KEY is set in .env
 * 
 * Run: node scripts/test-open-meteo.js
 */

require('dotenv').config();

// Sample test locations (Europe)
const TEST_LOCATIONS = [
  { name: 'Berlin, Germany', lat: 52.52, lon: 13.40 },
  { name: 'Paris, France', lat: 48.85, lon: 2.35 },
  { name: 'London, UK', lat: 51.51, lon: -0.13 },
  { name: 'Rome, Italy', lat: 41.90, lon: 12.50 },
  { name: 'Madrid, Spain', lat: 40.42, lon: -3.70 },
];

const OPEN_METEO_API_KEY = process.env.OPEN_METEO_API_KEY || '';
const OPEN_METEO_BASE_URL = OPEN_METEO_API_KEY
  ? 'https://customer-api.open-meteo.com/v1'
  : 'https://api.open-meteo.com/v1';

async function testCurrentWeather() {
  console.log('\n🧪 Testing Open-Meteo Current Weather API...\n');
  
  try {
    const location = TEST_LOCATIONS[0];
    
    const params = new URLSearchParams({
      latitude: location.lat,
      longitude: location.lon,
      current: [
        'temperature_2m',
        'relative_humidity_2m',
        'apparent_temperature',
        'precipitation',
        'weather_code',
        'cloud_cover',
        'wind_speed_10m',
        'wind_direction_10m',
      ].join(','),
    });

    const apiKeyParam = OPEN_METEO_API_KEY ? `&apikey=${OPEN_METEO_API_KEY}` : '';
    const url = `${OPEN_METEO_BASE_URL}/forecast?${params}${apiKeyParam}`;
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`API Error ${response.status}`);
    }
    
    const data = await response.json();
    const current = data.current;
    
    console.log(`✅ Success! Current weather for ${location.name}:\n`);
    console.log(`   Temperature: ${current.temperature_2m} °C (feels like ${current.apparent_temperature} °C)`);
    console.log(`   Humidity: ${current.relative_humidity_2m}%`);
    console.log(`   Wind: ${current.wind_speed_10m} m/s (${current.wind_direction_10m}°)`);
    console.log(`   Clouds: ${current.cloud_cover}%`);
    console.log(`   Weather Code: ${current.weather_code}`);
    console.log('');
    
    return true;
  } catch (error) {
    console.error('❌ Current Weather Test Failed:');
    console.error(error.message);
    return false;
  }
}

async function testForecast() {
  console.log('\n🧪 Testing Open-Meteo Forecast API (16 days)...\n');
  
  try {
    const location = TEST_LOCATIONS[1];
    
    const params = new URLSearchParams({
      latitude: location.lat,
      longitude: location.lon,
      daily: [
        'weather_code',
        'temperature_2m_max',
        'temperature_2m_min',
        'precipitation_sum',
        'wind_speed_10m_max',
      ].join(','),
      forecast_days: 16,
    });

    const apiKeyParam = OPEN_METEO_API_KEY ? `&apikey=${OPEN_METEO_API_KEY}` : '';
    const url = `${OPEN_METEO_BASE_URL}/forecast?${params}${apiKeyParam}`;
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`API Error ${response.status}`);
    }
    
    const data = await response.json();
    const forecast = data.daily;
    
    console.log(`✅ Success! 16-day forecast for ${location.name}:\n`);
    
    // Show first 3 days
    for (let i = 0; i < 3; i++) {
      const date = new Date(forecast.time[i]).toLocaleDateString('de-DE');
      console.log(`   ${date}:`);
      console.log(`      Temp: ${forecast.temperature_2m_min[i]} °C - ${forecast.temperature_2m_max[i]} °C`);
      console.log(`      Precipitation: ${forecast.precipitation_sum[i]}mm`);
      console.log(`      Wind: ${forecast.wind_speed_10m_max[i]} m/s`);
      console.log('');
    }
    
    console.log(`   ... and ${forecast.time.length - 3} more days`);
    console.log('');
    
    return true;
  } catch (error) {
    console.error('❌ Forecast Test Failed:');
    console.error(error.message);
    return false;
  }
}

async function testBatchPerformance() {
  console.log('\n🧪 Testing Batch Performance (5 locations in parallel)...\n');
  
  try {
    const startTime = Date.now();
    
    // Fetch all 5 locations in parallel
    const promises = TEST_LOCATIONS.map(location => {
      const params = new URLSearchParams({
        latitude: location.lat,
        longitude: location.lon,
        current: 'temperature_2m,weather_code',
        daily: 'temperature_2m_max,temperature_2m_min',
        forecast_days: 16,
      });
      
      const apiKeyParam = OPEN_METEO_API_KEY ? `&apikey=${OPEN_METEO_API_KEY}` : '';
      return fetch(`${OPEN_METEO_BASE_URL}/forecast?${params}${apiKeyParam}`)
        .then(res => res.json());
    });
    
    const results = await Promise.all(promises);
    const duration = Date.now() - startTime;
    
    console.log(`✅ Success! Fetched ${results.length} locations in ${duration}ms\n`);
    
    results.forEach((data, i) => {
      const location = TEST_LOCATIONS[i];
      const current = data.current;
      console.log(`   ${location.name}: ${current.temperature_2m} °C`);
    });
    
    console.log('');
    console.log(`   Average: ${Math.round(duration / results.length)}ms per location`);
    console.log(`   Rate: ${Math.round(1000 / (duration / results.length))} locations/second`);
    console.log('');
    
    return true;
  } catch (error) {
    console.error('❌ Batch Performance Test Failed:');
    console.error(error.message);
    return false;
  }
}

function estimateUsage() {
  console.log('\n📊 API Usage Estimate for Different Scenarios:\n');
  
  const scenarios = [
    { places: 100, updates: 2 },
    { places: 500, updates: 2 },
    { places: 1000, updates: 2 },
    { places: 5000, updates: 2 },
    { places: 10000, updates: 2 },
    { places: 20000, updates: 2 },
  ];
  
  console.log('   Places  │  Updates/Day  │  API Calls/Day  │  Fair-Use (10k)');
  console.log('   ────────┼───────────────┼─────────────────┼────────────────');
  
  scenarios.forEach(({ places, updates }) => {
    const calls = places * updates;
    const percentage = (calls / 10000) * 100;
    const status = percentage <= 100 ? '✅' : '⚠️';
    
    console.log(`   ${places.toString().padEnd(7)} │  ${updates}x           │  ${calls.toString().padEnd(14)} │  ${status} ${percentage.toFixed(1)}%`);
  });
  
  console.log('');
  console.log('   📝 Notes:');
  console.log('   - Open-Meteo is FREE (no API key needed!)');
  console.log('   - Fair-Use: ~10,000 requests/day');
  console.log('   - Each place = 1 API call (current + forecast in one)');
  console.log('   - 20 parallel requests = super fast!');
  console.log('');
}

async function main() {
  console.log('╔═══════════════════════════════════════════════════╗');
  console.log('║   Open-Meteo API Test Suite                      ║');
  console.log('║   NO API KEY NEEDED - Just works! 🎉             ║');
  console.log('╚═══════════════════════════════════════════════════╝');
  
  estimateUsage();
  
  const currentOk = await testCurrentWeather();
  const forecastOk = await testForecast();
  const batchOk = await testBatchPerformance();
  
  console.log('\n═══════════════════════════════════════════════════\n');
  
  if (currentOk && forecastOk && batchOk) {
    console.log('✅ All tests passed!');
    console.log('');
    console.log('🎯 Open-Meteo is ready to use!');
    console.log('');
    console.log('Next steps:');
    console.log('1. Set up Supabase (see SUPABASE_SETUP.md)');
    console.log('2. Import initial places data');
    console.log('3. Run: node scripts/update-weather.js');
    console.log('4. Set up cron jobs for 2x daily updates');
    console.log('');
    console.log('💡 Advantages:');
    console.log('   ✅ FREE (no registration needed)');
    console.log('   ✅ Fast (20 locations in parallel)');
    console.log('   ✅ Good data quality');
    console.log('   ✅ 16-day forecast');
    console.log('   ✅ Fair-Use: 10k+ requests/day');
    console.log('');
  } else {
    console.log('❌ Some tests failed. Check your internet connection.');
    process.exit(1);
  }
}

main();

