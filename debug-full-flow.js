require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// Center point in North America (roughly middle US)
const USER_LAT = 45.0;
const USER_LON = -95.0;
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
  console.log(`\n📍 Center: ${USER_LAT}, ${USER_LON}`);
  console.log(`📏 Radius: ${RADIUS_KM}km\n`);

  const bbox = getBoundingBox(USER_LAT, USER_LON, RADIUS_KM);
  console.log(`📦 Bounding Box: Lat [${bbox.latMin.toFixed(2)}, ${bbox.latMax.toFixed(2)}], Lon [${bbox.lonMin.toFixed(2)}, ${bbox.lonMax.toFixed(2)}]\n`);

  // Check Vancouver and Seattle
  const vancouverLat = 49.2827, vancouverLon = -123.1207;
  const seattleLat = 47.6062, seattleLon = -122.3321;
  
  const vancouverDist = getDistanceKm(USER_LAT, USER_LON, vancouverLat, vancouverLon);
  const seattleDist = getDistanceKm(USER_LAT, USER_LON, seattleLat, seattleLon);
  
  console.log(`🇨🇦 Vancouver: ${vancouverDist.toFixed(0)}km away`);
  console.log(`🇺🇸 Seattle: ${seattleDist.toFixed(0)}km away\n`);
  
  // Step 1: Check if they're in the DB query
  console.log('STEP 1: Checking bounding box query...');
  
  const PAGE_SIZE = 1000;
  const MAX_PAGES = 50;
  let allData = [];
  let page = 0;
  let foundVancouver = false;
  let foundSeattle = false;
  
  while (page < MAX_PAGES && (!foundVancouver || !foundSeattle)) {
    const { data: pageData } = await supabase
      .from('places_with_latest_weather')
      .select('id, name_en, latitude, longitude, population, attractiveness_score, country_code')
      .gte('latitude', bbox.latMin)
      .lte('latitude', bbox.latMax)
      .gte('longitude', bbox.lonMin)
      .lte('longitude', bbox.lonMax)
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    
    if (pageData && pageData.length > 0) {
      allData = allData.concat(pageData);
      
      const van = pageData.find(p => p.name_en.toLowerCase().includes('vancouver'));
      const sea = pageData.find(p => p.name_en.toLowerCase().includes('seattle'));
      
      if (van) {
        foundVancouver = true;
        console.log(`   ✅ Vancouver found in page ${page + 1}: Pop ${van.population?.toLocaleString()}, Score ${van.attractiveness_score}`);
      }
      if (sea) {
        foundSeattle = true;
        console.log(`   ✅ Seattle found in page ${page + 1}: Pop ${sea.population?.toLocaleString()}, Score ${sea.attractiveness_score}`);
      }
      
      page++;
      
      if (page % 10 === 0) {
        console.log(`   ... Page ${page}: ${allData.length} places total`);
      }
    } else {
      break;
    }
  }
  
  console.log(`\n   Total fetched: ${allData.length} places across ${page} pages`);
  console.log(`   Vancouver in DB query? ${foundVancouver ? '✅' : '❌'}`);
  console.log(`   Seattle in DB query? ${foundSeattle ? '✅' : '❌'}\n`);
  
  if (!foundVancouver || !foundSeattle) {
    console.log('❌ Cities not in bounding box query - they are outside the radius!\n');
    return;
  }
  
  // Step 2: Check filtering by distance
  console.log('STEP 2: Filtering by actual distance...');
  
  const filtered = allData
    .map(p => ({
      ...p,
      distance: getDistanceKm(USER_LAT, USER_LON, p.latitude, p.longitude),
    }))
    .filter(p => p.distance <= RADIUS_KM);
  
  const vancouverFiltered = filtered.find(p => p.name_en.toLowerCase().includes('vancouver'));
  const seattleFiltered = filtered.find(p => p.name_en.toLowerCase().includes('seattle'));
  
  console.log(`   Total after distance filter: ${filtered.length} places`);
  console.log(`   Vancouver after filter? ${vancouverFiltered ? '✅' : '❌'}`);
  console.log(`   Seattle after filter? ${seattleFiltered ? '✅' : '❌'}\n`);
  
  // Step 3: Check sectoring (geographic sampling)
  console.log('STEP 3: Geographic sampling (16 sectors)...');
  
  const sectors = {};
  filtered.forEach(place => {
    const dLon = (place.longitude - USER_LON) * Math.PI / 180;
    const lat1 = USER_LAT * Math.PI / 180;
    const lat2 = place.latitude * Math.PI / 180;
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    const bearing = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    const sector = Math.floor((bearing + 11.25) / 22.5) % 16;
    
    place.sector = sector;
    place.bearing = bearing;
    
    if (!sectors[sector]) sectors[sector] = [];
    sectors[sector].push(place);
  });
  
  const vancouverSector = vancouverFiltered?.sector;
  const seattleSector = seattleFiltered?.sector;
  
  console.log(`   Vancouver in sector: ${vancouverSector} (${sectors[vancouverSector]?.length || 0} places total)`);
  console.log(`   Seattle in sector: ${seattleSector} (${sectors[seattleSector]?.length || 0} places total)\n`);
  
  // Step 4: Check if they make it through sector sampling
  const MAX_PER_SECTOR = 500;
  let balancedPlaces = [];
  
  for (let s = 0; s < 16; s++) {
    if (sectors[s]) {
      const topPlaces = sectors[s]
        .sort((a, b) => {
          const scoreDiff = (b.attractiveness_score || 50) - (a.attractiveness_score || 50);
          if (scoreDiff !== 0) return scoreDiff;
          const popDiff = (b.population || 0) - (a.population || 0);
          if (popDiff !== 0) return popDiff;
          return a.distance - b.distance;
        })
        .slice(0, MAX_PER_SECTOR);
      balancedPlaces = balancedPlaces.concat(topPlaces);
    }
  }
  
  const vancouverFinal = balancedPlaces.find(p => p.name_en.toLowerCase().includes('vancouver'));
  const seattleFinal = balancedPlaces.find(p => p.name_en.toLowerCase().includes('seattle'));
  
  console.log(`STEP 4: After sector sampling (${balancedPlaces.length} places):`);
  console.log(`   Vancouver in final result? ${vancouverFinal ? '✅' : '❌'}`);
  console.log(`   Seattle in final result? ${seattleFinal ? '✅' : '❌'}\n`);
  
  if (vancouverFinal) {
    const sectorPlaces = sectors[vancouverSector];
    const vancouverRank = sectorPlaces
      .sort((a, b) => {
        const scoreDiff = (b.attractiveness_score || 50) - (a.attractiveness_score || 50);
        if (scoreDiff !== 0) return scoreDiff;
        return (b.population || 0) - (a.population || 0);
      })
      .findIndex(p => p.name_en === vancouverFinal.name_en) + 1;
    console.log(`   Vancouver rank in sector ${vancouverSector}: #${vancouverRank}/${sectorPlaces.length}`);
  }
  
  if (seattleFinal) {
    const sectorPlaces = sectors[seattleSector];
    const seattleRank = sectorPlaces
      .sort((a, b) => {
        const scoreDiff = (b.attractiveness_score || 50) - (a.attractiveness_score || 50);
        if (scoreDiff !== 0) return scoreDiff;
        return (b.population || 0) - (a.population || 0);
      })
      .findIndex(p => p.name_en === seattleFinal.name_en) + 1;
    console.log(`   Seattle rank in sector ${seattleSector}: #${seattleRank}/${sectorPlaces.length}`);
  }
}

debug();
