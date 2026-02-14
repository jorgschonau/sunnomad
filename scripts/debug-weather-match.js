#!/usr/bin/env node

/**
 * Debug: Check if place IDs match between places and weather_forecast
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function main() {
  console.log('🔍 Debugging weather match...\n');

  // 1. Get sample places
  const { data: places, error: pe } = await supabase
    .from('places')
    .select('id, name')
    .eq('is_active', true)
    .limit(5);

  if (pe) {
    console.error('❌ Places error:', pe);
    return;
  }

  console.log('📍 Sample PLACES:');
  places.forEach(p => {
    console.log(`   ID: "${p.id}" (type: ${typeof p.id}) - ${p.name}`);
  });

  // 2. Get today's date
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  console.log(`\n📅 Today (local): ${today}`);

  // 3. Get sample weather
  const { data: weather, error: we } = await supabase
    .from('weather_forecast')
    .select('place_id, forecast_date, temp_max')
    .limit(5);

  if (we) {
    console.error('❌ Weather error:', we);
    return;
  }

  console.log('\n🌤️ Sample WEATHER_FORECAST:');
  weather.forEach(w => {
    console.log(`   place_id: "${w.place_id}" (type: ${typeof w.place_id}) - date: ${w.forecast_date}, temp: ${w.temp_max} °C`);
  });

  // 4. Check weather for today
  const { data: todayWeather, error: twe } = await supabase
    .from('weather_forecast')
    .select('place_id, forecast_date')
    .eq('forecast_date', today)
    .limit(5);

  console.log(`\n🌤️ Weather for ${today}:`);
  if (twe) {
    console.error('❌ Error:', twe);
  } else if (!todayWeather || todayWeather.length === 0) {
    console.log('   ⚠️ NO WEATHER FOR TODAY!');
    
    // Check what dates exist
    const { data: dates } = await supabase
      .from('weather_forecast')
      .select('forecast_date')
      .limit(100);
    
    const uniqueDates = [...new Set(dates?.map(d => d.forecast_date) || [])];
    console.log(`\n📅 Available dates in DB: ${uniqueDates.slice(0, 10).join(', ')}`);
  } else {
    todayWeather.forEach(w => {
      console.log(`   place_id: "${w.place_id}" - date: ${w.forecast_date}`);
    });
  }

  // 5. Check if any place ID from places exists in weather
  console.log('\n🔗 Checking if place IDs match...');
  const placeIds = places.map(p => p.id);
  
  const { data: matchedWeather, error: mwe } = await supabase
    .from('weather_forecast')
    .select('place_id, forecast_date, temp_max')
    .in('place_id', placeIds)
    .limit(10);

  if (mwe) {
    console.error('❌ Match error:', mwe);
  } else if (!matchedWeather || matchedWeather.length === 0) {
    console.log('   ❌ NO MATCH! Place IDs do not exist in weather_forecast!');
  } else {
    console.log(`   ✅ Found ${matchedWeather.length} matches!`);
    matchedWeather.forEach(w => {
      console.log(`      place_id: ${w.place_id}, date: ${w.forecast_date}, temp: ${w.temp_max} °C`);
    });
  }

  // 6. Count totals
  const { count: placeCount } = await supabase
    .from('places')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true);

  const { count: weatherCount } = await supabase
    .from('weather_forecast')
    .select('*', { count: 'exact', head: true });

  const { count: todayCount } = await supabase
    .from('weather_forecast')
    .select('*', { count: 'exact', head: true })
    .eq('forecast_date', today);

  console.log(`\n📊 TOTALS:`);
  console.log(`   Places (active): ${placeCount}`);
  console.log(`   Weather (all): ${weatherCount}`);
  console.log(`   Weather (${today}): ${todayCount}`);
}

main();
