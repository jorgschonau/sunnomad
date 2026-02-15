import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Text,
  ActivityIndicator,
  Platform,
  Animated,
  Linking,
} from 'react-native';
import Toast from 'react-native-toast-message';
import AsyncStorage from '@react-native-async-storage/async-storage';
import MapView, { Marker, Circle } from 'react-native-maps';
import * as Location from 'expo-location';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../theme/ThemeProvider';
import { getWeatherForRadius, getWeatherIcon, getWeatherColor, applyBadgesToDestinations } from '../../usecases/weatherUsecases';
import { BadgeMetadata } from '../../domain/destinationBadge';
import { playTickSound, playDingSound } from '../../utils/soundUtils';
// Badges are now calculated in weatherUsecases.js, not here!
import WeatherFilter from '../components/WeatherFilter';
import DateFilter from '../components/DateFilter';
import OnboardingOverlay from '../components/OnboardingOverlay';
import AnimatedBadge from '../components/AnimatedBadge';
// import AnimatedMarker from '../components/AnimatedMarker'; // Temporarily disabled
import { SkeletonMapMarker } from '../components/SkeletonLoader';
// import MapSearchBar from '../components/MapSearchBar'; // TODO: Component doesn't exist yet

// Custom map style to hide POI Business and Transit
const customMapStyle = [
  {
    featureType: 'poi.business',
    stylers: [{ visibility: 'off' }],
  },
  {
    featureType: 'transit',
    stylers: [{ visibility: 'off' }],
  },
];

// Map boundaries - restrict visible area
const MAP_BOUNDS = {
  north: 75,   // Spitzbergen + Puffer
  south: 15,   // Südlich von Mexico City + Puffer
  west: -175,  // Alaska + Pazifik-Inseln
  east: 50     // Östlich Ural + Puffer
};

const MapScreen = ({ navigation }) => {
  const { t, i18n } = useTranslation();
  const { theme } = useTheme();
  const mapRef = useRef(null);
  const [location, setLocation] = useState(null);
  const [centerPoint, setCenterPoint] = useState(null); // Custom center point (if set)
  const [centerPointWeather, setCenterPointWeather] = useState(null); // Weather for custom center
  const [destinations, setDestinations] = useState([]);
  const [visibleMarkers, setVisibleMarkers] = useState([]); // Filtered markers based on zoom
  const [currentZoom, setCurrentZoom] = useState(5); // Track zoom level
  const [currentBounds, setCurrentBounds] = useState(null); // Track viewport bounds
  const radiusDebounceTimer = useRef(null); // Debounce timer for radius changes
  const boundsDebounceTimer = useRef(null); // Debounce timer for bounds changes
  const [radius, setRadius] = useState(500); // Default 500km
  const [selectedCondition, setSelectedCondition] = useState(null);
  const [selectedDateOffset, setSelectedDateOffset] = useState(0); // 0=today, 1=tomorrow, 3=+3days, 5=+5days
  const [loading, setLoading] = useState(true);
  const [locationError, setLocationError] = useState(null); // Error state for location fetch
  const [loadingPhase, setLoadingPhase] = useState(0); // 0=searching, 1=waiting, 2=refining
  const loadingPhaseTimer = useRef(null);
  const [loadingDestinations, setLoadingDestinations] = useState(false);
  const [mapType, setMapType] = useState('standard'); // standard, satellite, hybrid, terrain, mutedStandard
  const [controlsExpanded, setControlsExpanded] = useState(true); // Controls einklappbar
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showOnlyBadges, setShowOnlyBadges] = useState(false); // Toggle to show only destinations with badges
  const [showRadiusMenu, setShowRadiusMenu] = useState(false); // Dropdown for radius selection
  const [reverseMode, setReverseMode] = useState('warm'); // 'warm' or 'cold' - which places to reward
  const [radiusShape, setRadiusShape] = useState('circle'); // 'circle', 'half', 'semi' - radius shape
  const [currentRegion, setCurrentRegion] = useState(null); // Track current map region
  // const [warnings, setWarnings] = useState([]); // Weather warnings - DISABLED
  // const [showWarnings, setShowWarnings] = useState(true); // Toggle for warnings display - DISABLED
  // const [showSearch, setShowSearch] = useState(false); // Toggle search bar - DISABLED (MapSearchBar component missing)
  const [cachedData, setCachedData] = useState(null); // Cache for destinations

  // Default fallback location (Frankfurt, center of Europe)
  const DEFAULT_LOCATION = {
    latitude: 50.1109,
    longitude: 8.6821,
    latitudeDelta: 2,
    longitudeDelta: 2,
  };

  /**
   * Fetch location with timeout wrapper.
   * Returns position or throws on timeout/error.
   */
  const fetchLocationWithTimeout = async (timeoutMs = 15000) => {
    return new Promise(async (resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('LOCATION_TIMEOUT'));
      }, timeoutMs);

      try {
        const position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        clearTimeout(timer);
        resolve(position);
      } catch (err) {
        clearTimeout(timer);
        reject(err);
      }
    });
  };

  /**
   * Start loading phase progress text timer.
   * Phase 0 (0-5s): "Suche GPS Signal..."
   * Phase 1 (5-10s): "Warte auf Standort..."
   * Phase 2 (10-15s): "Standort wird genauer..."
   */
  const startLoadingPhaseTimer = () => {
    setLoadingPhase(0);
    // Clear any existing timer
    if (loadingPhaseTimer.current) clearTimeout(loadingPhaseTimer.current);

    // Phase 1 after 5s
    loadingPhaseTimer.current = setTimeout(() => {
      setLoadingPhase(1);
      // Phase 2 after 10s
      loadingPhaseTimer.current = setTimeout(() => {
        setLoadingPhase(2);
      }, 5000);
    }, 5000);
  };

  const stopLoadingPhaseTimer = () => {
    if (loadingPhaseTimer.current) {
      clearTimeout(loadingPhaseTimer.current);
      loadingPhaseTimer.current = null;
    }
  };

  /**
   * Skip location → use default (Frankfurt).
   */
  const skipToDefaultLocation = useCallback(() => {
    stopLoadingPhaseTimer();
    setLocation(DEFAULT_LOCATION);
    setLocationError(null);
    setLoading(false);
    showToast(t('map.usingDefaultLocation'), 'info');
  }, [t]);

  /**
   * Open device settings (for enabling Location Services).
   */
  const openLocationSettings = () => {
    if (Platform.OS === 'ios') {
      Linking.openURL('app-settings:');
    } else {
      Linking.openSettings();
    }
  };

  /**
   * Initialize location + cached data. Called on mount and on retry.
   */
  const initializeLocation = async () => {
    setLoading(true);
    setLocationError(null);
    startLoadingPhaseTimer();

    // Check if first time user
    const hasSeenOnboarding = await AsyncStorage.getItem('hasSeenOnboarding');
    if (!hasSeenOnboarding) {
      setShowOnboarding(true);
    }

    // Load cached center point
    try {
      const savedCenter = await AsyncStorage.getItem('mapCenterPoint');
      if (savedCenter) {
        const center = JSON.parse(savedCenter);
        setCenterPoint(center);
      }
    } catch (error) {
      console.warn('Failed to load saved center point:', error);
    }

    // Load saved date offset
    try {
      const savedDateOffset = await AsyncStorage.getItem('selectedDateOffset');
      if (savedDateOffset !== null) {
        const offset = parseInt(savedDateOffset, 10);
        if ([0, 1, 3, 5].includes(offset)) {
          setSelectedDateOffset(offset);
        }
      }
    } catch (error) {
      console.warn('Failed to load saved date offset:', error);
    }

    // Load cached destinations and use them immediately so map shows something before refresh
    try {
      const cached = await AsyncStorage.getItem('mapDestinationsCache');
      if (cached) {
        const cacheData = JSON.parse(cached);
        // Check if cache is less than 1 hour old
        if (Date.now() - cacheData.timestamp < 3600000 && Array.isArray(cacheData.data) && cacheData.data.length > 0) {
          setCachedData(cacheData.data);
          setDestinations(cacheData.data);
        }
      }
    } catch (error) {
      console.warn('Failed to load cache:', error);
    }

    // 1. Check if Location Services are enabled
    try {
      const enabled = await Location.hasServicesEnabledAsync();
      if (!enabled) {
        stopLoadingPhaseTimer();
        setLocationError('disabled');
        setLoading(false);
        return;
      }
    } catch (error) {
      console.warn('Could not check location services:', error);
    }

    // 2. Request permission
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        stopLoadingPhaseTimer();
        setLocationError('permission');
        setLoading(false);
        return;
      }
    } catch (error) {
      console.error('Location permission error:', error);
      stopLoadingPhaseTimer();
      setLocationError('permission');
      setLoading(false);
      return;
    }

    // 3. Fetch position with 15s timeout
    try {
      const currentLocation = await fetchLocationWithTimeout(15000);
      const initialRegion = {
        latitude: currentLocation.coords.latitude,
        longitude: currentLocation.coords.longitude,
        latitudeDelta: 2,
        longitudeDelta: 2,
      };
      setLocation(initialRegion);
      
      // Set initial bounds
      const initialBounds = {
        north: initialRegion.latitude + initialRegion.latitudeDelta / 2,
        south: initialRegion.latitude - initialRegion.latitudeDelta / 2,
        east: initialRegion.longitude + initialRegion.longitudeDelta / 2,
        west: initialRegion.longitude - initialRegion.longitudeDelta / 2,
      };
      setCurrentBounds(initialBounds);
      setLocationError(null);
    } catch (error) {
      console.error('Location fetch failed:', error);
      if (error.message === 'LOCATION_TIMEOUT') {
        setLocationError('timeout');
      } else {
        setLocationError('unavailable');
      }
    }

    stopLoadingPhaseTimer();
    setLoading(false);
  };

  useEffect(() => {
    initializeLocation();
  }, []);

  // Persist selected date offset to AsyncStorage
  useEffect(() => {
    AsyncStorage.setItem('selectedDateOffset', selectedDateOffset.toString()).catch(err =>
      console.warn('Failed to save date offset:', err)
    );
  }, [selectedDateOffset]);

  useEffect(() => {
    if (location) {
      console.log('🔄 Trigger: location/radius/condition/centerPoint/centerPointWeather changed, reloading destinations...');
      
      // Debounce radius changes to prevent rapid re-fetching
      if (radiusDebounceTimer.current) {
        clearTimeout(radiusDebounceTimer.current);
      }
      
      radiusDebounceTimer.current = setTimeout(() => {
        loadDestinations();
      }, 500); // Wait 500ms after last radius change
      
      // Adjust map region immediately (no debounce for visual feedback)
      const effectiveCenter = centerPoint || location;
      if (mapRef.current && effectiveCenter) {
        mapRef.current.animateToRegion({
          latitude: effectiveCenter.latitude,
          longitude: effectiveCenter.longitude,
          latitudeDelta: (radius * 2) / 111,
          longitudeDelta: (radius * 2) / (111* Math.cos(effectiveCenter.latitude * Math.PI / 180)),
        }, 600); // Langsamere Animation (600ms statt 500ms)
      }
    }
    
    // Cleanup timer on unmount
    return () => {
      if (radiusDebounceTimer.current) {
        clearTimeout(radiusDebounceTimer.current);
      }
    };
  }, [location, radius, selectedCondition, centerPoint, centerPointWeather]);

  /**
   * Derive display destinations from raw data + selected date offset.
   * Shifts temperature/condition/forecast AND recalculates badges.
   * NO network request needed when date changes!
   */
  const displayDestinations = useMemo(() => {
    if (selectedDateOffset === 0) return destinations;

    // Helper: build a shifted keyed forecast object from an array starting at offset
    const buildShiftedForecast = (arr, offset) => {
      const keys = ['today', 'tomorrow', 'day2', 'day3'];
      const result = {};
      keys.forEach((key, i) => {
        const entry = arr[offset + i];
        if (entry) {
          result[key] = { ...entry };
        }
      });
      return result;
    };
    
    const shifted = destinations.map(dest => {
      // Open-Meteo sourced (currentLocation, centerPoint) — use forecastDays array
      if (dest.forecastDays && dest.forecastDays[selectedDateOffset]) {
        const dayData = dest.forecastDays[selectedDateOffset];
        // Build forecast for badge calculation (include all fields badges need)
        const shiftedForecast = {};
        const keys = ['today', 'tomorrow', 'day2', 'day3'];
        keys.forEach((key, i) => {
          const fd = dest.forecastDays[selectedDateOffset + i];
          if (fd) {
            shiftedForecast[key] = {
              condition: fd.condition,
              temp: fd.temperature,
              high: Math.round(fd.temp_max || fd.temperature),
              low: Math.round(fd.temp_min || fd.temperature - 3),
              precipitation: fd.precipitation,
              windSpeed: fd.windSpeed,
              sunshine_duration: fd.sunshine_duration || 0,
            };
          }
        });
        return {
          ...dest,
          temperature: dayData.temperature,
          condition: dayData.condition,
          temp_max: dayData.temp_max,
          temp_min: dayData.temp_min,
          windSpeed: dayData.windSpeed,
          precipitation: dayData.precipitation,
          sunshine_duration: dayData.sunshine_duration || 0,
          forecast: shiftedForecast,
        };
      }

      // Supabase sourced (regular destinations) — use forecastArray
      if (dest.forecastArray && dest.forecastArray.length > selectedDateOffset) {
        const dayData = dest.forecastArray[selectedDateOffset];
        return {
          ...dest,
          temperature: dayData.high ?? dayData.temp ?? dest.temperature,
          condition: dayData.condition ?? dest.condition,
          windSpeed: dayData.windSpeed ?? dest.windSpeed,
          precipitation: dayData.precipitation ?? dest.precipitation,
          sunshine_duration: dayData.sunshine_duration ?? dest.sunshine_duration,
          humidity: dayData.humidity ?? dest.humidity,
          description: dayData.description ?? dest.description,               // RAINY_DAYS: heavy rain check
          weather_description: dayData.description ?? dest.weather_description, // alias
          forecast: buildShiftedForecast(dest.forecastArray, selectedDateOffset),
        };
      }

      // Fallback: use keyed forecast
      const FORECAST_KEY_MAP = { 1: 'tomorrow', 2: 'day2', 3: 'day3', 4: 'day4', 5: 'day5' };
      const forecastKey = FORECAST_KEY_MAP[selectedDateOffset];
      if (dest.forecast && forecastKey && dest.forecast[forecastKey]) {
        const dayData = dest.forecast[forecastKey];
        return {
          ...dest,
          temperature: dayData.high ?? dayData.temp ?? dest.temperature,
          condition: dayData.condition ?? dest.condition,
        };
      }
      return dest;
    });

    // Recalculate badges with the shifted weather data
    // IMPORTANT: centerPoint first (matches loadDestinations: centerPointWeather || currentLocationWeather)
    const origin = shifted.find(d => d.isCenterPoint) || shifted.find(d => d.isCurrentLocation);
    if (origin) {
      console.log(`🏆 Recalculating badges for date offset ${selectedDateOffset} (origin: ${origin.temperature} °C)`);
      applyBadgesToDestinations(shifted, origin, origin.lat, origin.lon);
    }

    return shifted;
  }, [destinations, selectedDateOffset]);

  // Derive shifted center point weather from displayDestinations (respects date offset)
  const displayCenterPointWeather = useMemo(() => {
    if (!centerPointWeather) return null;
    return displayDestinations.find(d => d.isCenterPoint) || centerPointWeather;
  }, [displayDestinations, centerPointWeather]);

  // Update visible markers when display data or zoom changes (NOT on pan/bounds)
  useEffect(() => {
    if (displayDestinations.length > 0) {
      const visible = getVisibleMarkers(displayDestinations, currentZoom, currentBounds);
      setVisibleMarkers(visible);
      
      const specialCount = visible.filter(v => v.isCurrentLocation || v.isCenterPoint).length;
      const badgeCount = visible.filter(v => getMapBadges(v.badges).length > 0 && !v.isCurrentLocation && !v.isCenterPoint).length;
      const regularCount = visible.length - specialCount - badgeCount;
      console.log(`🔍 Zoom ${currentZoom}: ${visible.length} markers (${specialCount} special + ${badgeCount} map badges + ${regularCount} regular) of ${displayDestinations.length}`);
    }
  }, [displayDestinations, currentZoom]);

  const loadDestinations = async () => {
    if (!location) return;
    
    setLoadingDestinations(true);
    try {
      // Use centerPoint if set, otherwise use user location
      const effectiveCenter = centerPoint || location;
      
      console.log(`🔄 Loading destinations for center: ${effectiveCenter.latitude.toFixed(2)}, ${effectiveCenter.longitude.toFixed(2)}, radius: ${radius}km`);
      
      // Get origin temperature for badge calculation
      const originTemp = centerPointWeather?.temperature || null;
      
      const weatherData = await getWeatherForRadius(
        effectiveCenter.latitude,
        effectiveCenter.longitude,
        radius,
        selectedCondition,
        originTemp, // Pass center point temp for accurate badge calculation!
        i18n.language // Pass locale for country name translation
      );
      
      // ALWAYS add current location as first marker
      const currentLocationWeather = await getCurrentLocationWeather();
      
      // Build destinations array: current location + center point (if set) + other destinations
      let allDestinations = [];
      
      if (currentLocationWeather) {
        allDestinations.push(currentLocationWeather);
      }
      
      // Add center point weather if it exists
      if (centerPointWeather) {
        allDestinations.push(centerPointWeather);
      }
      
      // Add all other destinations
      allDestinations = [...allDestinations, ...weatherData];
      
      // Calculate badges (AFTER current location is added!)
      // Use centerPointWeather if available, otherwise use currentLocationWeather
      const originWeather = centerPointWeather || currentLocationWeather;
      const originLat = centerPoint ? centerPoint.latitude : location.latitude;
      const originLon = centerPoint ? centerPoint.longitude : location.longitude;
      
      console.log(`🏆 Badge origin: ${centerPointWeather ? 'centerPoint' : 'currentLocation'} (${originWeather?.temperature} °C at ${originWeather?.name})`);
      
      // Badges are now calculated in weatherUsecases.js - no need to apply here!
      
      setDestinations(allDestinations);
      
      // DEBUG: Log all loaded places
      console.log(`📋 ALL ${allDestinations.length} loaded places:`);
      allDestinations.forEach((d, i) => {
        console.log(`  ${i}: ${d.name} (${d.lat?.toFixed(2)}, ${d.lon?.toFixed(2)}) ${d.temperature} °C ${d.condition || ''} ${d.badges?.length ? '🏆' + d.badges.join(',') : ''}`);
      });
      // Cache destinations
      try {
        await AsyncStorage.setItem('mapDestinationsCache', JSON.stringify({
          timestamp: Date.now(),
          data: allDestinations,
        }));
      } catch (cacheError) {
        console.warn('Failed to cache destinations:', cacheError);
      }
      
      // Generate warnings from destinations (independent of filter) - DISABLED
      // const generatedWarnings = generateWeatherWarnings(
      //   allDestinations,
      //   location.latitude,
      //   location.longitude
      // );
      // setWarnings(generatedWarnings);
    } catch (error) {
      showToast(t('map.failedToLoadWeather') || 'Failed to load weather data', 'error');
      console.error(error);
    } finally {
      setLoadingDestinations(false);
    }
  };

  /**
   * Fetch weather for current location (always show, independent of DB)
   */
  const getCurrentLocationWeather = async () => {
    if (!location) return null;
    
    try {
      // Get city name from reverse geocoding
      let cityName = 'Dein Standort';
      try {
        const geocode = await Location.reverseGeocodeAsync({
          latitude: location.latitude,
          longitude: location.longitude,
        });
        
        if (geocode && geocode[0]) {
          // Prefer city, fall back to district, then region
          cityName = geocode[0].city || geocode[0].district || geocode[0].region || 'Dein Standort';
        }
      } catch (geoError) {
        console.warn('Reverse geocoding failed:', geoError);
      }

      // Use Open-Meteo API for current location - fetch 14 days for badge recalc at any date offset
      const params = new URLSearchParams({
        latitude: location.latitude,
        longitude: location.longitude,
        daily: [
          'temperature_2m_max',
          'temperature_2m_min',
          'weather_code',
          'precipitation_sum',
          'wind_speed_10m_max',
          'sunshine_duration',
        ].join(','),
        current: [
          'relative_humidity_2m',
          'cloud_cover',
        ].join(','),
        timezone: 'auto',
        forecast_days: 14,
      });

      const url = `https://customer-api.open-meteo.com/v1/forecast?${params}&apikey=8cJ4NUh7dYHZF1uv`;
      const response = await fetch(url);

      if (!response.ok) return null;

      const data = await response.json();
      const daily = data.daily;
      const current = data.current || {};

      // Build forecastDays array (index 0 = today, 1 = tomorrow, etc.)
      const forecastDaysArr = daily.weather_code?.map((code, i) => ({
        condition: mapWeatherCodeToCondition(code),
        temperature: Math.round(daily.temperature_2m_max?.[i] || 0),
        temp_max: daily.temperature_2m_max?.[i],
        temp_min: daily.temperature_2m_min?.[i],
        windSpeed: Math.round(daily.wind_speed_10m_max?.[i] || 0),
        precipitation: daily.precipitation_sum?.[i] || 0,
        sunshine_duration: daily.sunshine_duration?.[i] || 0,
      })) || [];

      // Default display: today's data (offset applied later via useMemo)
      const condition = mapWeatherCodeToCondition(daily.weather_code?.[0]);
      
      return {
        lat: location.latitude,
        lon: location.longitude,
        name: `📍 ${cityName}`,
        condition,
        temperature: Math.round(daily.temperature_2m_max?.[0] || 0),
        temp_max: daily.temperature_2m_max?.[0],
        temp_min: daily.temperature_2m_min?.[0],
        humidity: current.relative_humidity_2m,
        windSpeed: Math.round(daily.wind_speed_10m_max?.[0] || 0),
        precipitation: daily.precipitation_sum?.[0] || 0,
        cloudCover: current.cloud_cover,
        stability: calculateStability(current.cloud_cover, daily.wind_speed_10m_max?.[0]),
        distance: 0,
        isCurrentLocation: true,
        badges: [],
        forecastDays: forecastDaysArr, // All 6 days for date filter
      };
    } catch (error) {
      console.warn('Failed to fetch current location weather:', error);
      return null;
    }
  };

  /**
   * Map Open-Meteo weather code to app condition
   */
  const mapWeatherCodeToCondition = (code) => {
    if (!code && code !== 0) return 'cloudy';
    
    if (code === 0 || code === 1) return 'sunny';
    if (code === 2 || code === 3) return 'cloudy';
    if (code >= 45 && code <= 48) return 'windy';
    if (code >= 51 && code <= 67) return 'rainy';
    if (code >= 71 && code <= 77) return 'snowy';
    if (code >= 80 && code <= 99) return 'rainy';
    
    return 'cloudy';
  };

  /**
   * Calculate stability from cloud cover and wind speed
   */
  const calculateStability = (cloudCover, windSpeed) => {
    const cloudScore = 100 - (cloudCover || 50);
    const windScore = Math.max(0, 100 - (windSpeed || 5) * 2);
    return Math.round((cloudScore + windScore) / 2);
  };

  const handleMarkerPress = (destination) => {
    navigation.navigate('DestinationDetail', { destination, selectedDateOffset });
  };

  const handleRadiusIncrease = async () => {
    const newRadius = Math.min(radius + 50, 5000); // Max 5000 km
    setRadius(newRadius);
    await playDingSound(); // Play ding sound on interaction
    // Note: loadDestinations is debounced in useEffect (500ms delay)
  };

  const handleRadiusDecrease = async () => {
    const newRadius = Math.max(radius - 50, 50); // Min 50 km
    setRadius(newRadius);
    await playDingSound(); // Play ding sound on interaction
    // Note: loadDestinations is debounced in useEffect (500ms delay)
  };

  const handleRadiusSelect = async (newRadius) => {
    setRadius(newRadius);
    setShowRadiusMenu(false);
    await playDingSound(); // Play ding sound on interaction
    // Note: loadDestinations is debounced in useEffect (500ms delay)
  };

  const handleCloseOnboarding = async () => {
    await AsyncStorage.setItem('hasSeenOnboarding', 'true');
    setShowOnboarding(false);
  };

  const getStabilitySymbol = (destination) => {
    // TREND: Compare TODAY vs TOMORROW from forecast data
    // ↑ = Weather getting BETTER
    // = = Weather staying SAME
    // ↓ = Weather getting WORSE
    
    // If we have weatherTrend from DB, use that (pre-calculated)
    if (destination.weatherTrend) {
      if (destination.weatherTrend === 'improving') return '↑';
      if (destination.weatherTrend === 'worsening') return '↓';
      return '=';
    }
    
    // Fallback: Calculate from current data (rough estimate)
    // TODO: This should be calculated properly in the weather update script
    // and stored in weather_data table as 'weather_trend'
    
    const temp = destination.temperature || 0;
    const condition = destination.condition || 'cloudy';
    
    // Simple heuristic until we have real forecast comparison:
    // Sunny + warm = likely staying good/improving
    // Rainy/cold = likely worsening
    if (condition === 'sunny' && temp >= 15) return '↑';
    if (condition === 'light_rain' || condition === 'heavy_rain' || condition === 'rainy' || temp < 5) return '↓';
    return '=';
  };

  // No more dynamic marker scaling - library handles density!

  const toggleMapType = () => {
    const mapTypes = ['standard', 'mutedStandard', 'satellite', 'hybrid', 'terrain'];
    const currentIndex = mapTypes.indexOf(mapType);
    const nextIndex = (currentIndex + 1) % mapTypes.length;
    setMapType(mapTypes[nextIndex]);
  };

  const getMapTypeLabel = () => {
    return t(`mapType.${mapType}`, { defaultValue: t('mapType.standard') });
  };

  const toggleReverseMode = async () => {
    setReverseMode(prev => prev === 'warm' ? 'cold' : 'warm');
    await playTickSound();
    // TODO: Implement badge calculation reversal (cold places get rewards)
  };

  const toggleRadiusShape = async () => {
    const shapes = ['circle', 'half', 'semi'];
    const currentIndex = shapes.indexOf(radiusShape);
    const nextIndex = (currentIndex + 1) % shapes.length;
    setRadiusShape(shapes[nextIndex]);
    await playTickSound();
    // TODO: Implement radius shape filtering
  };

  /**
   * Calculate dynamic zoom limits based on radius
   */
  const getZoomLimits = () => {
    // minZoom: Allow user to see entire radius
    // Formula: smaller minZoom for larger radius (MORE RELAXED!)
    let minZoom;
    if (radius <= 400) {
      minZoom = 4; // Normal radius (was 5, now 4 - more zoom out)
    } else if (radius <= 800) {
      minZoom = 3; // Medium radius (was 4, now 3)
    } else if (radius <= 1500) {
      minZoom = 2; // Large radius (was 3, now 2)
    } else {
      minZoom = 1; // Very large radius (was 2, now 1 - almost world view)
    }

    // maxZoom: Prevent zooming in too close (always 15)
    const maxZoom = 15;

    return { minZoom, maxZoom };
  };

  /**
   * Show toast notification (cross-platform)
   */
  const showToast = (message, type = 'info') => {
    Toast.show({
      type: type === 'error' ? 'error' : type === 'success' ? 'success' : 'info',
      text1: message,
      position: 'bottom',
      visibilityTime: 2000,
    });
  };

  /**
   * Get all badges for map markers (all badges are shown on map now)
   */
  const getMapBadges = (badges) => {
    if (!badges || badges.length === 0) return [];
    return badges;
  };

  /**
   * Calculate display score: Badges first, then TEMPERATURE (warmest wins!)
   */
  const getDisplayScore = (place) => {
    // Orte mit Badges = immer max Score (100)
    const mapBadges = getMapBadges(place.badges);
    if (mapBadges.length > 0) {
      return 100;
    }
    
    // TEMPERATUR als Hauptfaktor! (0-40 °C → 0-80 Punkte)
    const temp = place.temperature ?? 15;
    const tempScore = Math.min(80, Math.max(0, temp * 2)); // 20 °C = 40pts, 30 °C = 60pts
    
    // Sunny weather bonus
    const sunnyConditions = ['clear', 'sunny', 'Clear', 'Sunny'];
    const sunnyBonus = sunnyConditions.includes(place.condition) || 
                       sunnyConditions.includes(place.weather_main) ? 15 : 0;
    
    return tempScore + sunnyBonus;
  };

  /**
   * SOFT CLUSTERING ALGORITHM
   * - Always shows 100-200 markers
   * - Natural clustering allowed (more markers where weather is good)
   * - Max 30 markers per 100km region (prevents extreme clustering)
   * - Min 5km between markers (prevents overlap)
   * - Prioritizes: special > badges > score > temperature
   */
  
  // ========== BALANCED MARKER FILTER ==========
  // Shows mix of badge places AND normal good places
  
  /**
   * Dynamic max markers based on zoom and radius
   * Standard zoom: 3-4, reinzoomen: 5-6
   */
  const getMaxMarkers = (zoom, radiusKm) => {
    let base = Math.floor(radiusKm / 20);
    
    let zoomFactor;
    if (zoom <= 3) zoomFactor = 0.6;      // Standard rausgezoomt
    else if (zoom <= 4) zoomFactor = 1.0;  // Standard normal
    else if (zoom <= 5) zoomFactor = 1.5;  // Etwas reingezoomt
    else zoomFactor = 2.0;                 // 6+
    
    const total = Math.min(Math.max(base * zoomFactor, 25), 150);
    return Math.round(total);
  };
  
  /**
   * Minimum distance between markers (in km) based on zoom
   * Standard zoom: 3-4, reinzoomen: 5-6
   */
  const getMinDistanceForZoom = (zoom) => {
    if (zoom <= 4) return 80;    // Weit rausgezoomt (Europa)
    if (zoom <= 5) return 60;    // Länder-Ansicht
    if (zoom <= 6) return 45;    // Regional
    if (zoom <= 7) return 30;    // Städte-Ansicht
    return 20;                   // 8+ (nah dran)
  };
  
  /**
   * Sort places by: attractiveness score → temperature → distance from user
   */
  const sortByQuality = (places, userLat, userLon) => {
    return [...places].sort((a, b) => {
      // Special markers always first
      if (a.isCurrentLocation || a.isCenterPoint) return -1;
      if (b.isCurrentLocation || b.isCenterPoint) return 1;
      
      // Primary: Attractiveness score (higher is better)
      const aScore = a.attractivenessScore || a.attractiveness_score || 50;
      const bScore = b.attractivenessScore || b.attractiveness_score || 50;
      if (Math.abs(aScore - bScore) > 5) return bScore - aScore;
      
      // Secondary: Temperature (warmer is better)
      const aTemp = a.temperature || 0;
      const bTemp = b.temperature || 0;
      if (Math.abs(aTemp - bTemp) > 2) return bTemp - aTemp;
      
      // Tertiary: Distance from user (closer is better)
      if (userLat && userLon) {
        const aLat = a.lat || a.latitude;
        const aLon = a.lon || a.longitude;
        const bLat = b.lat || b.latitude;
        const bLon = b.lon || b.longitude;
        const aDist = getDistanceKm(userLat, userLon, aLat, aLon);
        const bDist = getDistanceKm(userLat, userLon, bLat, bLon);
        return aDist - bDist;
      }
      
      return 0;
    });
  };
  
  const getVisibleMarkers = (allPlaces, zoom, bounds) => {
    const candidates = allPlaces.filter(p => 
      p.temperature !== null && p.temperature !== undefined
    );
    if (candidates.length === 0) return [];
    
    const userLat = location?.latitude;
    const userLon = location?.longitude;
    const maxMarkers = getMaxMarkers(zoom, radius);
    const minDistance = getMinDistanceForZoom(zoom);
    
    // Constant grid size for consistent geographic balance (independent of zoom)
    const GRID_SIZE_KM = 250;
    const gridSize = GRID_SIZE_KM / 111;
    
    console.log('🎯 Filter Config:', { maxMarkers, minDistance: minDistance + 'km', zoom, radius: radius + 'km', candidates: candidates.length });
    
    // Separate special markers (always shown)
    const specialMarkers = candidates.filter(p => p.isCurrentLocation || p.isCenterPoint);
    
    // Budget badge places are ALWAYS shown, regardless of zoom/grid/distance
    const budgetPlaces = candidates.filter(p => 
      !p.isCurrentLocation && !p.isCenterPoint && 
      p.badges?.includes('WORTH_THE_DRIVE_BUDGET')
    );
    
    // Sort rest: badges first, then by quality
    const rest = candidates.filter(p => 
      !p.isCurrentLocation && !p.isCenterPoint && 
      !p.badges?.includes('WORTH_THE_DRIVE_BUDGET')
    );
    const sorted = [...rest].sort((a, b) => {
      const aBadges = getMapBadges(a.badges).length;
      const bBadges = getMapBadges(b.badges).length;
      if (aBadges !== bBadges) return bBadges - aBadges;
      
      const aScore = a.attractivenessScore || a.attractiveness_score || 50;
      const bScore = b.attractivenessScore || b.attractiveness_score || 50;
      if (Math.abs(aScore - bScore) > 5) return bScore - aScore;
      
      const aTemp = a.temperature || 0;
      const bTemp = b.temperature || 0;
      if (Math.abs(aTemp - bTemp) > 2) return bTemp - aTemp;
      
      if (userLat && userLon) {
        const aDist = getDistanceKm(userLat, userLon, a.lat || a.latitude, a.lon || a.longitude);
        const bDist = getDistanceKm(userLat, userLon, b.lat || b.latitude, b.lon || b.longitude);
        return aDist - bDist;
      }
      return 0;
    });
    
    // Adaptive strategy: Phase 1 = best places, Phase 2 = grid-limited diversity
    const PHASE_1_RATIO = 0.4;
    const phase1Limit = Math.floor(maxMarkers * PHASE_1_RATIO);
    const GRID_LIMIT = 3;
    
    const gridsUsed = new Map();
    const getGridKey = (lat, lon) => {
      const gLat = Math.floor(lat / gridSize) * gridSize;
      const gLon = Math.floor(lon / gridSize) * gridSize;
      return `${gLat.toFixed(1)},${gLon.toFixed(1)}`;
    };
    
    const result = [...specialMarkers, ...budgetPlaces];
    if (budgetPlaces.length > 0) {
      console.log(`💰 ${budgetPlaces.length} Budget badge places always shown: ${budgetPlaces.map(p => p.name).join(', ')}`);
    }
    let skipped = 0;
    let gridLimited = 0;
    
    for (const place of sorted) {
      if (result.length >= maxMarkers) {
        break;
      }
      
      const lat = place.lat || place.latitude;
      const lon = place.lon || place.longitude;
      const gridKey = getGridKey(lat, lon);
      const gridCount = gridsUsed.get(gridKey) || 0;
      const hasBadges = getMapBadges(place.badges).length > 0;
      
      // PHASE 1: First 40% - take best places, no grid limit (badges always allowed)
      const inPhase1 = result.length < phase1Limit;
      
      // PHASE 2: Last 60% - enforce grid limit (max 3 per grid)
      if (!inPhase1 && !hasBadges && gridCount >= GRID_LIMIT) {
        gridLimited++;
        continue;
      }
      
      // Distance check (same as before)
      let tooClose = false;
      for (const existing of result) {
        const dist = getDistanceKm(lat, lon, existing.lat || existing.latitude, existing.lon || existing.longitude);
        if (dist < minDistance) {
          tooClose = true;
          break;
        }
      }
      
      if (!tooClose) {
        result.push(place);
        gridsUsed.set(gridKey, gridCount + 1);
      } else {
        skipped++;
      }
    }
    
    const finalBadgeCount = result.filter(p => getMapBadges(p.badges).length > 0).length;
    const normalCount = result.length - finalBadgeCount - specialMarkers.length;
    const phase = result.length <= phase1Limit ? 'Phase1 only' : 'Phase1+2';
    console.log(`📊 Final: ${result.length} markers (${finalBadgeCount} badges + ${normalCount} normal), ${skipped} too close, ${gridLimited} grid limited, ${gridsUsed.size} grids [${phase}]`);
    return result;
  };

  /**
   * Calculate distance between two points (Haversine formula)
   */
  const getDistanceKm = (lat1, lon1, lat2, lon2) => {
    const R = 6371; // Earth radius in km
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

  const toRadians = (degrees) => {
    return degrees * (Math.PI / 180);
  };

  /**
   * Handle long press on map to set new center point
   */
  const handleMapLongPress = async (event) => {
    const { latitude, longitude } = event.nativeEvent.coordinate;
    
    playTickSound();
    
    // Set new center point
    const newCenter = {
      latitude,
      longitude,
      latitudeDelta: 2,
      longitudeDelta: 2,
    };
    
    setCenterPoint(newCenter);
    
    // Fetch weather for new center point
    await fetchCenterPointWeather(latitude, longitude);
    
    // Save to AsyncStorage
    try {
      await AsyncStorage.setItem('mapCenterPoint', JSON.stringify(newCenter));
    } catch (error) {
      console.warn('Failed to save center point:', error);
    }
    
    showToast('📍 Neuer Mittelpunkt gesetzt', 'info');
    
    // Note: useEffect with centerPoint dependency will automatically reload destinations
  };

  /**
   * Fetch weather for center point (similar to getCurrentLocationWeather)
   */
  const fetchCenterPointWeather = async (lat, lon) => {
    try {
      // Get city name from reverse geocoding
      let cityName = 'Neuer Mittelpunkt';
      try {
        const geocode = await Location.reverseGeocodeAsync({
          latitude: lat,
          longitude: lon,
        });
        
        if (geocode && geocode[0]) {
          cityName = geocode[0].city || geocode[0].district || geocode[0].region || 'Neuer Mittelpunkt';
        }
      } catch (geoError) {
        console.warn('Reverse geocoding failed:', geoError);
      }

      // Use Open-Meteo API - fetch 14 days for badge recalc at any date offset
      const params = new URLSearchParams({
        latitude: lat,
        longitude: lon,
        daily: [
          'temperature_2m_max',
          'temperature_2m_min',
          'weather_code',
          'precipitation_sum',
          'wind_speed_10m_max',
          'sunshine_duration',
        ].join(','),
        current: [
          'relative_humidity_2m',
          'cloud_cover',
        ].join(','),
        timezone: 'auto',
        forecast_days: 14,
      });

      const url = `https://customer-api.open-meteo.com/v1/forecast?${params}&apikey=8cJ4NUh7dYHZF1uv`;
      const response = await fetch(url);

      if (!response.ok) {
        setCenterPointWeather(null);
        return;
      }

      const data = await response.json();
      const daily = data.daily;
      const current = data.current || {};

      // Build forecastDays array (index 0 = today, 1 = tomorrow, etc.)
      const forecastDaysArr = daily.weather_code?.map((code, i) => ({
        condition: mapWeatherCodeToCondition(code),
        temperature: Math.round(daily.temperature_2m_max?.[i] || 0),
        temp_max: daily.temperature_2m_max?.[i],
        temp_min: daily.temperature_2m_min?.[i],
        windSpeed: Math.round(daily.wind_speed_10m_max?.[i] || 0),
        precipitation: daily.precipitation_sum?.[i] || 0,
        sunshine_duration: daily.sunshine_duration?.[i] || 0,
      })) || [];

      // Default display: today's data (offset applied later via useMemo)
      const condition = mapWeatherCodeToCondition(daily.weather_code?.[0]);
      
      const weatherData = {
        lat,
        lon,
        name: `⊕ ${cityName}`,
        condition,
        temperature: Math.round(daily.temperature_2m_max?.[0] || 0),
        temp_max: daily.temperature_2m_max?.[0],
        temp_min: daily.temperature_2m_min?.[0],
        humidity: current.relative_humidity_2m,
        windSpeed: Math.round(daily.wind_speed_10m_max?.[0] || 0),
        precipitation: daily.precipitation_sum?.[0] || 0,
        cloudCover: current.cloud_cover,
        stability: calculateStability(current.cloud_cover, daily.wind_speed_10m_max?.[0]),
        isCenterPoint: true,
        badges: [],
        forecastDays: forecastDaysArr, // All 6 days for date filter
      };
      
      setCenterPointWeather(weatherData);
    } catch (error) {
      console.warn('Failed to fetch center point weather:', error);
      setCenterPointWeather(null);
    }
  };

  /**
   * Reset center point to user location
   */
  const resetCenterPoint = async () => {
    setCenterPoint(null);
    setCenterPointWeather(null);
    try {
      await AsyncStorage.removeItem('mapCenterPoint');
    } catch (error) {
      console.warn('Failed to remove center point:', error);
    }
    playTickSound();
    showToast('📍 Mittelpunkt zurückgesetzt', 'info');
    
    // Note: useEffect with centerPoint dependency will automatically reload destinations
  };

  /**
   * Handle search result selection
   */
  const handleSearchSelect = (place) => {
    if (!mapRef.current) return;

    // Fly to selected place
    mapRef.current.animateToRegion({
      latitude: place.lat,
      longitude: place.lon,
      latitudeDelta: 1,
      longitudeDelta: 1,
    }, 1000);

    // Show place details after a short delay
    setTimeout(() => {
      handleMarkerPress(place);
    }, 1200);

    setShowSearch(false);
    playTickSound();
  };

  /**
   * Track map region changes to enforce boundaries + calculate zoom + bounds
   */
  const handleRegionChangeComplete = (region) => {
    // Calculate zoom from latitudeDelta
    // Zoom ~= log2(360 / latitudeDelta)
    const zoom = Math.round(Math.log2(360 / region.latitudeDelta));
    const newZoom = Math.max(1, Math.min(20, zoom));
    
    if (newZoom !== currentZoom) {
      const oldMax = getMaxMarkers(currentZoom, radius);
      const newMax = getMaxMarkers(newZoom, radius);
      const oldDist = getMinDistanceForZoom(currentZoom);
      const newDist = getMinDistanceForZoom(newZoom);
      console.log(`📏 ZOOM CHANGED: ${currentZoom} → ${newZoom} | Max: ${oldMax} → ${newMax} | MinDist: ${oldDist}km → ${newDist}km`);
      setCurrentZoom(newZoom);
    }
    
    // Calculate viewport bounds
    const { latitude, longitude, latitudeDelta, longitudeDelta } = region;
    const bounds = {
      north: latitude + latitudeDelta / 2,
      south: latitude - latitudeDelta / 2,
      east: longitude + longitudeDelta / 2,
      west: longitude - longitudeDelta / 2,
    };
    setCurrentBounds(bounds);
    
    // Enforce map boundaries
    let needsAdjustment = false;
    let newLatitude = latitude;
    let newLongitude = longitude;
    
    if (latitude > MAP_BOUNDS.north) {
      newLatitude = MAP_BOUNDS.north;
      needsAdjustment = true;
    } else if (latitude < MAP_BOUNDS.south) {
      newLatitude = MAP_BOUNDS.south;
      needsAdjustment = true;
    }
    
    if (longitude > MAP_BOUNDS.east) {
      newLongitude = MAP_BOUNDS.east;
      needsAdjustment = true;
    } else if (longitude < MAP_BOUNDS.west) {
      newLongitude = MAP_BOUNDS.west;
      needsAdjustment = true;
    }
    
    // If out of bounds, animate back to valid region
    if (needsAdjustment && mapRef.current) {
      mapRef.current.animateToRegion({
        latitude: newLatitude,
        longitude: newLongitude,
        latitudeDelta: region.latitudeDelta,
        longitudeDelta: region.longitudeDelta,
      }, 300);
    }
    
    setCurrentRegion(region);
  };

  if (loading && !location) {
    const phaseTexts = [
      t('map.loadingPhase0'),
      t('map.loadingPhase1'),
      t('map.loadingPhase2'),
    ];
    return (
      <View style={[styles.loadingContainer, { backgroundColor: theme.background }]}>
        <ActivityIndicator size="large" color={theme.primary} />
        <Text style={[styles.loadingText, { color: theme.text }]}>
          {phaseTexts[loadingPhase] || phaseTexts[0]}
        </Text>
        {/* Skip button visible after 5 seconds */}
        {loadingPhase >= 1 && (
          <TouchableOpacity
            style={[styles.skipButton, { borderColor: theme.textSecondary || '#888' }]}
            onPress={skipToDefaultLocation}
            activeOpacity={0.7}
          >
            <Text style={[styles.skipButtonText, { color: theme.textSecondary || '#888' }]}>
              {t('map.skipLocation')}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  if (!location && locationError) {
    const isPermission = locationError === 'permission';
    const isDisabled = locationError === 'disabled';

    const errorMessage = locationError === 'timeout'
      ? t('map.locationTimeout')
      : isDisabled
        ? t('map.locationDisabled')
        : isPermission
          ? t('map.locationNotAvailable')
          : t('map.locationUnavailable');

    return (
      <View style={[styles.loadingContainer, { backgroundColor: theme.background }]}>
        <Text style={{ fontSize: 48, marginBottom: 16 }}>📍</Text>
        <Text style={[styles.errorText, { color: theme.error }]}>{errorMessage}</Text>

        {/* Settings button for permission/disabled */}
        {(isPermission || isDisabled) && (
          <TouchableOpacity
            style={[styles.retryButton, { backgroundColor: '#FF8C42', marginBottom: 12 }]}
            onPress={openLocationSettings}
            activeOpacity={0.8}
          >
            <Text style={styles.retryButtonText}>{t('map.openSettings')}</Text>
          </TouchableOpacity>
        )}

        {/* Retry button */}
        <TouchableOpacity
          style={[styles.retryButton, { backgroundColor: theme.primary }]}
          onPress={initializeLocation}
          activeOpacity={0.8}
        >
          <Text style={styles.retryButtonText}>{t('map.retryLocation')}</Text>
        </TouchableOpacity>

        {/* Skip button (use default location) */}
        <TouchableOpacity
          style={[styles.skipButton, { borderColor: theme.textSecondary || '#888', marginTop: 16 }]}
          onPress={skipToDefaultLocation}
          activeOpacity={0.7}
        >
          <Text style={[styles.skipButtonText, { color: theme.textSecondary || '#888' }]}>
            {t('map.skipLocation')}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!location) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: theme.background }]}>
        <Text style={[styles.errorText, { color: theme.error }]}>{t('map.locationNotAvailable')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <OnboardingOverlay 
        visible={showOnboarding} 
        onClose={handleCloseOnboarding}
      />
      
      {/* Search Bar - DISABLED (MapSearchBar component missing) */}
      {/* {showSearch && (
        <MapSearchBar 
          onSelectPlace={handleSearchSelect}
          onClose={() => setShowSearch(false)}
        />
      )} */}
      
      <MapView
        ref={mapRef}
        style={styles.map}
        mapType={mapType}
        customMapStyle={customMapStyle}
        initialRegion={{
          latitude: location.latitude,
          longitude: location.longitude,
          // Start more zoomed out for cleaner view (multiply by 1.5)
          latitudeDelta: (radius * 2 * 1.5) / 111,
          longitudeDelta: (radius * 2 * 1.5) / (111 * Math.cos(location.latitude * Math.PI / 180)),
        }}
        minZoomLevel={getZoomLimits().minZoom}  // Dynamic based on radius!
        maxZoomLevel={getZoomLimits().maxZoom}  // Always 15 (prevent street level)
        pitchEnabled={false}  // Disable tilt/3D view
        rotateEnabled={false}  // Disable rotation
        showsUserLocation
        showsMyLocationButton
        onLongPress={handleMapLongPress}
        onRegionChangeComplete={handleRegionChangeComplete}
      >
        {/* Radius Circle - centered on centerPoint or location */}
        {(centerPoint || location) && (
          <Circle
            key={`radius-circle-${radius}-${(centerPoint || location).latitude}-${(centerPoint || location).longitude}`}
            center={{
              latitude: (centerPoint || location).latitude,
              longitude: (centerPoint || location).longitude,
            }}
            radius={radius * 1000}
            strokeWidth={4}
            strokeColor={centerPoint ? "#FF5722" : "#424242"}
            fillColor={centerPoint ? "rgba(255, 87, 34, 0.2)" : "rgba(66, 66, 66, 0.2)"}
          />
        )}

        {/* Custom Center Point Marker - Shows weather for SELECTED DATE */}
        {centerPoint && (
          <Marker
            coordinate={{ latitude: centerPoint.latitude, longitude: centerPoint.longitude }}
            anchor={{ x: 0.5, y: 0.5 }}
            onPress={() => displayCenterPointWeather && handleMarkerPress(displayCenterPointWeather)}
          >
            {displayCenterPointWeather ? (
              <View style={[
                styles.markerContainer,
                { backgroundColor: getWeatherColor(displayCenterPointWeather.condition, displayCenterPointWeather.temperature) },
                styles.centerPointMarker
              ]}>
                <Text style={styles.markerWeatherIcon}>{getWeatherIcon(displayCenterPointWeather.condition)}</Text>
                <Text style={styles.markerTemp}>
                  {displayCenterPointWeather.temperature !== null && displayCenterPointWeather.temperature !== undefined 
                    ? Math.round(displayCenterPointWeather.temperature) 
                    : '?'}°
                </Text>
                <View style={styles.centerPointBadgeIndicator}>
                  <Text style={styles.centerPointBadgeText}>⊕</Text>
                </View>
              </View>
            ) : (
              <View style={styles.centerPointCircleMarker}>
                <View style={styles.centerPointCircleInner}>
                  <Text style={styles.centerPointIcon}>⊕</Text>
                </View>
              </View>
            )}
          </Marker>
        )}

        {/* Greedy-filtered markers based on zoom + score */}
        {visibleMarkers
          .filter(dest => {
            if (!showOnlyBadges) return true;
            // When trophy filter active, only show badges that count for trophy
            const trophyBadges = getMapBadges(dest.badges).filter(b => !BadgeMetadata[b]?.excludeFromTrophy);
            return trophyBadges.length > 0;
          })
          .map((dest, index) => (
          <Marker
            key={`${dest.lat}-${dest.lon}-${index}`}
            coordinate={{ latitude: dest.lat, longitude: dest.lon }}
            onPress={() => handleMarkerPress(dest)}
          >
            <View style={[
              styles.markerContainer, 
              { backgroundColor: getWeatherColor(dest.condition, dest.temperature) },
              dest.isCurrentLocation && styles.currentLocationMarker,
              dest.isCenterPoint && styles.centerPointMarker
            ]}>
              <Text style={styles.markerWeatherIcon}>{getWeatherIcon(dest.condition)}</Text>
              <Text style={styles.markerTemp}>
                {dest.temperature !== null && dest.temperature !== undefined 
                  ? Math.round(dest.temperature) 
                  : '?'}°
              </Text>
              
              {/* Stability arrows DISABLED - too complicated for users
              <View style={[
                styles.stabilityBadge, 
                dest.isCurrentLocation && styles.currentLocationBadge,
                dest.isCenterPoint && styles.centerPointBadge
              ]}>
                <Text style={styles.stabilityText}>{getStabilitySymbol(dest)}</Text>
              </View>
              */}
              
              {/* Badge overlays (stacked vertically on right side) with animations */}
              {/* Badge overlays */}
              {getMapBadges(dest.badges).length > 0 && (
                <View style={styles.badgeOverlayContainer}>
                  {getMapBadges(dest.badges)
                    .sort((a, b) => (BadgeMetadata[a]?.priority || 99) - (BadgeMetadata[b]?.priority || 99)) // Sort by priority
                    .slice(0, 6) // Max 6 badges per marker
                    .map((badge, badgeIndex) => (
                      <AnimatedBadge
                        key={badgeIndex}
                        icon={BadgeMetadata[badge].icon}
                        color={BadgeMetadata[badge].color}
                        delay={badgeIndex * 100} // Stagger animation for multiple badges
                      />
                    ))}
                </View>
              )}
            </View>
          </Marker>
        ))}

        {/* Weather Warnings - DISABLED */}
      </MapView>

      {/* Loading Overlay for destinations */}
      {loadingDestinations && (
        <View style={styles.loadingOverlay}>
          <View style={[styles.loadingBox, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <ActivityIndicator size="large" color={theme.primary} />
            <Text style={[styles.loadingOverlayText, { color: theme.text }]}>
              {t('map.loadingLocation')}...
            </Text>
          </View>
        </View>
      )}

      {/* Empty state when trophy filter is active but no places */}
      {showOnlyBadges && !loadingDestinations && visibleMarkers.filter(dest => {
        const trophyBadges = getMapBadges(dest.badges).filter(b => !BadgeMetadata[b]?.excludeFromTrophy);
        return trophyBadges.length > 0;
      }).length === 0 && (
        <View style={[styles.emptyStateOverlay, { backgroundColor: 'rgba(0, 0, 0, 0.5)' }]} pointerEvents="box-none">
          <View style={[styles.emptyStateBox, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text style={styles.emptyStateIcon}>🏆</Text>
            <Text style={[styles.emptyStateTitle, { color: theme.text }]}>Keine Highlights</Text>
            <Text style={[styles.emptyStateMessage, { color: theme.textSecondary }]}>
              in {radius} km Radius
            </Text>
            <TouchableOpacity
              style={styles.emptyStatePrimaryButton}
              onPress={() => {
                const newRadius = Math.min(radius * 2, 5000);
                setRadius(newRadius);
                playTickSound();
              }}
            >
              <Text style={styles.emptyStatePrimaryButtonText}>Radius erweitern</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.emptyStateSecondaryButton}
              onPress={() => {
                setShowOnlyBadges(false);
                playTickSound();
              }}
            >
              <Text style={[styles.emptyStateSecondaryButtonText, { color: theme.textSecondary }]}>Alle Orte anzeigen</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Favourites Button */}
      <TouchableOpacity
        style={[styles.favouritesButton, { 
          backgroundColor: theme.surface,
          borderColor: theme.border,
          shadowColor: theme.shadow
        }]}
        onPress={() => navigation.navigate('Favourites')}
        accessibilityLabel={t('app.favourites')}
        accessibilityRole="button"
        accessibilityHint="View your saved favourite destinations"
      >
        <Text style={styles.favouritesIcon}>⭐</Text>
      </TouchableOpacity>

      {/* Badge Filter Toggle Button */}
      <TouchableOpacity
        style={[styles.badgeToggleButton, { 
          backgroundColor: showOnlyBadges ? '#FFD700' : theme.surface,
          borderColor: theme.border,
          shadowColor: theme.shadow,
          opacity: 1.0, // Always fully visible
        }]}
        onPress={() => {
          setShowOnlyBadges(!showOnlyBadges);
          playTickSound();
        }}
        accessibilityLabel={showOnlyBadges ? 'Show all destinations' : 'Show only special destinations'}
        accessibilityRole="switch"
        accessibilityState={{ checked: showOnlyBadges }}
        accessibilityHint="Filter to show only destinations with special badges"
      >
        <Text style={[styles.badgeToggleIcon, { 
          color: showOnlyBadges ? '#000' : theme.text,
          opacity: 1.0, // Always fully visible
        }]}>🏆</Text>
      </TouchableOpacity>

      {/* Smart Spacing Toggle Button - REMOVED (now always active based on zoom) */}

      {/* Warnings Toggle Button - REMOVED */}

      {/* Settings Button */}
      <TouchableOpacity
        style={[styles.settingsButton, { 
          backgroundColor: theme.surface,
          borderColor: theme.border,
          shadowColor: theme.shadow
        }]}
        onPress={() => navigation.navigate('Settings')}
        accessibilityLabel={t('app.settings')}
        accessibilityRole="button"
        accessibilityHint="Open app settings"
      >
        <Text style={styles.settingsIcon}>⚙️</Text>
      </TouchableOpacity>

      {/* Search Button - DISABLED (MapSearchBar component missing) */}
      {/* {!showSearch && (
        <TouchableOpacity
          style={[styles.searchButton, { 
            backgroundColor: theme.surface,
            borderColor: theme.border,
            shadowColor: theme.shadow
          }]}
          onPress={() => {
            setShowSearch(true);
            playTickSound();
          }}
          accessibilityLabel="Search destinations"
          accessibilityRole="button"
          accessibilityHint="Open search to find destinations by name"
        >
          <Text style={styles.searchIcon}>🔍</Text>
        </TouchableOpacity>
      )} */}

      {/* Reset Center Button (only show if centerPoint is set) */}
      {centerPoint && (
        <TouchableOpacity
          style={[styles.resetCenterButton, { 
            backgroundColor: '#FF5722',
            borderColor: '#fff',
            shadowColor: theme.shadow
          }]}
          onPress={resetCenterPoint}
          accessibilityLabel="Reset center point"
          accessibilityRole="button"
          accessibilityHint="Reset map center to your current location"
        >
          <Text style={styles.resetCenterIcon}>📍</Text>
          <Text style={styles.resetCenterText}>↺</Text>
        </TouchableOpacity>
      )}

      {/* Collapsible Controls */}
      <View style={styles.controlsWrapper}>
        <TouchableOpacity
          style={[styles.controlsToggle, {
            backgroundColor: theme.surface,
            borderColor: theme.border,
            shadowColor: theme.shadow
          }]}
          onPress={() => setControlsExpanded(!controlsExpanded)}
          accessibilityLabel={controlsExpanded ? 'Hide filters' : 'Show filters'}
          accessibilityRole="button"
          accessibilityHint="Toggle weather and radius filter controls"
          accessibilityState={{ expanded: controlsExpanded }}
        >
          <Text style={[styles.controlsToggleText, { color: theme.text }]}>
            {controlsExpanded ? '▼ Filter' : '▶ Filter'}
          </Text>
        </TouchableOpacity>
        
        {controlsExpanded && (
          <View style={[styles.controlsContainer, {
            backgroundColor: theme.surface,
            borderColor: theme.border,
            shadowColor: theme.shadow
          }]}>
            <DateFilter
              selectedDateOffset={selectedDateOffset}
              onDateOffsetChange={setSelectedDateOffset}
            />
            
            <View style={styles.filterSeparator} />
            
            <WeatherFilter
              selectedCondition={selectedCondition}
              onConditionChange={setSelectedCondition}
            />
          </View>
        )}
      </View>

      <View style={styles.radiusControlsWrapper}>
        {showRadiusMenu && (
          <View style={[styles.radiusPresetMenu, {
            backgroundColor: theme.surface,
            borderColor: theme.border,
            shadowColor: theme.shadow
          }]}>
            {[200, 500, 1000, 2000].map((radiusOption) => (
              <TouchableOpacity
                key={radiusOption}
                style={[styles.radiusPresetItem, radiusOption === radius && styles.radiusPresetItemActive]}
                onPress={() => handleRadiusSelect(radiusOption)}
              >
                <Text style={[
                  styles.radiusPresetText,
                  { color: radiusOption === radius ? theme.primary : theme.text }
                ]}>
                  {radiusOption} km
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
        
        <TouchableOpacity 
          style={[styles.radiusDisplay, {
            backgroundColor: theme.surface,
            borderColor: showRadiusMenu ? theme.primary : theme.border,
            shadowColor: theme.shadow
          }]}
          onPress={() => setShowRadiusMenu(!showRadiusMenu)}
          accessibilityLabel={t('radius.title')}
          accessibilityRole="button"
        >
          <Text style={[styles.radiusLabel, { color: theme.textTertiary }]}>{t('radius.title')}</Text>
          <Text style={[styles.radiusDisplayText, { color: theme.text }]}>{radius} km</Text>
        </TouchableOpacity>
        <View style={[styles.radiusControls, {
          backgroundColor: theme.surface,
          borderColor: theme.border,
          shadowColor: theme.shadow
        }]}>
          {/* + Button */}
          <TouchableOpacity
            style={[styles.radiusButton, styles.radiusButtonTop, {
              backgroundColor: theme.background
            }]}
            onPress={handleRadiusIncrease}
            accessibilityLabel={t('radius.more')}
            accessibilityRole="button"
            accessibilityHint={`Increase search radius from ${radius} km`}
          >
            <Text style={[styles.radiusButtonText, { color: theme.text }]}>+</Text>
            <Text style={[styles.radiusButtonLabel, { color: theme.textSecondary }]}>{t('radius.more')}</Text>
          </TouchableOpacity>
          
          {/* - Button */}
          <TouchableOpacity
            style={[styles.radiusButton, styles.radiusButtonBottom, {
              backgroundColor: theme.background
            }]}
            onPress={handleRadiusDecrease}
            accessibilityLabel={t('radius.less')}
            accessibilityRole="button"
            accessibilityHint={`Decrease search radius from ${radius} km`}
          >
            <Text style={[styles.radiusButtonText, { color: theme.text }]}>−</Text>
            <Text style={[styles.radiusButtonLabel, { color: theme.textSecondary }]}>{t('radius.less')}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Zoom Level Indicator */}
      <View style={[styles.zoomIndicator, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Text style={[styles.zoomIndicatorText, { color: theme.textSecondary }]}>Z{currentZoom}</Text>
      </View>

      {/* Bottom Left Buttons Container */}
      <View style={styles.bottomLeftButtons}>
        {/* Reverse Mode Button (Warm/Cold) */}
        <TouchableOpacity
          style={[styles.reverseButton, {
            backgroundColor: reverseMode === 'warm' ? '#FF6B35' : '#2196F3',
            borderColor: '#fff',
            shadowColor: theme.shadow
          }]}
          onPress={toggleReverseMode}
          accessibilityLabel={`Reverse mode: ${reverseMode}`}
          accessibilityRole="button"
          accessibilityHint="Toggle between rewarding warm or cold places"
        >
          <Text style={styles.reverseIcon}>🌡️</Text>
        </TouchableOpacity>

        {/* Radius Shape Button */}
        <TouchableOpacity
          style={[styles.radiusShapeButton, {
            backgroundColor: theme.surface,
            borderColor: theme.border,
            shadowColor: theme.shadow
          }]}
          onPress={toggleRadiusShape}
          onLongPress={() => {
            playTickSound();
            // TODO: Implement rotation on long press
          }}
          accessibilityLabel={`Radius shape: ${radiusShape}`}
          accessibilityRole="button"
          accessibilityHint="Tap to change shape, long press to rotate"
        >
          <Text style={[styles.radiusShapeIcon, { color: theme.text }]}>
            {radiusShape === 'circle' ? '⭕' : radiusShape === 'half' ? '◐' : '◔'}
          </Text>
        </TouchableOpacity>
      </View>

      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="small" color="#2E7D32" />
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 10,
    fontSize: 20,
    fontWeight: '500',
  },
  errorText: {
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
    paddingHorizontal: 32,
    marginBottom: 24,
  },
  retryButton: {
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  skipButton: {
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 12,
    borderWidth: 1.5,
    marginTop: 12,
  },
  skipButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  controlsWrapper: {
    position: 'absolute',
    top: 10,
    left: 10,
    right: 80,
  },
  controlsToggle: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 3,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  controlsToggleText: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  controlsContainer: {
    marginTop: 10,
    borderRadius: 12,
    padding: 16,
    borderWidth: 3,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  filterSeparator: {
    height: 1,
    backgroundColor: '#E0E0E0',
    marginVertical: 12,
  },
  markerContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  currentLocationMarker: {
    borderColor: '#2196F3',
    borderWidth: 4,
  },
  markerWeatherIcon: {
    fontSize: 28,
  },
  markerTemp: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000',
    marginTop: 2,
    textShadowColor: '#fff',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  stabilityBadge: {
    position: 'absolute',
    bottom: -18,
    backgroundColor: '#2E7D32',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#fff',
    minWidth: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  currentLocationBadge: {
    backgroundColor: '#2196F3',
  },
  centerPointMarker: {
    borderColor: '#FF5722',
    borderWidth: 4,
  },
  centerPointBadge: {
    backgroundColor: '#FF5722',
  },
  centerPointBadgeIndicator: {
    position: 'absolute',
    bottom: -10,
    backgroundColor: '#FF5722',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#fff',
  },
  centerPointBadgeText: {
    fontSize: 14,
    color: '#fff',
    fontWeight: 'bold',
  },
  centerPointCircleMarker: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(33, 150, 243, 0.3)', // Blau mit Transparenz
    borderWidth: 4,
    borderColor: '#2196F3',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#2196F3',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 8,
    elevation: 8,
  },
  centerPointCircleInner: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#2196F3',
    justifyContent: 'center',
    alignItems: 'center',
  },
  centerPointIcon: {
    fontSize: 28,
    color: '#fff',
    fontWeight: 'bold',
    textAlign: 'center',
  },
  stabilityText: {
    fontSize: 18,
    color: '#fff',
    fontWeight: 'bold',
    lineHeight: 18,
  },
  badgeOverlayContainer: {
    position: 'absolute',
    top: -8,
    right: -8,
    flexDirection: 'column',
    gap: 4,
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  zoomLoadingIndicator: {
    position: 'absolute',
    top: 80,
    left: '50%',
    marginLeft: -15,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderRadius: 15,
    padding: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  loadingBox: {
    padding: 30,
    borderRadius: 20,
    borderWidth: 2,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 10,
  },
  loadingOverlayText: {
    marginTop: 16,
    fontSize: 18,
    fontWeight: '600',
  },
  radiusControlsWrapper: {
    position: 'absolute',
    bottom: 50,
    right: 20,
    alignItems: 'center',
  },
  radiusDisplay: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 3,
    marginBottom: 8,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
    elevation: 5,
    alignItems: 'center',
  },
  radiusLabel: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 2,
  },
  radiusDisplayText: {
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  radiusControls: {
    flexDirection: 'row',
    borderRadius: 10,
    borderWidth: 3,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 8,
    overflow: 'hidden',
  },
  radiusButton: {
    width: 70,
    height: 70,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#BDBDBD',
  },
  radiusButtonTop: {
    borderTopLeftRadius: 8,
    borderBottomLeftRadius: 8,
    borderTopWidth: 0,
    borderBottomWidth: 0,
    borderLeftWidth: 0,
    borderRightWidth: 1,
    borderRightColor: '#E0E0E0',
  },
  radiusButtonBottom: {
    borderTopWidth: 0,
    borderBottomWidth: 0,
    borderRightWidth: 0,
    borderLeftWidth: 0,
    borderTopRightRadius: 8,
    borderBottomRightRadius: 8,
  },
  radiusButtonText: {
    fontSize: 28,
    fontWeight: '600',
    lineHeight: 28,
  },
  radiusButtonLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  radiusPresetMenu: {
    position: 'absolute',
    bottom: 160,
    right: 0,
    borderWidth: 2,
    borderRadius: 16,
    paddingVertical: 8,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 8,
    minWidth: 140,
    zIndex: 1000,
  },
  radiusPresetItem: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.05)',
  },
  radiusPresetItemActive: {
    backgroundColor: 'rgba(0,0,0,0.08)',
  },
  radiusPresetText: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  zoomIndicator: {
    position: 'absolute',
    bottom: 120,
    left: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    opacity: 0.7,
  },
  zoomIndicatorText: {
    fontSize: 12,
    fontWeight: '600',
  },
  bottomLeftButtons: {
    position: 'absolute',
    bottom: 50,
    left: 20,
    flexDirection: 'row',
    gap: 12,
  },
  reverseButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 6,
  },
  reverseIcon: {
    fontSize: 26,
  },
  radiusShapeButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 6,
  },
  radiusShapeIcon: {
    fontSize: 28,
  },
  favouritesButton: {
    position: 'absolute',
    top: 84,
    right: 10,
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 8,
  },
  favouritesIcon: {
    fontSize: 36,
    textAlign: 'center',
    lineHeight: 36,
    includeFontPadding: false,
    marginTop: 4,
  },
  badgeToggleButton: {
    position: 'absolute',
    top: 158, // Below favourites button
    right: 10,
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 8,
  },
  badgeToggleIcon: {
    fontSize: 36,
    textAlign: 'center',
    lineHeight: 36,
    includeFontPadding: false,
    marginTop: 4,
  },
  warningsToggleButton: {
    position: 'absolute',
    top: 306, // Below badge toggle (232 + 64 + 10)
    right: 10,
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 8,
  },
  warningsToggleIcon: {
    fontSize: 36,
    textAlign: 'center',
    lineHeight: 36,
    includeFontPadding: false,
    marginTop: 4,
  },
  spacingToggleButton: {
    position: 'absolute',
    top: 306, // Below badge toggle (232 + 64 + 10) - moved up since warnings removed
    right: 10,
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 8,
  },
  spacingToggleIcon: {
    fontSize: 36,
    textAlign: 'center',
    lineHeight: 36,
    includeFontPadding: false,
    marginTop: 4,
  },
  warningMarkerContainer: {
    padding: 8,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 70,
    minHeight: 70,
    borderWidth: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.6,
    shadowRadius: 5,
    elevation: 8,
  },
  warningIcon: {
    fontSize: 32,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  warningSeverityBadge: {
    position: 'absolute',
    top: -8,
    right: -8,
    backgroundColor: '#FFD700', // GELB
    borderRadius: 6, // Etwas eckiger
    width: 34,
    height: 34,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#000', // SCHWARZ
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.8,
    shadowRadius: 3,
    elevation: 10,
  },
  warningSeverityText: {
    color: '#000', // SCHWARZES AUSRUFEZEICHEN
    fontSize: 24,
    fontWeight: 'bold',
    marginTop: -2,
  },
  settingsButton: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 8,
  },
  settingsIcon: {
    fontSize: 36,
    textAlign: 'center',
    lineHeight: 36,
    includeFontPadding: false,
    marginTop: 4,
  },
  searchButton: {
    position: 'absolute',
    top: 10,
    left: 10,
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 8,
  },
  searchIcon: {
    fontSize: 36,
    textAlign: 'center',
    lineHeight: 36,
    includeFontPadding: false,
    marginTop: 4,
  },
  resetCenterButton: {
    position: 'absolute',
    bottom: 140,
    left: 20,
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 8,
  },
  resetCenterIcon: {
    fontSize: 24,
    textAlign: 'center',
    marginTop: -4,
  },
  resetCenterText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    marginTop: -2,
  },
  crosshairMarker: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(255, 87, 34, 0.8)',
    borderWidth: 3,
    borderColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 6,
  },
  crosshairText: {
    fontSize: 32,
    color: '#fff',
    fontWeight: 'bold',
    textAlign: 'center',
  },
  emptyStateOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyStateBox: {
    padding: 32,
    paddingHorizontal: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    maxWidth: '75%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 10,
  },
  emptyStateIcon: {
    fontSize: 36,
    marginBottom: 16,
  },
  emptyStateTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 6,
    textAlign: 'center',
  },
  emptyStateMessage: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  emptyStatePrimaryButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center',
    marginBottom: 12,
  },
  emptyStatePrimaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  emptyStateSecondaryButton: {
    paddingVertical: 8,
  },
  emptyStateSecondaryButtonText: {
    fontSize: 14,
    textDecorationLine: 'underline',
  },
});

export default MapScreen;



