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

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const GEONAMES_USER = process.env.GEONAMES_USER;
const BATCH_SIZE = 50;
const DELAY_MS = 1200; // ~50 req/min, well within free tier

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

async function fetchGeoNames(lat, lng) {
  const url = `http://api.geonames.org/findNearbyPlaceNameJSON?lat=${lat}&lng=${lng}&radius=10&maxRows=1&username=${GEONAMES_USER}`;
  const res = await fetch(url);
  const json = await res.json();

  if (json.status) {
    console.warn(`   ⚠️  GeoNames error: ${json.status.message}`);
    return null;
  }

  const place = json.geonames?.[0];
  if (!place) return null;

  return {
    population: parseInt(place.population) || 0,
    elevation: parseInt(place.elevation) || null,
    dem: parseInt(place.astergdem) || parseInt(place.srtm3) || null,
    feature_class: place.fclName ? place.fcl : null,
    feature_code: place.fcode || null,
    country_code: place.countryCode || null,
  };
}

async function main() {
  console.log('╔═══════════════════════════════════════════════════╗');
  console.log('║   Enrich User-Search Places via GeoNames          ║');
  console.log('╚═══════════════════════════════════════════════════╝\n');

  // Find un-enriched user_search places
  const { data: places, error } = await supabase
    .from('places')
    .select('id, name, latitude, longitude, country_code')
    .eq('source', 'user_search')
    .is('feature_code', null)
    .order('created_at', { ascending: false })
    .limit(500);

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
        const geo = await fetchGeoNames(place.latitude, place.longitude);

        if (!geo) {
          console.log(`   ⏭️  ${place.name}: no GeoNames match`);
          // Mark as checked so we don't retry forever
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
              country_code: place.country_code || geo.country_code,
            })
            .eq('id', place.id);

          if (updateError) {
            console.log(`   ❌ ${place.name}: update failed — ${updateError.message}`);
            errors++;
          } else {
            console.log(`   ✅ ${place.name}: ${placeType}, pop=${geo.population}, dem=${geo.dem || '?'}`);
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
