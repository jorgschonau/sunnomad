#!/usr/bin/env node
/**
 * Quick test: Fetch weather for 5 places only
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const OPEN_METEO_API_KEY = process.env.OPEN_METEO_API_KEY || '';
const OPEN_METEO_BASE_URL = OPEN_METEO_API_KEY
  ? 'https://customer-api.open-meteo.com/v1'
  : 'https://api.open-meteo.com/v1';

async function main() {
  console.log('🧪 Testing weather fetch for 5 places...\n');

  // Get 5 places
  const { data: places, error } = await supabase
    .from('places')
    .select('id, name_en, latitude, longitude')
    .eq('is_active', true)
    .limit(5);

  if (error) {
    console.error('❌ Failed to get places:', error);
    return;
  }

  console.log(`📍 Got ${places.length} places\n`);

  for (const place of places) {
    try {
      console.log(`Fetching: ${place.name_en}...`);
      
      const params = new URLSearchParams({
        latitude: place.latitude,
        longitude: place.longitude,
        daily: 'temperature_2m_max,temperature_2m_min,weather_code',
        forecast_days: 3,
        timezone: 'auto',
      });

      const apiKeyParam = OPEN_METEO_API_KEY ? `&apikey=${OPEN_METEO_API_KEY}` : '';
      const url = `${OPEN_METEO_BASE_URL}/forecast?${params}${apiKeyParam}`;
      const response = await fetch(url);
      const data = await response.json();

      if (data.error) {
        console.log(`  ❌ API Error: ${data.reason}`);
        continue;
      }

      const today = data.daily.time[0];
      const tempMin = data.daily.temperature_2m_min[0];
      const tempMax = data.daily.temperature_2m_max[0];

      console.log(`  ✅ ${place.name_en}: ${tempMin}°/${tempMax} °C (${today})`);

      // Try to save
      const { error: saveError } = await supabase
        .from('weather_forecast')
        .upsert({
          place_id: place.id,
          forecast_date: today,
          temp_min: tempMin,
          temp_max: tempMax,
          weather_main: 'Test',
          data_source: 'test',
          fetched_at: new Date().toISOString(),
        }, { onConflict: 'place_id,forecast_date' });

      if (saveError) {
        console.log(`  ❌ Save error: ${saveError.message}`);
      } else {
        console.log(`  💾 Saved!`);
      }

    } catch (err) {
      console.log(`  ❌ Error: ${err.message}`);
    }
  }

  console.log('\n✅ Test complete!');
}

main();
