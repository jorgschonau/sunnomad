#!/usr/bin/env node

/**
 * Import Places from GeoNames TXT files
 * - tr_ma_tn_cities.txt (Cities: Tunisia, Morocco, Turkey)
 * 
 * Features:
 * - Duplicate check by (latitude, longitude, name)
 * - Missing columns = NULL
 * - feature_class & feature_code stored for later use
 * 
 * Run: node scripts/import-places-geonames.js
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const readline = require('readline');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const BATCH_SIZE = 500;
const FILES = [
  { path: './tr_ma_tn_cities.txt', type: 'cities' }
  // Only cities - no POIs for now
];

/**
 * GeoNames TSV Format:
 * 0: geonameid
 * 1: name
 * 2: asciiname
 * 3: alternatenames
 * 4: latitude
 * 5: longitude
 * 6: feature_class (P=populated place, H=water, T=mountain, L=parks, V=forest)
 * 7: feature_code (PPL=city, BAY=bay, MT=mountain, PK=peak, etc.)
 * 8: country_code
 * 9: cc2
 * 10-13: admin codes
 * 14: population
 * 15: elevation
 * 16: dem
 * 17: timezone
 * 18: modification date
 */

/**
 * Map GeoNames feature to valid place_type
 * Constraint allows: 'city', 'town', 'campground', 'beach', 'mountain', 'poi'
 */
function mapPlaceType(featureClass, featureCode, population) {
  // Cities/Towns based on population
  if (featureClass === 'P') {
    if (population > 100000) return 'city';
    if (population > 10000) return 'town';
    return 'town'; // Small settlements
  }
  
  // Water features
  if (featureClass === 'H') {
    return 'beach'; // Bays, beaches, lakes
  }
  
  // Mountains
  if (featureClass === 'T') {
    return 'mountain';
  }
  
  // Everything else
  return 'poi';
}

/**
 * Detect region from country code
 */
function detectRegion(countryCode) {
  const europe = ['AL','AD','AT','BY','BE','BA','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IS','IE','IT','XK','LV','LI','LT','LU','MT','MD','MC','ME','NL','MK','NO','PL','PT','RO','RU','SM','RS','SK','SI','ES','SE','CH','UA','GB','VA','TR','MA','TN','DZ']; // Added Turkey, Morocco, Tunisia, Algeria
  const northAmerica = ['US','CA','MX','GT','BZ','SV','HN','NI','CR','PA','DO','CU','HT','JM','PR','TT'];
  
  if (europe.includes(countryCode)) return 'europe';
  if (northAmerica.includes(countryCode)) return 'north_america';
  return 'other';
}

/**
 * Parse GeoNames line
 */
function parseLine(line, fileType) {
  const fields = line.split('\t');
  if (fields.length < 18) return null;
  
  const latitude = parseFloat(fields[4]);
  const longitude = parseFloat(fields[5]);
  const name = fields[1] || fields[2]; // Use asciiname if name is empty
  
  if (!name || isNaN(latitude) || isNaN(longitude)) return null;
  
  const region = detectRegion(fields[8]);
  
  // Only keep Europe + North America
  if (region === 'other') return null;
  
  const population = parseInt(fields[14]) || 0;
  
  return {
    geonames_id: parseInt(fields[0]) || null,
    name_en: name.substring(0, 200), // Limit to 200 chars
    latitude: latitude,
    longitude: longitude,
    country_code: fields[8] || null,
    region: region,
    place_type: mapPlaceType(fields[6], fields[7], population), // Required by CHECK constraint
    feature_class: fields[6] || null, // P, H, T, L, V
    feature_code: fields[7] || null, // PPL, BAY, MT, PK, etc.
    population: population,
    elevation: parseInt(fields[15]) || null,
    timezone: fields[17] || null,
    attractiveness_score: null, // User will calculate later
    is_active: true,
  };
}

/**
 * Filter out duplicates (manual check without UNIQUE constraint)
 */
async function filterDuplicates(batch) {
  if (batch.length === 0) return [];
  
  // Build OR query to check all places in batch
  const checks = batch.map(p => 
    `and(latitude.eq.${p.latitude},longitude.eq.${p.longitude},name_en.eq.${p.name_en.replace(/'/g, "''")})`
  );
  
  // Check in chunks (Supabase has URL length limit)
  const CHUNK_SIZE = 50;
  const existingPlaces = new Set();
  
  for (let i = 0; i < checks.length; i += CHUNK_SIZE) {
    const chunk = checks.slice(i, i + CHUNK_SIZE);
    const { data } = await supabase
      .from('places')
      .select('latitude,longitude,name_en')
      .or(chunk.join(','));
    
    if (data) {
      data.forEach(p => {
        existingPlaces.add(`${p.latitude},${p.longitude},${p.name_en}`);
      });
    }
  }
  
  // Filter out existing places
  return batch.filter(p => {
    const key = `${p.latitude},${p.longitude},${p.name_en}`;
    return !existingPlaces.has(key);
  });
}

/**
 * Import file
 */
async function importFile(filePath, fileType) {
  console.log(`\n📄 Importing: ${filePath}`);
  
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({ input: fileStream });
  
  let batch = [];
  let lineCount = 0;
  let processedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;
  
  for await (const line of rl) {
    lineCount++;
    
    try {
      const place = parseLine(line, fileType);
      
      if (!place) {
        skippedCount++;
        continue;
      }
      
      batch.push(place);
      
      if (batch.length >= BATCH_SIZE) {
        // Manual duplicate check (no UNIQUE constraint needed)
        const newPlaces = await filterDuplicates(batch);
        
        if (newPlaces.length > 0) {
          const { error } = await supabase
            .from('places')
            .insert(newPlaces);
          
          if (error) {
            console.error(`❌ Batch error:`, error.message);
            errorCount += newPlaces.length;
          } else {
            processedCount += newPlaces.length;
            console.log(`   ✅ ${processedCount.toLocaleString()} new places imported (${batch.length - newPlaces.length} duplicates skipped)...`);
          }
        } else {
          console.log(`   ⏭️  Batch skipped (all ${batch.length} were duplicates)`);
        }
        
        batch = [];
      }
    } catch (err) {
      console.error(`Line ${lineCount} error:`, err.message);
      errorCount++;
    }
  }
  
  // Insert remaining
  if (batch.length > 0) {
    const newPlaces = await filterDuplicates(batch);
    
    if (newPlaces.length > 0) {
      const { error } = await supabase
        .from('places')
        .insert(newPlaces);
      
      if (error) {
        console.error(`❌ Final batch error:`, error.message);
        errorCount += newPlaces.length;
      } else {
        processedCount += newPlaces.length;
      }
    }
  }
  
  console.log(`\n   📊 ${filePath} Summary:`);
  console.log(`      Lines read:    ${lineCount.toLocaleString()}`);
  console.log(`      Processed:     ${processedCount.toLocaleString()}`);
  console.log(`      Skipped:       ${skippedCount.toLocaleString()}`);
  console.log(`      Errors:        ${errorCount.toLocaleString()}`);
  
  return { processed: processedCount, skipped: skippedCount, errors: errorCount };
}

/**
 * Main
 */
async function main() {
  console.log('╔═══════════════════════════════════════════════════╗');
  console.log('║   Import Places from GeoNames                     ║');
  console.log('╚═══════════════════════════════════════════════════╝');
  
  let totalProcessed = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  
  for (const file of FILES) {
    const { processed, skipped, errors } = await importFile(file.path, file.type);
    totalProcessed += processed;
    totalSkipped += skipped;
    totalErrors += errors;
  }
  
  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║   Import Complete                                 ║');
  console.log('╚═══════════════════════════════════════════════════╝');
  console.log(`\n   ✅ Total imported: ${totalProcessed.toLocaleString()}`);
  console.log(`   ⏭️  Total skipped:  ${totalSkipped.toLocaleString()}`);
  console.log(`   ❌ Total errors:   ${totalErrors.toLocaleString()}`);
  
  // Final count
  const { count } = await supabase
    .from('places')
    .select('*', { count: 'exact', head: true });
  
  console.log(`\n   📍 Total places in DB: ${count?.toLocaleString() || 'unknown'}`);
  console.log('');
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
