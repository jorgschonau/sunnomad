import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Text,
  TextInput,
  ActivityIndicator,
  Platform,
  Linking,
  InteractionManager,
  Keyboard,
} from 'react-native';
import Toast from 'react-native-toast-message';
import AsyncStorage from '@react-native-async-storage/async-storage';
import MapView, { Marker, Circle } from 'react-native-maps';
import * as Location from 'expo-location';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../theme/ThemeProvider';
import { getWeatherForRadius, getWeatherIcon, getWeatherColor, mapWeatherCode, applyBadgesToDestinations } from '../../usecases/weatherUsecases';
import { BadgeMetadata, DestinationBadge } from '../../domain/destinationBadge';
import { playTickSound } from '../../utils/soundUtils';
import { trackMapViews, trackDetailView } from '../../services/placesService';
import { hybridSearch, ensurePlaceInDB } from '../../services/hybridSearchService';
import { getPlaceDetail } from '../../services/placesWeatherService';
import { getPlaceName } from '../../utils/localization';
import { getFavourites } from '../../usecases/favouritesUsecases';
import WeatherFilter from '../components/WeatherFilter';
import DateFilter from '../components/DateFilter';
import OnboardingOverlay from '../components/OnboardingOverlay';
import AnimatedBadge from '../components/AnimatedBadge';
import { useUnits } from '../../contexts/UnitContext';
import { formatTemperature, formatDistance } from '../../utils/unitConversion';
import { hasDedicatedHeroImage } from '../../utils/heroImages';
import { supabase } from '../../config/supabase';

// Custom map style to hide POI Business and Transit
const customMapStyle = [
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'landscape.man_made', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'labels', stylers: [{ visibility: 'off' }] },
];

const DestinationMarker = ({
  dest,
  index,
  onPress,
  getMapBadges,
  getWeatherColor,
  getWeatherIcon,
  styles: markerStyles,
  temperatureUnit,
}) => {
  const hasImageBadge = getMapBadges(dest.badges).some(
    b => b === DestinationBadge.WARM_AND_DRY || b === DestinationBadge.HEATWAVE
  );
  const [imageLoaded, setImageLoaded] = useState(!hasImageBadge);
  const handleImageLoad = useCallback(() => {
    setTimeout(() => setImageLoaded(true), 500);
  }, []);

  // Safety: force tracksViewChanges off after 3s even if image never fires onLoad
  useEffect(() => {
    if (imageLoaded || !hasImageBadge) return;
    const safety = setTimeout(() => setImageLoaded(true), 3000);
    return () => clearTimeout(safety);
  }, [hasImageBadge, imageLoaded]);

  return (
    <Marker
      coordinate={{ latitude: dest.lat, longitude: dest.lon }}
      anchor={{ x: 0.5, y: 0.5 }}
      style={{ overflow: 'visible', zIndex: 999 }}
      tracksViewChanges={hasImageBadge ? !imageLoaded : false}
      onPress={onPress}
    >
      <View style={markerStyles.markerFrameAndroid}>
        <View style={[
          markerStyles.markerContainer,
          { backgroundColor: getWeatherColor(dest.condition, dest.temperature) },
          dest.isCurrentLocation && markerStyles.currentLocationMarker,
          dest.isCenterPoint && markerStyles.centerPointMarker,
          hasDedicatedHeroImage(dest.id || dest.placeId) && markerStyles.dedicatedHeroMarker,
        ]}>
          <Text style={markerStyles.markerWeatherIcon}>{getWeatherIcon(dest.condition)}</Text>
          <Text style={markerStyles.markerTemp}>
            {dest.temperature !== null && dest.temperature !== undefined
              ? formatTemperature(dest.temperature, temperatureUnit, false)
              : '?°'}
          </Text>
          {getMapBadges(dest.badges).length > 0 && (() => {
            const sorted = getMapBadges(dest.badges)
              .sort((a, b) => (BadgeMetadata[a]?.priority || 99) - (BadgeMetadata[b]?.priority || 99))
              .slice(0, 6);
            const right = sorted.slice(0, 3);
            const left = sorted.slice(3);
            return (
              <>
                <View style={markerStyles.badgeOverlayContainer}>
                  {right.map((badge, i) => (
                    <AnimatedBadge
                      key={i}
                      icon={BadgeMetadata[badge].icon}
                      color={BadgeMetadata[badge].color}
                      delay={i * 100}
                      onImageLoad={hasImageBadge && typeof BadgeMetadata[badge].icon !== 'string' ? handleImageLoad : undefined}
                    />
                  ))}
                </View>
                {left.length > 0 && (
                  <View style={markerStyles.badgeOverlayContainerLeft}>
                    {left.map((badge, i) => (
                      <AnimatedBadge
                        key={i}
                        icon={BadgeMetadata[badge].icon}
                        color={BadgeMetadata[badge].color}
                        delay={(i + 3) * 100}
                        onImageLoad={hasImageBadge && typeof BadgeMetadata[badge].icon !== 'string' ? handleImageLoad : undefined}
                      />
                    ))}
                  </View>
                )}
              </>
            );
          })()}
        </View>
      </View>
    </Marker>
  );
};

// Map boundaries - restrict visible area
const MAP_BOUNDS = {
  north: 75,   // Spitzbergen + Puffer
  south: 15,   // Südlich von Mexico City + Puffer
  west: -175,  // Alaska + Pazifik-Inseln
  east: 50     // Östlich Ural + Puffer
};

const LOADING_STATES = [
  { text: 'Suche GPS Signal... 🛰️', duration: 2000 },
  { text: 'Bestimme Position... 📍', duration: 2000 },
  { text: 'Gleich geschafft... ⏱️', duration: 3000 },
];
const LOADING_TIPS = [
  'Tipp: WiFi hilft bei Indoor-Ortung',
  'Tipp: GPS funktioniert draußen am besten',
  'Tipp: Standort wird im Hintergrund aktualisiert',
];

const MapScreen = ({ navigation }) => {
  const { t, i18n } = useTranslation();
  const { theme } = useTheme();
  const { useImperial, temperatureUnit, distanceUnit } = useUnits();
  const mapRef = useRef(null);
  const [location, setLocation] = useState(null);
  const [centerPoint, setCenterPoint] = useState(null); // Custom center point (if set)
  const [centerPointWeather, setCenterPointWeather] = useState(null); // Weather for custom center
  const [destinations, setDestinations] = useState([]);
  const [displayDestinations, setDisplayDestinations] = useState([]); // Derived from destinations + date offset (async when offset !== 0)
  // visibleMarkers is derived via useMemo below
  const [mapViewport, setMapViewport] = useState({ zoom: 5, bounds: null });
  const currentZoomRef = useRef(5);
  const radiusDebounceTimer = useRef(null);

  const regionChangeDebounceTimer = useRef(null);
  const hasLoadedForLocationRef = useRef(false);
  const skipNextLocationAnimRef = useRef(false);
  const markerJustPressedRef = useRef(false);
  const lastMapTapRef = useRef(0);
  const [radius, setRadius] = useState(500); // Default 500km
  const [selectedCondition, setSelectedCondition] = useState(null);
  const [selectedDateOffset, setSelectedDateOffset] = useState(0); // 0=today, 1=tomorrow, 3=+3days, 5=+5days
  const [loading, setLoading] = useState(true);
  const [locationError, setLocationError] = useState(null); // Error state for location fetch
  const [locationPermissionGranted, setLocationPermissionGranted] = useState(false); // Track if GPS permission was granted
  const [isRecentering, setIsRecentering] = useState(false); // Prevent duplicate on-demand location requests
  const recenterCooldownUntilRef = useRef(0); // Throttle on-demand GPS requests
  const mapViewTrackedIds = useRef(new Set()); // Deduplicate map_view_count per session
  const mapViewTrackTimer = useRef(null);
  const [loadingState, setLoadingState] = useState(LOADING_STATES[0].text);
  const [loadingTipIndex, setLoadingTipIndex] = useState(0);
  const [showSkipLocation, setShowSkipLocation] = useState(false);
  const [loadingDestinations, setLoadingDestinations] = useState(false);
  const [controlsExpanded, setControlsExpanded] = useState(true); // Controls einklappbar
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showOnlyBadges, setShowOnlyBadges] = useState(false); // Toggle to show only destinations with badges
  const [showRadiusMenu, setShowRadiusMenu] = useState(false); // Dropdown for radius selection
  const [reverseMode, setReverseMode] = useState('warm'); // 'warm' or 'cold' - which places to reward
  const [currentRegion, setCurrentRegion] = useState(null); // Track current map region
  const [favouriteDestinations, setFavouriteDestinations] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [googleResults, setGoogleResults] = useState([]);
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchDebounceRef = useRef(null);

  // Default fallback location (Frankfurt, center of Europe)
  const DEFAULT_LOCATION = {
    latitude: 50.1109,
    longitude: 8.6821,
    latitudeDelta: 2,
    longitudeDelta: 2,
  };

  const applyLocationFromPosition = useCallback((position) => {
    if (!position?.coords) return;
    const initialRegion = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      latitudeDelta: 2,
      longitudeDelta: 2,
    };
    setLocation(initialRegion);
    setMapViewport(prev => ({
      ...prev,
      bounds: {
        north: initialRegion.latitude + initialRegion.latitudeDelta / 2,
        south: initialRegion.latitude - initialRegion.latitudeDelta / 2,
        east: initialRegion.longitude + initialRegion.longitudeDelta / 2,
        west: initialRegion.longitude - initialRegion.longitudeDelta / 2,
      },
    }));
    setLocationError(null);
  }, []);

  /**
   * Skip location → use default (Frankfurt).
   * Sets all required state so the map fully initializes without crashing.
   */
  const skipToDefaultLocation = useCallback(() => {
    try {
      setLocation(DEFAULT_LOCATION);
      setLocationError(null);
      setLoading(false);

      setMapViewport(prev => ({
        ...prev,
        bounds: {
          north: DEFAULT_LOCATION.latitude + DEFAULT_LOCATION.latitudeDelta / 2,
          south: DEFAULT_LOCATION.latitude - DEFAULT_LOCATION.latitudeDelta / 2,
          east: DEFAULT_LOCATION.longitude + DEFAULT_LOCATION.longitudeDelta / 2,
          west: DEFAULT_LOCATION.longitude - DEFAULT_LOCATION.longitudeDelta / 2,
        },
      }));

      showToast(t('map.usingDefaultLocation'), 'info');
    } catch (error) {
      console.error('skipToDefaultLocation failed:', error);
      // Last resort: force map to render with defaults
      setLocation(DEFAULT_LOCATION);
      setLocationError(null);
      setLoading(false);
    }
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
    setShowSkipLocation(false);
    setLoadingState(LOADING_STATES[0].text);
    setLoadingTipIndex(0);
    setLocationError(null);

    // Read all cached values in parallel instead of sequentially
    const [hasSeenOnboarding, savedCenter, savedDateOffset, cachedDestinations] = await Promise.all([
      AsyncStorage.getItem('hasSeenOnboarding').catch(() => null),
      AsyncStorage.getItem('mapCenterPoint').catch(() => null),
      AsyncStorage.getItem('selectedDateOffset').catch(() => null),
      AsyncStorage.getItem('mapDestinationsCache').catch(() => null),
    ]);

    if (!hasSeenOnboarding) {
      setShowOnboarding(true);
    }

    if (savedCenter) {
      try {
        setCenterPoint(JSON.parse(savedCenter));
      } catch (e) { /* corrupted JSON */ }
    }

    if (savedDateOffset !== null) {
      const offset = parseInt(savedDateOffset, 10);
      if ([0, 1, 3, 5, 7, 10].includes(offset)) {
        setSelectedDateOffset(offset);
      }
    }

    if (cachedDestinations) {
      try {
        const cacheData = JSON.parse(cachedDestinations);
        const cacheValid = Date.now() - cacheData.timestamp < 3600000
          && Array.isArray(cacheData.data) && cacheData.data.length > 0
          && cacheData.data.some(d => d.image_region !== undefined);
        if (cacheValid) {
          setDestinations(cacheData.data);
        }
      } catch (e) { /* corrupted JSON */ }
    }

    // 1. Check if Location Services are enabled
    try {
      const enabled = await Location.hasServicesEnabledAsync();
      if (!enabled) {
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
        setLocationPermissionGranted(false);
        setLocationError('permission');
        setLoading(false);
        return;
      }
      setLocationPermissionGranted(true);
    } catch (error) {
      console.error('Location permission error:', error);
      setLocationPermissionGranted(false);
      setLocationError('permission');
      setLoading(false);
      return;
    }

    // 3. Try cached location first for an instant map start
    let hasInstantLocation = false;
    try {
      const lastKnown = await Location.getLastKnownPositionAsync({
        maxAge: 60000,
      });
      if (lastKnown?.coords) {
        applyLocationFromPosition(lastKnown);
        setLoading(false);
        hasInstantLocation = true;
      }
    } catch (error) {
      console.warn('getLastKnownPositionAsync (fast start) failed:', error.message);
    }

    // 4. Fetch fresh position in background and update once ready
    try {
      const fresh = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
        timeout: 15000,
        maximumAge: 10000,
      });
      if (fresh?.coords) {
        applyLocationFromPosition(fresh);
        setLoading(false);
        return;
      }
    } catch (error) {
      console.warn('getCurrentPositionAsync failed:', error.message);
    }

    // 5. If no instant location was available and fresh GPS failed, use default
    if (!hasInstantLocation) {
      console.warn('No cached or fresh location available, using default location');
      setLocation(DEFAULT_LOCATION);
      setMapViewport(prev => ({
        ...prev,
        bounds: {
          north: DEFAULT_LOCATION.latitude + DEFAULT_LOCATION.latitudeDelta / 2,
          south: DEFAULT_LOCATION.latitude - DEFAULT_LOCATION.latitudeDelta / 2,
          east: DEFAULT_LOCATION.longitude + DEFAULT_LOCATION.longitudeDelta / 2,
          west: DEFAULT_LOCATION.longitude - DEFAULT_LOCATION.longitudeDelta / 2,
        },
      }));
      setLocationError(null);
      showToast(t('map.usingDefaultLocation'), 'info');
      setLoading(false);
    }
  };

  useEffect(() => {
    initializeLocation();
  }, []);

  // Load favourites on mount and whenever the screen gains focus
  useEffect(() => {
    const loadFavs = async () => {
      try {
        const favs = await getFavourites();
        setFavouriteDestinations(favs);
      } catch (e) {
        console.warn('Failed to load favourites for map:', e);
      }
    };
    loadFavs();

    const unsubscribe = navigation.addListener('focus', loadFavs);
    return unsubscribe;
  }, [navigation]);

  useEffect(() => {
    if (!(loading && !location)) return undefined;
    let currentIndex = 0;
    const interval = setInterval(() => {
      currentIndex = (currentIndex + 1) % LOADING_STATES.length;
      setLoadingState(LOADING_STATES[currentIndex].text);
      setLoadingTipIndex(prev => (prev + 1) % LOADING_TIPS.length);
    }, 2000);

    return () => clearInterval(interval);
  }, [loading, location]);

  useEffect(() => {
    if (!(loading && !location)) {
      setShowSkipLocation(false);
      return undefined;
    }
    const timeout = setTimeout(() => {
      setShowSkipLocation(true);
    }, 5000);
    return () => clearTimeout(timeout);
  }, [loading, location]);

  // Persist selected date offset to AsyncStorage
  useEffect(() => {
    AsyncStorage.setItem('selectedDateOffset', selectedDateOffset.toString()).catch(err =>
      console.warn('Failed to save date offset:', err)
    );
  }, [selectedDateOffset]);

  useEffect(() => {
    if (!location) return;
    if (__DEV__) {
      console.log('🔄 Trigger: location/radius/centerPoint changed, reloading destinations...');
    }
    // First time we get location: load immediately (no debounce). Later: debounce radius/center changes.
    if (!hasLoadedForLocationRef.current) {
      hasLoadedForLocationRef.current = true;
      loadDestinations();
    } else {
      if (radiusDebounceTimer.current) clearTimeout(radiusDebounceTimer.current);
      radiusDebounceTimer.current = setTimeout(() => loadDestinations(), 500);
    }
    const effectiveCenter = centerPoint || location;
    if (skipNextLocationAnimRef.current) {
      skipNextLocationAnimRef.current = false;
    } else if (mapRef.current && effectiveCenter) {
      mapRef.current.animateToRegion({
        latitude: effectiveCenter.latitude,
        longitude: effectiveCenter.longitude,
        latitudeDelta: (radius * 2) / 111,
        longitudeDelta: (radius * 2) / (111 * Math.cos(effectiveCenter.latitude * Math.PI / 180)),
      }, 600);
    }
    return () => {
      if (radiusDebounceTimer.current) clearTimeout(radiusDebounceTimer.current);
    };
    // Intentionally omit centerPointWeather: reload only when center *position* changes to avoid double load after long-press
  }, [location, radius, selectedCondition, centerPoint, reverseMode]);

  useEffect(() => {
    return () => {
      if (regionChangeDebounceTimer.current) {
        clearTimeout(regionChangeDebounceTimer.current);
      }
      if (mapViewTrackTimer.current) {
        clearTimeout(mapViewTrackTimer.current);
      }
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
      }
    };
  }, []);

  /**
   * Sync displayDestinations from destinations + date offset.
   * Offset 0: set immediately (no heavy work). Offset !== 0: run shift+badges after interactions so tap stays instant.
   */
  useEffect(() => {
    if (!destinations.length) {
      setDisplayDestinations([]);
      return;
    }
    if (selectedDateOffset === 0) {
      setDisplayDestinations(destinations);
      return;
    }
    // Don't set state here – keeps button update instant. Map content updates when async work finishes.
    const cancelled = { current: false };
    const handle = InteractionManager.runAfterInteractions(() => {
      if (cancelled.current) return;
      const offset = selectedDateOffset;
      const normalizeForecastEntry = (entry) => {
        if (!entry) return null;
        const temp = entry.temp ?? entry.temperature ?? entry.high ?? null;
        const high = entry.high ?? entry.temp_max ?? entry.temperature ?? null;
        const low = entry.low ?? entry.temp_min ?? (high != null ? high - 3 : null);
        return {
          ...entry,
          condition: entry.condition,
          temp,
          tempMax: high,
          high,
          low,
          precipitation: entry.precipitation ?? 0,
          windSpeed: entry.windSpeed ?? 0,
          humidity: entry.humidity ?? null,
          description: entry.description ?? entry.weather_description ?? '',
          sunshine_duration: entry.sunshine_duration ?? 0,
        };
      };
      // 5 slots to match DestinationDetailScreen (today, tomorrow, day3, day4, day5)
      const buildShiftedForecast = (arr, off) => {
        const keys = ['today', 'tomorrow', 'day3', 'day4', 'day5'];
        const result = {};
        keys.forEach((key, i) => {
          const entry = arr[off + i];
          if (entry) result[key] = normalizeForecastEntry(entry);
        });
        return result;
      };
      const buildShiftedKeyedForecast = (forecastObj, off) => {
        const inputKeys = ['today', 'tomorrow', 'day2', 'day3', 'day4', 'day5', 'day6', 'day7', 'day8', 'day9', 'day10', 'day11', 'day12', 'day13', 'day14', 'day15'];
        const outputKeys = ['today', 'tomorrow', 'day3', 'day4', 'day5'];
        const result = {};
        outputKeys.forEach((outKey, i) => {
          const sourceKey = inputKeys[off + i];
          if (sourceKey && forecastObj?.[sourceKey]) result[outKey] = normalizeForecastEntry(forecastObj[sourceKey]);
        });
        return result;
      };
      const shifted = destinations.map(dest => {
        if (dest.forecastDays && dest.forecastDays[offset]) {
          const dayData = dest.forecastDays[offset];
          const shiftedForecast = {};
          ['today', 'tomorrow', 'day3', 'day4', 'day5'].forEach((key, i) => {
            const fd = dest.forecastDays[offset + i];
            if (fd) {
              shiftedForecast[key] = normalizeForecastEntry({
                condition: fd.condition,
                temp: fd.temperature,
                high: Math.round(fd.temp_max || fd.temperature),
                low: Math.round(fd.temp_min || fd.temperature - 3),
                precipitation: fd.precipitation,
                windSpeed: fd.windSpeed,
                humidity: fd.humidity,
                description: fd.description ?? fd.weather_description ?? '',
                sunshine_duration: fd.sunshine_duration || 0,
              });
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
            humidity: dayData.humidity ?? dest.humidity,
            description: dayData.description ?? dest.description,
            weather_description: dayData.description ?? dest.weather_description,
            sunshine_duration: dayData.sunshine_duration || 0,
            forecast: shiftedForecast,
          };
        }
        if (dest.forecastArray && dest.forecastArray.length > offset) {
          const dayData = dest.forecastArray[offset];
          return {
            ...dest,
            temperature: dayData.high ?? dayData.temp ?? dest.temperature,
            condition: dayData.condition ?? dest.condition,
            windSpeed: dayData.windSpeed ?? dest.windSpeed,
            precipitation: dayData.precipitation ?? dest.precipitation,
            sunshine_duration: dayData.sunshine_duration ?? dest.sunshine_duration,
            humidity: dayData.humidity ?? dest.humidity,
            description: dayData.description ?? dest.description,
            weather_description: dayData.description ?? dest.weather_description,
            forecast: buildShiftedForecast(dest.forecastArray, offset),
          };
        }
        const FORECAST_KEY_MAP = { 1: 'tomorrow', 2: 'day2', 3: 'day3', 4: 'day4', 5: 'day5', 6: 'day6', 7: 'day7', 8: 'day8', 9: 'day9', 10: 'day10' };
        const forecastKey = FORECAST_KEY_MAP[offset];
        if (dest.forecast && forecastKey && dest.forecast[forecastKey]) {
          const dayData = dest.forecast[forecastKey];
          return {
            ...dest,
            temperature: dayData.high ?? dayData.temp ?? dest.temperature,
            condition: dayData.condition ?? dest.condition,
            windSpeed: dayData.windSpeed ?? dest.windSpeed,
            precipitation: dayData.precipitation ?? dest.precipitation,
            humidity: dayData.humidity ?? dest.humidity,
            description: dayData.description ?? dest.description,
            weather_description: dayData.description ?? dest.weather_description,
            forecast: buildShiftedKeyedForecast(dest.forecast, offset),
          };
        }
        return dest;
      });
      const origin = shifted.find(d => d.isCenterPoint) || shifted.find(d => d.isCurrentLocation);
      if (origin) applyBadgesToDestinations(shifted, origin, origin.lat, origin.lon, reverseMode, radius);
      if (!cancelled.current) setDisplayDestinations(shifted);
    });
    return () => {
      cancelled.current = true;
      if (handle?.cancel) handle.cancel();
    };
  }, [destinations, selectedDateOffset, reverseMode, radius]);

  // Derive shifted center point weather from displayDestinations (respects date offset)
  const displayCenterPointWeather = useMemo(() => {
    if (!centerPointWeather) return null;
    return displayDestinations.find(d => d.isCenterPoint) || centerPointWeather;
  }, [displayDestinations, centerPointWeather]);

  const toRadians = (degrees) => {
    return degrees * (Math.PI / 180);
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


  const loadDestinations = async () => {
    if (!location) return;
    setLoadingDestinations(true);
    try {
      const effectiveCenter = centerPoint || location;
      const originTemp = centerPointWeather?.temperature || null;
      if (__DEV__) {
        console.log(`🔄 Loading destinations for center: ${effectiveCenter.latitude.toFixed(2)}, ${effectiveCenter.longitude.toFixed(2)}, radius: ${radius}km`);
      }
      // Run radius fetch and current-location weather in parallel (was sequential = double wait)
      const [weatherData, currentLocationWeather] = await Promise.all([
        getWeatherForRadius(
          effectiveCenter.latitude,
          effectiveCenter.longitude,
          radius,
          selectedCondition,
          originTemp,
          i18n.language,
          reverseMode
        ),
        getCurrentLocationWeather(),
      ]);
      let allDestinations = [];
      if (currentLocationWeather) allDestinations.push(currentLocationWeather);
      if (centerPointWeather) allDestinations.push(centerPointWeather);
      allDestinations = [...allDestinations, ...weatherData];
      if (__DEV__) {
        console.log(`🏆 Badge origin: ${centerPointWeather ? 'centerPoint' : 'currentLocation'}, ${allDestinations.length} places`);
      }
      if (__DEV__ && allDestinations.length > 1) {
        const sample = allDestinations.find(d => !d.isCurrentLocation && !d.isCenterPoint);
        if (sample) console.log('[DEBUG MapScreen] sample dest:', sample.name, '| place_type:', sample.place_type, '| image_region:', sample.image_region);
      }
      setDestinations(allDestinations);
      // Cache in background so we don't block UI
      AsyncStorage.setItem('mapDestinationsCache', JSON.stringify({
        timestamp: Date.now(),
        data: allDestinations,
      })).catch((cacheError) => console.warn('Failed to cache destinations:', cacheError));
    } catch (error) {
      showToast(t('map.failedToLoadWeather') || 'Failed to load weather data', 'error');
      console.error(error);
    } finally {
      setLoadingDestinations(false);
    }
  };

  const buildWeatherFromDB = async (lat, lon, prefix, extraProps = {}) => {
    const { data: rpcData, error: rpcError } = await supabase.rpc('nearest_place', {
      user_lat: lat, user_lon: lon, max_distance_km: 50,
    });
    if (rpcError || !rpcData?.length) return null;
    const place = rpcData[0];
    const { place: detail, forecast: forecastData } = await getPlaceDetail(place.id);
    if (!detail || !forecastData?.length) return null;

    const forecastDaysArr = forecastData.map(f => ({
      condition: f.condition,
      temperature: f.tempMax ?? f.tempMin,
      temp_max: f.tempMax,
      temp_min: f.tempMin,
      windSpeed: f.windSpeed || 0,
      precipitation: f.precipitation || 0,
      sunshine_duration: 0,
    }));

    __DEV__ && console.log(`${prefix} Weather from DB: ${detail.name} (${forecastData.length} days)`);
    return {
      id: place.id,
      lat, lon,
      name: `${prefix} ${detail.name || getPlaceName(place, i18n.language)}`,
      condition: detail.condition || 'cloudy',
      temperature: detail.temperature,
      temp_max: detail.temp_max ?? detail.temperature,
      temp_min: detail.temp_min ?? detail.temperature,
      humidity: detail.humidity || null,
      windSpeed: detail.windSpeed || 0,
      precipitation: detail.precipitation || 0,
      cloudCover: detail.cloudCover || null,
      stability: calculateStability(detail.cloudCover, detail.windSpeed),
      badges: [],
      forecastDays: forecastDaysArr,
      country_code: detail.countryCode || detail.country_code || place.country_code,
      countryCode: detail.countryCode || detail.country_code || place.country_code,
      place_type: detail.place_type || null,
      image_region: detail.image_region || null,
      ...extraProps,
    };
  };

  const getCurrentLocationWeather = async () => {
    if (!location) return null;
    try {
      const dbResult = await buildWeatherFromDB(
        location.latitude, location.longitude, '📍',
        { distance: 0, isCurrentLocation: true }
      );
      if (dbResult) return dbResult;

      // --- Fallback: Open-Meteo API (no nearby place in DB) ---
      __DEV__ && console.log('📍 No nearby DB place for location, falling back to Open-Meteo API');

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
        current: ['relative_humidity_2m', 'cloud_cover'].join(','),
        timezone: 'auto',
        forecast_days: 16,
      });
      const url = `https://customer-api.open-meteo.com/v1/forecast?${params}&apikey=${process.env.EXPO_PUBLIC_OPEN_METEO_KEY}`;
      const [geocodeResult, response] = await Promise.all([
        Location.reverseGeocodeAsync({ latitude: location.latitude, longitude: location.longitude }).catch(() => null),
        fetch(url),
      ]);
      if (!response.ok) return null;
      const data = await response.json();
      let cityName = 'Dein Standort';
      let countryCode = null;
      if (geocodeResult && geocodeResult[0]) {
        const g = geocodeResult[0];
        cityName = g.city || g.district || g.region || 'Dein Standort';
        countryCode = g.isoCountryCode || null;
      }
      const daily = data.daily;
      const current = data.current || {};

      const forecastDaysArr = daily.weather_code?.map((code, i) => ({
        condition: mapWeatherCodeToCondition(code),
        temperature: Math.round(daily.temperature_2m_max?.[i] || 0),
        temp_max: daily.temperature_2m_max?.[i],
        temp_min: daily.temperature_2m_min?.[i],
        windSpeed: Math.round(daily.wind_speed_10m_max?.[i] || 0),
        precipitation: daily.precipitation_sum?.[i] || 0,
        sunshine_duration: daily.sunshine_duration?.[i] || 0,
      })) || [];

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
        forecastDays: forecastDaysArr,
        country_code: countryCode,
        countryCode,
      };
    } catch (error) {
      console.warn('Failed to fetch current location weather:', error);
      return null;
    }
  };

  // mapWeatherCode imported from usecases/weatherUsecases (single source of truth)
  const mapWeatherCodeToCondition = mapWeatherCode;

  /**
   * Calculate stability from cloud cover and wind speed
   */
  const calculateStability = (cloudCover, windSpeed) => {
    const cloudScore = 100 - (cloudCover || 50);
    const windScore = Math.max(0, 100 - (windSpeed || 5) * 2);
    return Math.round((cloudScore + windScore) / 2);
  };

  const handleMarkerPress = (destination) => {
    markerJustPressedRef.current = true;
    setTimeout(() => { markerJustPressedRef.current = false; }, 500);
    if (destination.id) trackDetailView(destination.id);
    navigation.navigate('DestinationDetail', { destination, dateOffset: selectedDateOffset, reverseMode });
  };

  const handleRadiusIncrease = async () => {
    const newRadius = Math.min(radius + 50, 5000); // Max 5000 km
    setRadius(newRadius);
    playTickSound();
    // Note: loadDestinations is debounced in useEffect (500ms delay)
  };

  const handleRadiusDecrease = async () => {
    const newRadius = Math.max(radius - 50, 50); // Min 50 km
    setRadius(newRadius);
    playTickSound();
    // Note: loadDestinations is debounced in useEffect (500ms delay)
  };

  const handleRadiusSelect = async (newRadius) => {
    setRadius(newRadius);
    setShowRadiusMenu(false);
    playTickSound();
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

  const toggleReverseMode = async () => {
    setReverseMode(prev => prev === 'warm' ? 'cold' : prev === 'cold' ? 'all' : 'warm');
    await playTickSound();
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
   * Dynamic max markers based on zoom and radius.
   * Android gets fewer markers (slower map rendering pipeline).
   */
  const getMaxMarkers = (zoom, radiusKm) => {
    let base = Math.floor(radiusKm / 20);
    
    let zoomFactor;
    if (zoom <= 3) zoomFactor = 0.5;
    else if (zoom <= 4) zoomFactor = 0.8;
    else if (zoom <= 5) zoomFactor = 1.0;
    else if (zoom <= 6) zoomFactor = 1.8;
    else if (zoom <= 7) zoomFactor = 3.0;
    else zoomFactor = 5.0;
    
    const maxCap = Platform.OS === 'android' ? 80 : 120;
    const minFloor = zoom >= 7 ? (Platform.OS === 'android' ? 35 : 60) :
                     zoom >= 5 ? (Platform.OS === 'android' ? 20 : 40) :
                     zoom >= 4 ? (Platform.OS === 'android' ? 20 : 40) :
                     (Platform.OS === 'android' ? 15 : 30);
    const total = Math.min(Math.max(base * zoomFactor, minFloor), maxCap);
    return Math.round(total);
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
    
    const GRID_COLS = zoom <= 4 ? 6 : zoom <= 5 ? 6 : zoom <= 7 ? 8 : 12;
    const GRID_ROWS = zoom <= 4 ? 8 : zoom <= 5 ? 8 : zoom <= 7 ? 10 : 16;

    // Separate special markers (always shown)
    const specialMarkers = candidates.filter(p => p.isCurrentLocation || p.isCenterPoint);

    const getGridKey = (lat, lon) => {
      if (!bounds) return '0_0';
      const col = Math.floor((lon - bounds.west)  / (bounds.east  - bounds.west)  * GRID_COLS);
      const row = Math.floor((lat - bounds.south) / (bounds.north - bounds.south) * GRID_ROWS);
      return `${Math.min(col, GRID_COLS-1)}_${Math.min(row, GRID_ROWS-1)}`;
    };
    
    // Pinned badges: always visible, but soft grid limit (max 2 per grid) to avoid clustering
    const PINNED_GRID_LIMIT = 2;
    const pinnedBadges = [DestinationBadge.WORTH_THE_DRIVE, DestinationBadge.WORTH_THE_DRIVE_BUDGET];
    const allPinned = candidates.filter(p => 
      !p.isCurrentLocation && !p.isCenterPoint &&
      Array.isArray(p.badges) && p.badges.some(b => pinnedBadges.includes(b))
    );
    const pinnedGridCounts = new Map();
    const pinned = [];
    const pinnedOverflow = [];
    const sortedPinned = sortByQuality(allPinned, userLat, userLon);
    for (const p of sortedPinned) {
      const pLat = p.lat || p.latitude;
      const pLon = p.lon || p.longitude;
      const key = getGridKey(pLat, pLon);
      const count = pinnedGridCounts.get(key) || 0;
      if (count < PINNED_GRID_LIMIT) {
        pinned.push(p);
        pinnedGridCounts.set(key, count + 1);
      } else {
        pinnedOverflow.push(p);
      }
    }
    __DEV__ && console.log(`📌 Pinned: ${pinned.length} shown, ${pinnedOverflow.length} redistributed`);
    
    // Normal places + overflow pinned: subject to grid/distance/maxMarkers filtering
    const normal = [
      ...pinnedOverflow,
      ...candidates.filter(p => 
        !p.isCurrentLocation && !p.isCenterPoint &&
        !(Array.isArray(p.badges) && p.badges.some(b => pinnedBadges.includes(b)))
      ),
    ];

    const viewportPlaces = (bounds)
      ? normal.filter(p => {
          const lat = p.lat || p.latitude;
          const lon = p.lon || p.longitude;
          return lat >= bounds.south && lat <= bounds.north &&
                 lon >= bounds.west  && lon <= bounds.east;
        })
      : normal;

    // Build grid: best place per cell (guaranteed geographic coverage)
    const gridMap = new Map();
    for (const place of viewportPlaces) {
      const lat = place.lat || place.latitude;
      const lon = place.lon || place.longitude;
      const key = getGridKey(lat, lon);
      const existing = gridMap.get(key);
      const score = place.attractivenessScore || place.attractiveness_score || 50;
      const existingScore = existing ? (existing.attractivenessScore || existing.attractiveness_score || 50) : -1;
      if (!existing || score > existingScore) {
        gridMap.set(key, place);
      }
    }

    // Take best-per-grid, sort those by score, cap at maxMarkers
    const gridWinners = Array.from(gridMap.values())
      .sort((a, b) => {
        const aScore = a.attractivenessScore || a.attractiveness_score || 50;
        const bScore = b.attractivenessScore || b.attractiveness_score || 50;
        return bScore - aScore;
      })
      .slice(0, maxMarkers - pinned.length);

    const result = [...specialMarkers, ...pinned, ...gridWinners];

    const pinnedCount = pinned.length;
    const normalCount = gridWinners.length;
    __DEV__ && console.log(`📊 Final: ${result.length} markers (${pinnedCount} pinned + ${normalCount} normal + ${specialMarkers.length} special), ${gridMap.size} grids`);
    return result;
  };

  const visibleMarkers = useMemo(() => {
    if (!displayDestinations.length || !location || !radius) return [];
    const { zoom: currentZoom, bounds: currentBounds } = mapViewport;
    const effectiveCenter = centerPoint || location;
    const inRadiusDestinations = displayDestinations.filter(d => {
      const lat = d.lat ?? d.latitude;
      const lon = d.lon ?? d.longitude;
      if (!lat || !lon) return false;
      return getDistanceKm(effectiveCenter.latitude, effectiveCenter.longitude, lat, lon) <= radius;
    });
    return getVisibleMarkers(inRadiusDestinations, currentZoom, currentBounds, favouriteDestinations);
  }, [mapViewport, displayDestinations, location, radius, favouriteDestinations, centerPoint]);

  // Track map_view_count as a side-effect of visibleMarkers changing
  useEffect(() => {
    if (visibleMarkers.length === 0) return;
    if (__DEV__) {
      const specialCount = visibleMarkers.filter(v => v.isCurrentLocation || v.isCenterPoint).length;
      console.log(`🔍 Zoom ${mapViewport.zoom}: ${visibleMarkers.length} markers (${specialCount} special) of ${displayDestinations.length}`);
    }
    const newIds = visibleMarkers
      .filter(d => d.id && !d.isCurrentLocation && !d.isCenterPoint && !mapViewTrackedIds.current.has(d.id))
      .map(d => d.id);
    if (newIds.length > 0) {
      newIds.forEach(id => mapViewTrackedIds.current.add(id));
      clearTimeout(mapViewTrackTimer.current);
      mapViewTrackTimer.current = setTimeout(() => trackMapViews(newIds), 2000);
    }
  }, [visibleMarkers]);


  /**
   * Handle long press on map to set new center point
   */
  const handleMapLongPress = async (event) => {
    const { latitude, longitude } = event.nativeEvent.coordinate;
    
    playTickSound();
    
    const newCenter = {
      latitude,
      longitude,
      latitudeDelta: 2,
      longitudeDelta: 2,
    };
    
    // Fetch weather FIRST so centerPointWeather is ready when useEffect fires
    await fetchCenterPointWeather(latitude, longitude);
    
    // Now set center point — this triggers the useEffect that calls loadDestinations
    setCenterPoint(newCenter);
    
    AsyncStorage.setItem('mapCenterPoint', JSON.stringify(newCenter)).catch(error =>
      console.warn('Failed to save center point:', error)
    );
    
    showToast('📍 Neuer Mittelpunkt gesetzt', 'info');
  };

  const handleMapTap = async (event) => {
    if (markerJustPressedRef.current) return;

    const now = Date.now();
    if (now - lastMapTapRef.current < 1000) return;
    lastMapTapRef.current = now;

    if (searchFocused || searchResults.length > 0 || googleResults.length > 0) {
      clearSearch();
      return;
    }

    const { latitude, longitude } = event.nativeEvent.coordinate;

    const maxDistance = mapViewport.zoom >= 8 ? 20 :
                        mapViewport.zoom >= 6 ? 50 :
                        100;

    try {
      const { data, error } = await supabase.rpc('nearest_place', {
        user_lat: latitude,
        user_lon: longitude,
        max_distance_km: maxDistance,
      });

      if (error || !data || data.length === 0) {
        showToast('No destination found nearby', 'info');
        return;
      }

      const place = data[0];
      const match = displayDestinations.find(d =>
        Math.abs((d.lat ?? d.latitude) - place.latitude) < 0.05 &&
        Math.abs((d.lon ?? d.longitude) - place.longitude) < 0.05
      );

      if (match) {
        handleMarkerPress(match);
      } else {
        showToast('No destination found nearby', 'info');
      }
    } catch (err) {
      console.warn('nearest_place RPC failed:', err);
      showToast('No destination found nearby', 'info');
    }
  };

  /**
   * Fetch weather for center point.
   * Tries nearest DB place first (no API call). Falls back to Open-Meteo
   * only when no place is within 50 km.
   */
  const fetchCenterPointWeather = async (lat, lon) => {
    try {
      const dbResult = await buildWeatherFromDB(lat, lon, '⊕', { isCenterPoint: true });
      if (dbResult) {
        setCenterPointWeather(dbResult);
        return;
      }

      // --- Fallback: Open-Meteo API (no nearby place in DB) ---
      __DEV__ && console.log('⊕ No nearby DB place, falling back to Open-Meteo API');

      let cityName = 'Neuer Mittelpunkt';
      let countryCode = null;
      try {
        const geocode = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lon });
        if (geocode && geocode[0]) {
          const g = geocode[0];
          cityName = g.city || g.district || g.region || 'Neuer Mittelpunkt';
          countryCode = g.isoCountryCode || null;
        }
      } catch (geoError) {
        console.warn('Reverse geocoding failed:', geoError);
      }

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
        forecast_days: 16,
      });

      const url = `https://customer-api.open-meteo.com/v1/forecast?${params}&apikey=${process.env.EXPO_PUBLIC_OPEN_METEO_KEY}`;
      const response = await fetch(url);

      if (!response.ok) {
        setCenterPointWeather(null);
        return;
      }

      const data = await response.json();
      const daily = data.daily;
      const current = data.current || {};

      const forecastDaysArr = daily.weather_code?.map((code, i) => ({
        condition: mapWeatherCodeToCondition(code),
        temperature: Math.round(daily.temperature_2m_max?.[i] || 0),
        temp_max: daily.temperature_2m_max?.[i],
        temp_min: daily.temperature_2m_min?.[i],
        windSpeed: Math.round(daily.wind_speed_10m_max?.[i] || 0),
        precipitation: daily.precipitation_sum?.[i] || 0,
        sunshine_duration: daily.sunshine_duration?.[i] || 0,
      })) || [];

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
        forecastDays: forecastDaysArr,
        country_code: countryCode,
        countryCode,
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
   * On-demand recenter: request one fresh location update and move map.
   * Avoids keeping the native user-location layer active all the time.
   */
  const recenterToCurrentLocation = async () => {
    if (isRecentering) return;
    const now = Date.now();
    if (now < recenterCooldownUntilRef.current) {
      const secondsLeft = Math.ceil((recenterCooldownUntilRef.current - now) / 1000);
      showToast(`Bitte warte noch ${secondsLeft}s`, 'info');
      return;
    }
    setIsRecentering(true);
    recenterCooldownUntilRef.current = now + 10000;

    try {
      const servicesEnabled = await Location.hasServicesEnabledAsync();
      if (!servicesEnabled) {
        setLocationError('disabled');
        showToast(t('map.locationDisabled'), 'error');
        return;
      }

      let hasPermission = locationPermissionGranted;
      if (!hasPermission) {
        const { status } = await Location.requestForegroundPermissionsAsync();
        hasPermission = status === 'granted';
        setLocationPermissionGranted(hasPermission);
      }

      if (!hasPermission) {
        setLocationError('permission');
        showToast(t('map.locationNotAvailable'), 'error');
        return;
      }

      let position = null;
      try {
        position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
          timeout: 10000,
          maximumAge: 15000,
        });
      } catch (error) {
        console.warn('recenter getCurrentPositionAsync failed:', error?.message || error);
      }

      if (!position?.coords) {
        position = await Location.getLastKnownPositionAsync({ maxAge: 120000 });
      }

      if (!position?.coords) {
        showToast(t('map.locationUnavailable'), 'error');
        return;
      }

      applyLocationFromPosition(position);
      setCenterPoint(null);
      setCenterPointWeather(null);
      setLocationError(null);
      AsyncStorage.removeItem('mapCenterPoint').catch(err =>
        console.warn('Failed to remove center point while recentering:', err)
      );

      const latitudeDelta = currentRegion?.latitudeDelta ?? (radius * 2) / 111;
      const longitudeDelta = currentRegion?.longitudeDelta
        ?? (radius * 2) / (111 * Math.cos(position.coords.latitude * Math.PI / 180));

      mapRef.current?.animateToRegion({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        latitudeDelta,
        longitudeDelta,
      }, 500);

      playTickSound();
      showToast('📍 Auf deinen Standort zentriert', 'success');
    } finally {
      setIsRecentering(false);
    }
  };

  const searchPlaces = useCallback(async (text) => {
    if (!text || text.length < 3) {
      setSearchResults([]);
      setGoogleResults([]);
      return;
    }
    try {
      setSearchLoading(true);
      const center = currentRegion || location;
      const { dbPlaces, googlePlaces } = await hybridSearch(text, center, i18n.language || 'de');
      setSearchResults(dbPlaces.slice(0, 5));
      setGoogleResults(googlePlaces.slice(0, 5));
    } catch (e) {
      if (__DEV__) console.warn('Places search failed:', e);
      setSearchResults([]);
      setGoogleResults([]);
    } finally {
      setSearchLoading(false);
    }
  }, [currentRegion, location, i18n.language]);

  const handleSearchTextChange = useCallback((text) => {
    setSearchQuery(text);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => searchPlaces(text), 300);
  }, [searchPlaces]);

  const handleSearchResultSelect = useCallback(async (item) => {
    setSearchQuery('');
    setSearchResults([]);
    setGoogleResults([]);
    setSearchFocused(false);
    Keyboard.dismiss();
    playTickSound();

    // If Google place, auto-add to DB first (fire-and-forget for the insert, but we need coords)
    if (item.source === 'google') {
      ensurePlaceInDB(item).then(dbPlace => {
        if (__DEV__ && dbPlace) console.log('🆕 Google place saved:', dbPlace.name_en, dbPlace.id);
      });
    }

    const lat = Number(item.latitude);
    const lng = Number(item.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      const newCenter = {
        latitude: lat,
        longitude: lng,
        latitudeDelta: (radius * 2) / 111,
        longitudeDelta: (radius * 2) / (111 * Math.cos(lat * Math.PI / 180)),
      };

      // Set as center point so radius + destinations center around the searched place
      await fetchCenterPointWeather(lat, lng);
      setCenterPoint(newCenter);
      AsyncStorage.setItem('mapCenterPoint', JSON.stringify(newCenter)).catch(err =>
        console.warn('Failed to save center point:', err)
      );

      skipNextLocationAnimRef.current = true;
      InteractionManager.runAfterInteractions(() => {
        mapRef.current?.animateToRegion(newCenter, 800);
      });
    }
  }, [radius]);

  const clearSearch = useCallback(() => {
    setSearchQuery('');
    setSearchResults([]);
    setGoogleResults([]);
    setSearchFocused(false);
    Keyboard.dismiss();
  }, []);

  /**
   * Track map region changes (debounced) to enforce boundaries + zoom + bounds without blocking UI
   */
  const handleRegionChangeComplete = useCallback((region) => {
    if (regionChangeDebounceTimer.current) {
      clearTimeout(regionChangeDebounceTimer.current);
    }
    regionChangeDebounceTimer.current = setTimeout(() => {
      regionChangeDebounceTimer.current = null;
      const zoom = Math.max(1, Math.min(20, Math.round(Math.log2(360 / region.latitudeDelta))));
      currentZoomRef.current = zoom;
      const { latitude, longitude, latitudeDelta, longitudeDelta } = region;
      const newBounds = {
        north: latitude + latitudeDelta / 2,
        south: latitude - latitudeDelta / 2,
        east: longitude + longitudeDelta / 2,
        west: longitude - longitudeDelta / 2,
      };
      setMapViewport({ zoom, bounds: newBounds });
      let newLatitude = latitude;
      let newLongitude = longitude;
      let needsAdjustment = false;
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
      if (needsAdjustment && mapRef.current) {
        mapRef.current.animateToRegion({
          latitude: newLatitude,
          longitude: newLongitude,
          latitudeDelta: region.latitudeDelta,
          longitudeDelta: region.longitudeDelta,
        }, 300);
      }
      setCurrentRegion(region);
    }, 100);
  }, []);

  if (loading && !location) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: theme.background }]}>
        <ActivityIndicator size="large" color={theme.primary} />
        <Text style={[styles.loadingText, { color: theme.text }]}>
          {loadingState}
        </Text>
        <Text style={[styles.hintText, { color: theme.textSecondary || '#888' }]}>
          {LOADING_TIPS[loadingTipIndex]}
        </Text>
        {/* Skip button visible after 5 seconds */}
        {showSkipLocation && (
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
        <Text style={{ fontSize: 48, marginBottom: 16 }}>📍</Text>
        <Text style={[styles.errorText, { color: theme.error }]}>{t('map.locationNotAvailable')}</Text>
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

  return (
    <View style={styles.container}>
      <OnboardingOverlay 
        visible={showOnboarding} 
        onClose={handleCloseOnboarding}
      />
      
      {/* Google Places Search Bar */}
      <View style={styles.searchBarContainer}>
        <View style={styles.searchInputRow}>
          <TextInput
            style={styles.searchInput}
            placeholder={t('map.searchPlaceholder')}
            placeholderTextColor="#999"
            value={searchQuery}
            onChangeText={handleSearchTextChange}
            onFocus={() => setSearchFocused(true)}
            returnKeyType="search"
            autoCorrect={false}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity style={styles.searchClearButton} onPress={clearSearch}>
              <Text style={styles.searchClearText}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
        {(searchResults.length > 0 || googleResults.length > 0 || searchLoading) && (
          <View style={styles.searchResultsList}>
            {searchResults.map((item) => (
              <TouchableOpacity
                key={item.id}
                style={styles.searchRow}
                onPress={() => handleSearchResultSelect(item)}
                activeOpacity={0.6}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.searchDescription} numberOfLines={1}>
                      {item.description}
                    </Text>
                    {(item.place_type || item.country_code) && (
                      <Text style={styles.searchSubtitle} numberOfLines={1}>
                        {[item.place_type ? t(`placeType.${item.place_type}`, item.place_type.replace(/_/g, ' ')) : null, item.country_code].filter(Boolean).join(' · ')}
                      </Text>
                    )}
                  </View>
                  {item.distLabel ? (
                    <Text style={{ color: '#999', fontSize: 12, marginLeft: 8 }}>{item.distLabel}</Text>
                  ) : null}
                </View>
              </TouchableOpacity>
            ))}
            {googleResults.length > 0 && (
              <>
                <View style={styles.searchDivider}>
                  <Text style={styles.searchDividerText}>{t('map.moreResults', 'Weitere Ergebnisse')}</Text>
                </View>
                {googleResults.map((item) => (
                  <TouchableOpacity
                    key={item.googlePlaceId}
                    style={styles.searchRow}
                    onPress={() => handleSearchResultSelect(item)}
                    activeOpacity={0.6}
                  >
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.searchDescription} numberOfLines={1}>
                          {item.description}
                        </Text>
                        {item.country_code && (
                          <Text style={styles.searchSubtitle} numberOfLines={1}>
                            {item.country_code}
                          </Text>
                        )}
                      </View>
                      <Text style={{ color: '#999', fontSize: 11, marginLeft: 8 }}>via Google</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </>
            )}
            {searchLoading && (
              <View style={[styles.searchRow, { alignItems: 'center' }]}>
                <ActivityIndicator size="small" color="#999" />
              </View>
            )}
          </View>
        )}
      </View>

      <MapView
        ref={mapRef}
        style={styles.map}
        mapType="standard"
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
        showsUserLocation={false}
        showsMyLocationButton={false}
        onPress={handleMapTap}
        onLongPress={handleMapLongPress}
        onRegionChange={(region) => {
          const zoom = Math.max(1, Math.min(20,
            Math.round(Math.log2(360 / region.latitudeDelta))
          ));
          currentZoomRef.current = zoom;
        }}
        onRegionChangeComplete={handleRegionChangeComplete}
      >
        {/* Guard: no markers until location + radius are ready */}
        {(!location || !radius) ? null : <>

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
            tracksViewChanges={false}
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
                    ? formatTemperature(displayCenterPointWeather.temperature, temperatureUnit, false) 
                    : '?°'}
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
            // Skip favourites - they're rendered separately below
            if (dest.isFavourite) return false;
            // Always show current location and center point
            if (dest.isCurrentLocation || dest.isCenterPoint) return true;
            if (!showOnlyBadges) return true;
            // When trophy filter active, only show badges that count for trophy
            const trophyBadges = getMapBadges(dest.badges).filter(b => !BadgeMetadata[b]?.excludeFromTrophy);
            return trophyBadges.length > 0;
          })
          .map((dest, index) => (
          <DestinationMarker
            key={`${dest.lat}-${dest.lon}-${index}`}
            dest={dest}
            index={index}
            onPress={() => handleMarkerPress(dest)}
            getMapBadges={getMapBadges}
            getWeatherColor={getWeatherColor}
            getWeatherIcon={getWeatherIcon}
            styles={styles}
            temperatureUnit={temperatureUnit}
          />
        ))}

        {/* Favourites - rendered separately; always check radius */}
        {favouriteDestinations
          .filter(fav => fav && fav.lat != null && fav.lon != null)
          .map((fav, index) => {
            const effectiveCenter = centerPoint || location;
            const distToCenter = getDistanceKm(
              effectiveCenter.latitude, effectiveCenter.longitude,
              Number(fav.lat), Number(fav.lon)
            );
            if (distToCenter > radius) return null;

            const withWeather = displayDestinations.find(d => 
              Math.abs((d.lat ?? d.latitude) - fav.lat) < 0.05 &&
              Math.abs((d.lon ?? d.longitude) - fav.lon) < 0.05
            );
            
            const temp = withWeather?.temperature ?? fav.temperature ?? null;
            const cond = withWeather?.condition ?? fav.condition ?? 'cloudy';
            
            return (
          <Marker
            key={`sep-fav-${fav.placeId || fav.id || `${fav.lat}-${fav.lon}`}-${selectedDateOffset}-${mapViewport.zoom}`}
            coordinate={{ latitude: Number(fav.lat), longitude: Number(fav.lon) }}
            anchor={{ x: 0.5, y: 0.5 }}
            zIndex={10000}
            tracksViewChanges={false}
            onPress={() => handleMarkerPress(withWeather || fav)}
          >
            <View style={styles.markerFrameAndroid}>
              <View style={[
                styles.markerContainer,
                { backgroundColor: temp != null ? getWeatherColor(cond, temp) : '#888' },
                styles.favouriteMarkerBorder,
              ]}>
                <Text style={styles.markerWeatherIcon}>
                  {getWeatherIcon(temp != null ? cond : 'cloudy')}
                </Text>
                <Text style={styles.markerTemp}>
                  {temp != null ? formatTemperature(temp, temperatureUnit, false) : '?°'}
                </Text>
              </View>
            </View>
          </Marker>
            );
          })}

        </>}
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

      {/* Empty state when trophy filter is active but no trophy-worthy places visible */}
      {showOnlyBadges && !loadingDestinations && visibleMarkers.filter(dest => {
        const trophyBadges = getMapBadges(dest.badges).filter(b => !BadgeMetadata[b]?.excludeFromTrophy);
        return trophyBadges.length > 0;
      }).length === 0 && favouriteDestinations.filter(fav => {
        if (!fav || fav.lat == null || fav.lon == null) return false;
        const withWeather = displayDestinations.find(d =>
          Math.abs((d.lat ?? d.latitude) - fav.lat) < 0.05 &&
          Math.abs((d.lon ?? d.longitude) - fav.lon) < 0.05
        );
        const badges = withWeather?.badges || fav.badges || [];
        return getMapBadges(badges).some(b => !BadgeMetadata[b]?.excludeFromTrophy);
      }).length === 0 && (
        <View style={[styles.emptyStateOverlay, { backgroundColor: 'rgba(0, 0, 0, 0.5)' }]} pointerEvents="box-none">
          <View style={[styles.emptyStateBox, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text style={styles.emptyStateIcon}>🏆</Text>
            <Text style={[styles.emptyStateTitle, { color: theme.text }]}>Keine Highlights</Text>
            <Text style={[styles.emptyStateMessage, { color: theme.textSecondary }]}>
              in {formatDistance(radius, distanceUnit, 0)} Radius
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

      {/* Recenter Button (on-demand location, battery-friendly) */}
      <TouchableOpacity
        style={[styles.myLocationButton, {
          backgroundColor: theme.surface,
          borderColor: theme.border,
          shadowColor: theme.shadow,
          opacity: isRecentering ? 0.6 : 1,
        }]}
        onPress={recenterToCurrentLocation}
        disabled={isRecentering}
        accessibilityLabel="Center map on my location"
        accessibilityRole="button"
        accessibilityHint="Fetch current location once and center the map"
      >
        <Text style={styles.myLocationIcon}>{isRecentering ? '…' : '📍'}</Text>
      </TouchableOpacity>

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
                  {formatDistance(radiusOption, distanceUnit, 0)}
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
          <Text style={[styles.radiusDisplayText, { color: theme.text }]}>{formatDistance(radius, distanceUnit, 0)}</Text>
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
            accessibilityHint={`Increase search radius from ${formatDistance(radius, distanceUnit, 0)}`}
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
            accessibilityHint={`Decrease search radius from ${formatDistance(radius, distanceUnit, 0)}`}
          >
            <Text style={[styles.radiusButtonText, { color: theme.text }]}>−</Text>
            <Text style={[styles.radiusButtonLabel, { color: theme.textSecondary }]}>{t('radius.less')}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Zoom Level Indicator */}
      <View style={[styles.zoomIndicator, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Text style={[styles.zoomIndicatorText, { color: theme.textSecondary }]}>Z{mapViewport.zoom}</Text>
      </View>

      {/* Bottom Left Buttons Container */}
      <View style={styles.bottomLeftButtons}>
        {/* Reverse Mode Button (Warm/Cold) */}
        <TouchableOpacity
          style={[styles.reverseButton, {
            backgroundColor: reverseMode === 'warm' ? '#FF8C42' : reverseMode === 'cold' ? '#4A90E2' : '#888',
            shadowColor: theme.shadow
          }]}
          onPress={toggleReverseMode}
          accessibilityRole="button"
        >
          <Text style={styles.reverseIcon}>{reverseMode === 'warm' ? '☀️' : reverseMode === 'cold' ? '❄️' : <Text>☀️<Text style={{ color: 'rgba(255,255,255,0.5)' }}>/</Text>❄️</Text>}</Text>
          <Text style={styles.reverseLabel}>{reverseMode === 'warm' ? t('map.modeWarmer') : reverseMode === 'cold' ? t('map.modeCooler') : t('map.modeAll')}</Text>
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
  hintText: {
    marginTop: 8,
    fontSize: 14,
    textAlign: 'center',
    paddingHorizontal: 28,
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
  searchBarContainer: {
    position: 'absolute',
    top: 10,
    left: 10,
    right: 80,
    zIndex: 50,
    elevation: 50,
  },
  searchInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  searchInput: {
    flex: 1,
    height: 48,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 3,
    borderColor: '#E0E0E0',
    paddingHorizontal: 16,
    paddingRight: 40,
    fontSize: 16,
    color: '#333',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  searchClearButton: {
    position: 'absolute',
    right: 12,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#E0E0E0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchClearText: {
    fontSize: 14,
    color: '#666',
    fontWeight: '700',
  },
  searchResultsList: {
    backgroundColor: '#fff',
    borderRadius: 12,
    marginTop: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 50,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    overflow: 'hidden',
  },
  searchRow: {
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  searchDescription: {
    fontSize: 14,
    color: '#333',
  },
  searchSubtitle: {
    fontSize: 11,
    color: '#999',
    marginTop: 2,
  },
  searchDivider: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    backgroundColor: '#F5F5F5',
    borderBottomWidth: 1,
    borderBottomColor: '#E8E8E8',
  },
  searchDividerText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#999',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  controlsWrapper: {
    position: 'absolute',
    top: 66,
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
  markerFrameAndroid: {
    width: 128,
    height: 128,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'visible',
  },
  markerContainer: {
    width: 76,
    height: 76,
    borderRadius: 38,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.9)',
    overflow: 'visible',
    zIndex: 999,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.18,
    shadowRadius: 3,
    elevation: 3,
  },
  currentLocationMarker: {
    borderColor: '#5CA3D9',
    borderWidth: 2.5,
  },
  markerWeatherIcon: {
    fontSize: 24,
  },
  markerTemp: {
    fontSize: 14,
    fontWeight: '600',
    color: 'rgba(0, 0, 0, 0.85)',
    marginTop: 1,
    letterSpacing: -0.3,
    backgroundColor: 'rgba(255, 255, 255, 0.75)',
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 6,
    overflow: 'hidden',
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
    borderColor: '#D96240',
    borderWidth: 2.5,
  },
  dedicatedHeroMarker: {
    borderColor: '#FFD700',
    borderWidth: 2.5,
    shadowColor: '#FFD700',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 5,
    elevation: 6,
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
  badgeOverlayContainerLeft: {
    position: 'absolute',
    top: -8,
    left: -8,
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
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 22,
    gap: 6,
    borderWidth: 2,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 6,
  },
  reverseIcon: {
    fontSize: 18,
  },
  reverseLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 0.3,
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
  myLocationButton: {
    position: 'absolute',
    top: 232,
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
  myLocationIcon: {
    fontSize: 30,
    textAlign: 'center',
    lineHeight: 32,
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
  favouriteMarkerBorder: {
    borderColor: '#E8732A',
    borderWidth: 2.5,
    shadowColor: '#E8732A',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 3,
    elevation: 4,
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



