/** Only log in dev to avoid blocking UI when calculating many badges */
const devLog = (...args) => { if (typeof __DEV__ !== 'undefined' && __DEV__) console.log(...args); };

const ROAD_FACTOR = 1.35;

/**
 * Badge types that can be awarded to destinations
 * based on various criteria
 */
export const DestinationBadge = {
  WORTH_THE_DRIVE: 'WORTH_THE_DRIVE', // Best weather gain per km/hour
  WORTH_THE_DRIVE_BUDGET: 'WORTH_THE_DRIVE_BUDGET', // Good weather, closer distance (budget-friendly)
  WARM_AND_DRY: 'WARM_AND_DRY', // Max warm with acceptable weather/wind/night conditions
  BEACH_PARADISE: 'BEACH_PARADISE', // Coastal location with perfect beach weather
  SUNNY_STREAK: 'SUNNY_STREAK', // 3+ days of sunshine in a row (stable good weather)
  WEATHER_MIRACLE: 'WEATHER_MIRACLE', // Place transforms from bad to great weather (today bad → tomorrow sunny!)
  HEATWAVE: 'HEATWAVE', // 3+ days >32 °C with no rain
  SNOW_KING: 'SNOW_KING', // Reliable snow conditions - perfect for skiing
  RAINY_DAYS: 'RAINY_DAYS', // 3+ rainy days with at least 1 heavy rain
  WEATHER_CURSE: 'WEATHER_CURSE', // Good weather now but will turn bad soon
  SPRING_AWAKENING: 'SPRING_AWAKENING', // Perfect spring weather (March 1 - May 15)
};

/**
 * Badge metadata for display
 */
export const BadgeMetadata = {
  [DestinationBadge.WORTH_THE_DRIVE_BUDGET]: {
    icon: '💰',
    color: '#4CAF50', // Green (budget-friendly)
    priority: 1,
  },
  [DestinationBadge.WORTH_THE_DRIVE]: {
    icon: '🚗',
    color: '#FFD700', // Gold
    priority: 1, // Same as Budget (mutually exclusive)
  },
  [DestinationBadge.WARM_AND_DRY]: {
    icon: require('../../assets/warmanddry.png'),
    color: '#FF6B35', // Orange-red
    priority: 2,
    excludeFromTrophy: true, // Show on map, but don't count for trophy filter
  },
  [DestinationBadge.BEACH_PARADISE]: {
    icon: '🌊',
    color: '#00BCD4', // Cyan/Turquoise
    priority: 3,
  },
  [DestinationBadge.HEATWAVE]: {
    icon: require('../../assets/heatwave.png'),
    color: '#FF5722', // Red/Orange
    priority: 4,
    excludeFromTrophy: true, // Warning badge, but still combinable with WTD/Budget
  },
  [DestinationBadge.WEATHER_MIRACLE]: {
    icon: '🌈',
    color: '#E91E63', // Pink (dramatic!)
    priority: 5,
    excludeFromTrophy: true, // Show on map, but don't count for trophy filter
  },
  [DestinationBadge.SUNNY_STREAK]: {
    icon: '☀️',
    color: '#FFA726', // Orange (sunny!)
    priority: 6,
    excludeFromTrophy: true, // Show on map, but don't count for trophy filter
  },
  [DestinationBadge.SNOW_KING]: {
    icon: '⛄',
    color: '#2196F3', // Blue (winter cold)
    priority: 7,
    excludeFromTrophy: true, // Show on map, but don't count for trophy filter
  },
  [DestinationBadge.RAINY_DAYS]: {
    icon: '🌧️',
    color: '#607D8B', // Gray-blue
    priority: 8,
    excludeFromTrophy: true, // Show on map, but don't count for trophy filter
  },
  [DestinationBadge.WEATHER_CURSE]: {
    icon: '⛈️',
    color: '#37474F', // Dark gray (storm cloud)
    priority: 9,
    excludeFromTrophy: true, // Show on map, but don't count for trophy filter
  },
  [DestinationBadge.SPRING_AWAKENING]: {
    icon: '🐇', // Bunny for spring
    color: '#7ED957', // Fresh spring green
    priority: 10,
    excludeFromTrophy: true,
  },
};

/**
 * Calculate a balanced weather score from current conditions
 * Combines multiple factors: temperature comfort, condition quality, stability, wind
 * 
 * @param {Object} destination - Destination with weather data
 * @returns {number} - Score 0-100
 */
export function calculateWeatherScore(destination) {
  if (!destination) return 0;

  // Temperature comfort: optimal around 20-25 °C
  const temp = destination.temperature ?? 15;
  const tempScore = Math.max(0, 100 - Math.abs(temp - 22) * 3); // Peaks at 22 °C

  // Condition quality
  const conditionScores = {
    sunny: 100,
    cloudy: 60,
    windy: 50,
    rainy: 20,
    snowy: 30,
  };
  const conditionScore = conditionScores[destination.condition] ?? 50;

  // Stability (already 0-100)
  const stabilityScore = destination.stability ?? 50;

  // Wind penalty: Higher wind = worse
  const windSpeed = destination.windSpeed ?? 10;
  const windScore = Math.max(0, 100 - windSpeed * 2); // Penalize >25 km/h heavily

  // Balanced weighted average
  const score = (
    tempScore * 0.35 +
    conditionScore * 0.30 +
    stabilityScore * 0.20 +
    windScore * 0.15
  );

  return Math.round(Math.max(0, Math.min(100, score)));
}

/**
 * Calculate ETA in hours based on road distance
 * Assumes average speed of 80 km/h (highway driving)
 * Callers should pass road distance (straight-line * ROAD_FACTOR)
 * 
 * @param {number} roadDistanceKm - Road distance in kilometers
 * @returns {number} - ETA in hours
 */
export function calculateETA(roadDistanceKm) {
  const AVERAGE_SPEED_KMH = 80;
  const eta = roadDistanceKm / AVERAGE_SPEED_KMH;
  return Math.max(0.5, eta);
}

/**
 * Get weather score at a specific ETA window
 * For now, uses current weather since we don't have hourly forecasts
 * 
 * @param {Object} destination - Destination with weather data
 * @param {number} eta - ETA in hours
 * @returns {number} - Weather score at that time
 */
export function getWeatherScoreAtETA(destination, eta) {
  // For now, use current weather
  return calculateWeatherScore(destination);
}

/**
 * Check if weather deteriorates significantly in the next 2-3 days
 * Returns true if average temp drops by more than threshold
 * 
 * @param {Object} destination - Destination with forecast data
 * @param {number} threshold - Max allowed temp drop (default 4 °C)
 * @returns {Object} - { isDeteriorating, avgTempDrop }
 */
export function checkWeatherDeterioration(destination, threshold = 4) {
  const currentTemp = destination.temperature ?? 0;
  const forecast = destination.forecast;
  
  if (!forecast) {
    console.log(`⚠️ ${destination.name}: No forecast data for deterioration check`);
    return { isDeteriorating: false, avgTempDrop: 0 };
  }
  
  // Get temps for tomorrow, day2, and day3 (use all available)
  const tomorrowTemp = forecast.tomorrow?.temp ?? forecast.tomorrow?.high ?? null;
  const day2Temp = forecast.day2?.temp ?? forecast.day2?.high ?? null;
  const day3Temp = forecast.day3?.temp ?? forecast.day3?.high ?? null;
  
  // Collect all available future temps
  const futureTemps = [tomorrowTemp, day2Temp, day3Temp].filter(t => t !== null);
  
  if (futureTemps.length === 0) {
    console.log(`⚠️ ${destination.name}: No future temps in forecast`);
    return { isDeteriorating: false, avgTempDrop: 0 };
  }
  
  // Calculate average future temp
  const avgFutureTemp = futureTemps.reduce((sum, t) => sum + t, 0) / futureTemps.length;
  const avgTempDrop = currentTemp - avgFutureTemp;
  
  // Also check the minimum (worst case)
  const minFutureTemp = Math.min(...futureTemps);
  const maxTempDrop = currentTemp - minFutureTemp;
  
  // Deteriorating if AVERAGE drops by more than threshold
  const isDeteriorating = avgTempDrop > threshold;
  
  console.log(`🌡️ ${destination.name}: Deterioration check - ` +
    `Today: ${currentTemp} °C, Future avg: ${avgFutureTemp.toFixed(1)} °C (min: ${minFutureTemp} °C), ` +
    `Drop: ${avgTempDrop.toFixed(1)} °C (max: ${maxTempDrop.toFixed(1)} °C) → ${isDeteriorating ? '❌ DETERIORATING' : '✓ OK'}`
  );
  
  return {
    isDeteriorating,
    avgTempDrop: Math.round(avgTempDrop * 10) / 10,
    maxTempDrop: Math.round(maxTempDrop * 10) / 10,
    currentTemp: Math.round(currentTemp),
    avgFutureTemp: Math.round(avgFutureTemp * 10) / 10,
    minFutureTemp: Math.round(minFutureTemp),
  };
}

/**
 * Calculate "Worth the Drive" value score
 * 
 * @param {Object} destination - Destination to evaluate
 * @param {Object} origin - User's current location with weather data
 * @param {number} distanceKm - Distance in km
 * @returns {Object} - { value, delta, eta, weatherDest, weatherOrigin, shouldAward }
 */
const UK_IE_CODES = new Set(['GB', 'IE']);
const cc = (place) => (place?.country_code || place?.countryCode || '').toUpperCase();

export function calculateWorthTheDrive(destination, origin, distanceKm, reverseMode = 'warm') {
  const isColdMode = reverseMode === 'cold';
  const roadDistanceKm = distanceKm * ROAD_FACTOR;
  const destCc = cc(destination);
  const originCc = cc(origin);
  if (UK_IE_CODES.has(destCc) && !UK_IE_CODES.has(originCc)) {
    return { value: 0, delta: 0, eta: 0, weatherDest: 0, weatherOrigin: 0, tempDest: 0, tempOrigin: 0, tempDelta: 0, shouldAward: false, rankScore: 0, roadDistanceKm: Math.round(roadDistanceKm) };
  }
  const eta = calculateETA(roadDistanceKm);
  
  // Get weather scores at the same absolute time window (ETA from now)
  const weatherDest = getWeatherScoreAtETA(destination, eta);
  const weatherOrigin = getWeatherScoreAtETA(origin, eta);
  
  const badgeBoost = 
    destination.badges?.includes(DestinationBadge.SUNNY_STREAK) ? 8 :
    destination.badges?.includes(DestinationBadge.WEATHER_MIRACLE) ? 10 :
    destination.badges?.includes(DestinationBadge.WARM_AND_DRY) ? 5 : 0;
  const boostedWeatherDest = Math.min(weatherDest + badgeBoost, 100);
  
  const delta = weatherDest - weatherOrigin;
  
  // Temperature check: In warm mode destination MUST be warmer, in cold mode COLDER
  const tempDest = destination.temperature ?? 0;
  const tempOrigin = origin.temperature ?? 0;
  const tempDelta = tempDest - tempOrigin; // positive = warmer, negative = colder
  
  // Value = weather gain per hour of travel
  // In cold mode, use absolute temp delta (colder = more value)
  const effectiveDelta = isColdMode ? Math.abs(tempDelta) : delta;
  const value = effectiveDelta / (eta + 0.75); // +0.75 penalty factor
  
  // Gating criteria
  const MIN_WEATHER_SCORE = 
    tempDelta >= 6 ? 45 :
    tempDest >= 20 ? 50 :
    60;
  const MIN_DELTA = 3; // Weather score must be at least slightly better than origin
  const MIN_VALUE = 1.5; // Must have reasonable value per hour
  const MIN_DISTANCE_KM = 30; // Must be at least 30km away (otherwise not "worth the drive")
  
  let shouldAward;
  if (isColdMode) {
    // Cold mode: reward places that are COLDER
    const MIN_TEMP_DELTA_COLD = 4; // Destination must be colder (-4 °C minimum)
    const MAX_TEMP_ABSOLUTE = 30; // Destination must NOT be too hot
    shouldAward = (
      distanceKm >= MIN_DISTANCE_KM &&
      (-tempDelta) >= MIN_TEMP_DELTA_COLD && // Actually colder (tempDelta is negative)
      tempDest <= MAX_TEMP_ABSOLUTE // Not scorching hot
    );
  } else {
    // Warm mode (default): reward places that are WARMER
    // Sunny destinations get slightly relaxed thresholds (leichte Bias)
    const isSunny = destination.condition === 'sunny';
    const MIN_TEMP_ABSOLUTE = 4; // Destination must be at least 4 °C (not freezing!)
    const MIN_TEMP_DELTA = isSunny ? 3 : 4;
    shouldAward = (
      distanceKm >= MIN_DISTANCE_KM &&
      boostedWeatherDest >= MIN_WEATHER_SCORE &&
      delta >= (isSunny ? 2 : MIN_DELTA) &&
      value >= (isSunny ? 1.2 : MIN_VALUE) &&
      tempDest >= MIN_TEMP_ABSOLUTE &&
      tempDelta >= MIN_TEMP_DELTA
    );
  }
  
  // Final ranking score (for sorting multiple candidates)
  const rankScore = isColdMode 
    ? Math.abs(tempDelta) * 1.0 + (100 - weatherDest) * 0.02 // Colder + worse weather = more extreme
    : value * 1.0 + weatherDest * 0.02; // Tie-breaker favors better weather
  
  return {
    value: Math.round(value * 10) / 10,
    delta: Math.round(delta),
    eta: Math.round(eta * 10) / 10,
    weatherDest: Math.round(weatherDest),
    weatherOrigin: Math.round(weatherOrigin),
    tempDest: Math.round(tempDest),
    tempOrigin: Math.round(tempOrigin),
    tempDelta: Math.round(tempDelta),
    shouldAward,
    rankScore,
    roadDistanceKm: Math.round(roadDistanceKm),
  };
}

/**
 * Calculate "Worth the Drive Budget" efficiency score
 * RANKING SYSTEM: Best temp gain per km distance
 * Only the TOP 1 destination gets the badge!
 * 
 * @param {Object} destination - Destination to evaluate
 * @param {Object} origin - User's current location
 * @param {number} distanceKm - Distance in km
 * @param {string} reverseMode - 'warm' or 'cold'
 * @param {number|null} radius - Search radius in km (used for max distance cap)
 * @returns {Object} - { efficiency, tempDelta, distance, tempDest, eta, delta, value }
 */
export function calculateWorthTheDriveBudget(destination, origin, distanceKm, reverseMode = 'warm', radius = null) {
  const isColdMode = reverseMode === 'cold';
  const roadDistanceKm = distanceKm * ROAD_FACTOR;
  const destCc = cc(destination);
  const originCc = cc(origin);
  if (UK_IE_CODES.has(destCc) && !UK_IE_CODES.has(originCc)) {
    const eta = calculateETA(roadDistanceKm);
    return { efficiency: 0, tempDelta: 0, tempDest: 0, tempOrigin: 0, distance: Math.round(distanceKm), roadDistanceKm: Math.round(roadDistanceKm), eta: Math.round(eta * 10) / 10, delta: 0, value: 0, isEligible: false };
  }
  const tempDest = destination.temperature ?? 0;
  const tempOrigin = origin.temperature ?? 0;
  const tempDelta = tempDest - tempOrigin;
  
  const eta = calculateETA(roadDistanceKm);
  
  const weatherDest = calculateWeatherScore(destination);
  const weatherOrigin = calculateWeatherScore(origin);
  const delta = weatherDest - weatherOrigin;
  
  const MIN_DISTANCE = 1;
  const MIN_DISTANCE_KM = 30; // straight-line check
  
  let isEligible;
  if (isColdMode) {
    const MIN_TEMP_DELTA_COLD = 3;
    const MAX_TEMP_ABSOLUTE = 30;
    isEligible = distanceKm >= MIN_DISTANCE_KM && (-tempDelta) >= MIN_TEMP_DELTA_COLD && tempDest <= MAX_TEMP_ABSOLUTE;
  } else {
    const isSunny = destination.condition === 'sunny';
    const MIN_TEMP_DELTA = isSunny ? 2 : 3;
    const MIN_TEMP_ABSOLUTE = 10;
    isEligible = distanceKm >= MIN_DISTANCE_KM && tempDelta >= MIN_TEMP_DELTA && tempDest >= MIN_TEMP_ABSOLUTE;
  }
  
  if (isEligible && radius != null) {
    const MAX_BUDGET_DISTANCE = radius * 0.5;
    if (roadDistanceKm > MAX_BUDGET_DISTANCE) {
      const effectiveTempDelta = isColdMode ? Math.abs(tempDelta) : tempDelta;
      const efficiency = effectiveTempDelta / Math.max(roadDistanceKm, MIN_DISTANCE);
      const value = effectiveTempDelta / (roadDistanceKm / 100);
      return {
        efficiency: Math.round(efficiency * 1000) / 1000,
        tempDelta: Math.round(tempDelta),
        tempDest: Math.round(tempDest),
        tempOrigin: Math.round(tempOrigin),
        distance: Math.round(distanceKm),
        roadDistanceKm: Math.round(roadDistanceKm),
        eta: Math.round(eta * 10) / 10,
        delta: Math.round(delta),
        value: Math.round(value * 10) / 10,
        isEligible: false,
        skipReason: 'Too far for budget badge',
      };
    }
  }

  const effectiveTempDelta = isColdMode ? Math.abs(tempDelta) : tempDelta;
  const efficiency = effectiveTempDelta / Math.max(roadDistanceKm, MIN_DISTANCE);
  const value = effectiveTempDelta / (roadDistanceKm / 100);
  
  return {
    efficiency: Math.round(efficiency * 1000) / 1000,
    tempDelta: Math.round(tempDelta),
    tempDest: Math.round(tempDest),
    tempOrigin: Math.round(tempOrigin),
    distance: Math.round(distanceKm),
    roadDistanceKm: Math.round(roadDistanceKm),
    eta: Math.round(eta * 10) / 10,
    delta: Math.round(delta),
    value: Math.round(value * 10) / 10,
    isEligible,
  };
}

/**
 * Calculate "Warm & Dry" eligibility
 * Awards badge to warmest destinations with good conditions (no rain, low wind)
 * NOW CHECKS FORECAST: Must be dry for at least 2 out of next 3 days!
 * 
 * @param {Object} destination - Destination to evaluate
 * @param {Array} allDestinations - All destinations for comparison
 * @returns {Object} - { isWarm, isDry, isCalm, shouldAward, tempRank }
 */
export function calculateWarmAndDry(destination, tempRankMap) {
  const temp = destination.temperature ?? 0;
  const condition = destination.condition ?? 'unknown';
  const windSpeed = destination.windSpeed ?? 0;
  const precipitation = destination.precipitation ?? 0;
  const forecast = destination.forecast;
  
  // Criteria - seasonal temperature threshold
  const month = new Date().getMonth() + 1;
  let MIN_TEMP;
  if (month >= 6 && month <= 8) MIN_TEMP = 28;      // Jun–Aug: >= 28 °C
  else if (month === 5 || month === 9) MIN_TEMP = 22; // May, Sep: >= 22 °C
  else MIN_TEMP = 20;                                 // All other months: >= 20 °C
  const MAX_WIND = 30; // Max wind speed in km/h
  const MAX_PRECIPITATION = 2; // Max 2mm precipitation
  const BAD_CONDITIONS = ['rainy', 'snowy']; // Conditions that disqualify
  
  // Check today's conditions
  const isWarm = temp >= MIN_TEMP;
  const isPrecipitationLow = precipitation < MAX_PRECIPITATION;
  const isTodayDry = !BAD_CONDITIONS.includes(condition);
  const isCalm = windSpeed <= MAX_WIND;
  
  // Helper to check if a day is rainy
  const isDayRainy = (dayForecast) => {
    if (!dayForecast) return false;
    const dayCondition = (dayForecast.condition || '').toLowerCase();
    const dayDesc = (dayForecast.description || '').toLowerCase();
    return dayCondition === 'rainy' || 
           dayCondition === 'snowy' ||
           dayDesc.includes('rain') || 
           dayDesc.includes('drizzle') ||
           dayDesc.includes('thunder') ||
           dayDesc.includes('snow');
  };
  
  // Check forecast for next 3 days - must be mostly dry!
  let forecastRainyDays = 0;
  
  if (forecast) {
    // Forecast structure: { today, tomorrow, day2, day3 }
    if (isDayRainy(forecast.today)) forecastRainyDays++;
    if (isDayRainy(forecast.tomorrow)) forecastRainyDays++;
    if (isDayRainy(forecast.day2)) forecastRainyDays++;
    if (isDayRainy(forecast.day3)) forecastRainyDays++;
  }
  
  // Must have max 1 rainy day in forecast (3 out of 4 dry)
  const isForecastDry = forecastRainyDays <= 1;
  const isDry = isTodayDry && isForecastDry;
  
  // O(1) rank lookup from pre-computed map (built once in applyBadgesToDestinations)
  const tempRank = tempRankMap?.get(`${destination.lat},${destination.lon}`) ?? 999;
  
  // Award to destinations that meet the criteria (limited to top 10 warmest in usecases)
  const shouldAward = isWarm && isDry && isCalm && isPrecipitationLow;
  
  return {
    isWarm,
    isDry,
    isCalm,
    isPrecipitationLow,
    isForecastDry,
    forecastRainyDays,
    shouldAward,
    tempRank,
    temp,
    precipitation,
    windSpeed,
    condition,
    threshold: MIN_TEMP,
  };
}

/**
 * Calculate "Beach Paradise" eligibility
 * Perfect beach weather: warm, sunny, light wind
 * 
 * @param {Object} destination - Destination to evaluate
 * @returns {Object} - { shouldAward, temp, condition, windSpeed }
 */
export function calculateBeachParadise(destination) {
  const temp = destination.temperature ?? 0;
  const condition = destination.condition ?? 'unknown';
  const windSpeed = destination.windSpeed ?? 0;
  const placeType = destination.place_type || destination.place_category || '';
  
  // ONLY beaches get this badge!
  const isBeach = placeType === 'beach';
  
  // Perfect beach criteria
  const MIN_TEMP = 20;
  const MAX_TEMP = 35;
  const GOOD_CONDITIONS = ['sunny', 'cloudy'];
  const MAX_WIND = 25;
  
  const shouldAward = (
    isBeach && // MUST be place_type = 'beach'!
    temp >= MIN_TEMP &&
    temp <= MAX_TEMP &&
    GOOD_CONDITIONS.includes(condition) &&
    windSpeed <= MAX_WIND
  );
  
  return {
    shouldAward,
    isBeach,
    temp,
    condition,
    windSpeed,
  };
}

/**
 * Calculate "Sunny Streak" eligibility
 * 3+ days of sunshine (simple: today + forecast)
 *
 * @param {Object} destination - Destination with forecast data
 * @returns {Object} - { shouldAward, streakLength, avgTemp, sunshineHours, condition, temp }
 */
export function calculateSunnyStreak(destination) {
  const currentCondition = destination.condition ?? 'unknown';
  const sunshineDuration = destination.sunshine_duration ?? 0;
  const temp = destination.temperature ?? 0;

  const MIN_TEMP = 10;
  const MIN_SUNSHINE_SECONDS = 28800; // 8 hours (Open-Meteo: sunshine_duration in seconds)
  // Count sunny days from forecastArray[0..4] — exactly what the UI shows (5 forecast slots)
  const arr = destination.forecastArray || [];
  const slots = [arr[0], arr[1], arr[2], arr[3], arr[4]];
  const sunnySlots = slots.filter(s => s?.condition === 'sunny');
  const sunnyDays = sunnySlots.length;
  const streakLength = sunnyDays;

  const isWarmEnough = temp >= MIN_TEMP;
  // When sunshine_duration available: require 8+ h. When 0/null: trust 3+ sunny days.
  const hasLongSunshine = sunshineDuration >= MIN_SUNSHINE_SECONDS || (sunshineDuration <= 0 && sunnyDays >= 3);

  // Avg temp only from sunny days in those 5 slots
  const temps = sunnySlots.map(s => s.high ?? s.temp ?? temp);
  const avgTemp = temps.length > 0 ? Math.round(temps.reduce((a, b) => a + b, 0) / temps.length) : Math.round(temp);

  const shouldAward = sunnyDays >= 3 && isWarmEnough && hasLongSunshine;
  const sunshineHours = Math.round(sunshineDuration / 3600 * 10) / 10;

  return {
    shouldAward,
    streakLength,
    avgTemp,
    sunshineHours,
    condition: currentCondition,
    temp,
  };
}

/**
 * Calculate "Weather Miracle" eligibility
 * Place transforms from bad weather today to great weather tomorrow/future
 * 
 * @param {Object} destination - Destination with forecast data
 * @returns {Object} - { shouldAward, todayCondition, futureCondition, tempGain }
 */
export function calculateWeatherMiracle(destination) {
  const todayCondition = destination.condition ?? 'unknown';
  const todayTemp = destination.temperature ?? 0;
  const forecast = destination.forecast;
  
  if (!forecast) {
    return { shouldAward: false };
  }
  
  // Check for transformation: bad today → sunny tomorrow/day3
  const BAD_CONDITIONS = ['rainy', 'snowy', 'windy'];
  const isBadToday = BAD_CONDITIONS.includes(todayCondition);
  
  const tomorrowSunny = forecast.tomorrow?.condition === 'sunny';
  const day3Sunny = forecast.day3?.condition === 'sunny';
  
  const tomorrowTemp = forecast.tomorrow?.temp ?? todayTemp;
  const day3Temp = forecast.day3?.temp ?? todayTemp;
  const futureTempMax = Math.max(tomorrowTemp, day3Temp);
  const tempGain = futureTempMax - todayTemp;
  
  // Badge criteria: bad today AND sunny future AND warmer
  const MIN_TEMP_GAIN = 5; // Must get warmer by at least 5 °C
  const shouldAward = (
    isBadToday &&
    (tomorrowSunny || day3Sunny) &&
    tempGain >= MIN_TEMP_GAIN
  );
  
  return {
    shouldAward,
    todayCondition,
    todayTemp,
    futureCondition: tomorrowSunny ? 'sunny (tomorrow)' : 'sunny (day 3)',
    futureTempMax,
    tempGain,
  };
}

/**
 * Calculate "Heatwave" eligibility
 * 3+ days above 34 °C with no rain
 * 
 * @param {Object} destination - Destination with forecast data
 * @returns {Object} - { shouldAward, hotDays, maxTemp }
 */
export function calculateHeatwave(destination) {
  const currentTemp = destination.temperature ?? 0;
  const currentCondition = destination.condition ?? 'unknown';
  const forecast = destination.forecast;
  
  const MIN_HEATWAVE_TEMP = 34; // Minimum temperature for heatwave
  
  // Check for rain conditions
  const hasRain = currentCondition === 'rainy' || 
                  forecast?.today?.condition === 'rainy' ||
                  forecast?.tomorrow?.condition === 'rainy' ||
                  forecast?.day3?.condition === 'rainy';
  
  let hotDays = currentTemp >= MIN_HEATWAVE_TEMP ? 1 : 0;
  let maxTemp = currentTemp;
  
  if (forecast) {
    if (forecast.today?.high >= MIN_HEATWAVE_TEMP) hotDays++;
    if (forecast.tomorrow?.high >= MIN_HEATWAVE_TEMP) hotDays++;
    if (forecast.day3?.high >= MIN_HEATWAVE_TEMP) hotDays++;
    
    maxTemp = Math.max(
      maxTemp,
      forecast.today?.high ?? 0,
      forecast.tomorrow?.high ?? 0,
      forecast.day3?.high ?? 0
    );
  }
  
  // Calculate average temp across hot days
  const temps = [currentTemp];
  if (forecast?.today?.high != null) temps.push(forecast.today.high);
  if (forecast?.tomorrow?.high != null) temps.push(forecast.tomorrow.high);
  if (forecast?.day3?.high != null) temps.push(forecast.day3.high);
  const avgTemp = temps.length > 0 ? Math.round(temps.reduce((a, b) => a + b, 0) / temps.length) : 0;

  // Badge criteria: 3+ days >= 34 °C AND no rain
  const MIN_HOT_DAYS = 3;
  const shouldAward = hotDays >= MIN_HOT_DAYS && !hasRain;
  
  return {
    shouldAward,
    hotDays,
    days: hotDays,
    maxTemp: Math.round(maxTemp),
    avgTemp,
  };
}

/**
 * Calculate "Snow King" eligibility
 * Reliable snow conditions - perfect for skiing
 * 
 * RULES:
 * - Population > 150k excluded (large cities out, but medium OK)
 * - No elevation requirement (snow can be anywhere)
 * - Winter only (Nov-Mar), except high Alps >2000m
 * - 3 paths to qualify (see below)
 * - Max 10 badges, max 3 per country, sorted by snow (60%) + cold (40%)
 * 
 * @param {Object} destination - Destination with forecast and snowfall data
 * @returns {Object} - { shouldAward, snowDays, snowfallAmount, avgTemp, reason, score, country }
 */
export function calculateSnowKing(destination) {
  const currentCondition = destination.condition ?? 'unknown';
  const currentTemp = destination.temperature ?? 0;
  const population = destination.population ?? 0;
  const elevation = destination.elevation ?? 0;
  const country = destination.country || destination.countryCode || '';
  
  // Exclude large cities (over 150k population)
  const MAX_POPULATION = 150000;
  if (population > MAX_POPULATION) {
    return {
      shouldAward: false,
      snowDays: 0,
      snowfallAmount: 0,
      maxTemp: currentTemp,
      minTemp: currentTemp,
      avgTemp: currentTemp,
      score: 0,
      country,
      reason: `City too large (${population.toLocaleString()} population)`,
    };
  }
  
  // Season check: Winter = Nov-Mar (months 11, 12, 1, 2, 3)
  const month = new Date().getMonth() + 1;
  const isWinter = month >= 11 || month <= 3;
  const isHighAlps = elevation >= 2000;
  
  // Summer: No badge except high Alps >2000m
  if (!isWinter && !isHighAlps) {
    return {
      shouldAward: false,
      snowDays: 0,
      snowfallAmount: 0,
      maxTemp: currentTemp,
      minTemp: currentTemp,
      avgTemp: currentTemp,
      score: 0,
      country,
      reason: `Summer season (Apr-Oct) - only high Alps >2000m qualify`,
    };
  }
  
  // Snowfall amount (mm)
  const snowfall1h = destination.snowfall1h || 0;
  const snowfall3h = destination.snowfall3h || 0;
  const snowfall24h = destination.snowfall24h || 0;
  
  // Calculate total snowfall from forecast
  let totalSnowfall = snowfall24h;
  
  // Check forecast if available
  const forecast = destination.forecast;
  let snowDays = currentCondition === 'snowy' ? 1 : 0;
  let maxTemp = currentTemp;
  let minTemp = currentTemp;
  let avgTemp = currentTemp;
  let tempCount = 1;
  
  if (forecast) {
    // Count snowy days in forecast and accumulate snowfall
    if (forecast.today?.condition === 'snowy') {
      snowDays++;
      totalSnowfall += forecast.today?.precipitation || 0;
    }
    if (forecast.tomorrow?.condition === 'snowy') {
      snowDays++;
      totalSnowfall += forecast.tomorrow?.precipitation || 0;
    }
    if (forecast.day2?.condition === 'snowy') {
      snowDays++;
      totalSnowfall += forecast.day2?.precipitation || 0;
    }
    if (forecast.day3?.condition === 'snowy') {
      snowDays++;
      totalSnowfall += forecast.day3?.precipitation || 0;
    }
    
    // Calculate temperature stats
    if (forecast.today?.high != null) {
      maxTemp = Math.max(maxTemp, forecast.today.high);
      minTemp = Math.min(minTemp, forecast.today.low ?? forecast.today.high);
      avgTemp += forecast.today.high;
      tempCount++;
    }
    if (forecast.tomorrow?.high != null) {
      maxTemp = Math.max(maxTemp, forecast.tomorrow.high);
      minTemp = Math.min(minTemp, forecast.tomorrow.low ?? forecast.tomorrow.high);
      avgTemp += forecast.tomorrow.high;
      tempCount++;
    }
    if (forecast.day2?.high != null) {
      maxTemp = Math.max(maxTemp, forecast.day2.high);
      minTemp = Math.min(minTemp, forecast.day2.low ?? forecast.day2.high);
      avgTemp += forecast.day2.high;
      tempCount++;
    }
    if (forecast.day3?.high != null) {
      maxTemp = Math.max(maxTemp, forecast.day3.high);
      minTemp = Math.min(minTemp, forecast.day3.low ?? forecast.day3.high);
      avgTemp += forecast.day3.high;
      tempCount++;
    }
  }
  
  avgTemp = avgTemp / tempCount;
  
  // === WINTER PATHS (Nov-Mar) ===
  
  // Path 1 (Heavy Snow): ≥20mm snow/24h, avg ≤2 °C
  const path1 = snowfall24h >= 20 && avgTemp <= 2;
  
  // Path 2 (Consistent Snow): ≥3 snow days, ≥10mm total, avg ≤0 °C
  const path2 = snowDays >= 3 && totalSnowfall >= 10 && avgTemp <= 0;
  
  // Path 3 (Cold + Snow): ≥1 snow day, avg ≤-5 °C, max ≤-1 °C
  const path3 = snowDays >= 1 && avgTemp <= -5 && maxTemp <= -1;
  
  const shouldAward = path1 || path2 || path3;
  
  // Calculate score for sorting: Snow (60%) + Cold (40%)
  // Normalize: snowfall max ~50mm = 100 points, temp min ~-20 °C = 100 points
  const snowScore = Math.min(100, (totalSnowfall / 50) * 100) * 0.6;
  const coldScore = Math.min(100, Math.max(0, (10 - avgTemp) / 30) * 100) * 0.4;
  const score = Math.round((snowScore + coldScore) * 10) / 10;
  
  let reason = '';
  if (path1) reason = `Heavy: ${snowfall24h.toFixed(0)}mm/24h, Ø${avgTemp.toFixed(1)} °C`;
  else if (path2) reason = `Consistent: ${snowDays} Tage, ${totalSnowfall.toFixed(0)}mm, Ø${avgTemp.toFixed(1)} °C`;
  else if (path3) reason = `Freezing: Ø${avgTemp.toFixed(1)} °C, Max ${maxTemp.toFixed(0)} °C`;
  
  if (isHighAlps && !isWinter) {
    reason += ' (Hochalpen)';
  }
  
  return {
    shouldAward,
    snowDays,
    snowfallAmount: totalSnowfall,
    totalSnowfall, // alias for UI (snowkingSummary, totalSnowfall badge)
    maxTemp,
    minTemp,
    avgTemp: Math.round(avgTemp * 10) / 10,
    score,
    country,
    reason,
  };
}

/**
 * Calculate "Rainy Days" eligibility
 * 3+ rainy days with at least 1 heavy rain
 * 
 * @param {Object} destination - Destination with forecast data
 * @returns {Object} - { shouldAward, rainyDays, hasHeavyRain }
 */
export function calculateRainyDays(destination) {
  const currentCondition = destination.condition ?? 'unknown';
  const forecast = destination.forecast;
  
  // Count rainy days
  let rainyDays = currentCondition === 'rainy' ? 1 : 0;
  let hasHeavyRain = false;
  
  // Check current for heavy rain
  const currentDesc = destination.description?.toLowerCase() || '';
  if (currentDesc.includes('heavy') || currentDesc.includes('intense')) {
    hasHeavyRain = true;
  }
  
  if (forecast) {
    if (forecast.today?.condition === 'rainy') {
      rainyDays++;
      const todayDesc = forecast.today?.description?.toLowerCase() || '';
      if (todayDesc.includes('heavy') || todayDesc.includes('intense')) {
        hasHeavyRain = true;
      }
    }
    if (forecast.tomorrow?.condition === 'rainy') {
      rainyDays++;
      const tomorrowDesc = forecast.tomorrow?.description?.toLowerCase() || '';
      if (tomorrowDesc.includes('heavy') || tomorrowDesc.includes('intense')) {
        hasHeavyRain = true;
      }
    }
    if (forecast.day3?.condition === 'rainy') {
      rainyDays++;
      const day3Desc = forecast.day3?.description?.toLowerCase() || '';
      if (day3Desc.includes('heavy') || day3Desc.includes('intense')) {
        hasHeavyRain = true;
      }
    }
  }
  
  // Badge criteria: 3+ rainy days AND at least 1 heavy rain
  const MIN_RAINY_DAYS = 3;
  const shouldAward = rainyDays >= MIN_RAINY_DAYS && hasHeavyRain;
  
  return {
    shouldAward,
    rainyDays,
    hasHeavyRain,
  };
}

/**
 * Calculate "Weather Curse" eligibility
 * Good & warm weather now but will turn bad soon (opposite of Weather Miracle)
 * 
 * Criteria:
 * - Today: > 10 °C AND good weather (sunny/cloudy/overcast)
 * - Tomorrow/Day3: bad weather (rainy/snowy/windy)
 * - Temp loss >= 5 °C
 * 
 * @param {Object} destination - Destination with forecast data
 * @returns {Object} - { shouldAward, todayCondition, futureCondition, tempLoss }
 */
export function calculateWeatherCurse(destination) {
  const todayCondition = destination.condition ?? 'unknown';
  const todayTemp = destination.temperatureMax ?? destination.temperature ?? 0;
  const forecast = destination.forecast;
  
  if (!forecast) {
    return { shouldAward: false };
  }
  
  // Prerequisite: Today must be warm (> 10 °C) AND good weather
  const MIN_TODAY_TEMP = 10;
  const GOOD_CONDITIONS = ['sunny', 'cloudy', 'overcast'];
  const isWarmToday = todayTemp > MIN_TODAY_TEMP;
  const isGoodToday = GOOD_CONDITIONS.includes(todayCondition);
  
  // Future: bad weather — require at least 2 out of 3 future days
  const BAD_CONDITIONS = ['rainy', 'snowy', 'windy'];
  const futureDays = [
    forecast.tomorrow?.condition,
    forecast.day2?.condition,
    forecast.day3?.condition,
  ];
  const badDayCount = futureDays.filter(c => BAD_CONDITIONS.includes(c)).length;
  
  // Use tempMax for fair day-vs-day comparison (avoid day vs night false positives)
  const tomorrowTemp = forecast.tomorrow?.tempMax ?? forecast.tomorrow?.temp ?? todayTemp;
  const day3Temp = forecast.day3?.tempMax ?? forecast.day3?.temp ?? todayTemp;
  const futureTempMin = Math.min(tomorrowTemp, day3Temp);
  const tempLoss = todayTemp - futureTempMin;
  
  // Badge criteria: warm + good today AND ≥2 bad future days AND ≥5 °C colder
  const MIN_TEMP_LOSS = 5;
  const shouldAward = (
    isWarmToday &&
    isGoodToday &&
    badDayCount >= 2 &&
    tempLoss >= MIN_TEMP_LOSS
  );
  
  // Debug logging for Weather Curse candidates
  if (isGoodToday && badDayCount >= 1) {
    const reason = !isWarmToday ? `TOO COLD (${todayTemp} °C ≤ ${MIN_TODAY_TEMP} °C)` :
                   badDayCount < 2 ? `NOT ENOUGH BAD DAYS (${badDayCount}/3)` :
                   tempLoss < MIN_TEMP_LOSS ? `NOT ENOUGH TEMP LOSS (${tempLoss} °C < ${MIN_TEMP_LOSS} °C)` : 'OK';
    console.log(`🔮 ${destination.name}: Weather Curse candidate! ` +
      `Today: ${todayCondition} ${todayTemp} °C, ` +
      `Future: ${badDayCount}/3 bad days, ` +
      `Tomorrow: ${forecast.tomorrow?.condition || 'N/A'} ${tomorrowTemp} °C, ` +
      `Day3: ${forecast.day3?.condition || 'N/A'} ${day3Temp} °C, ` +
      `TempLoss: ${tempLoss} °C → ${shouldAward ? '✅ AWARD' : `❌ ${reason}`}`
    );
  }
  
  return {
    shouldAward,
    todayCondition,
    todayTemp: Math.round(todayTemp),
    futureCondition: futureDays.find(c => BAD_CONDITIONS.includes(c)) || 'unknown',
    futureTempMin: Math.round(futureTempMin),
    tempLoss: Math.round(tempLoss),
    badDayCount,
  };
}

// Frühlingserwachen: only destinations north of ~45°N (DE, NL, DK, SE, NO, PL, FR north, etc.)
const SPRING_AWAKENING_MIN_LAT = 45;

/**
 * Calculate "Spring Awakening" eligibility
 * Strict: 18-23 °C, sunny only, wind ≤ 20 km/h, only north of ~45°N.
 * Only from March 1 - May 15.
 *
 * @param {Object} destination - Destination with weather data (and .lat)
 * @param {Object} origin - Origin location with weather (for temp delta)
 * @param {number} distanceKm - Distance from origin
 * @returns {Object} - { shouldAward, tempDelta, tempDest, tempOrigin, distance, eta }
 */
export function calculateSpringAwakening(destination, origin, distanceKm) {
  const tempDest = destination.temperature ?? 0;
  const tempOrigin = origin?.temperature ?? 0;
  const tempDelta = tempDest - tempOrigin;
  const roadDistanceKm = distanceKm * ROAD_FACTOR;
  const lat = destination.lat ?? destination.latitude ?? 0;

  // Normal mode: Check date: March 1 - May 15
  const now = new Date();
  const month = now.getMonth(); // 0 = January, 2 = March, 4 = May
  const day = now.getDate();

  // Spring period: March 1 (month 2, day 1) to May 15 (month 4, day 15)
  const isSpringPeriod = (
    (month === 2) || // March (entire month)
    (month === 3) || // April (entire month)
    (month === 4 && day <= 15) // May 1-15
  );

  if (!isSpringPeriod) {
    return {
      shouldAward: false,
      reason: 'Not spring period (March 1 - May 15)',
      tempDelta: Math.round(tempDelta),
      tempDest: Math.round(tempDest),
      tempOrigin: Math.round(tempOrigin),
      distance: Math.round(distanceKm),
      eta: 0,
      isSpringPeriod: false
    };
  }

  // Only destinations north of ~45°N (DE, NL, DK, SE, NO, PL, FR north, etc.)
  const isNorthEnough = lat >= SPRING_AWAKENING_MIN_LAT;
  if (!isNorthEnough) {
    return {
      shouldAward: false,
      reason: `South of ${SPRING_AWAKENING_MIN_LAT}°N (${Math.round(lat * 10) / 10}°N)`,
      tempDelta: Math.round(tempDelta),
      tempDest: Math.round(tempDest),
      tempOrigin: Math.round(tempOrigin),
      distance: Math.round(distanceKm),
      roadDistanceKm: Math.round(roadDistanceKm),
      eta: Math.round(calculateETA(roadDistanceKm) * 10) / 10,
      isSpringPeriod: true
    };
  }

  const condition = destination.condition ?? 'unknown';
  const windSpeed = destination.windSpeed ?? 0;

  // Temperature: 18-23 °C (strict spring window)
  const MIN_TEMP = 18;
  const MAX_TEMP = 23;
  const isGoodTemp = tempDest >= MIN_TEMP && tempDest <= MAX_TEMP;

  // Condition: Sunny only
  const isGoodCondition = condition === 'sunny';

  // Wind: ≤20 km/h
  const MAX_WIND = 20;
  const isLightWind = windSpeed <= MAX_WIND;

  // All criteria must be met
  const shouldAward = isGoodTemp && isGoodCondition && isLightWind;
  const eta = calculateETA(roadDistanceKm);

  return {
    shouldAward,
    tempDelta: Math.round(tempDelta),
    tempDest: Math.round(tempDest),
    tempOrigin: Math.round(tempOrigin),
    distance: Math.round(distanceKm),
    roadDistanceKm: Math.round(roadDistanceKm),
    eta: Math.round(eta * 10) / 10,
    isSpringPeriod: true,
    reason: shouldAward
      ? 'Perfect spring weather!'
      : `Temp: ${isGoodTemp ? '✓' : '✗'}, Condition: ${isGoodCondition ? '✓' : '✗'}, Wind: ${isLightWind ? '✓' : '✗'}`
  };
}

/**
 * Calculate badge eligibility for a destination
 * 
 * @param {Object} destination - The destination to evaluate
 * @param {Object} userLocation - Current user location (with weather data)
 * @param {number} distanceKm - Distance from user to destination
 * @param {Array} allDestinations - All destinations for comparison
 * @returns {Array<string>} - Array of badge types this destination earned
 */
export function calculateBadges(destination, userLocation, distanceKm, tempRankMap = new Map(), reverseMode = 'warm', radius = null) {
  const badges = [];

  // === PRE-CHECK: Weather Curse & Deterioration ===
  // Calculate Weather Curse early (needed for Worth the Drive exclusion)
  const weatherCurseResult = calculateWeatherCurse(destination);
  destination._weatherCurseData = weatherCurseResult;
  const hasWeatherCurse = weatherCurseResult.shouldAward;
  
  // Check weather deterioration (>4 °C drop in next 2 days average)
  const deteriorationResult = checkWeatherDeterioration(destination, 4);
  destination._weatherDeteriorationData = deteriorationResult;
  const isDeterioritating = deteriorationResult.isDeteriorating;
  
  // Flag: Skip Worth the Drive badges if weather is getting worse
  // In cold mode, deterioration (getting colder) is actually GOOD, so don't skip
  const skipWorthTheDrive = reverseMode === 'cold' ? false : (hasWeatherCurse || isDeterioritating);
  
  if (skipWorthTheDrive) {
    devLog(`⚠️ ${destination.name}: Skipping Worth the Drive - ` +
      `${hasWeatherCurse ? 'Weather Curse' : ''} ` +
      `${isDeterioritating ? `Deteriorating (${deteriorationResult.avgTempDrop} °C drop)` : ''}`
    );
  }

  // 1. Worth the Drive Budget - RANKING SYSTEM (PRIORITY 1!)
  // Calculate efficiency for this destination
  const budgetResult = calculateWorthTheDriveBudget(destination, userLocation, distanceKm, reverseMode, radius);
  destination._worthTheDriveBudgetData = budgetResult;
  
  // Mark as ineligible if weather is deteriorating
  if (skipWorthTheDrive) {
    budgetResult.isEligible = false;
    budgetResult.skipReason = hasWeatherCurse ? 'Weather Curse' : 'Weather deteriorating';
  }
  
  // Badge is awarded later after comparing all destinations (see below)

  // 2. Worth the Drive (PRIORITY 2!)
  const worthResult = calculateWorthTheDrive(destination, userLocation, distanceKm, reverseMode);
  destination._worthTheDriveData = worthResult;
  
  // Only award if not skipped due to weather issues
  if (worthResult.shouldAward && !skipWorthTheDrive) {
    badges.push(DestinationBadge.WORTH_THE_DRIVE);
    devLog(
      `🚗 ${destination.name}: Worth it! ` +
      `Temp: ${worthResult.tempOrigin} °C → ${worthResult.tempDest} °C (+${worthResult.tempDelta} °C), ` +
      `Weather: ${worthResult.weatherOrigin} → ${worthResult.weatherDest} (+${worthResult.delta} pts), ` +
      `Value: ${worthResult.value} pts/h, ` +
      `ETA: ${worthResult.eta}h (${Math.round(distanceKm)} km)`
    );
  } else if (worthResult.shouldAward && skipWorthTheDrive) {
    devLog(`🚗❌ ${destination.name}: Would qualify for Worth the Drive but skipped due to weather issues`);
  }

  // 3. Warm & Dry
  const warmDryResult = calculateWarmAndDry(destination, tempRankMap);
  destination._warmAndDryData = warmDryResult;
  
  if (warmDryResult.shouldAward) {
    badges.push(DestinationBadge.WARM_AND_DRY);
    devLog(
      `☀️ ${destination.name}: Warm & Dry! ` +
      `Temp: ${warmDryResult.temp} °C (Rank: #${warmDryResult.tempRank}), ` +
      `Condition: ${warmDryResult.condition}, ` +
      `Wind: ${warmDryResult.windSpeed} km/h`
    );
  }

  // 4. Beach Paradise
  const beachResult = calculateBeachParadise(destination);
  destination._beachParadiseData = beachResult;
  
  if (beachResult.shouldAward) {
    badges.push(DestinationBadge.BEACH_PARADISE);
    devLog(
      `🌊 ${destination.name}: Beach Paradise! ` +
      `Temp: ${beachResult.temp} °C, ` +
      `Condition: ${beachResult.condition}, ` +
      `Wind: ${beachResult.windSpeed} km/h`
    );
  }

  // 5. Sunny Streak
  const sunnyStreakResult = calculateSunnyStreak(destination);
  destination._sunnyStreakData = sunnyStreakResult;
  
  if (sunnyStreakResult.shouldAward) {
    badges.push(DestinationBadge.SUNNY_STREAK);
    devLog(
      `☀️ ${destination.name}: Sunny Streak! ` +
      `${sunnyStreakResult.streakLength} days of sunshine, Ø ${sunnyStreakResult.avgTemp} °C`
    );
  }

  // 6. Weather Miracle
  const miracleResult = calculateWeatherMiracle(destination);
  destination._weatherMiracleData = miracleResult;
  
  if (miracleResult.shouldAward) {
    badges.push(DestinationBadge.WEATHER_MIRACLE);
    devLog(
      `🌈 ${destination.name}: Weather Miracle! ` +
      `TODAY: ${miracleResult.todayTemp} °C, ${miracleResult.todayCondition} → ` +
      `FUTURE: ${miracleResult.futureTempMax} °C, sunny (+${miracleResult.tempGain} °C gain!)`
    );
  }

  // 7. Heatwave
  const heatwaveResult = calculateHeatwave(destination);
  destination._heatwaveData = heatwaveResult;
  
  if (heatwaveResult.shouldAward) {
    badges.push(DestinationBadge.HEATWAVE);
    devLog(
      `🔥 ${destination.name}: Heatwave! ` +
      `${heatwaveResult.hotDays} days >30 °C, Max: ${heatwaveResult.maxTemp} °C`
    );
  }

  // 8. Snow King
  const snowKingResult = calculateSnowKing(destination);
  destination._snowKingData = snowKingResult;
  
  if (snowKingResult.shouldAward) {
    badges.push(DestinationBadge.SNOW_KING);
    devLog(
      `⛄ ${destination.name}: Snow King! ` +
      `${snowKingResult.reason} ` +
      `(${snowKingResult.snowDays} snowy days, ${snowKingResult.snowfallAmount.toFixed(1)}mm/24h)`
    );
  }

  // 9. Rainy Days
  const rainyDaysResult = calculateRainyDays(destination);
  destination._rainyDaysData = rainyDaysResult;
  
  if (rainyDaysResult.shouldAward) {
    badges.push(DestinationBadge.RAINY_DAYS);
    devLog(
      `🌧️ ${destination.name}: Rainy Days! ` +
      `${rainyDaysResult.rainyDays} rainy days, ` +
      `Heavy rain: ${rainyDaysResult.hasHeavyRain ? 'Yes' : 'No'}`
    );
  }

  // 10. Weather Curse (already calculated at beginning for Worth the Drive check)
  // Just award the badge if it qualifies
  if (weatherCurseResult.shouldAward) {
    badges.push(DestinationBadge.WEATHER_CURSE);
    devLog(
      `⚠️ ${destination.name}: Weather Curse! ` +
      `TODAY: ${weatherCurseResult.todayTemp} °C, ${weatherCurseResult.todayCondition} → ` +
      `FUTURE: ${weatherCurseResult.futureTempMin} °C, ${weatherCurseResult.futureCondition} (-${weatherCurseResult.tempLoss} °C loss!)`
    );
  }

  // 11. Spring Awakening (only March 1 - May 15)
  const springAwakeningResult = calculateSpringAwakening(destination, userLocation, distanceKm);
  destination._springAwakeningData = springAwakeningResult;
  
  if (springAwakeningResult.shouldAward) {
    badges.push(DestinationBadge.SPRING_AWAKENING);
    devLog(
      `🐇 ${destination.name}: Spring Awakening! ` +
      `Temp: ${springAwakeningResult.tempOrigin} °C → ${springAwakeningResult.tempDest} °C (${springAwakeningResult.tempDelta > 0 ? '+' : ''}${springAwakeningResult.tempDelta} °C), ` +
      `ETA: ${springAwakeningResult.eta}h (${springAwakeningResult.distance} km) - ${springAwakeningResult.reason}`
    );
  }

  return badges;
}
