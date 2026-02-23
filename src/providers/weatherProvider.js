import Constants from 'expo-constants';
import { calculateBadges } from '../domain/destinationBadge';
import { parseWeatherAlert, shouldShowWarning, WarningType } from '../domain/weatherWarning';

const API_BASE_URL = 'https://api.openweathermap.org/data/2.5';
const SEARCH_URL = `${API_BASE_URL}/find`;
const FORECAST_URL = `${API_BASE_URL}/forecast`;

const CACHE_TTL_MS = 60 * 60 * 1000;
const forecastCache = new Map();

const isValidCoordinate = (value) => Number.isFinite(value);

const toRadians = (value) => (value * Math.PI) / 180;

const getBoundingBox = (lat, lon, radiusKm) => {
  const latDelta = Math.min(89.9, radiusKm / 111.32);
  const lonMultiplier = Math.max(Math.cos(lat * Math.PI / 180), 0.1);
  const lonDelta = Math.min(179.9, radiusKm / (111.32 * lonMultiplier));

  return {
    latMin: lat - latDelta,
    latMax: lat + latDelta,
    lonMin: lon - lonDelta,
    lonMax: lon + lonDelta,
  };
};

const getDistanceKm = (lat1, lon1, lat2, lon2) => {
  const R = 6371;
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

const isWithinRadius = (centerLat, centerLon, targetLat, targetLon, radiusKm) => {
  if (!radiusKm) return true;
  return getDistanceKm(centerLat, centerLon, targetLat, targetLon) <= radiusKm;
};

const mapWeatherCondition = (weatherMain = '', weatherDescription = '') => {
  const main = weatherMain.toLowerCase();
  const description = weatherDescription.toLowerCase();

  if (main === 'clear') return 'sunny';
  if (main === 'clouds') return 'cloudy';
  if (main === 'rain' || main === 'drizzle' || description.includes('shower')) {
    return 'rainy';
  }
  if (main === 'thunderstorm' || description.includes('storm')) return 'rainy';
  if (main === 'snow') return 'snowy';
  if (
    ['mist', 'smoke', 'haze', 'dust', 'fog', 'sand', 'ash', 'squall', 'tornado'].includes(main) ||
    description.includes('wind')
  ) {
    return 'windy';
  }
  if (description.includes('sun') || description.includes('clear')) return 'sunny';

  return 'cloudy';
};

const normalizeCoordinate = (coordValue) =>
  Number.isFinite(coordValue) ? coordValue : 0;

const adaptDestination = (city) => {
  const { coord = {}, main = {}, weather = [], wind = {}, clouds = {} } = city;
  const [weatherInfo] = weather;
  
  const mappedCondition = mapWeatherCondition(weatherInfo?.main, weatherInfo?.description);

  return {
    lat: normalizeCoordinate(coord.Lat ?? coord.lat),
    lon: normalizeCoordinate(coord.Lon ?? coord.lon),
    name: city.name || 'Unknown destination',
    condition: mappedCondition,
    temperature: Math.round(main.temp ?? 0),
    humidity: main.humidity ?? 0,
    windSpeed: Math.round((wind.speed ?? 0) * 3.6),
    stability: Math.max(
      0,
      Math.min(
        100,
        100 - (clouds.all ?? 0) - Math.round((wind.speed ?? 0) * 2)
      )
    ),
    badges: [], // Future: Will contain badge types (e.g., ['WORTH_THE_DRIVE', 'WARM_AND_DRY'])
  };
};

const adaptDailyForecastEntry = (entry) => {
  if (!entry) {
    return {
      condition: 'sunny',
      temp: 0,
      high: 0,
      low: 0,
    };
  }

  const [weatherInfo] = entry.weather || [];
  const tempValue = entry.temp?.day ?? entry.temp ?? 0;

  return {
    condition: mapWeatherCondition(weatherInfo?.main, weatherInfo?.description),
    temp: Math.round(tempValue),
    high: Math.round(entry.temp?.max ?? tempValue),
    low: Math.round(entry.temp?.min ?? tempValue),
  };
};

const capitalize = (text) => {
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1);
};

const buildForecastFromResponse = (data, lat, lon, name) => {
  // The forecast API returns a list of 3-hour intervals for 5 days
  const forecastList = data.list || [];
  const cityName = data.city?.name || name || `Location at ${lat.toFixed(2)}, ${lon.toFixed(2)}`;
  
  if (forecastList.length === 0) {
    return buildMockForecast(lat, lon, cityName);
  }

  // Get current conditions from the first entry
  const current = forecastList[0];
  const [currentWeather] = current.weather || [];
  
  // Group forecast by day to calculate daily highs/lows
  const dailyGroups = {};
  forecastList.forEach((entry) => {
    const date = new Date(entry.dt * 1000);
    const dayKey = date.toISOString().split('T')[0]; // YYYY-MM-DD
    if (!dailyGroups[dayKey]) {
      dailyGroups[dayKey] = [];
    }
    dailyGroups[dayKey].push(entry);
  });

  const dailyKeys = Object.keys(dailyGroups).slice(0, 3); // Today, tomorrow, day 3
  
  const buildDayForecast = (dayKey) => {
    const entries = dailyGroups[dayKey] || [];
    if (entries.length === 0) {
      return { condition: 'sunny', temp: 0, high: 0, low: 0 };
    }
    
    const temps = entries.map((e) => e.main?.temp ?? 0);
    const [weatherInfo] = entries[0].weather || [];
    
    return {
      condition: mapWeatherCondition(weatherInfo?.main, weatherInfo?.description),
      temp: Math.round(temps.reduce((a, b) => a + b, 0) / temps.length),
      high: Math.round(Math.max(...temps)),
      low: Math.round(Math.min(...temps)),
    };
  };

  return {
    lat,
    lon,
    name: cityName,
    condition: mapWeatherCondition(currentWeather?.main, currentWeather?.description),
    temperature: Math.round(current.main?.temp ?? 0),
    humidity: current.main?.humidity ?? 0,
    windSpeed: Math.round((current.wind?.speed ?? 0) * 3.6),
    stability: Math.max(
      0,
      Math.min(
        100,
        100 - (current.clouds?.all ?? 0) - Math.round((current.wind?.speed ?? 0) * 2)
      )
    ),
    forecast: {
      today: buildDayForecast(dailyKeys[0]),
      tomorrow: buildDayForecast(dailyKeys[1]),
      day3: buildDayForecast(dailyKeys[2]),
    },
    description: capitalize(currentWeather?.description || 'Weather data available'),
    fetchedAt: new Date().toISOString(),
  };
};

const generateMockWeatherData = (lat, lon, index, desiredCondition = null) => {
  // Use coordinates as seed for deterministic "random" values
  // This ensures same coordinates always generate same weather data
  const seed = Math.abs(lat * lon * 1000) % 10000;
  const seededRandom = (offset = 0) => ((seed + offset) % 100) / 100;
  
  const conditions = ['sunny', 'cloudy', 'rainy', 'snowy', 'windy'];
  
  // Determine condition index for forecast progression
  const conditionIndex = Math.floor(seededRandom(1) * conditions.length);
  
  // If a specific condition is desired, use it for most mock data (80% chance)
  let condition;
  if (desiredCondition && seededRandom(0) < 0.8) {
    condition = desiredCondition;
  } else {
    condition = conditions[conditionIndex];
  }

  const baseTemp = condition === 'snowy' ? -5 : condition === 'sunny' ? 25 : 15;
  const temp = baseTemp + (seededRandom(2) * 10 - 5);

  return {
    lat,
    lon,
    name: `Destination ${index + 1}`,
    condition,
    temperature: Math.round(temp),
    humidity: Math.round(50 + seededRandom(3) * 30),
    windSpeed: Math.round(5 + seededRandom(4) * 20),
    stability: Math.round(70 + seededRandom(5) * 25),
    isMockData: true, // Mark as mock for visual distinction
    badges: [], // Future: Will contain badge types
    forecast: {
      today: {
        condition,
        temp: Math.round(temp),
        high: Math.round(temp + 5),
        low: Math.round(temp - 5),
      },
      tomorrow: {
        condition: conditions[(conditionIndex + 1) % conditions.length],
        temp: Math.round(temp + 2),
        high: Math.round(temp + 7),
        low: Math.round(temp - 3),
      },
      day3: {
        condition: conditions[(conditionIndex + 2) % conditions.length],
        temp: Math.round(temp - 1),
        high: Math.round(temp + 4),
        low: Math.round(temp - 6),
      },
    },
    description: `${condition.charAt(0).toUpperCase() + condition.slice(1)} conditions`,
    fetchedAt: new Date().toISOString(),
  };
};

/**
 * Apply badge calculations to all destinations
 * Mutates destination objects by adding 'badges' array
 * Limits "Worth the Drive" badges to top 3 destinations only
 */
const applyBadgesToDestinations = (destinations, originLocation, originLat, originLon) => {
  if (!destinations || !originLocation) return;
  
  destinations.forEach(dest => {
    // Skip current location (it shouldn't get badges)
    if (dest.isCurrentLocation) {
      dest.badges = [];
      return;
    }
    
    // Calculate distance if not already present
    if (!dest.distance) {
      dest.distance = getDistanceKm(originLat, originLon, dest.lat, dest.lon);
    }
    
    // Calculate and assign badges
    dest.badges = calculateBadges(dest, originLocation, dest.distance, destinations);
  });
  
  // Limit "Worth the Drive" badges to top 3 WARMEST destinations (among those that qualify)
  const MAX_WORTH_THE_DRIVE_BADGES = 3;
  
  const worthTheDriveCandidates = destinations
    .filter(d => !d.isCurrentLocation && d.badges.includes('WORTH_THE_DRIVE'))
    .sort((a, b) => (b._worthTheDriveData?.tempDest || 0) - (a._worthTheDriveData?.tempDest || 0)); // Sort by temperature!
  
  if (worthTheDriveCandidates.length > MAX_WORTH_THE_DRIVE_BADGES) {
    worthTheDriveCandidates.slice(MAX_WORTH_THE_DRIVE_BADGES).forEach(dest => {
      dest.badges = dest.badges.filter(b => b !== 'WORTH_THE_DRIVE');
    });
  }
  
  // Limit "Warm & Dry" badges to top 10 warmest destinations
  const MAX_WARM_DRY_BADGES = 10;
  
  const warmDryCandidates = destinations
    .filter(d => !d.isCurrentLocation && d.badges.includes('WARM_AND_DRY'))
    .sort((a, b) => (b.temperature || 0) - (a.temperature || 0)); // Warmest first
  
  if (warmDryCandidates.length > MAX_WARM_DRY_BADGES) {
    warmDryCandidates.slice(MAX_WARM_DRY_BADGES).forEach(dest => {
      dest.badges = dest.badges.filter(b => b !== 'WARM_AND_DRY');
    });
  }
  
  const destWithBadges = destinations.filter(d => d.badges && d.badges.length > 0);
  const totalBadges = destWithBadges.reduce((sum, d) => sum + d.badges.length, 0);
  const worthCount = destinations.filter(d => d.badges?.includes('WORTH_THE_DRIVE')).length;
  const warmDryCount = destinations.filter(d => d.badges?.includes('WARM_AND_DRY')).length;
  
  console.log(
    `🏆 Awarded ${totalBadges} badges to ${destWithBadges.length} destinations ` +
    `(🚗 Worth: ${worthCount}/${worthTheDriveCandidates.length} limited, ☀️ Warm&Dry: ${warmDryCount}/${warmDryCandidates.length} max 10)`
  );
};

const generateMockDestinations = (lat, lon, radiusKm = 400, count = null, desiredCondition = null) => {
  const destinations = [];
  const numDestinations = count ?? Math.max(5, Math.min(20, Math.floor(radiusKm / 50)));

  // Better distribution strategy: Use rings and sectors for even coverage
  const numRings = Math.min(4, Math.ceil(numDestinations / 8)); // Divide into rings
  const pointsPerRing = Math.ceil(numDestinations / numRings);

  let pointIndex = 0;
  for (let ring = 0; ring < numRings && pointIndex < numDestinations; ring++) {
    // Distance for this ring: spread from 20km minimum to 100% of radius
    // Don't generate points too close to starting location
    const MIN_TRAVEL_DISTANCE_KM = 20;
    const minDistance = Math.max(MIN_TRAVEL_DISTANCE_KM, (0.4 + (ring / numRings) * 0.6) * radiusKm);
    const maxDistance = (0.4 + ((ring + 1) / numRings) * 0.6) * radiusKm;
    
    const pointsInThisRing = Math.min(pointsPerRing, numDestinations - pointIndex);
    
    for (let p = 0; p < pointsInThisRing; p++) {
      // Evenly distribute angles with some randomness
      const baseAngle = (p / pointsInThisRing) * 2 * Math.PI;
      const angleJitter = (Math.random() - 0.5) * 0.4; // Small random offset
      const angle = baseAngle + angleJitter;
      
      // Random distance within ring with bias towards outer edge
      const distanceRatio = 0.3 + Math.random() * 0.7; // Bias towards outer part of ring
      const distance = (minDistance + distanceRatio * (maxDistance - minDistance)) * 1000;
      
      const latOffset = (distance * Math.cos(angle)) / 111000;
      const lonOffset =
        (distance * Math.sin(angle)) / (111000 * Math.max(Math.cos(lat * Math.PI / 180), 0.1));

      destinations.push(generateMockWeatherData(lat + latOffset, lon + lonOffset, pointIndex, desiredCondition));
      pointIndex++;
    }
  }

  return destinations;
};

const getOpenWeatherApiKey = () =>
  Constants.expoConfig?.extra?.openWeatherApiKey?.trim() ?? '';

export const fetchWeatherDestinationsForRadius = async (
  userLat,
  userLon,
  radiusKm = 400,
  desiredCondition = null
) => {
  if (!isValidCoordinate(userLat) || !isValidCoordinate(userLon)) {
    return generateMockDestinations(0, 0, radiusKm);
  }

  const apiKey = getOpenWeatherApiKey();

  if (!apiKey) {
    console.warn(
      '⚠️ OpenWeatherMap API key is not configured, falling back to mock destinations'
    );
    return generateMockDestinations(userLat, userLon, radiusKm);
  }

  // First, fetch weather for user's current location for comparison
  let currentLocationWeather = null;
  try {
    const currentUrl = `${API_BASE_URL}/weather?lat=${userLat}&lon=${userLon}&units=metric&appid=${apiKey}`;
    const currentResponse = await fetch(currentUrl);
    if (currentResponse.ok) {
      const currentData = await currentResponse.json();
      currentLocationWeather = {
        ...adaptDestination(currentData),
        name: `📍 ${currentData.name || 'Your Location'}`,
        distance: 0,
        isCurrentLocation: true,
      };
    }
  } catch (error) {
    console.warn('Could not fetch current location weather:', error.message);
  }

  // Multi-point search strategy: Search from center + 8 points around the radius
  // When filtering is active, we need MORE cities because many will be filtered out
  const hasFilter = Boolean(desiredCondition);
  const searchMultiplier = hasFilter ? 2 : 1; // Double search points when filtering
  
  const searchPoints = [
    { lat: userLat, lon: userLon, name: 'center' }, // Center point
  ];
  
  // Add search points around the radius (8 normally, 16 when filtering)
  const numDirections = hasFilter ? 16 : 8;
  const searchRadiusFraction = 0.6; // Search from 60% of radius in each direction
  
  for (let i = 0; i < numDirections; i++) {
    const angle = (i / numDirections) * 2 * Math.PI;
    const searchDist = radiusKm * searchRadiusFraction * 1000; // meters
    const latOffset = (searchDist * Math.cos(angle)) / 111000;
    const lonOffset = (searchDist * Math.sin(angle)) / (111000 * Math.max(Math.cos(userLat * Math.PI / 180), 0.1));
    searchPoints.push({
      lat: userLat + latOffset,
      lon: userLon + lonOffset,
      name: `Dir${i}`
    });
  }

  // Fetch cities from all search points
  const allCitiesMap = new Map(); // Use Map to deduplicate by coordinates
  
  try {
    const citiesPerPoint = hasFilter ? 20 : 10; // More cities when filtering
    
    const fetchPromises = searchPoints.map(async (point) => {
      const cnt = citiesPerPoint;
      const url = `${SEARCH_URL}?lat=${point.lat}&lon=${point.lon}&cnt=${cnt}&units=metric&appid=${apiKey}`;
      
      try {
        const response = await fetch(url);
        if (!response.ok) return [];
        
        const data = await response.json();
        return (data.list || []).map(adaptDestination);
      } catch (err) {
        console.warn(`Failed to fetch from ${point.name}:`, err.message);
        return [];
      }
    });

    const results = await Promise.all(fetchPromises);
    
    // Combine and deduplicate cities
    results.flat().forEach((city) => {
      if (city.lat && city.lon && isWithinRadius(userLat, userLon, city.lat, city.lon, radiusKm)) {
        const key = `${city.lat.toFixed(3)},${city.lon.toFixed(3)}`; // Dedupe by rounded coords
        if (!allCitiesMap.has(key)) {
          allCitiesMap.set(key, {
            ...city,
            distance: getDistanceKm(userLat, userLon, city.lat, city.lon),
          });
        }
      }
    });
    
    const allCities = Array.from(allCitiesMap.values());
    
    // Filter out cities too close to user location (< 20km) as they're not interesting for travel
    const MIN_TRAVEL_DISTANCE_KM = 20;
    const travelDestinations = allCities.filter(city => 
      city.distance >= MIN_TRAVEL_DISTANCE_KM
    );

    // Smart selection strategy:
    // 1. Sort by temperature (warmest first)
    // 2. Apply minimum distance filter between markers (prevent clustering)
    // 3. Take top 30-50 cities
    const realCities = [];
    if (travelDestinations && travelDestinations.length > 0) {
      const MIN_DISTANCE_KM = hasFilter ? 15 : 20; // Reduce min distance when filtering
      const MAX_CITIES = hasFilter ? 60 : Math.min(50, Math.max(30, Math.floor(radiusKm / 15))); // More cities when filtering
      
      // Sort by temperature descending (warmest first)
      const sortedByTemp = [...travelDestinations].sort((a, b) => b.temperature - a.temperature);
      
      // Select cities with minimum distance constraint
      for (const city of sortedByTemp) {
        if (realCities.length >= MAX_CITIES) break;
        
        // Check if this city is too close to any already selected city
        const tooClose = realCities.some((selected) => {
          const dist = getDistanceKm(city.lat, city.lon, selected.lat, selected.lon);
          return dist < MIN_DISTANCE_KM;
        });
        
        if (!tooClose) {
          realCities.push(city);
        }
      }
      
    }

    // Hybrid mode: When filtering is active, ALWAYS add mock destinations
    // because real cities often don't match the filter (e.g. all cloudy today)
    let allDestinations = [...realCities];
    
    // Always add current location as first destination for comparison
    if (currentLocationWeather) {
      allDestinations = [currentLocationWeather, ...realCities];
    }
    
    if (hasFilter) {
      const mockCount = Math.max(20, Math.floor(radiusKm / 20)); // Always 20+ mocks when filtering
      const mockDestinations = generateMockDestinations(userLat, userLon, radiusKm, mockCount, desiredCondition);
      const finalDestinations = [...allDestinations, ...mockDestinations];
      
      // Calculate badges before returning
      applyBadgesToDestinations(finalDestinations, currentLocationWeather, userLat, userLon, 'warm', radiusKm);
      
      return finalDestinations;
    }
    
    // No filter: add mocks only if needed
    const desiredTotal = Math.max(25, Math.min(35, Math.floor(radiusKm / 25)));
    const mockCount = Math.max(0, desiredTotal - allDestinations.length);
    
    if (mockCount > 0) {
      const mockDestinations = generateMockDestinations(userLat, userLon, radiusKm, mockCount);
      allDestinations = [...allDestinations, ...mockDestinations];
    }
    
    // Calculate badges before returning
    applyBadgesToDestinations(allDestinations, currentLocationWeather, userLat, userLon, 'warm', radiusKm);
    
    return allDestinations;
  } catch (error) {
    console.warn('Failed to load destinations from OpenWeatherMap', error);
    const mockDests = generateMockDestinations(userLat, userLon, radiusKm);
    // Even for mock data, try to calculate badges if we have current location weather
    if (currentLocationWeather) {
      applyBadgesToDestinations(mockDests, currentLocationWeather, userLat, userLon, 'warm', radiusKm);
    }
    return mockDests;
  }
};

const buildMockForecast = (lat, lon, name) => {
  // Use same deterministic seed logic as generateMockWeatherData
  const seed = Math.abs(lat * lon * 1000) % 10000;
  const seededRandom = (offset = 0) => ((seed + offset) % 100) / 100;
  
  const conditions = ['sunny', 'cloudy', 'rainy', 'snowy', 'windy'];
  const conditionIndex = Math.floor(seededRandom(1) * conditions.length);
  const condition = conditions[conditionIndex];
  
  const baseTemp = condition === 'snowy' ? -5 : condition === 'sunny' ? 25 : 15;
  const temp = baseTemp + (seededRandom(2) * 10 - 5);

  return {
    lat,
    lon,
    name: name || `Location at ${lat.toFixed(2)}, ${lon.toFixed(2)}`,
    condition,
    temperature: Math.round(temp),
    humidity: Math.round(50 + seededRandom(3) * 30),
    windSpeed: Math.round(5 + seededRandom(4) * 20),
    stability: Math.round(70 + seededRandom(5) * 25),
    isMockData: true, // Mark as mock for visual distinction
    forecast: {
      today: {
        condition,
        temp: Math.round(temp),
        high: Math.round(temp + 5),
        low: Math.round(temp - 5),
      },
      tomorrow: {
        condition: conditions[(conditionIndex + 1) % conditions.length],
        temp: Math.round(temp + 2),
        high: Math.round(temp + 7),
        low: Math.round(temp - 3),
      },
      day3: {
        condition: conditions[(conditionIndex + 2) % conditions.length],
        temp: Math.round(temp - 1),
        high: Math.round(temp + 4),
        low: Math.round(temp - 6),
      },
    },
    description: `${condition.charAt(0).toUpperCase() + condition.slice(1)} conditions`,
    fetchedAt: new Date().toISOString(),
  };
};

export const fetchDetailedForecast = async (lat, lon, name = null) => {
  if (!isValidCoordinate(lat) || !isValidCoordinate(lon)) {
    const mockForecast = buildMockForecast(lat || 0, lon || 0, name);
    return mockForecast;
  }

  const cacheKey = getCacheKey(lat, lon);
  const cached = getFromCache(cacheKey);
  if (cached) {
    return cached;
  }

  const apiKey = getOpenWeatherApiKey();

  if (!apiKey) {
    const mockForecast = buildMockForecast(lat, lon, name);
    setInCache(cacheKey, mockForecast);
    return mockForecast;
  }

  const url = `${FORECAST_URL}?lat=${lat}&lon=${lon}&units=metric&appid=${apiKey}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`OpenWeatherMap returned ${response.status}`);
    }

    const data = await response.json();
    const forecast = buildForecastFromResponse(data, lat, lon, name);
    setInCache(cacheKey, forecast);
    return forecast;
  } catch (error) {
    console.warn('Failed to fetch forecast from OpenWeatherMap', error);
    const mockForecast = buildMockForecast(lat, lon, name);
    setInCache(cacheKey, mockForecast);
    return mockForecast;
  }
};

const getCacheKey = (lat, lon) => `${lat}:${lon}`;

const isCacheValid = (cacheEntry) => {
  if (!cacheEntry) return false;
  return Date.now() - cacheEntry.timestamp < CACHE_TTL_MS;
};

const getFromCache = (key) => {
  const cacheEntry = forecastCache.get(key);
  if (isCacheValid(cacheEntry)) {
    return cacheEntry.data;
  }
  if (cacheEntry) {
    forecastCache.delete(key);
  }
  return null;
};

const setInCache = (key, data) => {
  forecastCache.set(key, {
    data,
    timestamp: Date.now(),
  });
};

/**
 * Generate weather warnings from extreme conditions
 * TODO: Replace with real weather alerts API (NINA, Meteoalarm, etc.)
 * For now, we detect extreme conditions from existing weather data
 */
export const generateWeatherWarnings = (destinations, userLat, userLon) => {
  const warnings = [];
  
  destinations.forEach((dest) => {
    // Skip user's current location
    if (dest.isCurrentLocation) return;
    
    const warningsForLocation = [];
    
    // EXTREME COLD: < 5 °C (demo threshold - will be stricter in production)
    if (dest.temperature < 5) {
      warningsForLocation.push({
        id: `warning-cold-${dest.id}`,
        type: WarningType.EXTREME_COLD,
        severity: dest.temperature < -15 ? 'extreme' : 'severe',
        title: `Extreme Kälte: ${Math.round(dest.temperature)} °C`,
        description: `Gefährlich niedrige Temperaturen in ${dest.name}`,
        location: {
          name: dest.name,
          latitude: dest.lat,
          longitude: dest.lon,
        },
        icon: '❄️',
        color: '#4169E1',
        label: 'Extremkälte',
        temperature: dest.temperature,
        distance: dest.distance,
      });
    }
    
    // EXTREME HEAT: > 30 °C
    if (dest.temperature > 30) {
      warningsForLocation.push({
        id: `warning-heat-${dest.id}`,
        type: WarningType.EXTREME_HEAT,
        severity: dest.temperature > 40 ? 'extreme' : 'severe',
        title: `Extremhitze: ${Math.round(dest.temperature)} °C`,
        description: `Gefährlich hohe Temperaturen in ${dest.name}`,
        location: {
          name: dest.name,
          latitude: dest.lat,
          longitude: dest.lon,
        },
        icon: '🌡️',
        color: '#FF6347',
        label: 'Extremhitze',
        temperature: dest.temperature,
        distance: dest.distance,
      });
    }
    
    // STRONG WIND: > 20 km/h (demo - will be stricter in production)
    if (dest.windSpeed > 20) {
      warningsForLocation.push({
        id: `warning-wind-${dest.id}`,
        type: WarningType.WIND,
        severity: dest.windSpeed > 50 ? 'extreme' : 'severe',
        title: `Starker Wind: ${Math.round(dest.windSpeed)} km/h`,
        description: `Gefährliche Windgeschwindigkeiten in ${dest.name}`,
        location: {
          name: dest.name,
          latitude: dest.lat,
          longitude: dest.lon,
        },
        icon: '💨',
        color: '#87CEEB',
        label: 'Starker Wind',
        windSpeed: dest.windSpeed,
        distance: dest.distance,
      });
    }
    
    // STORM: Combination of rain + wind
    const isRainy = dest.condition && (dest.condition.includes('rain') || dest.condition.includes('rainy'));
    if (isRainy && dest.windSpeed > 25) {
      warningsForLocation.push({
        id: `warning-storm-${dest.id}`,
        type: WarningType.STORM,
        severity: dest.windSpeed > 60 ? 'extreme' : 'severe',
        title: `Sturm in ${dest.name}`,
        description: `Starkregen mit Wind ${Math.round(dest.windSpeed)} km/h`,
        location: {
          name: dest.name,
          latitude: dest.lat,
          longitude: dest.lon,
        },
        icon: '⛈️',
        color: '#4B0082',
        label: 'Sturm',
        windSpeed: dest.windSpeed,
        distance: dest.distance,
      });
    }
    
    // Only add if we have warnings for this location
    if (warningsForLocation.length > 0) {
      // Pick the most severe warning for this location
      const mostSevere = warningsForLocation.sort((a, b) => {
        if (a.severity === 'extreme' && b.severity !== 'extreme') return -1;
        if (b.severity === 'extreme' && a.severity !== 'extreme') return 1;
        return 0;
      })[0];
      
      warnings.push(mostSevere);
    }
  });
  
  // Limit to 10 most critical warnings (closest or most severe)
  return warnings
    .sort((a, b) => {
      // Extreme severity comes first
      if (a.severity === 'extreme' && b.severity !== 'extreme') return -1;
      if (b.severity === 'extreme' && a.severity !== 'extreme') return 1;
      // Then sort by distance (closest first)
      return (a.distance || 0) - (b.distance || 0);
    })
    .slice(0, 10);
};


