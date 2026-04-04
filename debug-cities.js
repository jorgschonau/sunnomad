require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// Your location from screenshot (roughly center of North America)
const USER_LAT = 52.52;  // Berlin area from first screenshot
const USER_LON = 13.4;
const RADIUS_KM = 2000;

function getBoundingBox(lat, lon, radiusKm) {
  const latDelta = Math.min(89.9, radiusKm / 111.32);
  const lonMultiplier = Math.max(Math.cos(lat * Math.PI / 180), 0.1);
  const lonDelta = Math.min(179.9, radiusKm / (111.32 * lonMultiplier));

  return {
    latMin: lat - latDelta,
    latMax: lat + latDelta,
    lonMin: lon - lonDelta,
    lonMax: lon + lonDelta,
  };
}

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
  console.log(`📍 User Location: ${USER_LAT}, ${USER_LON}`);
  console.log(`📏 Radius: ${RADIUS_KM}km\n`);

  // Calculate bounding box
  const bbox = getBoundingBox(USER_LAT, USER_LON, RADIUS_KM);
  console.log(`📦 Bounding Box:`);
  console.log(`   Lat: [${bbox.latMin.toFixed(2)}, ${bbox.latMax.toFixed(2)}]`);
  console.log(`   Lon: [${bbox.lonMin.toFixed(2)}, ${bbox.lonMax.toFixed(2)}]\n`);

  // Check if Vancouver and Seattle are in bounding box
  const vancouverLat = 49.2827, vancouverLon = -123.1207;
  const seattleLat = 47.6062, seattleLon = -122.3321;
  
  const vancouverDist = getDistanceKm(USER_LAT, USER_LON, vancouverLat, vancouverLon);
  const seattleDist = getDistanceKm(USER_LAT, USER_LON, seattleLat, seattleLon);
  
  console.log(`📍 Vancouver Distance: ${vancouverDist.toFixed(0)}km`);
  console.log(`📍 Seattle Distance: ${seattleDist.toFixed(0)}km\n`);
  
  const vancouverInBbox = vancouverLat >= bbox.latMin && vancouverLat <= bbox.latMax && 
                          vancouverLon >= bbox.lonMin && vancouverLon <= bbox.lonMax;
  const seattleInBbox = seattleLat >= bbox.latMin && seattleLat <= bbox.latMax &&
                        seattleLon >= bbox.lonMin && seattleLon <= bbox.lonMax;
  
  console.log(`📦 Vancouver in bounding box? ${vancouverInBbox ? '✅' : '❌'}`);
  console.log(`📦 Seattle in bounding box? ${seattleInBbox ? '✅' : '❌'}\n`);
  
  // Query DB with bounding box
  const { data: places, error } = await supabase
    .from('places_with_latest_weather')
    .select('name_en, latitude, longitude, population, attractiveness_score')
    .gte('latitude', bbox.latMin)
    .lte('latitude', bbox.latMax)
    .gte('longitude', bbox.lonMin)
    .lte('longitude', bbox.lonMax)
    .ilike('name_en', '%vancouver%');
  
  console.log(`🔍 Query for Vancouver in bbox:`);
  if (places && places.length > 0) {
    places.forEach(p => console.log(`   ✅ ${p.name_en}`));
  } else {
    console.log(`   ❌ Not found in bounding box query!`);
  }
}

debug();
