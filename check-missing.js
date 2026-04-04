require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkMissing() {
  console.log('🔍 Checking missing weather data...\n');

  // Get places without weather data
  const { data: placesWithoutWeather, error } = await supabase
    .from('places')
    .select('id, name_en, latitude, longitude, country_code')
    .eq('is_active', true)
    .is('last_weather_fetch', null)
    .limit(20);

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log(`Found ${placesWithoutWeather.length} places without weather (showing first 20):\n`);
  
  placesWithoutWeather.forEach((p, i) => {
    console.log(`${i + 1}. ${p.name_en} (${p.country_code}) - ID: ${p.id.substring(0, 8)}`);
  });

  // Count by country
  const { data: byCountry } = await supabase
    .from('places')
    .select('country_code')
    .eq('is_active', true)
    .is('last_weather_fetch', null);

  const countryStats = {};
  byCountry.forEach(p => {
    countryStats[p.country_code] = (countryStats[p.country_code] || 0) + 1;
  });

  console.log('\n📊 Missing by country:');
  Object.entries(countryStats)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .forEach(([cc, count]) => {
      console.log(`   ${cc}: ${count} places`);
    });

  console.log(`\n🔧 Total missing: ${byCountry.length} places`);
}

checkMissing();
