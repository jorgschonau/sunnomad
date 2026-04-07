import { getPlacesWithWeather } from '../services/placesWeatherService';
import { filterDestinationsByCondition } from '../domain/weatherFilter';
import { getWeatherIcon, getWeatherColor, mapWeatherCode, mapWeatherMain } from '../domain/weatherPresentation';
import { calculateBadges } from '../domain/destinationBadge';

/**
 * Helper: Calculate distance between two points (Haversine formula)
 */
const getDistanceKm = (lat1, lon1, lat2, lon2) => {
  const R = 6371;
  const toRadians = (deg) => deg * (Math.PI / 180);
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

/**
 * Minimum distance from origin for budget badges, scaled by search radius.
 * At 2000 km radius, 40 km is too close to highlight.
 */
const getMinDistanceForBudget = (radius) => {
  if (radius <= 500) return 40;
  if (radius <= 1000) return 80;
  if (radius <= 2000) return 150;
  return 200;
};

const NORTH_AFRICA_CODES = new Set(['MA', 'DZ', 'TN', 'LY', 'EG']);

/**
 * Slight ranking bias for sunny conditions and destinations with other
 * positive badges (Spring Awakening, Weather Miracle, Sunny Streak, Beach Paradise).
 * Returns a multiplier >= 1.0 used to boost efficiency / temp in sorting.
 */
const POSITIVE_BADGE_DATA_KEYS = [
  '_springAwakeningData',
  '_weatherMiracleData',
  '_sunnyStreakData',
  '_beachParadiseData',
];

const getPositiveWeatherBias = (dest) => {
  let bonus = 1.0;
  if (dest.condition === 'sunny') bonus += 0.10;
  for (const key of POSITIVE_BADGE_DATA_KEYS) {
    if (dest[key]?.shouldAward) bonus += 0.06;
  }
  return bonus;
};

/**
 * Apply badge calculations to all destinations
 * Mutates destination objects by adding 'badges' array
 * Limits "Worth the Drive" badges to top 3 destinations only
 */
export const applyBadgesToDestinations = (destinations, originLocation, originLat, originLon, reverseMode = 'warm', radiusKm = 500) => {
  if (!destinations || !originLocation) return;
  
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.log(`🏆 applyBadgesToDestinations: ${destinations.length} destinations, origin: ${originLocation.name}, radius: ${radiusKm}km`);
  }
  // Pre-compute temperature rank map once (O(n log n)) instead of per-destination (O(n²))
  const sortedByTemp = destinations
    .filter(d => !d.isCurrentLocation)
    .sort((a, b) => (b.temperature ?? 0) - (a.temperature ?? 0));
  const tempRankMap = new Map(
    sortedByTemp.map((d, i) => [`${d.lat},${d.lon}`, i + 1])
  );

  destinations.forEach(dest => {
    if (dest.isCurrentLocation) {
      dest.badges = [];
      return;
    }
    if (!dest.distance) {
      dest.distance = getDistanceKm(originLat, originLon, dest.lat, dest.lon);
    }
    dest.badges = calculateBadges(dest, originLocation, dest.distance, tempRankMap, reverseMode, radiusKm);
  });

  // TEMPORARY: Strip WTD/Budget badges for Ukraine west of Moldova (~28°E)
  // TODO: Remove this block once the data quality / place density in that region improves
  const UKRAINE_BADGE_EXCLUSION = { minLat: 44, maxLat: 53, maxLon: 28 };
  destinations.forEach(dest => {
    const lat = dest.lat ?? dest.latitude;
    const lon = dest.lon ?? dest.longitude;
    const cc = (dest.country_code || dest.countryCode || '').toUpperCase();
    if (
      cc === 'UA' &&
      lat >= UKRAINE_BADGE_EXCLUSION.minLat && lat <= UKRAINE_BADGE_EXCLUSION.maxLat &&
      lon <= UKRAINE_BADGE_EXCLUSION.maxLon
    ) {
      dest.badges = dest.badges.filter(b => b !== 'WORTH_THE_DRIVE' && b !== 'WORTH_THE_DRIVE_BUDGET');
    }
  });

  // Limit certain badges to prevent overcrowding
  const MAX_WORTH_THE_DRIVE_BADGES = 5;
  const MAX_BUDGET_BADGES = 2;
  const MAX_WTD_PER_COUNTRY = 2; // Country diversity: max 2 WTD badges per country
  const MIN_BADGE_DISTANCE_KM = 60;
  const MIN_BUDGET_BADGE_DISTANCE_KM = 100; // Second budget badge must be ≥100km from first (geographic diversity)
  
  // Budget badge min distance from origin scales with radius (first: closer, second: farther)
  const baseMinBudget = getMinDistanceForBudget(radiusKm);
  const minDistanceFromOrigin1 = baseMinBudget * 0.7; // First badge: e.g. 28 km at 500 radius
  const minDistanceFromOrigin2 = baseMinBudget * 1.3; // Second badge: e.g. 52 km at 500 radius
  
  // "Worth the Drive Budget" - RANKING SYSTEM: Top 2 get the badge!
  // Award this FIRST before Worth the Drive. Second badge must be ≥100km from first and ≥ minDistanceFromOrigin2 from origin.
  const budgetCandidates = destinations
    .filter(d => !d.isCurrentLocation && d._worthTheDriveBudgetData?.isEligible)
    .sort((a, b) => {
      // Primary: efficiency, boosted by sunny / positive-badge bias
      const aEff = (a._worthTheDriveBudgetData?.efficiency || 0) * getPositiveWeatherBias(a);
      const bEff = (b._worthTheDriveBudgetData?.efficiency || 0) * getPositiveWeatherBias(b);
      const effDiff = bEff - aEff;
      if (Math.abs(effDiff) > 0.0005) return effDiff;
      // Tiebreaker 1: attractiveness score
      const aScore = a.attractivenessScore || a.attractiveness_score || 50;
      const bScore = b.attractivenessScore || b.attractiveness_score || 50;
      if (aScore !== bScore) return bScore - aScore;
      // Tiebreaker 2: closer distance wins
      return (a._worthTheDriveBudgetData?.distance || 9999) - (b._worthTheDriveBudgetData?.distance || 9999);
    });
  
  // DEBUG: Show top 10 candidates
  __DEV__ && console.log(`💰 DEBUG Budget Candidates (top 10 of ${budgetCandidates.length}):`);
  budgetCandidates.slice(0, 10).forEach((c, i) => {
    const data = c._worthTheDriveBudgetData;
    __DEV__ && console.log(`  ${i+1}. ${c.name}: eff=${data.efficiency.toFixed(4)}, temp=${c.temperature} °C, delta=+${data.tempDelta} °C, dist=${data.distance}km`);
  });
  
  // Count how many Worth the Drive candidates exist (before Budget steals them)
  const allWorthTheDriveCandidates = destinations
    .filter(d => !d.isCurrentLocation && d.badges.includes('WORTH_THE_DRIVE'));
  let remainingWTD = allWorthTheDriveCandidates.length;

  // Award badge to top 2 budget candidates: first = best with dist >= minDistanceFromOrigin1; second with dist >= minDistanceFromOrigin2 and ≥100km from first
  const selectedBudgetBadges = [];
  for (const candidate of budgetCandidates) {
    if (selectedBudgetBadges.length >= MAX_BUDGET_BADGES) break;
    
    const slotIndex = selectedBudgetBadges.length;
    const minDistFromOrigin = slotIndex === 0 ? minDistanceFromOrigin1 : minDistanceFromOrigin2;
    const distanceFromOrigin = candidate.distance ?? getDistanceKm(originLat, originLon, candidate.lat || candidate.latitude, candidate.lon || candidate.longitude);
    if (distanceFromOrigin < minDistFromOrigin) continue;
    
    const minDistFromBudget = slotIndex === 0 ? 0 : MIN_BUDGET_BADGE_DISTANCE_KM;
    const tooCloseBudget = selectedBudgetBadges.some(selected => {
      const dist = getDistanceKm(
        candidate.lat || candidate.latitude,
        candidate.lon || candidate.longitude,
        selected.lat || selected.latitude,
        selected.lon || selected.longitude
      );
      return dist < minDistFromBudget;
    });
    const tooClose = tooCloseBudget;
    
    if (!tooClose) {
      // Don't steal the last Worth the Drive candidate
      const hasWTD = candidate.badges.includes('WORTH_THE_DRIVE');
      if (hasWTD && remainingWTD <= 1) {
        __DEV__ && console.log(`💰 Skipped ${candidate.name} for Budget (would leave 0 Worth the Drive badges)`);
        continue;
      }

      // North Africa >1000km: never Budget, at most Worth the Drive
      // Only when a) destination in North Africa AND b) origin outside North Africa
      const destCc = (candidate.country_code || candidate.countryCode || '').toUpperCase();
      const originCc = (originLocation?.country_code || originLocation?.countryCode || '').toUpperCase();
      const destInNorthAfrica = NORTH_AFRICA_CODES.has(destCc);
      const originInNorthAfrica = originCc && NORTH_AFRICA_CODES.has(originCc);
      if (destInNorthAfrica && !originInNorthAfrica && distanceFromOrigin > 1000) {
        __DEV__ && console.log(`💰 Skipped ${candidate.name} for Budget (dest ${destCc} North Africa, origin outside, ${Math.round(distanceFromOrigin)}km > 1000km)`);
        continue;
      }

      candidate.badges.push('WORTH_THE_DRIVE_BUDGET');
      // REMOVE Worth the Drive if present (Budget is exclusive!)
      if (hasWTD) {
        candidate.badges = candidate.badges.filter(b => b !== 'WORTH_THE_DRIVE');
        remainingWTD--;
      }
      selectedBudgetBadges.push(candidate);
      __DEV__ && console.log(
        `💰 ${candidate.name}: Budget #${selectedBudgetBadges.length}! ` +
        `Efficiency: ${candidate._worthTheDriveBudgetData.efficiency.toFixed(3)} °C/km, ` +
        `Temp: +${candidate._worthTheDriveBudgetData.tempDelta} °C, ` +
        `Distance: ${candidate._worthTheDriveBudgetData.distance}km`
      );
    }
  }
  
  // Limit "Worth the Drive" to top 5 by temperature, with MIN 20km distance between badges
  // EXCLUDE destinations that already have Budget badge!
  const worthTheDriveCandidates = destinations
    .filter(d => !d.isCurrentLocation && d.badges.includes('WORTH_THE_DRIVE') && !d.badges.includes('WORTH_THE_DRIVE_BUDGET'))
    .sort((a, b) => {
      // Sort by temp, with sunny / positive-badge bias as effective bonus
      const aBias = getPositiveWeatherBias(a);
      const bBias = getPositiveWeatherBias(b);
      const aTemp = (a._worthTheDriveData?.tempDest || 0) * aBias;
      const bTemp = (b._worthTheDriveData?.tempDest || 0) * bBias;
      return reverseMode === 'cold' ? aTemp - bTemp : bTemp - aTemp;  // 'all' treated as 'warm' for badge ranking
    });
  
  // DEBUG: Show ALL Worth the Drive candidates (not just top 10)
  __DEV__ && console.log(`🚗 DEBUG Worth the Drive Candidates (${worthTheDriveCandidates.length} total):`);
  worthTheDriveCandidates.slice(0, 15).forEach((c, i) => {
    const data = c._worthTheDriveData;
    __DEV__ && console.log(`  ${i+1}. ${c.name}: temp=${data?.tempDest} °C, delta=+${data?.tempDelta} °C, value=${data?.value}, dist=${c.distance?.toFixed(0)}km`);
  });
  
  // Greedy selection: top candidates, min distance apart, max per country
  const selectedWorthBadges = [];
  const wtdCountryCounts = {};
  for (const candidate of worthTheDriveCandidates) {
    if (selectedWorthBadges.length >= MAX_WORTH_THE_DRIVE_BADGES) break;
    
    const candidateCc = (candidate.country_code || candidate.countryCode || '').toUpperCase();
    
    // Country diversity cap
    if (candidateCc && (wtdCountryCounts[candidateCc] || 0) >= MAX_WTD_PER_COUNTRY) {
      __DEV__ && console.log(`  ❌ Skipped (${candidateCc} has ${MAX_WTD_PER_COUNTRY} WTD): ${candidate.name}`);
      continue;
    }
    
    // Check distance to ALL selected badges (WTD + Budget)
    const allSelectedBadges = [...selectedWorthBadges, ...selectedBudgetBadges];
    const tooClose = allSelectedBadges.some(selected => {
      const dist = getDistanceKm(
        candidate.lat || candidate.latitude,
        candidate.lon || candidate.longitude,
        selected.lat || selected.latitude,
        selected.lon || selected.longitude
      );
      return dist < MIN_BADGE_DISTANCE_KM;
    });
    
    if (!tooClose) {
      selectedWorthBadges.push(candidate);
      if (candidateCc) wtdCountryCounts[candidateCc] = (wtdCountryCounts[candidateCc] || 0) + 1;
      __DEV__ && console.log(`  ✅ Selected: ${candidate.name} (${candidateCc} ${wtdCountryCounts[candidateCc]}/${MAX_WTD_PER_COUNTRY})`);
    } else {
      __DEV__ && console.log(`  ❌ Skipped (too close): ${candidate.name}`);
    }
  }
  
  // Remove badge from non-selected candidates
  worthTheDriveCandidates.forEach(dest => {
    if (!selectedWorthBadges.includes(dest)) {
      dest.badges = dest.badges.filter(b => b !== 'WORTH_THE_DRIVE');
    }
  });
  
  // Promote Budget → Worth the Drive when radius >500km, destination is far out
  // (>80% of radius), and no other WTD badges exist. A lone distant Budget
  // badge feels more like a road-trip recommendation than a budget tip.
  // Backfill: try to find a closer, non–North Africa replacement for the Budget badge.
  if (radiusKm > 500 && selectedWorthBadges.length === 0) {
    const threshold = radiusKm * 0.8;
    const originCc = (originLocation?.country_code || originLocation?.countryCode || '').toUpperCase();
    const originInNorthAfrica = originCc && NORTH_AFRICA_CODES.has(originCc);
    const promoted = [];

    for (const dest of selectedBudgetBadges) {
      const dist = dest.distance ?? dest._worthTheDriveBudgetData?.distance ?? 0;
      if (dist >= threshold) {
        dest.badges = dest.badges.filter(b => b !== 'WORTH_THE_DRIVE_BUDGET');
        dest.badges.push('WORTH_THE_DRIVE');
        promoted.push(dest);
        __DEV__ && console.log(
          `🚗💰 ${dest.name}: Budget → Worth the Drive (dist ${Math.round(dist)}km ≥ ${Math.round(threshold)}km threshold, no other WTD badges)`
        );
      }
    }

    // Backfill Budget: find closer replacement(s), not in North Africa when origin outside
    const remainingBudget = selectedBudgetBadges.filter(b => !promoted.includes(b));
    const minDistFromOrigin = baseMinBudget * 0.7;
    for (const _ of promoted) {
      const replacement = budgetCandidates.find(c => {
        if (c.badges.includes('WORTH_THE_DRIVE_BUDGET') || promoted.includes(c)) return false;
        const cDist = c.distance ?? c._worthTheDriveBudgetData?.distance ?? 9999;
        if (cDist >= threshold) return false;
        if (cDist < minDistFromOrigin) return false;
        const cc = (c.country_code || c.countryCode || '').toUpperCase();
        if (!originInNorthAfrica && NORTH_AFRICA_CODES.has(cc)) return false;
        const tooClose = remainingBudget.some(r => {
          const d = getDistanceKm(c.lat || c.latitude, c.lon || c.longitude, r.lat || r.latitude, r.lon || r.longitude);
          return d < MIN_BUDGET_BADGE_DISTANCE_KM;
        });
        return !tooClose;
      });
      if (replacement) {
        replacement.badges.push('WORTH_THE_DRIVE_BUDGET');
        if (replacement.badges.includes('WORTH_THE_DRIVE')) {
          replacement.badges = replacement.badges.filter(b => b !== 'WORTH_THE_DRIVE');
        }
        remainingBudget.push(replacement);
        const data = replacement._worthTheDriveBudgetData;
        __DEV__ && console.log(
          `💰 ${replacement.name}: Budget backfill (closer ${Math.round(data?.distance ?? replacement.distance ?? 0)}km, replacing promoted)`
        );
      }
    }
  }
  
  // Helper: Score by temp + attractiveness
  const getScore = (d, tempAsc = false) => {
    const temp = d.temperature || 0;
    const attr = d.attractivenessScore || d.attractiveness_score || 0;
    return (tempAsc ? -temp : temp) + attr * 0.5;
  };
  
  const MAX_OTHER_BADGES = 10;
  
  // Limit Beach Paradise: max 10, by temp + attractiveness
  const beachCandidates = destinations
    .filter(d => d.badges?.includes('BEACH_PARADISE'))
    .sort((a, b) => getScore(b) - getScore(a));
  if (beachCandidates.length > MAX_OTHER_BADGES) {
    beachCandidates.slice(MAX_OTHER_BADGES).forEach(d => {
      d.badges = d.badges.filter(b => b !== 'BEACH_PARADISE');
    });
  }
  
  // Limit Sunny Streak: max 10, by temp + attractiveness + 20km apart
  const MIN_SUNNY_DISTANCE_KM = 20;
  let sunnyCandidates = destinations
    .filter(d => d.badges?.includes('SUNNY_STREAK'))
    .sort((a, b) => getScore(b) - getScore(a));
  
  // Select top 10 with minimum distance
  const selectedSunny = [];
  for (const candidate of sunnyCandidates) {
    if (selectedSunny.length >= MAX_OTHER_BADGES) break;
    
    const tooClose = selectedSunny.some(sel => {
      const dist = getDistanceKm(
        candidate.lat || candidate.latitude,
        candidate.lon || candidate.longitude,
        sel.lat || sel.latitude,
        sel.lon || sel.longitude
      );
      return dist < MIN_SUNNY_DISTANCE_KM;
    });
    
    if (!tooClose) {
      selectedSunny.push(candidate);
    }
  }
  
  // Remove badge from all non-selected
  sunnyCandidates.forEach(d => {
    if (!selectedSunny.includes(d)) {
      d.badges = d.badges.filter(b => b !== 'SUNNY_STREAK');
    }
  });
  
  __DEV__ && console.log(`☀️ Sunny Streak: ${sunnyCandidates.length} → ${selectedSunny.length} (max 10, min 20km apart)`);
  
  // Limit Snow King: max 10 total, max 3 per country, sorted by score (60% snow + 40% cold)
  const MAX_SNOW_PER_COUNTRY = 3;
  const snowCandidates = destinations
    .filter(d => d.badges?.includes('SNOW_KING'))
    .sort((a, b) => (b._snowKingData?.score || 0) - (a._snowKingData?.score || 0)); // By score (snow 60% + cold 40%)
  
  // Select max 10, with max 3 per country
  const selectedSnow = [];
  const countryCount = {};
  
  for (const candidate of snowCandidates) {
    if (selectedSnow.length >= MAX_OTHER_BADGES) break;
    
    const country = candidate._snowKingData?.country || candidate.country || candidate.countryCode || 'unknown';
    countryCount[country] = (countryCount[country] || 0);
    
    if (countryCount[country] < MAX_SNOW_PER_COUNTRY) {
      selectedSnow.push(candidate);
      countryCount[country]++;
    }
  }
  
  // Remove badge from non-selected
  snowCandidates.forEach(d => {
    if (!selectedSnow.includes(d)) {
      d.badges = d.badges.filter(b => b !== 'SNOW_KING');
    }
  });
  
  __DEV__ && console.log(`⛄ Snow King: ${snowCandidates.length} → ${selectedSnow.length} (max 10, max 3/country, by score)`);
  
  // Limit Warm & Dry: max 10, by warmest temperature
  const warmDryCandidates = destinations
    .filter(d => d.badges?.includes('WARM_AND_DRY'))
    .sort((a, b) => (b.temperature || 0) - (a.temperature || 0)); // Warmest first
  if (warmDryCandidates.length > MAX_OTHER_BADGES) {
    warmDryCandidates.slice(MAX_OTHER_BADGES).forEach(d => {
      d.badges = d.badges.filter(b => b !== 'WARM_AND_DRY');
    });
  }
  
  // UK/IE: Strip Budget + Worth the Drive from GB/IE destinations when origin is outside UK/Ireland
  const UK_IE_CODES = new Set(['GB', 'IE']);
  const getCc = (p) => (p?.country_code || p?.countryCode || '').toUpperCase().slice(0, 2);
  const originCc = getCc(originLocation);
  const originInUKIreland = originCc && UK_IE_CODES.has(originCc);
  if (!originInUKIreland) {
    destinations.forEach(d => {
      if (d.isCurrentLocation || d.isCenterPoint) return;
      const destCc = getCc(d);
      if (UK_IE_CODES.has(destCc)) {
        const had = d.badges?.length ?? 0;
        d.badges = (d.badges || []).filter(b => b !== 'WORTH_THE_DRIVE' && b !== 'WORTH_THE_DRIVE_BUDGET');
        if (d.badges.length < had && __DEV__) {
          console.log(`🇬🇧 Stripped ${d.name} (${destCc}): no Budget/WTD when origin outside UK/IE (origin: ${originCc || 'unknown'})`);
        }
      }
    });
  }

  const destWithBadges = destinations.filter(d => d.badges && d.badges.length > 0);
  const totalBadges = destWithBadges.reduce((sum, d) => sum + d.badges.length, 0);
  const worthCount = destinations.filter(d => d.badges?.includes('WORTH_THE_DRIVE')).length;
  const budgetCount = destinations.filter(d => d.badges?.includes('WORTH_THE_DRIVE_BUDGET')).length;
  const warmDryCount = destinations.filter(d => d.badges?.includes('WARM_AND_DRY')).length;
  const beachCount = destinations.filter(d => d.badges?.includes('BEACH_PARADISE')).length;
  const sunnyCount = destinations.filter(d => d.badges?.includes('SUNNY_STREAK')).length;
  const miracleCount = destinations.filter(d => d.badges?.includes('WEATHER_MIRACLE')).length;
  const heatwaveCount = destinations.filter(d => d.badges?.includes('HEATWAVE')).length;
  const snowCount = destinations.filter(d => d.badges?.includes('SNOW_KING')).length;
  
  __DEV__ && console.log(
    `🏆 Awarded ${totalBadges} badges to ${destWithBadges.length} destinations:\n` +
    `  💰 Budget: ${budgetCount}/${budgetCandidates.length} (TOP 1 ONLY)\n` +
    `  🚗 Worth: ${worthCount}/${worthTheDriveCandidates.length} (max 3, min 20km apart)\n` +
    `  ☀️ Warm&Dry: ${warmDryCount}/${warmDryCandidates.length} (max 10, warmest)\n` +
    `  🌊 Beach: ${beachCount}/${beachCandidates.length} (max 10)\n` +
    `  ☀️ Sunny: ${sunnyCount}/${sunnyCandidates.length} (max 10)\n` +
    `  🌈 Miracle: ${miracleCount} (unlimited)\n` +
    `  🔥 Heatwave: ${heatwaveCount} (unlimited)\n` +
    `  ⛄ Snow: ${snowCount}/${snowCandidates.length} (max 10, max 3/country)`
  );
};

/**
 * Use-case: get destinations for a radius, optionally filtered by desiredCondition.
 * Badges are NOT applied here - MapScreen's displayDestinations useEffect handles that
 * with the correct date offset.
 * @param locale - Locale for translations (e.g. 'de', 'en')
 */
export const getWeatherForRadius = async (userLat, userLon, radiusKm, desiredCondition = null, originTemp = null, locale = 'en', reverseMode = 'warm') => {
  // Fetch real places with weather data from Supabase (always from today, date offset applied client-side)
  const { places, error } = await getPlacesWithWeather({
    userLat,
    userLon,
    radiusKm,
    locale,
  });

  if (error) {
    console.error('Failed to load places from Supabase:', error);
    return [];
  }

  __DEV__ && console.log(`📍 Loaded ${places.length} places from Supabase`);

  // Apply condition filter if specified
  let filteredPlaces = desiredCondition 
    ? filterDestinationsByCondition(places, desiredCondition)
    : places;

  __DEV__ && console.log(`🔍 After filter: ${filteredPlaces.length} places`);
  
  // Limit markers from small/distant countries if user is NOT in these countries
  // This prevents Caribbean islands etc. from flooding the map
  const SMALL_COUNTRIES = ['CU', 'DO', 'JM', 'HT', 'LU', 'MT', 'CY', 'TN', 'MA'];
  const MAX_PER_SMALL_COUNTRY = 3;
  
  // Find user's country from the closest place
  const closestPlace = filteredPlaces.find(p => p.distance !== undefined && p.distance < 50);
  const userCountry = closestPlace?.country_code || closestPlace?.countryCode || null;
  
  // Only apply limit if user is NOT in one of the small countries
  if (!SMALL_COUNTRIES.includes(userCountry)) {
    const smallCountryCount = {};
    filteredPlaces = filteredPlaces.filter(place => {
      const placeCountry = place.country_code || place.countryCode || '';
      
      // Not a small country? Keep it
      if (!SMALL_COUNTRIES.includes(placeCountry)) return true;
      
      // Small country - check limit
      smallCountryCount[placeCountry] = (smallCountryCount[placeCountry] || 0) + 1;
      return smallCountryCount[placeCountry] <= MAX_PER_SMALL_COUNTRY;
    });
    
    const limitedCount = Object.values(smallCountryCount).reduce((sum, c) => sum + Math.min(c, MAX_PER_SMALL_COUNTRY), 0);
    __DEV__ && console.log(`🏝️ Limited small countries (${SMALL_COUNTRIES.join(', ')}) to max ${MAX_PER_SMALL_COUNTRY} each: ${limitedCount} markers`);
  }

  // HÖHERE LIMITS - mehr Orte auf der Karte!
  let MAX_PLACES_ON_MAP;
  if (radiusKm <= 400) {
    MAX_PLACES_ON_MAP = 1500;
  } else if (radiusKm <= 800) {
    MAX_PLACES_ON_MAP = 2500;
  } else if (radiusKm <= 1500) {
    MAX_PLACES_ON_MAP = 4000;
  } else {
    MAX_PLACES_ON_MAP = 8000;
  }
  
  // Sort by relevance (mode-aware: warm = hottest first, cold = coldest first)
  filteredPlaces.sort((a, b) => {
    // 1. Attractiveness Score (höher = besser)
    const aScore = a.attractivenessScore || a.attractiveness_score || 50;
    const bScore = b.attractivenessScore || b.attractiveness_score || 50;
    if (aScore !== bScore) return bScore - aScore;
    
    // 2. Temperatur (warm = hottest first, cold = coldest first, all = skip)
    if (reverseMode !== 'all') {
      const aTemp = a.temperature || 0;
      const bTemp = b.temperature || 0;
      if (Math.abs(aTemp - bTemp) > 3) return reverseMode === 'cold' ? aTemp - bTemp : bTemp - aTemp;
    }
    
    // 3. Distanz (näher = besser)
    const aDist = a.distance || Infinity;
    const bDist = b.distance || Infinity;
    return aDist - bDist;
  });

  if (filteredPlaces.length > MAX_PLACES_ON_MAP) {
    __DEV__ && console.log(`⚡ Limiting to ${MAX_PLACES_ON_MAP} places for radius ${radiusKm}km (sorted by attractiveness)`);
    filteredPlaces = filteredPlaces.slice(0, MAX_PLACES_ON_MAP);
  }

  // Badges are applied in MapScreen's displayDestinations useEffect
  // (with correct date offset and shifted weather data).
  // No need to pre-calculate here - it would be overwritten anyway.

  return filteredPlaces;
};

// Re-export so UI imports only from usecases
export { getWeatherIcon, getWeatherColor, mapWeatherCode, mapWeatherMain };



