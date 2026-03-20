import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Text,
  TextInput,
  FlatList,
  ActivityIndicator,
  Platform,
  Animated,
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
import { getWeatherForRadius, getWeatherIcon, getWeatherColor, applyBadgesToDestinations } from '../../usecases/weatherUsecases';
import { BadgeMetadata, DestinationBadge } from '../../domain/destinationBadge';
import { playTickSound } from '../../utils/soundUtils';
import { trackMapViews, trackDetailView } from '../../services/placesService';
import { hybridSearch, ensurePlaceInDB } from '../../services/hybridSearchService';
import { getFavourites } from '../../usecases/favouritesUsecases';
import WeatherFilter from '../components/WeatherFilter';
import DateFilter from '../components/DateFilter';
import OnboardingOverlay from '../components/OnboardingOverlay';
import AnimatedBadge from '../components/AnimatedBadge';
import { SkeletonMapMarker } from '../components/SkeletonLoader';

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
}) => {
  const hasImageBadge = getMapBadges(dest.badges).some(
    b => b === DestinationBadge.WARM_AND_DRY || b === DestinationBadge.HEATWAVE
  );
  const [imageLoaded, setImageLoaded] = useState(false);
  const handleImageLoad = useCallback(() => {
    setTimeout(() => setImageLoaded(true), 500);
  }, []);

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
          dest.isCenterPoint && markerStyles.centerPointMarker
        ]}>
          <Text style={markerStyles.markerWeatherIcon}>{getWeatherIcon(dest.condition)}</Text>
          <Text style={markerStyles.markerTemp}>
            {dest.temperature !== null && dest.temperature !== undefined
              ? Math.round(dest.temperature)
              : '?'}°
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

const MapScreen = ({ navigation }) => {
  const { t, i18n } = useTranslation();
  const { theme } = useTheme();
  const mapRef = useRef(null);
  const [location, setLocation] = useState(null);
  const [centerPoint, setCenterPoint] = useState(null); // Custom center point (if set)
  const [centerPointWeather, setCenterPointWeather] = useState(null); // Weather for custom center
  const [destinations, setDestinations] = useState([]);
  const [displayDestinations, setDisplayDestinations] = useState([]); // Derived from destinations + date offset (async when offset !== 0)
  const [visibleMarkers, setVisibleMarkers] = useState([]); // Filtered markers based on zoom
  const [currentZoom, setCurrentZoom] = useState(5); // Track zoom level
  const [currentBounds, setCurrentBounds] = useState(null); // Track viewport bounds
  const radiusDebounceTimer = useRef(null);
  const boundsDebounceTimer = useRef(null);
  const regionChangeDebounceTimer = useRef(null);
  const hasLoadedForLocationRef = useRef(false);
  const skipNextLocationAnimRef = useRef(false);
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
  const loadingStates = [
    { text: 'Suche GPS Signal... 🛰️', duration: 2000 },
    { text: 'Bestimme Position... 📍', duration: 2000 },
    { text: 'Gleich geschafft... ⏱️', duration: 3000 },
  ];
  const loadingTips = [
    'Tipp: WiFi hilft bei Indoor-Ortung',
    'Tipp: GPS funktioniert draußen am besten',
    'Tipp: Standort wird im Hintergrund aktualisiert',
  ];
  const [loadingState, setLoadingState] = useState(loadingStates[0].text);
  const [loadingTipIndex, setLoadingTipIndex] = useState(0);
  const [showSkipLocation, setShowSkipLocation] = useState(false);
  const [loadingDestinations, setLoadingDestinations] = useState(false);
  const [mapType, setMapType] = useState('standard'); // standard, satellite, hybrid, terrain, mutedStandard
  const [controlsExpanded, setControlsExpanded] = useState(true); // Controls einklappbar
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showOnlyBadges, setShowOnlyBadges] = useState(false); // Toggle to show only destinations with badges
  const [showRadiusMenu, setShowRadiusMenu] = useState(false); // Dropdown for radius selection
  const [reverseMode, setReverseMode] = useState('warm'); // 'warm' or 'cold' - which places to reward
  const [radiusShape, setRadiusShape] = useState('circle'); // 'circle', 'half', 'semi' - radius shape
  const [currentRegion, setCurrentRegion] = useState(null); // Track current map region
  const [favouriteDestinations, setFavouriteDestinations] = useState([]);
  const [cachedData, setCachedData] = useState(null); // Cache for destinations
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
    setCurrentBounds({
      north: initialRegion.latitude + initialRegion.latitudeDelta / 2,
      south: initialRegion.latitude - initialRegion.latitudeDelta / 2,
      east: initialRegion.longitude + initialRegion.longitudeDelta / 2,
      west: initialRegion.longitude - initialRegion.longitudeDelta / 2,
    });
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

      // Set initial bounds so marker filtering works immediately
      setCurrentBounds({
        north: DEFAULT_LOCATION.latitude + DEFAULT_LOCATION.latitudeDelta / 2,
        south: DEFAULT_LOCATION.latitude - DEFAULT_LOCATION.latitudeDelta / 2,
        east: DEFAULT_LOCATION.longitude + DEFAULT_LOCATION.longitudeDelta / 2,
        west: DEFAULT_LOCATION.longitude - DEFAULT_LOCATION.longitudeDelta / 2,
      });

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
    setLoadingState(loadingStates[0].text);
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
        if (Date.now() - cacheData.timestamp < 3600000 && Array.isArray(cacheData.data) && cacheData.data.length > 0) {
          setCachedData(cacheData.data);
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
      setCurrentBounds({
        north: DEFAULT_LOCATION.latitude + DEFAULT_LOCATION.latitudeDelta / 2,
        south: DEFAULT_LOCATION.latitude - DEFAULT_LOCATION.latitudeDelta / 2,
        east: DEFAULT_LOCATION.longitude + DEFAULT_LOCATION.longitudeDelta / 2,
        west: DEFAULT_LOCATION.longitude - DEFAULT_LOCATION.longitudeDelta / 2,
      });
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
      currentIndex = (currentIndex + 1) % loadingStates.length;
      setLoadingState(loadingStates[currentIndex].text);
      setLoadingTipIndex(prev => (prev + 1) % loadingTips.length);
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

  // Update visible markers when display data or zoom changes (NOT on pan/bounds)
  useEffect(() => {
    if (displayDestinations.length > 0) {
      const favs = favouriteDestinations.filter(f => f && f.lat != null && f.lon != null);
      const regularMarkers = getVisibleMarkers(displayDestinations, currentZoom, currentBounds, favs);
      
      // Add favourites with weather to visibleMarkers (so they render in regular flow)
      const favsWithWeather = favs.map(fav => {
        const match = displayDestinations.find(d => 
          Math.abs((d.lat ?? d.latitude) - fav.lat) < 0.01 &&
          Math.abs((d.lon ?? d.longitude) - fav.lon) < 0.01
        );
        return match ? { ...fav, ...match, isFavourite: true } : { ...fav, isFavourite: true };
      });
      
      const visible = [...favsWithWeather, ...regularMarkers];
      setVisibleMarkers(visible);
      
      if (__DEV__) {
        const specialCount = visible.filter(v => v.isCurrentLocation || v.isCenterPoint).length;
        console.log(`🔍 Zoom ${currentZoom}: ${visible.length} markers (${favsWithWeather.length} favs, ${specialCount} special) of ${displayDestinations.length}`);
      }

      // Track map_view_count: collect new IDs, debounce 2s, then batch-fire
      const newIds = visible
        .filter(d => d.id && !d.isCurrentLocation && !d.isCenterPoint && !mapViewTrackedIds.current.has(d.id))
        .map(d => d.id);
      if (newIds.length > 0) {
        newIds.forEach(id => mapViewTrackedIds.current.add(id));
        clearTimeout(mapViewTrackTimer.current);
        mapViewTrackTimer.current = setTimeout(() => trackMapViews(newIds), 2000);
      }
    }
  }, [displayDestinations, currentZoom, favouriteDestinations]);

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
      setDestinations(allDestinations);
      // Cache in background so we don't block UI
      AsyncStorage.setItem('mapDestinationsCache', JSON.stringify({
        timestamp: Date.now(),
        data: allDestinations,
      })).catch((cacheError) => console.warn('Failed to cache destinations:', cacheError));
      
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
      const url = `https://customer-api.open-meteo.com/v1/forecast?${params}&apikey=8cJ4NUh7dYHZF1uv`;
      // Run geocode and Open-Meteo in parallel so we don't wait for city name before weather
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
        country_code: countryCode,
        countryCode,
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
    if (destination.id) trackDetailView(destination.id);
    navigation.navigate('DestinationDetail', { destination, selectedDateOffset });
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
   * Dynamic max markers based on zoom and radius.
   * Android gets fewer markers (slower map rendering pipeline).
   */
  const getMaxMarkers = (zoom, radiusKm) => {
    let base = Math.floor(radiusKm / 20);
    
    let zoomFactor;
    if (zoom <= 3) zoomFactor = 0.6;
    else if (zoom <= 4) zoomFactor = 1.0;
    else if (zoom <= 5) zoomFactor = 1.5;
    else zoomFactor = 2.0;
    
    const maxCap = Platform.OS === 'android' ? 80 : 150;
    const minFloor = Platform.OS === 'android' ? 15 : 25;
    const total = Math.min(Math.max(base * zoomFactor, minFloor), maxCap);
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
  
  const getVisibleMarkers = (allPlaces, zoom, bounds, favPlaces = []) => {
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
    
    if (__DEV__) {
      console.log('🎯 Filter Config:', { maxMarkers, zoom, candidates: candidates.length });
    }
    
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
    let skipped = 0;
    let gridLimited = 0;
    let favBlocked = 0;
    
    for (const place of sorted) {
      if (result.length >= maxMarkers) {
        break;
      }
      
      const lat = place.lat || place.latitude;
      const lon = place.lon || place.longitude;
      
      // Check if too close to ANY favourite (favourites always win)
      let blockedByFav = false;
      for (const fav of favPlaces) {
        const dist = getDistanceKm(lat, lon, Number(fav.lat), Number(fav.lon));
        if (dist < minDistance) {
          blockedByFav = true;
          break;
        }
      }
      if (blockedByFav) {
        favBlocked++;
        continue;
      }
      
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
    console.log(`📊 Final: ${result.length} markers (${finalBadgeCount} badges + ${normalCount} normal), ${favBlocked} blocked by favs, ${skipped} too close, ${gridLimited} grid limited, ${gridsUsed.size} grids [${phase}]`);
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
      // Get city name and country from reverse geocoding
      let cityName = 'Neuer Mittelpunkt';
      let countryCode = null;
      try {
        const geocode = await Location.reverseGeocodeAsync({
          latitude: lat,
          longitude: lon,
        });
        
        if (geocode && geocode[0]) {
          const g = geocode[0];
          cityName = g.city || g.district || g.region || 'Neuer Mittelpunkt';
          countryCode = g.isoCountryCode || null;
        }
      } catch (geoError) {
        console.warn('Reverse geocoding failed:', geoError);
      }

      // Use Open-Meteo API - fetch 16 days for badge recalc at any date offset
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
    if (!text || text.length < 2) {
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
        if (__DEV__ && dbPlace) console.log('🆕 Google place saved:', dbPlace.name, dbPlace.id);
      });
    }

    const lat = Number(item.latitude);
    const lng = Number(item.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      const newRegion = {
        latitude: lat,
        longitude: lng,
        latitudeDelta: 0.5,
        longitudeDelta: 0.5,
      };
      skipNextLocationAnimRef.current = true;
      setLocation(newRegion);
      InteractionManager.runAfterInteractions(() => {
        mapRef.current?.animateToRegion(newRegion, 800);
      });
    }
  }, []);

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
      const zoom = Math.round(Math.log2(360 / region.latitudeDelta));
      const newZoom = Math.max(1, Math.min(20, zoom));
      if (newZoom !== currentZoom) {
        if (__DEV__) {
          console.log(`📏 ZOOM: ${currentZoom} → ${newZoom}`);
        }
        setCurrentZoom(newZoom);
      }
      const { latitude, longitude, latitudeDelta, longitudeDelta } = region;
      setCurrentBounds({
        north: latitude + latitudeDelta / 2,
        south: latitude - latitudeDelta / 2,
        east: longitude + longitudeDelta / 2,
        west: longitude - longitudeDelta / 2,
      });
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
    }, 200);
  }, [currentZoom]);

  if (loading && !location) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: theme.background }]}>
        <ActivityIndicator size="large" color={theme.primary} />
        <Text style={[styles.loadingText, { color: theme.text }]}>
          {loadingState}
        </Text>
        <Text style={[styles.hintText, { color: theme.textSecondary || '#888' }]}>
          {loadingTips[loadingTipIndex]}
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
        {(searchResults.length > 0 || googleResults.length > 0) && (
          <View style={styles.searchResultsList}>
            {searchResults.map((item) => (
              <TouchableOpacity
                key={item.id}
                style={styles.searchRow}
                onPress={() => handleSearchResultSelect(item)}
                activeOpacity={0.6}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={[styles.searchDescription, { flex: 1 }]} numberOfLines={1}>
                    {item.description}
                  </Text>
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
                      <Text style={[styles.searchDescription, { flex: 1 }]} numberOfLines={1}>
                        {item.description}
                      </Text>
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
        showsUserLocation={false}
        showsMyLocationButton={false}
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
          />
        ))}

        {/* Favourites - ALWAYS VISIBLE, rendered separately */}
        {favouriteDestinations
          .filter(fav => fav && fav.lat != null && fav.lon != null)
          .map((fav, index) => {
            // Lookup weather from displayDestinations
            const withWeather = displayDestinations.find(d => 
              Math.abs((d.lat ?? d.latitude) - fav.lat) < 0.01 &&
              Math.abs((d.lon ?? d.longitude) - fav.lon) < 0.01
            );
            
            const temp = withWeather?.temperature ?? null;
            const cond = withWeather?.condition ?? 'cloudy';
            
            return (
          <Marker
            key={`sep-fav-${fav.placeId || fav.id || `${fav.lat}-${fav.lon}`}-${selectedDateOffset}-${currentZoom}`}
            coordinate={{ latitude: Number(fav.lat), longitude: Number(fav.lon) }}
            anchor={{ x: 0.5, y: 0.5 }}
            zIndex={10000}
            tracksViewChanges={false}
            onPress={() => handleMarkerPress(withWeather || fav)}
          >
            <View style={styles.markerFrameAndroid}>
              <View style={[
                styles.markerContainer,
                { backgroundColor: temp != null ? getWeatherColor(cond, temp) : '#FFD700' },
                styles.favouriteMarkerBorder,
              ]}>
                {temp != null ? (
                  <>
                    <Text style={styles.markerWeatherIcon}>{getWeatherIcon(cond)}</Text>
                    <Text style={styles.markerTemp}>{Math.round(temp)}°</Text>
                  </>
                ) : (
                  <Text style={{ fontSize: 18, fontWeight: '700', color: '#fff' }}>
                    {(fav.name || '★').replace(/^📍\s?/, '').replace(/^⊕\s?/, '').substring(0, 6)}
                  </Text>
                )}
                <View style={styles.favouriteBadgeWrap}>
                  <AnimatedBadge icon="⭐" color="#FFD700" delay={0} />
                </View>
              </View>
            </View>
          </Marker>
            );
          })}
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
            backgroundColor: reverseMode === 'warm' ? '#FF8C42' : '#4A90E2',
            shadowColor: theme.shadow
          }]}
          onPress={toggleReverseMode}
          accessibilityLabel={reverseMode === 'warm' ? 'Wärmer Modus aktiv' : 'Kühler Modus aktiv'}
          accessibilityRole="button"
          accessibilityHint="Toggle between rewarding warm or cold places"
        >
          <Text style={styles.reverseIcon}>{reverseMode === 'warm' ? '☀️' : '❄️'}</Text>
          <Text style={styles.reverseLabel}>{reverseMode === 'warm' ? 'Wärmer' : 'Kühler'}</Text>
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
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#fff',
    overflow: 'visible',
    zIndex: 999,
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
  favouriteMarkerContainer: {
    backgroundColor: '#FFD700',
    borderRadius: 20,
    borderWidth: 3,
    borderColor: '#DAA520',
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
    maxWidth: 120,
  },
  favouriteMarkerStar: {
    fontSize: 18,
    color: '#8B6914',
  },
  favouriteMarkerName: {
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
    flexShrink: 1,
  },
  favouriteMarkerBorder: {
    borderWidth: 3,
    borderColor: '#FFD700',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
    elevation: 6,
  },
  favouriteBadgeWrap: {
    position: 'absolute',
    top: -14,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 10,
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



