require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkCities() {
  console.log('🔍 Checking for Vancouver and Seattle...\n');

  // Check Vancouver
  const { data: vancouver } = await supabase
    .from('places_with_latest_weather')
    .select('id, name, latitude, longitude, temperature, weather_description, population, attractiveness_score')
    .ilike('name', '%vancouver%')
    .limit(5);

  console.log('🇨🇦 Vancouver:');
  if (vancouver && vancouver.length > 0) {
    vancouver.forEach(p => {
      console.log(`   ✅ ${p.name}: ${p.temperature} °C, Pop: ${p.population?.toLocaleString() || 'N/A'}, Score: ${p.attractiveness_score}`);
    });
  } else {
    console.log('   ❌ Not found!');
  }

  console.log('');

  // Check Seattle
  const { data: seattle } = await supabase
    .from('places_with_latest_weather')
    .select('id, name, latitude, longitude, temperature, weather_description, population, attractiveness_score')
    .ilike('name', '%seattle%')
    .limit(5);

  console.log('🇺🇸 Seattle:');
  if (seattle && seattle.length > 0) {
    seattle.forEach(p => {
      console.log(`   ✅ ${p.name}: ${p.temperature} °C, Pop: ${p.population?.toLocaleString() || 'N/A'}, Score: ${p.attractiveness_score}`);
    });
  } else {
    console.log('   ❌ Not found!');
  }
}

checkCities();
