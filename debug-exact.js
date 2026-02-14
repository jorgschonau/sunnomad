require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// 200km north of Vancouver
const vancouverLat = 49.2827, vancouverLon = -123.1207;
const USER_LAT = vancouverLat + (200 / 111.32); // ~51.08°N
const USER_LON = vancouverLon; // Same longitude
const RADIUS_KM = 2000;

function getDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRadians = (deg) => deg * (Math.PI / 180);
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function debug() {
  console.log(`\n📍 Center: ${USER_LAT.toFixed(4)}, ${USER_LON.toFixed(4)} (200km north of Vancouver)`);
  console.log(`📏 Radius: ${RADIUS_KM}km\n`);

  const seattleLat = 47.6062, seattleLon = -122.3321;
  
  const vancouverDist = getDistanceKm(USER_LAT, USER_LON, vancouverLat, vancouverLon);
  const seattleDist = getDistanceKm(USER_LAT, USER_LON, seattleLat, seattleLon);
  
  console.log(`🇨🇦 Vancouver: ${vancouverDist.toFixed(0)}km from center (should be ~200km)`);
  console.log(`🇺🇸 Seattle: ${seattleDist.toFixed(0)}km from center\n`);
  
  if (vancouverDist > RADIUS_KM) {
    console.log(`❌ Vancouver is OUTSIDE radius (${vancouverDist.toFixed(0)} > ${RADIUS_KM})!\n`);
    return;
  }
  if (seattleDist > RADIUS_KM) {
    console.log(`❌ Seattle is OUTSIDE radius (${seattleDist.toFixed(0)} > ${RADIUS_KM})!\n`);
    return;
  }
  
  console.log('✅ Both cities are INSIDE radius!\n');
  
  // Check if they exist in places_with_latest_weather view
  console.log('Checking places_with_latest_weather view...');
  
  const { data: vanData } = await supabase
    .from('places_with_latest_weather')
    .select('*')
    .ilike('name', '%vancouver%');
  
  const { data: seaData } = await supabase
    .from('places_with_latest_weather')
    .select('*')
    .ilike('name', '%seattle%');
  
  console.log(`   Vancouver entries: ${vanData?.length || 0}`);
  if (vanData && vanData.length > 0) {
    vanData.forEach(v => {
      console.log(`     - ${v.name}: ${v.temperature} °C, Pop: ${v.population?.toLocaleString()}, Score: ${v.attractiveness_score}`);
    });
  }
  
  console.log(`   Seattle entries: ${seaData?.length || 0}`);
  if (seaData && seaData.length > 0) {
    seaData.forEach(s => {
      console.log(`     - ${s.name}: ${s.temperature} °C, Pop: ${s.population?.toLocaleString()}, Score: ${s.attractiveness_score}`);
    });
  }
}

debug();
