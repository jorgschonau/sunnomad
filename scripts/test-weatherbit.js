#!/usr/bin/env node

/**
 * Weatherbit API Test Script
 * 
 * Tests the Weatherbit bulk API with sample locations
 * Run: node scripts/test-weatherbit.js
 */

require('dotenv').config();

const WEATHERBIT_API_KEY = process.env.WEATHERBIT_API_KEY;

if (!WEATHERBIT_API_KEY) {
  console.error('❌ WEATHERBIT_API_KEY not found in .env file');
  process.exit(1);
}

// Sample test locations (Europe)
const TEST_LOCATIONS = [
  { name: 'Berlin', lat: 52.52, lon: 13.40 },
  { name: 'Paris', lat: 48.85, lon: 2.35 },
  { name: 'London', lat: 51.51, lon: -0.13 },
  { name: 'Rome', lat: 41.90, lon: 12.50 },
  { name: 'Madrid', lat: 40.42, lon: -3.70 },
];

async function testBulkCurrentWeather() {
  console.log('\n🧪 Testing Bulk Current Weather API...\n');
  
  try {
    const locations = TEST_LOCATIONS.map(l => ({
      lat: l.lat,
      lon: l.lon,
    }));
    
    const response = await fetch(
      'https://api.weatherbit.io/v2.0/current/bulk',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'key': WEATHERBIT_API_KEY,
        },
        body: JSON.stringify({ locations }),
      }
    );
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API Error ${response.status}: ${errorText}`);
    }
    
    const data = await response.json();
    
    console.log(`✅ Success! Received weather for ${data.data.length} locations:`);
    console.log('');
    
    data.data.forEach((weather, i) => {
      const location = TEST_LOCATIONS[i];
      console.log(`📍 ${location.name}:`);
      console.log(`   Temperature: ${weather.temp} °C (feels like ${weather.app_temp} °C)`);
      console.log(`   Conditions: ${weather.weather?.description || 'N/A'}`);
      console.log(`   Wind: ${weather.wind_spd} m/s`);
      console.log(`   Humidity: ${weather.rh}%`);
      console.log(`   Clouds: ${weather.clouds}%`);
      console.log('');
    });
    
    return true;
  } catch (error) {
    console.error('❌ Bulk Current Weather Test Failed:');
    console.error(error.message);
    return false;
  }
}

async function testBulkForecast() {
  console.log('\n🧪 Testing Bulk Forecast API (16 days)...\n');
  
  try {
    const locations = TEST_LOCATIONS.slice(0, 3).map(l => ({
      lat: l.lat,
      lon: l.lon,
    }));
    
    const response = await fetch(
      'https://api.weatherbit.io/v2.0/forecast/daily/bulk?days=16',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'key': WEATHERBIT_API_KEY,
        },
        body: JSON.stringify({ locations }),
      }
    );
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API Error ${response.status}: ${errorText}`);
    }
    
    const data = await response.json();
    
    console.log(`✅ Success! Received forecasts for ${data.data.length} locations:`);
    console.log('');
    
    data.data.forEach((forecast, i) => {
      const location = TEST_LOCATIONS[i];
      console.log(`📍 ${location.name}:`);
      console.log(`   Forecast days: ${forecast.data?.length || 0}`);
      
      if (forecast.data && forecast.data.length > 0) {
        const today = forecast.data[0];
        const week = forecast.data[6];
        
        console.log(`   Today: ${today.temp} °C, ${today.weather?.description}`);
        if (week) {
          console.log(`   In 7 days: ${week.temp} °C, ${week.weather?.description}`);
        }
      }
      console.log('');
    });
    
    return true;
  } catch (error) {
    console.error('❌ Bulk Forecast Test Failed:');
    console.error(error.message);
    return false;
  }
}

async function estimateUsage() {
  console.log('\n📊 API Usage Estimate for 20,000 Places:\n');
  
  const PLACES = 20000;
  const BATCH_SIZE = 100;
  const BATCHES = Math.ceil(PLACES / BATCH_SIZE);
  const CALLS_PER_UPDATE = BATCHES * 2; // Current + Forecast
  const UPDATES_PER_DAY = 2;
  const DAILY_CALLS = CALLS_PER_UPDATE * UPDATES_PER_DAY;
  
  console.log(`   Total Places: ${PLACES.toLocaleString()}`);
  console.log(`   Batch Size: ${BATCH_SIZE} locations/call`);
  console.log(`   Batches per update: ${BATCHES}`);
  console.log(`   API Calls per update: ${CALLS_PER_UPDATE} (${BATCHES} current + ${BATCHES} forecast)`);
  console.log(`   Updates per day: ${UPDATES_PER_DAY}x (morning + evening)`);
  console.log('');
  console.log(`   📈 Daily API Calls: ${DAILY_CALLS}`);
  console.log(`   📈 Monthly API Calls: ~${(DAILY_CALLS * 30).toLocaleString()}`);
  console.log('');
  console.log(`   ✅ Weatherbit Developer Plan: 5,000 calls/day`);
  console.log(`   ✅ Usage: ${((DAILY_CALLS / 5000) * 100).toFixed(1)}% of daily limit`);
  console.log(`   ✅ Remaining: ${(5000 - DAILY_CALLS).toLocaleString()} calls for on-demand updates`);
  console.log('');
}

async function main() {
  console.log('╔═══════════════════════════════════════════╗');
  console.log('║   Weatherbit.io Bulk API Test Suite      ║');
  console.log('╚═══════════════════════════════════════════╝');
  
  estimateUsage();
  
  const currentWeatherOk = await testBulkCurrentWeather();
  const forecastOk = await testBulkForecast();
  
  console.log('\n═══════════════════════════════════════════\n');
  
  if (currentWeatherOk && forecastOk) {
    console.log('✅ All tests passed!');
    console.log('');
    console.log('Next steps:');
    console.log('1. Set up Supabase (see SUPABASE_SETUP.md)');
    console.log('2. Import initial places data');
    console.log('3. Run first bulk update');
    console.log('4. Set up cron jobs for 2x daily updates');
    console.log('');
  } else {
    console.log('❌ Some tests failed. Please check your API key and try again.');
    process.exit(1);
  }
}

main();

