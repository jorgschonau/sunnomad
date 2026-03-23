import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const SKIP_IF_EXISTS = ['US', 'GB', 'IE'];

const shortenStateName = (name) => {
  if (!name) return null;
  return name
    .replace('Autonomous Community of the ', '')
    .replace('Autonomous Community of ', '')
    .replace('Autonomous Region of the ', '')
    .replace('Autonomous Region of ', '')
    .replace('Region of the ', '')
    .replace('Region of ', '')
    .replace('Province of the ', '')
    .replace('Province of ', '')
    .replace('State of the ', '')
    .replace('State of ', '')
    .replace('County of the ', '')
    .replace('County of ', '')
    .replace(/^the /, '')
    .trim();
};

const getStateName = async (lat, lon) => {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&addressdetails=1`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'SunNomad/1.0 hola@sunnomad.com',
        'Accept-Language': 'en'
      }
    });
    const data = await res.json();
    const addr = data.address;
    const raw = addr.state || addr.province || addr.region || addr.county || null;
    return shortenStateName(raw);
  } catch (e) {
    console.error(`Error for ${lat},${lon}:`, e.message);
    return null;
  }
};

const run = async () => {
  const { data: places, error } = await supabase
    .from('places')
    .select('id, name, latitude, longitude, country_code, state_name')
    .eq('is_active', true)
    .order('id');

  if (error) {
    console.error('Supabase error:', error);
    return;
  }

  const toProcess = places.filter(p => {
    if (SKIP_IF_EXISTS.includes(p.country_code) && p.state_name) return false;
    return true;
  });

  console.log(`Processing ${toProcess.length} of ${places.length} places...`);

  let success = 0;
  let failed = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const place = toProcess[i];
    const stateName = await getStateName(place.latitude, place.longitude);

    if (stateName) {
      await supabase
        .from('places')
        .update({ state_name: stateName })
        .eq('id', place.id);
      success++;
      console.log(`✅ [${i+1}/${toProcess.length}] ${place.name} (${place.country_code}): ${stateName}`);
    } else {
      failed++;
      console.log(`⚠️ [${i+1}/${toProcess.length}] ${place.name}: no state found`);
    }

    await sleep(1100);
  }

  console.log(`\nDone! ✅ ${success} updated, ⚠️ ${failed} skipped`);
};

run();