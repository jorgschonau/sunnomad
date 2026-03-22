#!/usr/bin/env node

/**
 * Enrich user-search places with GeoNames metadata.
 *
 * Finds places with source='user_search' that have no feature_code yet,
 * looks them up via GeoNames findNearbyPlaceName API, and updates
 * population, elevation, dem, feature_class, feature_code, place_type, is_island.
 *
 * GeoNames free tier: 1000 req/hour, 30000/day.
 * Script is safe to re-run — only touches un-enriched rows.
 *
 * Setup: register free account at https://www.geonames.org/login
 *        then enable web services at https://www.geonames.org/manageaccount
 *
 * Run:   GEONAMES_USER=your_username node scripts/enrich-user-places.js
 *   or:  add GEONAMES_USER to .env
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!serviceKey) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY is required (bypasses RLS for updates).\n   Find it in Supabase Dashboard → Settings → API → service_role key');
  process.exit(1);
}
const supabase = createClient(process.env.SUPABASE_URL, serviceKey);
const GEONAMES_USER = process.env.GEONAMES_USER;
const BATCH_SIZE = 50;
const DELAY_MS = 800; // Delay between API calls (~3 calls per place)

if (!GEONAMES_USER) {
  console.error('❌ GEONAMES_USER env var is required.\n   Register free at https://www.geonames.org/login');
  process.exit(1);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function mapPlaceType(featureClass, featureCode, population) {
  if (featureClass === 'P') {
    if (population > 500000) return 'large_city';
    if (population > 100000) return 'city';
    if (population > 30000) return 'medium_city';
    if (population > 5000) return 'town';
    if (population > 1000) return 'small_town';
    return 'village';
  }
  if (featureClass === 'T') return 'mountain';
  if (featureClass === 'H') return 'beach';
  if (featureClass === 'L') return 'natural_park';
  if (featureClass === 'S' && featureCode === 'CMPG') return 'campground';
  return 'poi';
}

async function fetchGeoNames(name, lat, lng, countryCode) {
  // 1. Search by name + country for exact match (style=FULL gives all fields)
  const nameEnc = encodeURIComponent(name);
  const countryParam = countryCode ? `&country=${countryCode}` : '';
  const searchUrl = `http://api.geonames.org/searchJSON?name=${nameEnc}${countryParam}&lat=${lat}&lng=${lng}&radius=50&maxRows=5&style=FULL&username=${GEONAMES_USER}`;
  const res = await fetch(searchUrl);
  const json = await res.json();

  if (json.status) {
    console.warn(`   ⚠️  GeoNames error: ${json.status.message}`);
    return null;
  }

  // Pick the closest match by distance to our coordinates
  let place = null;
  if (json.geonames?.length) {
    place = json.geonames.reduce((best, p) => {
      const dist = Math.abs(p.lat - lat) + Math.abs(p.lng - lng);
      const bestDist = best ? Math.abs(best.lat - lat) + Math.abs(best.lng - lng) : Infinity;
      return dist < bestDist ? p : best;
    }, null);
  }

  // 2. Fallback: nearest place by coordinates
  if (!place) {
    const nearbyUrl = `http://api.geonames.org/findNearbyPlaceNameJSON?lat=${lat}&lng=${lng}&radius=20&maxRows=1&style=FULL&username=${GEONAMES_USER}`;
    const nearbyRes = await fetch(nearbyUrl);
    const nearbyJson = await nearbyRes.json();
    place = nearbyJson.geonames?.[0];
    await sleep(DELAY_MS);
  }

  if (!place) return null;

  // 3. DEM elevation (separate endpoint)
  let dem = parseInt(place.astergdem) || parseInt(place.srtm3) || null;
  if (!dem) {
    try {
      const demRes = await fetch(`http://api.geonames.org/srtm3JSON?lat=${lat}&lng=${lng}&username=${GEONAMES_USER}`);
      const demJson = await demRes.json();
      if (demJson.srtm3 && demJson.srtm3 > 0) dem = demJson.srtm3;
    } catch (_) { /* non-critical */ }
    await sleep(DELAY_MS);
  }

  // 4. Check if place is on an island (look for ISL feature nearby)
  let isIsland = false;
  try {
    const nearbyFeatUrl = `http://api.geonames.org/findNearbyJSON?lat=${lat}&lng=${lng}&featureCode=ISL&featureCode=ISLS&radius=15&maxRows=1&username=${GEONAMES_USER}`;
    const islandRes = await fetch(nearbyFeatUrl);
    const islandJson = await islandRes.json();
    isIsland = (islandJson.geonames?.length || 0) > 0;
  } catch (_) { /* non-critical */ }

  return {
    population: parseInt(place.population) || 0,
    elevation: parseInt(place.elevation) || null,
    dem,
    feature_class: place.fcl || null,
    feature_code: place.fcode || null,
    country_code: place.countryCode || null,
    is_island: isIsland,
    timezone: place.timezone?.timeZoneId || null,
  };
}

async function main() {
  console.log('╔═══════════════════════════════════════════════════╗');
  console.log('║   Enrich User-Search Places via GeoNames          ║');
  console.log('╚═══════════════════════════════════════════════════╝\n');

  const force = process.argv.includes('--force');
  let query = supabase
    .from('places')
    .select('id, name, latitude, longitude, country_code')
    .eq('source', 'user_search')
    .order('created_at', { ascending: false })
    .limit(500);

  if (!force) query = query.is('feature_code', null);
  else console.log('⚡ --force mode: re-enriching ALL user_search places\n');

  const { data: places, error } = await query;

  if (error) {
    console.error('❌ DB query failed:', error.message);
    process.exit(1);
  }

  if (!places?.length) {
    console.log('✅ No un-enriched user_search places found. Nothing to do.');
    return;
  }

  console.log(`📍 Found ${places.length} places to enrich.\n`);

  let enriched = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < places.length; i += BATCH_SIZE) {
    const batch = places.slice(i, i + BATCH_SIZE);
    console.log(`📦 Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(places.length / BATCH_SIZE)} (${batch.length} places)...`);

    for (const place of batch) {
      try {
        const geo = await fetchGeoNames(place.name, place.latitude, place.longitude, place.country_code);

        if (!geo) {
          console.log(`   ⏭️  ${place.name}: no GeoNames match`);
          await supabase.from('places').update({ feature_code: 'UNKNOWN' }).eq('id', place.id);
          skipped++;
        } else {
          const placeType = mapPlaceType(geo.feature_class, geo.feature_code, geo.population);
          const { error: updateError } = await supabase
            .from('places')
            .update({
              population: geo.population,
              elevation: geo.elevation,
              dem: geo.dem,
              feature_class: geo.feature_class,
              feature_code: geo.feature_code,
              place_type: placeType,
              is_island: geo.is_island,
              timezone: geo.timezone,
              country_code: place.country_code || geo.country_code,
            })
            .eq('id', place.id);

          if (updateError) {
            console.log(`   ❌ ${place.name}: update failed — ${updateError.message}`);
            errors++;
          } else {
            const extras = [
              geo.is_island ? '🏝️' : null,
              geo.dem ? `${geo.dem}m` : null,
            ].filter(Boolean).join(' ');
            console.log(`   ✅ ${place.name}: ${placeType}, pop=${geo.population}, dem=${geo.dem || '?'} ${extras}`);
            enriched++;
          }
        }

        await sleep(DELAY_MS);
      } catch (e) {
        console.log(`   ❌ ${place.name}: ${e.message}`);
        errors++;
      }
    }
  }

  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║   Summary                                         ║');
  console.log('╚═══════════════════════════════════════════════════╝\n');
  console.log(`  ✅ Enriched: ${enriched}`);
  console.log(`  ⏭️  Skipped:  ${skipped}`);
  console.log(`  ❌ Errors:   ${errors}`);
  console.log(`\n💡 Run calculate_attractiveness.sql afterwards to update scores.\n`);
}

main().catch(e => {
  console.error('❌ Fatal:', e);
  process.exit(1);
});
