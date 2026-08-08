import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Pressable,
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
import MapView, { Marker, Circle, Polyline } from 'react-native-maps';
import * as Location from 'expo-location';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../theme/ThemeProvider';
import { getWeatherForRadius, getWeatherIcon, getWeatherColor, mapWeatherCode, applyBadgesToDestinations } from '../../usecases/weatherUsecases';
import { BadgeMetadata, DestinationBadge, filterWarmDryIfHeatwave } from '../../domain/destinationBadge';
import { playTickSound, playMediumHaptic } from '../../utils/soundUtils';
import { trackMapViews, trackDetailView } from '../../services/placesService';
import { mixpanel } from '../../services/mixpanel';
import {
  trackRadiusChanged,
  trackCenterMethod,
  trackRefMode,
} from '../../utils/ironicProgress';
import { hybridSearch, ensurePlaceInDB } from '../../services/hybridSearchService';
import { getPlaceDetail, fetchExtendedForecast } from '../../services/placesWeatherService';
import { getPlaceName } from '../../utils/localization';
import { getFavourites } from '../../usecases/favouritesUsecases';
import WeatherFilter from '../components/WeatherFilter';
import DateFilter from '../components/DateFilter';
import LoadingModal from '../components/LoadingModal';
import NoHighlightsModal from '../components/NoHighlightsModal';
import OnboardingOverlay from '../components/OnboardingOverlay';
import AnimatedBadge from '../components/AnimatedBadge';
import { useUnits } from '../../contexts/UnitContext';
import { formatTemperature, formatDistance, milesToKm, kmToMiles } from '../../utils/unitConversion';
import { hasDedicatedHeroImage } from '../../utils/heroImages';
import { supabase } from '../../config/supabase';
import { getPreloadResult, getCachedLocation, setCachedLocation } from '../../utils/locationPreload';

// Apple MapKit on iOS (default) — better colors than Google. customMapStyle is Google-only.
// Never set Marker `image` to a 1×1 transparent PNG on Apple Maps: AIRMapMarker
// sizes the annotation from self.image, so hit-testing collapses to 1px while
// children still paint (untappable "ghost" badges/circles).

// Minimum movement (in km) between the currently shown position and a fresh GPS
// fix before it's worth re-centering + re-fetching markers a second time.
const SIGNIFICANT_MOVE_KM = 10;
const EARTH_RADIUS_KM = 6371;

function getDistanceKm(lat1, lon1, lat2, lon2) {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isWithinRadiusKm(centerLat, centerLon, lat, lon, radiusKm) {
  if (!Number.isFinite(centerLat) || !Number.isFinite(centerLon)) return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (!Number.isFinite(radiusKm) || radiusKm <= 0) return false;
  return getDistanceKm(centerLat, centerLon, lat, lon) <= radiusKm;
}

/** MapKit MKCircle jetsams / hard-crashes around 1500–2000km overlays. */
const MAX_RADIUS_CIRCLE_KM = 1200;
/** Cap region deltas so animateToRegion can't ask for near-world spans. */
const MAX_MAP_DELTA = 55;

function regionDeltasForRadiusKm(latitude, radiusKm, pad = 1) {
  const r = Math.max(0, Number(radiusKm) || 0);
  const cosLat = Math.max(0.2, Math.cos((Number(latitude) || 0) * Math.PI / 180));
  return {
    latitudeDelta: Math.min((r * 2 * pad) / 111, MAX_MAP_DELTA),
    longitudeDelta: Math.min((r * 2 * pad) / (111 * cosLat), MAX_MAP_DELTA),
  };
}

/** Geodesic ring for large radii — Polyline avoids MKCircle's crashy bounding rect. */
function circleRingCoordinates(lat, lon, radiusKm, steps = 72) {
  const coords = [];
  const angular = radiusKm / EARTH_RADIUS_KM;
  const latRad = lat * Math.PI / 180;
  const lonRad = lon * Math.PI / 180;
  for (let i = 0; i <= steps; i++) {
    const bearing = (2 * Math.PI * i) / steps;
    const lat2 = Math.asin(
      Math.sin(latRad) * Math.cos(angular) +
      Math.cos(latRad) * Math.sin(angular) * Math.cos(bearing),
    );
    const lon2 = lonRad + Math.atan2(
      Math.sin(bearing) * Math.sin(angular) * Math.cos(latRad),
      Math.cos(angular) - Math.sin(latRad) * Math.sin(lat2),
    );
    coords.push({
      latitude: lat2 * 180 / Math.PI,
      longitude: ((lon2 * 180 / Math.PI + 540) % 360) - 180,
    });
  }
  return coords;
}

const TROPHY_BADGES = new Set([DestinationBadge.WORTH_THE_DRIVE, DestinationBadge.WORTH_THE_DRIVE_BUDGET]);
const isTrophyWorthy = (badges) => badges.some(b => TROPHY_BADGES.has(b));

/**
 * Get all badges for map markers (all badges are shown on map now).
 * Module-level so memoized markers get a stable reference.
 */
const getMapBadges = (badges, heatwaveShouldAward = false) => {
  return filterWarmDryIfHeatwave(badges, heatwaveShouldAward);
};

const markerKeyFor = (dest) =>
  dest.isCurrentLocation ? 'cl'
  : dest.isCenterPoint ? `cp-${dest.id || dest.placeId || `${dest.lat}-${dest.lon}`}`
  : String(dest.id || dest.placeId || `${dest.lat}-${dest.lon}`);

const favStableKey = (fav) =>
  String(fav.placeId || fav.id || `${fav.lat}-${fav.lon}`);

// Above favourites (10k) and regular markers — origin pin always on top
const ORIGIN_MARKER_Z_INDEX = 20000;

/**
 * Dedicated GPS / chosen-location pin.
 * Must NOT go through DestinationMarker or the density list: radius animateToRegion
 * + Circle updates blank custom MapKit annotations when React doesn't remount them
 * (memoized origin with stable props stays invisible). Plain Views only — Animated
 * children also blank after camera moves on iOS.
 */
const OriginPinMarker = ({
  coordinate,
  weather,
  isCenterPoint,
  onPress,
  styles: s,
  temperatureUnit,
  getWeatherColor,
  getWeatherIcon,
}) => {
  const { t } = useTranslation();
  const temp = weather?.temperature;
  const condition = weather?.condition || 'cloudy';
  return (
    <Marker
      coordinate={coordinate}
      anchor={{ x: 0.5, y: 64 / 118 }}
      zIndex={ORIGIN_MARKER_Z_INDEX}
      style={{ overflow: 'visible', zIndex: ORIGIN_MARKER_Z_INDEX }}
      tracksViewChanges
      onPress={onPress}
    >
      <View style={[s.markerFrameAndroid, s.currentLocationFrame]} collapsable={false}>
        <View
          style={[
            s.markerContainer,
            { backgroundColor: getWeatherColor(condition, temp) },
            isCenterPoint ? s.centerPointMarker : s.currentLocationMarker,
          ]}
          collapsable={false}
        >
          <Text style={s.markerWeatherIcon}>{getWeatherIcon(condition)}</Text>
          <Text style={s.markerTemp}>
            {temp != null ? formatTemperature(temp, temperatureUnit, false) : '?°'}
          </Text>
        </View>
        <Text style={[s.currentLocationLabel, isCenterPoint && s.centerPointLabel]}>
          {t(isCenterPoint ? 'map.chosenLocation' : 'map.youAreHere')}
        </Text>
      </View>
    </Marker>
  );
};

const DestinationMarker = React.memo(({
  dest,
  coordinate = null,
  onPress,
  getWeatherColor,
  getWeatherIcon,
  styles: markerStyles,
  temperatureUnit,
}) => {
  const hasImageBadge = getMapBadges(dest.badges, dest._heatwaveData?.shouldAward).some(
    b => b === DestinationBadge.WARM_AND_DRY || b === DestinationBadge.HEATWAVE
  );
  // Apple MapKit ignores tracksViewChanges — skip the repaint state machine (re-render churn).
  const tracksViewChangesSupported = Platform.OS === 'android';
  const [imageLoaded, setImageLoaded] = useState(!hasImageBadge || !tracksViewChangesSupported);
  const imageLoadTimerRef = useRef(null);
  const handleImageLoad = useCallback(() => {
    if (!tracksViewChangesSupported) return;
    imageLoadTimerRef.current = setTimeout(() => setImageLoaded(true), 120);
  }, [tracksViewChangesSupported]);
  useEffect(() => {
    return () => clearTimeout(imageLoadTimerRef.current);
  }, []);

  const contentSig = `${dest.temperature}|${dest.condition}|${(dest.badges || []).join(',')}`;
  const prevSigRef = useRef(contentSig);
  const [repaintWindow, setRepaintWindow] = useState(false);
  useEffect(() => {
    if (!tracksViewChangesSupported) return undefined;
    if (prevSigRef.current === contentSig) return undefined;
    prevSigRef.current = contentSig;
    if (hasImageBadge) setImageLoaded(false);
    setRepaintWindow(true);
    const timer = setTimeout(() => setRepaintWindow(false), 60);
    return () => clearTimeout(timer);
  }, [contentSig, hasImageBadge, tracksViewChangesSupported]);

  useEffect(() => {
    if (!tracksViewChangesSupported || imageLoaded || !hasImageBadge) return undefined;
    const safety = setTimeout(() => setImageLoaded(true), 2000);
    return () => clearTimeout(safety);
  }, [hasImageBadge, imageLoaded, tracksViewChangesSupported]);

  const pinLat = coordinate?.latitude ?? dest.lat;
  const pinLon = coordinate?.longitude ?? dest.lon;
  const tracksViewChanges = tracksViewChangesSupported
    && (repaintWindow || (hasImageBadge ? !imageLoaded : false));

  return (
    <Marker
      coordinate={{ latitude: pinLat, longitude: pinLon }}
      anchor={{ x: 0.5, y: 0.5 }}
      style={{ overflow: 'visible', zIndex: 999 }}
      tracksViewChanges={tracksViewChanges}
      onPress={() => onPress(dest)}
    >
      <View style={markerStyles.markerFrameAndroid} collapsable={false}>
        <View style={[
          markerStyles.markerContainer,
          { backgroundColor: getWeatherColor(dest.condition, dest.temperature) },
          hasDedicatedHeroImage(dest.id || dest.placeId) && markerStyles.dedicatedHeroMarker,
        ]}>
          <Text style={markerStyles.markerWeatherIcon}>{getWeatherIcon(dest.condition)}</Text>
          <Text style={markerStyles.markerTemp}>
            {dest.temperature !== null && dest.temperature !== undefined
              ? formatTemperature(dest.temperature, temperatureUnit, false)
              : '?°'}
          </Text>
          {getMapBadges(dest.badges, dest._heatwaveData?.shouldAward).length > 0 && (() => {
            const sorted = getMapBadges(dest.badges, dest._heatwaveData?.shouldAward)
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
                      delay={i * 40}
                      animate="light"
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
                        delay={(i + 3) * 40}
                        animate="light"
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
});

// Map boundaries — EU + NA + TR + Maghreb (Americas west of -25° via search split)
const MAP_BOUNDS = {
  north: 75,   // Spitzbergen + Puffer
  south: 15,   // Südlich von Mexico City + Puffer
  west: -175,  // Alaska + Pazifik-Inseln
  east: 50     // Östlich Ural + Puffer
};

function isWithinSupportedMapRegion(latitude, longitude) {
  return (
    latitude >= MAP_BOUNDS.south &&
    latitude <= MAP_BOUNDS.north &&
    longitude >= MAP_BOUNDS.west &&
    longitude <= MAP_BOUNDS.east
  );
}

const LOADING_STATE_KEYS = ['map.loadingState0', 'map.loadingState1', 'map.loadingState2'];
const LOADING_TIP_KEYS = ['map.loadingTip0', 'map.loadingTip1', 'map.loadingTip2'];

const LOADING_CARD_PHASES = [
  'loadingCardPhaseLocation',
  'loadingCardPhaseNearby',
  'loadingCardPhaseWeather',
  'loadingCardPhasePlaces',
];

const buildLoadingCardPhases = () => {
  const phases = [...LOADING_CARD_PHASES];
  if (Math.random() < 0.15) {
    phases.splice(1 + Math.floor(Math.random() * phases.length), 0, 'loadingCardPhaseGoldie');
  }
  return phases;
};

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
  // mapViewport: live (zoom chip / tap radius). markerViewport: settled only — drives markers.
  // Updating markers mid-pinch at ~z6 was the silent jetsam.
  const [mapViewport, setMapViewport] = useState({ zoom: 5, bounds: null });
  const [markerViewport, setMarkerViewport] = useState({ zoom: 5, bounds: null });
  const [devZoom, setDevZoom] = useState(5);
  const currentZoomRef = useRef(5);
  const radiusDebounceTimer = useRef(null);
  const originPinRemountTimer = useRef(null);

  const regionChangeDebounceTimer = useRef(null);
  const markerViewportDebounceTimer = useRef(null);

  /** Init / center changes: keep map + marker viewports in sync. Pan/zoom uses delayed marker commit. */
  const setViewports = useCallback((updater) => {
    setMapViewport(updater);
    setMarkerViewport(updater);
  }, []);
  const loadRequestIdRef = useRef(0);
  const hasLoadedForLocationRef = useRef(false);
  const skipNextLocationAnimRef = useRef(false);
  const flyOverActiveRef = useRef(false);
  const markerJustPressedRef = useRef(false);
  const lastMapTapRef = useRef(0);
  const [radius, setRadius] = useState(500); // Default 500km
  const [selectedConditions, setSelectedConditions] = useState([]);
  const [selectedDateOffset, setSelectedDateOffset] = useState(0); // 0=today, 1=tomorrow, 3=+3days, 5=+5days
  const [loading, setLoading] = useState(true);
  const [locationError, setLocationError] = useState(null); // Error state for location fetch
  const [locationPermissionGranted, setLocationPermissionGranted] = useState(false); // Track if GPS permission was granted
  const lastAppliedCoordsRef = useRef(null); // Most recently applied real coords, for movement-threshold checks
  // Bump to remount OriginPinMarker after MapKit blanks it (radius anim / pan settle).
  const [originPinGen, setOriginPinGen] = useState(0);
  const bumpOriginPin = useCallback(() => {
    setOriginPinGen((g) => g + 1);
  }, []);
  const lastOriginBumpAtRef = useRef(0);
  const bumpOriginPinThrottled = useCallback(() => {
    const now = Date.now();
    if (now - lastOriginBumpAtRef.current < 400) return;
    lastOriginBumpAtRef.current = now;
    bumpOriginPin();
  }, [bumpOriginPin]);
  const mapViewTrackedIds = useRef(new Set()); // Deduplicate map_view_count per session
  const mapViewTrackTimer = useRef(null);
  const [loadingStateIndex, setLoadingStateIndex] = useState(0);
  const [loadingTipIndex, setLoadingTipIndex] = useState(0);
  const [showSkipLocation, setShowSkipLocation] = useState(false);
  const [loadingDestinations, setLoadingDestinations] = useState(false);
  const [loadingPhaseKey, setLoadingPhaseKey] = useState(LOADING_CARD_PHASES[0]);
  const loadingPhaseTimerRef = useRef(null);
  const [controlsExpanded, setControlsExpanded] = useState(false); // Controls einklappbar
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
  const [showRefMenu, setShowRefMenu] = useState(false); // Reference location context menu
  const [showRefTip, setShowRefTip] = useState(false); // One-time tooltip for the reference button
  const savedManualRef = useRef(null); // Last manual center { center, weather }, kept across mode switches

  // Default fallback location (Frankfurt, center of Europe)
  const DEFAULT_LOCATION = {
    latitude: 50.1109,
    longitude: 8.6821,
    latitudeDelta: 2,
    longitudeDelta: 2,
  };

  // Viewport bounds matching the map's initialRegion (radius * 2 * 1.5 delta).
  // Must cover what the map actually shows on start; onRegionChangeComplete
  // refines them later. A too-small initial box hides most markers until the
  // user moves the map.
  const initialViewportBounds = (latitude, longitude, radiusKm) => {
    const latDelta = (radiusKm * 2 * 1.5) / 111;
    const lonDelta = (radiusKm * 2 * 1.5) / (111 * Math.cos(latitude * Math.PI / 180));
    return {
      north: latitude + latDelta / 2,
      south: latitude - latDelta / 2,
      east: longitude + lonDelta / 2,
      west: longitude - lonDelta / 2,
    };
  };

  const viewportForCenter = useCallback((latitude, longitude, radiusKm) => {
    const latDelta = (radiusKm * 2 * 1.5) / 111;
    return {
      zoom: Math.max(1, Math.min(20, Math.round(Math.log2(360 / latDelta)))),
      bounds: initialViewportBounds(latitude, longitude, radiusKm),
    };
  }, []);

  const viewportForRegion = useCallback((region) => {
    const { latitude, longitude, latitudeDelta, longitudeDelta } = region;
    return {
      zoom: Math.max(1, Math.min(20, Math.round(Math.log2(360 / (latitudeDelta || 1))))),
      bounds: {
        north: latitude + latitudeDelta / 2,
        south: latitude - latitudeDelta / 2,
        east: longitude + longitudeDelta / 2,
        west: longitude - longitudeDelta / 2,
      },
    };
  }, []);

  /** Search / long-press: sync map + marker viewports immediately; drop pending pan debounces. */
  const commitViewportsNow = useCallback((viewport) => {
    if (markerViewportDebounceTimer.current) {
      clearTimeout(markerViewportDebounceTimer.current);
      markerViewportDebounceTimer.current = null;
    }
    if (regionChangeDebounceTimer.current) {
      clearTimeout(regionChangeDebounceTimer.current);
      regionChangeDebounceTimer.current = null;
    }
    currentZoomRef.current = viewport.zoom;
    setViewports(viewport);
    if (__DEV__) setDevZoom(viewport.zoom);
  }, [setViewports]);

  const triggerCurrentLocationPulse = useCallback(() => {
    bumpOriginPinThrottled();
  }, [bumpOriginPinThrottled]);

  // Remount origin pin when a location is freely chosen (long-press / search)
  useEffect(() => {
    if (!centerPoint) return;
    bumpOriginPin();
  }, [centerPoint?.latitude, centerPoint?.longitude, bumpOriginPin]);

  const applyLocationFromPosition = useCallback((position, { notifyFallback = false } = {}) => {
    if (!position?.coords) return;
    const { latitude, longitude } = position.coords;
    lastAppliedCoordsRef.current = { latitude, longitude };
    setCachedLocation({ latitude, longitude });
    const outsideSupported = !isWithinSupportedMapRegion(latitude, longitude);
    const initialRegion = outsideSupported
      ? { ...DEFAULT_LOCATION }
      : {
          latitude,
          longitude,
          latitudeDelta: 2,
          longitudeDelta: 2,
        };
    if (outsideSupported) {
      __DEV__ && console.warn(
        `GPS outside supported map (${latitude}, ${longitude}) → Frankfurt fallback`
      );
    }
    setLocation(initialRegion);
    setViewports(prev => ({
      ...prev,
      bounds: initialViewportBounds(initialRegion.latitude, initialRegion.longitude, radius),
    }));
    setLocationError(null);
    if (!outsideSupported) {
      triggerCurrentLocationPulse();
    }
    if (outsideSupported && notifyFallback) {
      showToast(t('map.usingDefaultLocation'), 'info');
    }
  }, [t, triggerCurrentLocationPulse]);

  /**
   * Skip location → use default (Frankfurt).
   * Sets all required state so the map fully initializes without crashing.
   */
  const skipToDefaultLocation = useCallback(() => {
    mixpanel.track('Location Permission Skipped');
    try {
      setLocation(DEFAULT_LOCATION);
      setLocationError(null);
      setLoading(false);

      setViewports(prev => ({
        ...prev,
        bounds: initialViewportBounds(DEFAULT_LOCATION.latitude, DEFAULT_LOCATION.longitude, radius),
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
    setLoadingStateIndex(0);
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
      mixpanel.track('Onboarding Shown');
    }

    if (savedCenter) {
      try {
        const parsed = JSON.parse(savedCenter);
        setCenterPoint({
          latitude: parsed.latitude,
          longitude: parsed.longitude,
          latitudeDelta: parsed.latitudeDelta ?? 2,
          longitudeDelta: parsed.longitudeDelta ?? 2,
          placeId: parsed.placeId || null,
        });
        setViewports(prev => ({
          ...prev,
          bounds: initialViewportBounds(parsed.latitude, parsed.longitude, radius),
        }));
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
        const CACHE_VERSION = 2;
        const cacheValid = Date.now() - cacheData.timestamp < 3600000
          && cacheData.version === CACHE_VERSION
          && Array.isArray(cacheData.data) && cacheData.data.length > 0
          && cacheData.data.some(d => d.image_region !== undefined);
        if (cacheValid) {
          setDestinations(cacheData.data);
        }
      } catch (e) { /* corrupted JSON */ }
    }

    // 0. Instant path: a real GPS fix already resolved earlier this session
    // (e.g. re-mount after login/logout) — show it immediately, no waiting.
    const sessionCached = getCachedLocation();
    if (sessionCached) {
      applyLocationFromPosition({ coords: sessionCached }, { notifyFallback: false });
      setLoading(false);
    }

    // 1. Check if Location Services are enabled
    try {
      const enabled = await Location.hasServicesEnabledAsync();
      if (!enabled) {
        if (!lastAppliedCoordsRef.current) {
          setLocationError('disabled');
          setLoading(false);
        }
        return;
      }
    } catch (error) {
      if (__DEV__) console.warn('Could not check location services:', error);
    }

    // 2. Check permission WITHOUT prompting first. If it's not granted yet,
    // show the fallback region (and let markers load for it) right away instead
    // of waiting on the permission dialog; request permission in the background.
    let permissionStatus = getPreloadResult().permissionStatus;
    if (!permissionStatus) {
      try {
        permissionStatus = (await Location.getForegroundPermissionsAsync()).status;
      } catch (error) {
        if (__DEV__) console.warn('getForegroundPermissionsAsync failed:', error.message);
        permissionStatus = 'undetermined';
      }
    }

    if (permissionStatus !== 'granted') {
      setLocationPermissionGranted(false);
      if (!lastAppliedCoordsRef.current) {
        setLocation(DEFAULT_LOCATION);
        setViewports(prev => ({
          ...prev,
          bounds: initialViewportBounds(DEFAULT_LOCATION.latitude, DEFAULT_LOCATION.longitude, radius),
        }));
        setLocationError(null);
        showToast(t('map.usingDefaultLocation'), 'info');
        setLoading(false);
      }

      Location.requestForegroundPermissionsAsync()
        .then(async ({ status }) => {
          if (status !== 'granted') {
            setLocationPermissionGranted(false);
            if (!lastAppliedCoordsRef.current) setLocationError('permission');
            return;
          }
          setLocationPermissionGranted(true);
          setLocationError(null);
          try {
            const fresh = await Location.getCurrentPositionAsync({
              accuracy: Location.Accuracy.Balanced,
              timeout: 15000,
              maximumAge: 10000,
            });
            if (fresh?.coords) {
              applyLocationFromPosition(fresh, { notifyFallback: true });
              setLoading(false);
            }
          } catch (error) {
            if (__DEV__) console.warn('getCurrentPositionAsync (post-permission) failed:', error.message);
          }
        })
        .catch((error) => {
          console.error('Location permission error:', error);
          setLocationPermissionGranted(false);
          if (!lastAppliedCoordsRef.current) {
            setLocationError('permission');
            setLoading(false);
          }
        });
      return;
    }

    setLocationPermissionGranted(true);

    // 3. Try preloaded / cached location first for an instant map start
    let hasInstantLocation = !!lastAppliedCoordsRef.current;
    try {
      const preloadedPosition = getPreloadResult().lastKnownPosition;
      const lastKnown = preloadedPosition || await Location.getLastKnownPositionAsync({
        maxAge: 60000,
      });
      if (lastKnown?.coords) {
        const prev = lastAppliedCoordsRef.current;
        const movedSignificantly = !prev || getDistanceKm(
          prev.latitude, prev.longitude, lastKnown.coords.latitude, lastKnown.coords.longitude
        ) > SIGNIFICANT_MOVE_KM;
        if (movedSignificantly) {
          applyLocationFromPosition(lastKnown, { notifyFallback: true });
        } else {
          setCachedLocation({ latitude: lastKnown.coords.latitude, longitude: lastKnown.coords.longitude });
        }
        setLoading(false);
        hasInstantLocation = true;
      }
    } catch (error) {
      if (__DEV__) console.warn('getLastKnownPositionAsync (fast start) failed:', error.message);
    }

    // 4. Fetch fresh position in background. Only re-center + re-fetch markers if it
    // meaningfully differs from what's already shown, to avoid a redundant double load.
    try {
      const fresh = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
        timeout: 15000,
        maximumAge: 10000,
      });
      if (fresh?.coords) {
        const prev = lastAppliedCoordsRef.current;
        const movedSignificantly = !prev || getDistanceKm(
          prev.latitude, prev.longitude, fresh.coords.latitude, fresh.coords.longitude
        ) > SIGNIFICANT_MOVE_KM;
        if (movedSignificantly) {
          applyLocationFromPosition(fresh, { notifyFallback: true });
        } else {
          setCachedLocation({ latitude: fresh.coords.latitude, longitude: fresh.coords.longitude });
        }
        setLoading(false);
        return;
      }
    } catch (error) {
      if (__DEV__) console.warn('getCurrentPositionAsync failed:', error.message);
    }

    // 5. If no instant location was available and fresh GPS failed, use default
    if (!hasInstantLocation) {
      if (__DEV__) console.warn('No cached or fresh location available, using default location');
      setLocation(DEFAULT_LOCATION);
      setViewports(prev => ({
        ...prev,
        bounds: initialViewportBounds(DEFAULT_LOCATION.latitude, DEFAULT_LOCATION.longitude, radius),
      }));
      setLocationError(null);
      showToast(t('map.usingDefaultLocation'), 'info');
      setLoading(false);
    }
  };

  useEffect(() => {
    mixpanel.track('Map Opened');
    initializeLocation();
  }, []);

  // Load favourites on mount and whenever the screen gains focus
  useEffect(() => {
    const loadFavs = async () => {
      try {
        const favs = await getFavourites();
        setFavouriteDestinations(favs);
      } catch (e) {
        if (__DEV__) console.warn('Failed to load favourites for map:', e);
      }
    };
    loadFavs();

    const unsubscribe = navigation.addListener('focus', loadFavs);
    return unsubscribe;
  }, [navigation]);

  useEffect(() => {
    if (!(loading && !location)) return undefined;
    const interval = setInterval(() => {
      setLoadingStateIndex(prev => (prev + 1) % LOADING_STATE_KEYS.length);
      setLoadingTipIndex(prev => (prev + 1) % LOADING_TIP_KEYS.length);
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
    AsyncStorage.setItem('selectedDateOffset', selectedDateOffset.toString()).catch(err => {
      if (__DEV__) console.warn('Failed to save date offset:', err);
    });
  }, [selectedDateOffset]);

  const persistCenterPoint = useCallback((center, placeId = null) => {
    if (center?.latitude == null || center?.longitude == null) return;
    AsyncStorage.setItem('mapCenterPoint', JSON.stringify({
      latitude: center.latitude,
      longitude: center.longitude,
      latitudeDelta: center.latitudeDelta ?? 2,
      longitudeDelta: center.longitudeDelta ?? 2,
      ...(placeId ? { placeId } : {}),
    })).catch((error) => {
      if (__DEV__) console.warn('Failed to save center point:', error);
    });
  }, []);

  const stableManualCenterId = (lat, lon) =>
    `manual-${Math.round(lat * 10000)}-${Math.round(lon * 10000)}`;

  // Persist center coords always; attach placeId when weather/id is known
  useEffect(() => {
    if (!centerPoint?.latitude || !centerPoint?.longitude) return;
    const placeId = centerPointWeather?.id || centerPoint.placeId || null;
    persistCenterPoint(centerPoint, placeId);
  }, [centerPoint, centerPointWeather?.id, centerPoint?.placeId, persistCenterPoint]);

  // Remember the last manual reference so the context menu can switch back to it
  useEffect(() => {
    if (centerPoint) {
      savedManualRef.current = { center: centerPoint, weather: centerPointWeather };
    }
  }, [centerPoint, centerPointWeather]);

  // One-time tooltip for the reference location button
  useEffect(() => {
    if (__DEV__) {
      setShowRefTip(true);
      return;
    }
    AsyncStorage.getItem('refLocTipShown')
      .then(val => { if (!val) setShowRefTip(true); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!location) return;
    if (__DEV__) console.log('🔄 Trigger: location/radius/centerPoint changed, reloading destinations...');
    // First time we get location: load immediately (no debounce). Later: debounce radius/center changes.
    if (!hasLoadedForLocationRef.current) {
      hasLoadedForLocationRef.current = true;
      // A restored center point has no weather yet, so its origin temperature is still
      // unknown here. The centerPointWeather effect below fires the load once it arrives.
      if (!centerPoint || centerPointWeather) loadDestinations();
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
        ...regionDeltasForRadiusKm(effectiveCenter.latitude, radius),
      }, 600);
      // MapKit blanks the custom origin annotation during animateToRegion + Circle
      // resize; remount after the camera settles so the pin is visible again.
      if (originPinRemountTimer.current) clearTimeout(originPinRemountTimer.current);
      originPinRemountTimer.current = setTimeout(() => {
        originPinRemountTimer.current = null;
        bumpOriginPin();
      }, 700);
    }
    return () => {
      if (radiusDebounceTimer.current) clearTimeout(radiusDebounceTimer.current);
      if (originPinRemountTimer.current) clearTimeout(originPinRemountTimer.current);
    };
    // Intentionally omit centerPointWeather: reload only when center *position* changes to avoid double load after long-press
    // selectedConditions is intentionally omitted: weather filter is applied client-side in visibleMarkers
  }, [location, radius, centerPoint, reverseMode, bumpOriginPin]);

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
      if (loadingPhaseTimerRef.current) {
        clearInterval(loadingPhaseTimerRef.current);
      }
    };
  }, []);

  /**
   * Sync displayDestinations from destinations + date offset.
   * Offset 0: set immediately (no heavy work). Offset !== 0: run shift+badges after interactions so tap stays instant.
   */
  const normalizeForecastEntry = useCallback((entry) => {
    if (!entry) return null;
    const temp = entry.temp ?? entry.temperature ?? entry.high ?? null;
    const high = entry.high ?? entry.temp_max ?? entry.temperature ?? null;
    const low = entry.low ?? entry.temp_min ?? (high != null ? high - 3 : null);
    return {
      ...entry,
      condition: entry.condition,
      temp, tempMax: high, high, low,
      precipitation: entry.precipitation ?? 0,
      windSpeed: entry.windSpeed ?? 0,
      humidity: entry.humidity ?? null,
      description: entry.description ?? entry.weather_description ?? '',
      sunshine_duration: entry.sunshine_duration ?? 0,
    };
  }, []);

  const buildShiftedForecast = useCallback((arr, off) => {
    const keys = ['today', 'tomorrow', 'day3', 'day4', 'day5'];
    const result = {};
    keys.forEach((key, i) => {
      const entry = arr[off + i];
      if (entry) result[key] = normalizeForecastEntry(entry);
    });
    return result;
  }, [normalizeForecastEntry]);

  const shiftDestination = useCallback((dest, offset) => {
    // Branch 1: forecastDays (current location / center point from buildWeatherFromDB)
    if (dest.forecastDays && dest.forecastDays[offset]) {
      const dayData = dest.forecastDays[offset];
      const shiftedForecast = {};
      ['today', 'tomorrow', 'day3', 'day4', 'day5'].forEach((key, i) => {
        const fd = dest.forecastDays[offset + i];
        if (fd) {
          shiftedForecast[key] = normalizeForecastEntry({
            condition: fd.condition, temp: fd.temperature,
            high: Math.round(fd.temp_max || fd.temperature),
            low: Math.round(fd.temp_min || fd.temperature - 3),
            precipitation: fd.precipitation, windSpeed: fd.windSpeed,
            humidity: fd.humidity,
            description: fd.description ?? fd.weather_description ?? '',
            sunshine_duration: fd.sunshine_duration || 0,
          });
        }
      });
      return {
        ...dest, temperature: dayData.temperature, condition: dayData.condition,
        temp_max: dayData.temp_max, temp_min: dayData.temp_min,
        windSpeed: dayData.windSpeed, precipitation: dayData.precipitation,
        humidity: dayData.humidity ?? dest.humidity,
        description: dayData.description ?? dest.description,
        weather_description: dayData.description ?? dest.weather_description,
        sunshine_duration: dayData.sunshine_duration || 0, forecast: shiftedForecast,
      };
    }
    // Branch 2: forecastArray (places from getPlacesWithWeather)
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
    return null;
  }, [normalizeForecastEntry, buildShiftedForecast]);

  useEffect(() => {
    if (!destinations.length) {
      setDisplayDestinations([]);
      return;
    }
    if (selectedDateOffset === 0) {
      const origin = destinations.find(d => d.isCenterPoint) || destinations.find(d => d.isCurrentLocation);
      if (origin) applyBadgesToDestinations(destinations, origin, origin.lat, origin.lon, reverseMode, radius);
      // Shallow-copy elements: applyBadgesToDestinations mutates in place, and the
      // memoized markers only re-render when the dest reference changes.
      setDisplayDestinations(destinations.map(d => ({ ...d })));
      return;
    }

    const offset = selectedDateOffset;

    // Check if destinations have enough forecast data for this offset
    const needsExtendedData = destinations.some(d =>
      !d.isCurrentLocation && !d.isCenterPoint &&
      !d.forecastDays?.[offset] &&
      !(d.forecastArray && d.forecastArray.length > offset)
    );

    const applyShift = (dests) => {
      const shifted = dests.map(dest => shiftDestination(dest, offset) || dest);
      const origin = shifted.find(d => d.isCenterPoint) || shifted.find(d => d.isCurrentLocation);
      if (origin) applyBadgesToDestinations(shifted, origin, origin.lat, origin.lon, reverseMode, radius);
      if (__DEV__) {
        const ok = shifted.filter((s, i) => s !== dests[i]).length;
        if (__DEV__) console.log(`📅 +${offset}: ${ok} shifted, ${shifted.length - ok} unchanged`);
      }
      // Shallow-copy: badge application mutates in place, memoized markers compare by reference
      setDisplayDestinations(shifted.map(d => ({ ...d })));
    };

    if (!needsExtendedData) {
      applyShift(destinations);
      return;
    }

    // Forecast data too short → fetch extended forecast on-demand
    const idsToFetch = destinations
      .filter(d => d.id && !d.isCurrentLocation && !d.isCenterPoint &&
        !d.forecastDays?.[offset] &&
        !(d.forecastArray && d.forecastArray.length > offset))
      .map(d => d.id);

    __DEV__ && console.log(`📅 +${offset}: need extended forecast for ${idsToFetch.length} places...`);

    let cancelled = false;
    fetchExtendedForecast(idsToFetch).then(extendedMap => {
      if (cancelled) return;
      const enriched = destinations.map(d => {
        if (d.id && extendedMap[d.id]) {
          return { ...d, forecastArray: extendedMap[d.id] };
        }
        return d;
      });
      // Persist enriched forecastArrays back to destinations state
      setDestinations(enriched);
      applyShift(enriched);
    }).catch(err => {
      __DEV__ && console.warn('Extended forecast fetch failed:', err);
      applyShift(destinations);
    });

    return () => { cancelled = true; };
    // radius intentionally omitted: +/- only reloads destinations (debounced);
    // re-badging the old list on every tick freezes the UI. Badges recompute
    // when setDestinations runs after load, which already closes over new radius.
  }, [destinations, selectedDateOffset, reverseMode, shiftDestination]);

  // Center-point weather for the dedicated map pin (date-offset aware)
  const displayCenterPointWeather = useMemo(() => {
    if (!centerPointWeather) return null;
    const shifted = displayDestinations.find(
      d => d.isCenterPoint && d.id && d.id === centerPointWeather.id,
    );
    return shifted || centerPointWeather;
  }, [displayDestinations, centerPointWeather]);

  const displayCurrentLocationWeather = useMemo(
    () => displayDestinations.find(d => d.isCurrentLocation) || null,
    [displayDestinations],
  );

  const loadDestinations = async () => {
    if (!location) return;
    const requestId = ++loadRequestIdRef.current;

    if (loadingPhaseTimerRef.current) {
      clearInterval(loadingPhaseTimerRef.current);
    }
    const phases = buildLoadingCardPhases();
    let phaseIndex = 0;
    setLoadingPhaseKey(phases[0]);
    loadingPhaseTimerRef.current = setInterval(() => {
      phaseIndex = (phaseIndex + 1) % phases.length;
      setLoadingPhaseKey(phases[phaseIndex]);
    }, 2200);

    setLoadingDestinations(true);
    try {
      const effectiveCenter = centerPoint || location;
      const originTemp = centerPointWeather?.temperature || null;
      if (__DEV__) {
        if (__DEV__) console.log(`🔄 Loading destinations for center: ${effectiveCenter.latitude.toFixed(2)}, ${effectiveCenter.longitude.toFixed(2)}, radius: ${radius}km (req#${requestId})`);
      }
      const [weatherData, currentLocationWeather] = await Promise.all([
        getWeatherForRadius(
          effectiveCenter.latitude,
          effectiveCenter.longitude,
          radius,
          null,
          originTemp,
          i18n.language,
          reverseMode
        ),
        getCurrentLocationWeather(),
      ]);
      // Discard stale response if a newer request was fired while we were fetching
      if (requestId !== loadRequestIdRef.current) {
        __DEV__ && console.log(`🗑️ Discarding stale response req#${requestId} (current: req#${loadRequestIdRef.current})`);
        return;
      }
      let allDestinations = [];
      if (currentLocationWeather) allDestinations.push(currentLocationWeather);
      let radiusPlaces = weatherData.filter((p) => {
        const lat = Number(p.lat ?? p.latitude);
        const lon = Number(p.lon ?? p.longitude);
        return isWithinRadiusKm(
          Number(effectiveCenter.latitude),
          Number(effectiveCenter.longitude),
          lat,
          lon,
          Number(radius),
        );
      });
      if (centerPointWeather && centerPoint) {
        const centerId = centerPointWeather.id;
        if (centerId) {
          radiusPlaces = radiusPlaces.map(p => (p.id === centerId || p.placeId === centerId)
            ? { ...centerPointWeather, isCenterPoint: true }
            : p);
          if (!radiusPlaces.some(p => p.id === centerId || p.placeId === centerId)) {
            allDestinations.push({ ...centerPointWeather, isCenterPoint: true });
          }
        } else {
          allDestinations.push({ ...centerPointWeather, isCenterPoint: true });
        }
      }
      allDestinations = [...allDestinations, ...radiusPlaces];
      if (__DEV__) {
        if (__DEV__) console.log(`🏆 Badge origin: ${centerPointWeather ? 'centerPoint' : 'currentLocation'}, ${allDestinations.length} places`);
      }
      if (__DEV__ && allDestinations.length > 1) {
        const sample = allDestinations.find(d => !d.isCurrentLocation && !d.isCenterPoint);
        if (sample && __DEV__) console.log('[DEBUG MapScreen] sample dest:', sample.name, '| place_type:', sample.place_type, '| image_region:', sample.image_region);
      }
      setDestinations(allDestinations);
      // Density markers remount after reload; remount origin too — otherwise MapKit
      // can leave the chosen-location annotation blank after the Circle/camera update.
      bumpOriginPinThrottled();
      // Defer + slim cache: JSON.stringify of ~900 places × 16-day forecasts
      // freezes the JS thread (and can blow AsyncStorage's ~6MB cap) right when
      // markers/circle are updating after a radius change.
      const cacheData = allDestinations.map(({ forecastArray, ...rest }) => rest);
      setTimeout(() => {
        try {
          AsyncStorage.setItem('mapDestinationsCache', JSON.stringify({
            timestamp: Date.now(),
            version: 2,
            data: cacheData,
          })).catch((cacheError) => { if (__DEV__) console.warn('Failed to cache destinations:', cacheError); });
        } catch (cacheError) {
          if (__DEV__) console.warn('Failed to serialize destinations cache:', cacheError);
        }
      }, 0);
    } catch (error) {
      if (requestId !== loadRequestIdRef.current) return;
      showToast(t('map.failedToLoadWeather') || 'Failed to load weather data', 'error');
      console.error(error);
    } finally {
      if (requestId === loadRequestIdRef.current) {
        if (loadingPhaseTimerRef.current) {
          clearInterval(loadingPhaseTimerRef.current);
          loadingPhaseTimerRef.current = null;
        }
        setLoadingDestinations(false);
      }
    }
  };

  const buildWeatherFromDB = async (lat, lon, prefix, extraProps = {}, knownPlaceId = null) => {
    let place;
    if (knownPlaceId) {
      const { data, error } = await supabase
        .from('places')
        .select('id, name_en, name_de, name_fr, latitude, longitude, country_code, place_type')
        .eq('id', knownPlaceId)
        .maybeSingle();
      if (error || !data) return null;
      place = data;
    } else {
      const { data: rpcData, error: rpcError } = await supabase.rpc('nearest_place', {
        user_lat: lat, user_lon: lon, max_distance_km: 50,
      });
      if (rpcError || !rpcData?.length) return null;
      place = rpcData[0];
    }
    const { place: detail, forecast: forecastData } = await getPlaceDetail(place.id);
    if (!detail) return null;

    const placeLat = parseFloat(place.latitude) || lat;
    const placeLon = parseFloat(place.longitude) || lon;
    const placeLabel = detail.name || getPlaceName(place, i18n.language);

    if (!forecastData?.length) {
      // Searched place exists in DB but no forecast rows — keep the place id so the
      // origin pin stays linked (otherwise the place vanishes from the map as origin).
      if (knownPlaceId) {
        __DEV__ && console.log(`${prefix} No forecast for ${placeLabel}, Open-Meteo fallback (id kept)`);
        return await fetchOpenMeteoFallback(placeLat, placeLon, {
          prefix,
          defaultName: placeLabel,
          extraProps: {
            ...extraProps,
            id: place.id,
            country_code: place.country_code,
            countryCode: place.country_code,
            place_type: place.place_type || null,
          },
        });
      }
      return null;
    }

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
      lat: placeLat,
      lon: placeLon,
      name: `${prefix} ${placeLabel}`,
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

      __DEV__ && console.log('📍 No nearby DB place for location, falling back to Open-Meteo API');
      return await fetchOpenMeteoFallback(location.latitude, location.longitude, {
        prefix: '📍',
        defaultName: 'Dein Standort',
        extraProps: { distance: 0, isCurrentLocation: true },
      });
    } catch (error) {
      if (__DEV__) console.warn('Failed to fetch current location weather:', error);
      return null;
    }
  };

  // mapWeatherCode imported from usecases/weatherUsecases (single source of truth)
  const mapWeatherCodeToCondition = mapWeatherCode;

  const calculateStability = (cloudCover, windSpeed) => {
    const cloudScore = 100 - (cloudCover || 50);
    const windScore = Math.max(0, 100 - (windSpeed || 5) * 2);
    return Math.round((cloudScore + windScore) / 2);
  };

  /**
   * Fetch weather directly from Open-Meteo API (fallback when no nearby DB place).
   * Shared by getCurrentLocationWeather and fetchCenterPointWeather.
   */
  const fetchOpenMeteoFallback = async (lat, lon, { prefix, defaultName, extraProps = {} }) => {
    let cityName = defaultName;
    let countryCode = null;
    try {
      const geocode = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lon });
      if (geocode?.[0]) {
        const g = geocode[0];
        cityName = g.city || g.district || g.region || defaultName;
        countryCode = g.isoCountryCode || null;
      }
    } catch (_) {}

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
        'relative_humidity_2m_mean',
        'cloud_cover_mean',
      ].join(','),
      timezone: 'auto',
      forecast_days: 16,
    });
    const url = `https://customer-api.open-meteo.com/v1/forecast?${params}&apikey=${process.env.EXPO_PUBLIC_OPEN_METEO_KEY}`;
    const response = await fetch(url);
    if (!response.ok) return null;

    const data = await response.json();
    const daily = data.daily;

    const forecastDaysArr = daily.weather_code?.map((code, i) => ({
      condition: mapWeatherCodeToCondition(code),
      temperature: Math.round(daily.temperature_2m_max?.[i] || 0),
      temp_max: daily.temperature_2m_max?.[i],
      temp_min: daily.temperature_2m_min?.[i],
      windSpeed: Math.round(daily.wind_speed_10m_max?.[i] || 0),
      precipitation: daily.precipitation_sum?.[i] || 0,
      sunshine_duration: daily.sunshine_duration?.[i] || 0,
    })) || [];

    return {
      lat,
      lon,
      name: `${prefix} ${cityName}`,
      condition: mapWeatherCodeToCondition(daily.weather_code?.[0]),
      temperature: Math.round(daily.temperature_2m_max?.[0] || 0),
      temp_max: daily.temperature_2m_max?.[0],
      temp_min: daily.temperature_2m_min?.[0],
      humidity: daily.relative_humidity_2m_mean?.[0] ?? null,
      windSpeed: Math.round(daily.wind_speed_10m_max?.[0] || 0),
      precipitation: daily.precipitation_sum?.[0] || 0,
      cloudCover: daily.cloud_cover_mean?.[0] ?? null,
      stability: calculateStability(daily.cloud_cover_mean?.[0], daily.wind_speed_10m_max?.[0]),
      badges: [],
      forecastDays: forecastDaysArr,
      country_code: countryCode,
      countryCode,
      ...extraProps,
    };
  };

  const handleMarkerPress = (destination, source = 'map') => {
    markerJustPressedRef.current = true;
    setTimeout(() => { markerJustPressedRef.current = false; }, 500);
    if (destination.id) trackDetailView(destination.id);
    const origin = destinations.find(d => d.isCenterPoint) || destinations.find(d => d.isCurrentLocation);
    navigation.navigate('DestinationDetail', { destination, dateOffset: selectedDateOffset, reverseMode, origin, source });
  };

  // Stable callback for memoized DestinationMarker (always calls the latest handler)
  const handleMarkerPressRef = useRef(handleMarkerPress);
  handleMarkerPressRef.current = handleMarkerPress;
  const stableMarkerPress = useCallback((destination, source) => handleMarkerPressRef.current(destination, source), []);

  const isMiles = distanceUnit === 'miles';

  const getRadiusStep = (r) => {
    if (isMiles) {
      const mi = kmToMiles(r);
      if (mi < 100) return milesToKm(25);
      if (mi < 250) return milesToKm(50);
      if (mi < 500) return milesToKm(50);
      return milesToKm(100);
    }
    if (r < 200) return 25;
    if (r < 500) return 50;
    if (r < 1000) return 100;
    return 200;
  };

  const handleRadiusIncrease = async () => {
    const step = getRadiusStep(radius);
    const newRadius = Math.min(Math.round((radius + step) / step) * step, 5000);
    setRadius(newRadius);
    playTickSound();
    mixpanel.track('Radius Changed', { radius_km: newRadius, direction: 'increase' });
    trackRadiusChanged(newRadius).catch(() => {});
  };

  const handleRadiusDecrease = async () => {
    const step = getRadiusStep(radius - 1);
    const snapped = Math.round((radius - step) / step) * step;
    const newRadius = Math.max(snapped, isMiles ? milesToKm(25) : 50);
    setRadius(newRadius);
    playTickSound();
    mixpanel.track('Radius Changed', { radius_km: newRadius, direction: 'decrease' });
    trackRadiusChanged(newRadius).catch(() => {});
  };

  const handleRadiusSelect = async (newRadius) => {
    setRadius(newRadius);
    setShowRadiusMenu(false);
    playTickSound();
    mixpanel.track('Radius Changed', { radius_km: newRadius, direction: 'select' });
    trackRadiusChanged(newRadius).catch(() => {});
  };

  const finishOnboarding = async (event) => {
    await AsyncStorage.setItem('hasSeenOnboarding', 'true');
    setShowOnboarding(false);
    mixpanel.track(event);
  };

  const handleCloseOnboarding = () => finishOnboarding('Onboarding Completed');
  const handleDismissOnboarding = () => finishOnboarding('Onboarding Skipped');

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
    const next = reverseMode === 'warm' ? 'cold' : 'warm';
    setReverseMode(next);
    await playTickSound();
    mixpanel.track('Mode Changed', { mode: next });
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
    } else {
      // Keep ≥2 — world-view (minZoom 1) + custom markers jetsams on iOS
      minZoom = 2;
    }

    // maxZoom: Prevent zooming in too close (cap at 8)
    const maxZoom = 8;

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
      visibilityTime: 4500,
    });
  };

  /**
   * Calculate display score: Badges first, then TEMPERATURE (warmest wins!)
   */
  const getDisplayScore = (place) => {
    // Orte mit Badges = immer max Score (100)
    const mapBadges = getMapBadges(place.badges, place._heatwaveData?.shouldAward);
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
   * Soft cap — enough for viewport coverage, low enough for custom marker views on iOS.
   */
  const getMaxMarkers = (zoom, radiusKm) => {
    let base = Math.floor(radiusKm / 24);

    let zoomFactor;
    if (zoom <= 3) zoomFactor = 0.45;
    else if (zoom <= 4) zoomFactor = 0.7;
    else if (zoom <= 5) zoomFactor = 0.9;
    else if (zoom <= 6) zoomFactor = 1.1;
    else if (zoom <= 7) zoomFactor = 1.25;
    else if (zoom <= 8) zoomFactor = 1.4;
    else if (zoom <= 9) zoomFactor = 1.55;
    else zoomFactor = 1.7;

    const maxCap = 36;
    const minFloor = zoom >= 8 ? (Platform.OS === 'android' ? 20 : 24) :
                     zoom >= 6 ? (Platform.OS === 'android' ? 16 : 22) :
                     zoom >= 4 ? (Platform.OS === 'android' ? 12 : 18) :
                     (Platform.OS === 'android' ? 10 : 14);
    const total = Math.min(Math.max(base * zoomFactor, minFloor), maxCap);
    return Math.round(total);
  };
  
  
  
  /**
   * Sort places by mode:
   * warm — attractiveness → warmer temp → distance
   * cold — cooler temp → attractiveness → distance (heat-escape)
   */
  const sortByQuality = (places, userLat, userLon) => {
    return [...places].sort((a, b) => {
      // Special markers always first
      if (a.isCurrentLocation || a.isCenterPoint) return -1;
      if (b.isCurrentLocation || b.isCenterPoint) return 1;

      const aScore = a.attractivenessScore || a.attractiveness_score || 50;
      const bScore = b.attractivenessScore || b.attractiveness_score || 50;
      const aTemp = a.temperature || 0;
      const bTemp = b.temperature || 0;

      if (reverseMode === 'cold') {
        if (Math.abs(aTemp - bTemp) > 2) return aTemp - bTemp;
        if (Math.abs(aScore - bScore) > 2) return bScore - aScore;
      } else {
        if (Math.abs(aScore - bScore) > 2) return bScore - aScore;
        if (Math.abs(aTemp - bTemp) > 2) return bTemp - aTemp;
      }

      if (userLat && userLon) {
        const aLat = a.lat ?? a.latitude;
        const aLon = a.lon ?? a.longitude;
        const bLat = b.lat ?? b.latitude;
        const bLon = b.lon ?? b.longitude;
        const aDist = getDistanceKm(userLat, userLon, aLat, aLon);
        const bDist = getDistanceKm(userLat, userLon, bLat, bLon);
        return aDist - bDist;
      }

      return 0;
    });
  };
  
  const URBAN_PLACE_TYPES = new Set(['city', 'medium_town', 'small_town', 'town', 'village']);

  const getVisibleMarkers = (allPlaces, zoom, bounds) => {
    // Origin/center may briefly have null temp while weather loads — keep them
    // out of the temperature gate (they render via dedicated originPin anyway).
    const specialMarkers = allPlaces.filter(p => p.isCurrentLocation || p.isCenterPoint);
    const candidates = allPlaces.filter(p =>
      !p.isCurrentLocation &&
      !p.isCenterPoint &&
      p.temperature !== null &&
      p.temperature !== undefined
    );
    if (candidates.length === 0 && specialMarkers.length === 0) return [];
    
    const userLat = location?.latitude;
    const userLon = location?.longitude;
    const maxMarkers = getMaxMarkers(zoom, radius);
    
    // Grid density steps gently with zoom (avoid membership thrash at z6/z7 cliffs)
    const GRID_COLS = zoom <= 4 ? 5 : zoom <= 6 ? 6 : zoom <= 8 ? 7 : 9;
    const GRID_ROWS = zoom <= 4 ? 7 : zoom <= 6 ? 7 : zoom <= 8 ? 9 : 11;

    // Urban places (cities/towns) get a much coarser grid → wider spacing, fewer markers
    const URBAN_GRID_COLS = Math.max(3, Math.floor(GRID_COLS * 0.6));
    const URBAN_GRID_ROWS = Math.max(3, Math.floor(GRID_ROWS * 0.6));

    // Grid over the area where candidates can actually exist (viewport ∩ radius box).
    // On start the map is zoomed out well beyond the radius circle; a viewport-wide
    // grid would collapse all places into a few cells → too few markers.
    let gridBounds = bounds;
    const gridCenter = centerPoint || location;
    let radiusBox = null;
    if (gridCenter && radius) {
      const latPad = radius / 111;
      const lonPad = radius / (111 * Math.cos(gridCenter.latitude * Math.PI / 180));
      radiusBox = {
        north: gridCenter.latitude + latPad,
        south: gridCenter.latitude - latPad,
        east: gridCenter.longitude + lonPad,
        west: gridCenter.longitude - lonPad,
      };
    }
    if (bounds && radiusBox) {
      const clamped = {
        north: Math.min(bounds.north, radiusBox.north),
        south: Math.max(bounds.south, radiusBox.south),
        east: Math.min(bounds.east, radiusBox.east),
        west: Math.max(bounds.west, radiusBox.west),
      };
      if (clamped.north > clamped.south && clamped.east > clamped.west) {
        gridBounds = clamped;
      } else {
        // Stale viewport bounds (e.g. GPS in Europe, center point in the US) — use radius box
        gridBounds = radiusBox;
      }
    } else if (radiusBox) {
      gridBounds = radiusBox;
    }

    const makeGridKey = (lat, lon, cols, rows) => {
      if (!gridBounds) return '0_0';
      const col = Math.floor((lon - gridBounds.west)  / (gridBounds.east  - gridBounds.west)  * cols);
      const row = Math.floor((lat - gridBounds.south) / (gridBounds.north - gridBounds.south) * rows);
      return `${Math.max(0, Math.min(col, cols-1))}_${Math.max(0, Math.min(row, rows-1))}`;
    };
    const getGridKey = (lat, lon) => makeGridKey(lat, lon, GRID_COLS, GRID_ROWS);

    const getPlaceGridKey = (lat, lon, placeType) => {
      if (URBAN_PLACE_TYPES.has(placeType)) {
        return 'u_' + makeGridKey(lat, lon, URBAN_GRID_COLS, URBAN_GRID_ROWS);
      }
      return 'p_' + makeGridKey(lat, lon, GRID_COLS, GRID_ROWS);
    };
    
    // Screen-space spacing ≈ constant → geo floor grows as you zoom out.
    // Pinned WTD are bulkier (badge) → slightly larger floor than normal pins.
    const minSpacingKm = (z, role) => {
      const table = role === 'pinned'
        ? [120, 90, 70, 50, 35]
        : [80, 55, 40, 28, 18];
      if (z <= 5) return table[0];
      if (z <= 6) return table[1];
      if (z <= 7) return table[2];
      if (z <= 8) return table[3];
      return table[4];
    };
    const PINNED_GRID_LIMIT = 2;
    const MIN_PINNED_DISTANCE_KM = minSpacingKm(zoom, 'pinned');
    const pinnedBadges = [DestinationBadge.WORTH_THE_DRIVE, DestinationBadge.WORTH_THE_DRIVE_BUDGET];
    const allPinned = candidates.filter(p => 
      !p.isCurrentLocation && !p.isCenterPoint &&
      Array.isArray(p.badges) && p.badges.some(b => pinnedBadges.includes(b))
    );
    const pinnedGridCounts = new Map();
    const pinned = [];
    let pinnedHidden = 0;
    const sortedPinned = sortByQuality(allPinned, userLat, userLon);
    for (const p of sortedPinned) {
      const pLat = p.lat ?? p.latitude;
      const pLon = p.lon ?? p.longitude;
      const key = getGridKey(pLat, pLon);
      const count = pinnedGridCounts.get(key) || 0;
      const tooClose = pinned.some((s) => {
        const sLat = s.lat ?? s.latitude;
        const sLon = s.lon ?? s.longitude;
        return getDistanceKm(pLat, pLon, sLat, sLon) < MIN_PINNED_DISTANCE_KM;
      });
      if (!tooClose && count < PINNED_GRID_LIMIT) {
        pinned.push(p);
        pinnedGridCounts.set(key, count + 1);
      } else {
        pinnedHidden++;
      }
    }
    __DEV__ && console.log(
      `📌 Pinned: ${pinned.length} shown, ${pinnedHidden} hidden (min ${MIN_PINNED_DISTANCE_KM}km @ z${zoom})`
    );
    
    // Non-pinned WTD stay off the map at this zoom (reappear when spacing allows).
    // Do not redistribute into the normal grid — that re-clusters them next to the pin.
    const normal = candidates.filter(p => 
      !p.isCurrentLocation && !p.isCenterPoint &&
      !(Array.isArray(p.badges) && p.badges.some(b => pinnedBadges.includes(b)))
    );

    const viewportPlaces = (gridBounds)
      ? normal.filter(p => {
          const lat = p.lat ?? p.latitude;
          const lon = p.lon ?? p.longitude;
          return lat >= gridBounds.south && lat <= gridBounds.north &&
                 lon >= gridBounds.west  && lon <= gridBounds.east;
        })
      : normal;

    // Build grid: best place per cell. Urban and non-urban use separate grids
    // (different prefixes + resolutions) so they don't compete with each other.
    const WTD_BADGES = new Set([
      DestinationBadge.WORTH_THE_DRIVE, DestinationBadge.WORTH_THE_DRIVE_BUDGET,
    ]);
    const WARM_POSITIVE_BADGES = new Set([
      DestinationBadge.WORTH_THE_DRIVE, DestinationBadge.WORTH_THE_DRIVE_BUDGET,
      DestinationBadge.SUNNY_STREAK, DestinationBadge.BEACH_PARADISE,
      DestinationBadge.WARM_AND_DRY, DestinationBadge.SPRING_AWAKENING,
    ]);
    // Cold: dampen warm-flavor badges (still on pin, no grid boost). WTD still boosts.
    const boostSet = reverseMode === 'cold' ? WTD_BADGES : WARM_POSITIVE_BADGES;
    const gridRank = (p) => {
      const attr = p.attractivenessScore || p.attractiveness_score || 50;
      const badges = Array.isArray(p.badges) ? p.badges : [];
      const hasBadge = badges.some(b => boostSet.has(b)) ? 1 : 0;
      if (reverseMode === 'cold') {
        // Heat-escape: cooler temp wins the cell, attr is secondary
        const coolScore = -(p.temperature ?? 0);
        return coolScore * 1000 + hasBadge * 100 + attr;
      }
      return attr * 1000 + hasBadge * 100 + (p.temperature ?? 0);
    };
    const gridMap = new Map();
    for (const place of viewportPlaces) {
      const lat = place.lat ?? place.latitude;
      const lon = place.lon ?? place.longitude;
      const key = getPlaceGridKey(lat, lon, place.place_type);
      const existing = gridMap.get(key);
      if (!existing || gridRank(place) > gridRank(existing)) {
        gridMap.set(key, place);
      }
    }

    // Take best-per-grid, sort by score, then enforce zoom-aware min distance for all markers
    const MIN_MARKER_DISTANCE_KM = minSpacingKm(zoom, 'marker');
    const sorted = Array.from(gridMap.values())
      .sort((a, b) => {
        const aScore = a.attractivenessScore || a.attractiveness_score || 50;
        const bScore = b.attractivenessScore || b.attractiveness_score || 50;
        return bScore - aScore;
      });
    
    // When the budget is smaller than the number of cell winners, a pure score cut
    // drops all markers in low-score regions → visual clusters. Instead bucket the
    // winners into a coarse 4x4 super-grid and pick round-robin across buckets so
    // every region keeps its best places.
    const buckets = new Map();
    for (const place of sorted) {
      const key = makeGridKey(place.lat ?? place.latitude, place.lon ?? place.longitude, 4, 4);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(place); // stays score-desc within each bucket
    }
    const bucketLists = Array.from(buckets.values());
    
    const budget = Math.max(0, maxMarkers - pinned.length);
    const gridWinners = [];
    // Seed with pinned so normal pins don't sit on top of WTD
    const selectedCoords = pinned.map((p) => [p.lat ?? p.latitude, p.lon ?? p.longitude]);
    const takeEligible = (list) => {
      while (list.length > 0) {
        const place = list.shift();
        const pLat = place.lat ?? place.latitude;
        const pLon = place.lon ?? place.longitude;
        const tooClose = selectedCoords.some(([sLat, sLon]) =>
          getDistanceKm(pLat, pLon, sLat, sLon) < MIN_MARKER_DISTANCE_KM
        );
        if (tooClose) continue;
        return place;
      }
      return null;
    };
    let madeProgress = true;
    while (gridWinners.length < budget && madeProgress) {
      madeProgress = false;
      for (const list of bucketLists) {
        if (gridWinners.length >= budget) break;
        const place = takeEligible(list);
        if (!place) continue;
        gridWinners.push(place);
        selectedCoords.push([place.lat ?? place.latitude, place.lon ?? place.longitude]);
        madeProgress = true;
      }
    }

    const result = [...specialMarkers, ...pinned, ...gridWinners];

    const pinnedCount = pinned.length;
    const urbanCount = gridWinners.filter(p => URBAN_PLACE_TYPES.has(p.place_type)).length;
    const poiCount = gridWinners.length - urbanCount;
    __DEV__ && console.log(`📊 Final: ${result.length} markers (${pinnedCount} pinned + ${urbanCount} urban + ${poiCount} POI + ${specialMarkers.length} special), ${gridMap.size} grids`);
    return result;
  };

  const visibleMarkers = useMemo(() => {
    if (!displayDestinations.length || !location || !radius) return [];
    const { zoom: currentZoom, bounds: currentBounds } = markerViewport;
    const effectiveCenter = centerPoint || location;
    const centerLat = Number(effectiveCenter.latitude);
    const centerLon = Number(effectiveCenter.longitude);
    const radiusKm = Number(radius);
    let candidates = displayDestinations.filter(d => {
      // Origin/center pin always shown (rendered on circle center, not DB coords)
      if (d.isCurrentLocation || d.isCenterPoint) return true;
      const lat = Number(d.lat ?? d.latitude);
      const lon = Number(d.lon ?? d.longitude);
      return isWithinRadiusKm(centerLat, centerLon, lat, lon, radiusKm);
    });
    // Client-side weather condition filter (instant, no re-fetch needed)
    if (selectedConditions.length > 0) {
      const normalized = selectedConditions.map((c) => c.toLowerCase());
      candidates = candidates.filter(d =>
        d.isCurrentLocation || d.isCenterPoint || normalized.includes(d.condition?.toLowerCase())
      );
    }
    const visible = getVisibleMarkers(candidates, currentZoom, currentBounds);
    // Final hard clip — same formula as the drawn radius ring
    return visible.filter(d => {
      if (d.isCurrentLocation || d.isCenterPoint) return true;
      const lat = Number(d.lat ?? d.latitude);
      const lon = Number(d.lon ?? d.longitude);
      const ok = isWithinRadiusKm(centerLat, centerLon, lat, lon, radiusKm);
      if (__DEV__ && !ok) {
        console.log(`🚫 Clip outside radius: ${d.name} (${Math.round(getDistanceKm(centerLat, centerLon, lat, lon))}km > ${radiusKm}km)`);
      }
      return ok;
    });
    // favouriteDestinations intentionally omitted: favourites render separately (renderedFavourites)
  }, [markerViewport, displayDestinations, location, radius, centerPoint, selectedConditions, reverseMode]);

  // Favourites are rendered as dedicated markers further below. Detect them here
  // so the normal marker isn't drawn on top of the favourite marker (destinations
  // carry no isFavourite flag; match by id like the favourite render does).
  const favouriteIdSet = useMemo(() => {
    const set = new Set();
    favouriteDestinations.forEach(f => {
      if (f?.placeId) set.add(f.placeId);
      if (f?.id) set.add(f.id);
    });
    return set;
  }, [favouriteDestinations]);

  const isFavouritePlace = useCallback((dest) => {
    if (dest.id && favouriteIdSet.has(dest.id)) return true;
    const lat = dest.lat ?? dest.latitude;
    const lon = dest.lon ?? dest.longitude;
    return favouriteDestinations.some(f =>
      f && f.lat != null && f.lon != null &&
      Math.abs(lat - Number(f.lat)) < 0.01 && Math.abs(lon - Number(f.lon)) < 0.01
    );
  }, [favouriteDestinations, favouriteIdSet]);

  // Markers actually rendered on the map. Deduped by key and sorted by key:
  // a stable sibling order means React only inserts/removes marker views and
  // never reorders them — reordering native map subviews crashes iOS
  // (NSRangeException in insertReactSubview:atIndex:).
  // Do NOT remount the whole marker layer on radius/center change — that
  // jetsams custom views (tracksViewChanges=false on mount) and resurrects
  // default red pins.
  const renderedMarkers = useMemo(() => {
    const seen = new Set();
    const result = [];
    const c = centerPoint || location;
    const centerLat = c ? Number(c.latitude) : NaN;
    const centerLon = c ? Number(c.longitude) : NaN;
    const radiusKm = Number(radius);

    for (const dest of visibleMarkers) {
      // Origin/center pin is mounted once outside this list (stable MapView child
      // index). Keeping it here reshuffles its sibling index on every zoom/radius
      // settle and blanks the custom view on iOS.
      if (dest.isCurrentLocation || dest.isCenterPoint) continue;
      // Favourites are rendered separately below
      if (isFavouritePlace(dest)) continue;
      if (showOnlyBadges && !isTrophyWorthy(getMapBadges(dest.badges))) continue;

      // Last-chance radius gate (never trust upstream lists alone)
      const lat = Number(dest.lat ?? dest.latitude);
      const lon = Number(dest.lon ?? dest.longitude);
      if (!isWithinRadiusKm(centerLat, centerLon, lat, lon, radiusKm)) {
        if (__DEV__) {
          console.log(
            `🚫 Drop render outside radius: ${dest.name} ` +
            `${Math.round(getDistanceKm(centerLat, centerLon, lat, lon))}km > ${radiusKm}km`,
          );
        }
        continue;
      }

      const key = markerKeyFor(dest);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ key, dest });
    }
    result.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    return result;
  }, [visibleMarkers, isFavouritePlace, showOnlyBadges, centerPoint, location, radius]);

  const radiusRingCoords = useMemo(() => {
    if (!radius || radius <= MAX_RADIUS_CIRCLE_KM) return null;
    const c = centerPoint || location;
    if (!c) return null;
    return circleRingCoordinates(c.latitude, c.longitude, Number(radius));
  }, [radius, centerPoint, location]);

  // Dedicated origin pin data — rendered via OriginPinMarker (not density list).
  const originPin = useMemo(() => {
    if (centerPoint) {
      const weather = displayCenterPointWeather || centerPointWeather;
      return {
        weather: weather || { temperature: null, condition: 'cloudy', name: '' },
        dest: {
          ...(weather || { temperature: null, condition: 'cloudy', name: '' }),
          lat: centerPoint.latitude,
          lon: centerPoint.longitude,
          isCenterPoint: true,
        },
        coordinate: {
          latitude: centerPoint.latitude,
          longitude: centerPoint.longitude,
        },
        isCenterPoint: true,
      };
    }
    if (!location) return null;
    const weather = displayCurrentLocationWeather;
    return {
      weather: weather || { temperature: null, condition: 'cloudy', name: '' },
      dest: {
        ...(weather || { temperature: null, condition: 'cloudy', name: '' }),
        lat: location.latitude,
        lon: location.longitude,
        isCurrentLocation: true,
      },
      coordinate: {
        latitude: location.latitude,
        longitude: location.longitude,
      },
      isCenterPoint: false,
    };
  }, [
    centerPoint,
    centerPointWeather,
    displayCenterPointWeather,
    displayCurrentLocationWeather,
    location,
  ]);

  const renderedFavourites = useMemo(() => {
    const effectiveCenter = centerPoint || location;
    if (!effectiveCenter || !radius) return [];

    return favouriteDestinations
      .filter(fav => {
        if (!fav || fav.lat == null || fav.lon == null) return false;
        return isWithinRadiusKm(
          Number(effectiveCenter.latitude),
          Number(effectiveCenter.longitude),
          Number(fav.lat),
          Number(fav.lon),
          Number(radius),
        );
      })
      .map((fav) => {
        const withWeather = displayDestinations.find(d =>
          (d.id && fav.placeId && d.id === fav.placeId) ||
          (d.id && fav.id && d.id === fav.id) ||
          (Math.abs((d.lat ?? d.latitude) - fav.lat) < 0.01 &&
           Math.abs((d.lon ?? d.longitude) - fav.lon) < 0.01)
        );

        let temp = withWeather?.temperature ?? null;
        let cond = withWeather?.condition ?? null;
        if (temp == null && fav.forecastArray?.length > selectedDateOffset) {
          const shifted = fav.forecastArray[selectedDateOffset];
          temp = shifted?.high ?? shifted?.temp ?? fav.temperature ?? null;
          cond = shifted?.condition ?? fav.condition ?? 'cloudy';
        } else if (temp == null) {
          temp = fav.temperature ?? null;
          cond = cond ?? fav.condition ?? 'cloudy';
        }
        cond = cond ?? 'cloudy';

        const favBadges = getMapBadges(
          withWeather?.badges || fav.badges || [],
          withWeather?._heatwaveData?.shouldAward,
        );

        return {
          stableKey: favStableKey(fav),
          fav,
          withWeather,
          temp,
          cond,
          favBadges,
          hasFavBadges: favBadges.length > 0,
        };
      })
      .sort((a, b) => (a.stableKey < b.stableKey ? -1 : a.stableKey > b.stableKey ? 1 : 0));
  }, [favouriteDestinations, centerPoint, location, radius, displayDestinations, selectedDateOffset]);

  // Track map_view_count as a side-effect of visibleMarkers changing
  useEffect(() => {
    if (visibleMarkers.length === 0) return;
    if (__DEV__) {
      const specialCount = visibleMarkers.filter(v => v.isCurrentLocation || v.isCenterPoint).length;
      if (__DEV__) console.log(`🔍 Zoom ${mapViewport.zoom}: ${visibleMarkers.length} markers (${specialCount} special) of ${displayDestinations.length}`);
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
    // Coarse coords only (~10km): exact GPS positions are location PII
    mixpanel.track('Map Long Press', {
      latitude: Math.round(latitude * 10) / 10,
      longitude: Math.round(longitude * 10) / 10,
    });
    trackCenterMethod('longPress').catch(() => {});

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
    commitViewportsNow(viewportForCenter(latitude, longitude, radius));

    showToast(t('map.centerPointSet'), 'info');
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

    // Prefer destinations already on the map (what the user sees). The old
    // nearest_place → must-be-in-displayDestinations path toasted often when
    // the DB hit a place that wasn't in the loaded/filtered set.
    let best = null;
    let bestDist = Infinity;
    for (const d of displayDestinations) {
      if (d.isCurrentLocation) continue;
      const lat = d.lat ?? d.latitude;
      const lon = d.lon ?? d.longitude;
      if (lat == null || lon == null) continue;
      const dist = getDistanceKm(latitude, longitude, lat, lon);
      if (dist < bestDist) {
        bestDist = dist;
        best = d;
      }
    }

    if (best && bestDist <= maxDistance) {
      mixpanel.track('Map Tap', {
        place_id: best.id || best.placeId,
        place_name: best.name,
        zoom: mapViewport.zoom,
        distance_km: Math.round(bestDist),
      });
      handleMarkerPress(best, 'map_tap');
      return;
    }

    // Nothing loaded nearby — quiet miss (toast felt like a bug when markers surround the tap)
  };

  /**
   * Fetch weather for center point.
   * Tries nearest DB place first (no API call). Falls back to Open-Meteo
   * only when no place is within 50 km.
   */
  const fetchCenterPointWeather = async (lat, lon, knownPlaceId = null) => {
    try {
      const dbResult = await buildWeatherFromDB(lat, lon, '⊕', { isCenterPoint: true }, knownPlaceId);
      if (dbResult) {
        setCenterPointWeather(dbResult);
        return;
      }

      __DEV__ && console.log('⊕ No nearby DB place, falling back to Open-Meteo API');
      const weatherData = await fetchOpenMeteoFallback(lat, lon, {
        prefix: '⊕',
        defaultName: 'Neuer Mittelpunkt',
        extraProps: {
          isCenterPoint: true,
          id: knownPlaceId || stableManualCenterId(lat, lon),
        },
      });
      setCenterPointWeather(weatherData);
    } catch (error) {
      if (__DEV__) console.warn('Failed to fetch center point weather:', error);
      setCenterPointWeather(null);
      if (hasLoadedForLocationRef.current) loadDestinations();
    }
  };

  // Saved center point restored without weather — fetch it (standalone pin needs this)
  useEffect(() => {
    if (!centerPoint || centerPointWeather) return;
    fetchCenterPointWeather(
      centerPoint.latitude,
      centerPoint.longitude,
      centerPoint.placeId || null,
    );
  }, [centerPoint, centerPointWeather]);

  // centerPointWeather is omitted from the location/radius effect deps; reload when it arrives
  useEffect(() => {
    if (!location || !centerPointWeather) return;
    if (!hasLoadedForLocationRef.current) return;
    loadDestinations();
  }, [centerPointWeather]);

  /**
   * Reference location button: tap returns the map to the active reference
   * (GPS or manual center point), long press opens the mode context menu.
   */
  const dismissRefTip = () => {
    if (!showRefTip) return;
    setShowRefTip(false);
    if (!__DEV__) {
      AsyncStorage.setItem('refLocTipShown', '1').catch(() => {});
    }
  };

  const animateToReference = (point) => {
    if (!mapRef.current || !point) return;
    mapRef.current.animateToRegion({
      latitude: point.latitude,
      longitude: point.longitude,
      ...regionDeltasForRadiusKm(point.latitude, radius),
    }, 300);
  };

  const handleRefButtonPress = () => {
    dismissRefTip();
    mixpanel.track('Reference Button Tapped', { mode: centerPoint ? 'manual' : 'gps' });
    animateToReference(centerPoint || location);
  };

  const handleRefButtonLongPress = () => {
    dismissRefTip();
    playTickSound();
    setShowRefMenu(true);
  };

  const selectGpsReference = () => {
    setShowRefMenu(false);
    if (!centerPoint) {
      animateToReference(location);
      return;
    }
    playMediumHaptic();
    mixpanel.track('Reference Mode Changed', { mode: 'gps' });
    trackRefMode('gps').catch(() => {});
    setCenterPoint(null);
    setCenterPointWeather(null);
    AsyncStorage.removeItem('mapCenterPoint').catch(error => {
      if (__DEV__) console.warn('Failed to remove center point:', error);
    });
    skipNextLocationAnimRef.current = true;
    animateToReference(location);
  };

  const selectManualReference = () => {
    setShowRefMenu(false);
    if (centerPoint) {
      animateToReference(centerPoint);
      return;
    }
    const saved = savedManualRef.current;
    if (!saved?.center) return;
    playMediumHaptic();
    mixpanel.track('Reference Mode Changed', { mode: 'manual' });
    trackRefMode('manual').catch(() => {});
    setCenterPoint(saved.center);
    setCenterPointWeather(saved.weather || null);
    persistCenterPoint(saved.center, saved.weather?.id || saved.center.placeId || null);
    skipNextLocationAnimRef.current = true;
    animateToReference(saved.center);
  };

  const manualRefAvailable = !!(centerPoint || savedManualRef.current?.center);
  const manualRefWeatherName = (centerPointWeather || savedManualRef.current?.weather)?.name;
  const manualRefName = manualRefWeatherName ? manualRefWeatherName.replace('⊕', '').trim() : null;

  const flyToRegion = (fromLat, fromLon, targetRegion) => {
    if (!mapRef.current) return;
    const distKm = getDistanceKm(fromLat, fromLon, targetRegion.latitude, targetRegion.longitude);
    const duration = distKm > 2000 ? 2500 : distKm > 500 ? 1800 : 800;
    if (distKm > 500) {
      flyOverActiveRef.current = true;
    }
    setTimeout(() => {
      flyOverActiveRef.current = false;
      // Region-complete during fly is ignored — commit viewport when camera lands.
      commitViewportsNow(viewportForCenter(
        targetRegion.latitude,
        targetRegion.longitude,
        radius,
      ));
    }, duration + 200);
    mapRef.current.animateToRegion(targetRegion, duration);
  };

  const searchPlaces = useCallback(async (text) => {
    const q = (text || '').trimStart();
    if (!q || q.length < 3) {
      setSearchResults([]);
      setGoogleResults([]);
      return;
    }
    try {
      setSearchLoading(true);
      const center = currentRegion || location;
      const { dbPlaces, googlePlaces } = await hybridSearch(q, center, i18n.language || 'de');
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
    mixpanel.track('Search Used', { query: item.name || item.label, source: item.source || 'local' });
    trackCenterMethod('search').catch(() => {});

    // If Google place, ensure DB row exists so center pin keeps a stable place id
    let searchedPlaceId = item.source === 'db' ? item.id : null;
    if (item.source === 'google') {
      try {
        const dbPlace = await ensurePlaceInDB(item);
        if (dbPlace?.id) searchedPlaceId = dbPlace.id;
      } catch (e) {
        if (__DEV__) console.warn('ensurePlaceInDB failed:', e);
      }
    }

    const lat = Number(item.latitude);
    const lng = Number(item.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      const newCenter = {
        latitude: lat,
        longitude: lng,
        ...regionDeltasForRadiusKm(lat, radius),
      };

      setCenterPoint(newCenter);
      commitViewportsNow(viewportForCenter(lat, lng, radius));
      await fetchCenterPointWeather(lat, lng, searchedPlaceId);
      skipNextLocationAnimRef.current = true;
      InteractionManager.runAfterInteractions(() => {
        const curLat = currentRegion?.latitude ?? lat;
        const curLon = currentRegion?.longitude ?? lng;
        flyToRegion(curLat, curLon, newCenter);
      });
    }
  }, [radius, currentRegion, commitViewportsNow, viewportForCenter]);

  const clearSearch = useCallback(() => {
    setSearchQuery('');
    setSearchResults([]);
    setGoogleResults([]);
    setSearchFocused(false);
    Keyboard.dismiss();
  }, []);

  /**
   * Region settle: update live viewport immediately for UI; commit markerViewport only
   * after the gesture has been idle — never reshuffle markers mid-pinch (z6 jetsam).
   */
  const handleRegionChangeComplete = useCallback((region) => {
    if (regionChangeDebounceTimer.current) {
      clearTimeout(regionChangeDebounceTimer.current);
    }
    if (markerViewportDebounceTimer.current) {
      clearTimeout(markerViewportDebounceTimer.current);
    }

    const zoom = Math.max(1, Math.min(20, Math.round(Math.log2(360 / region.latitudeDelta))));
    currentZoomRef.current = zoom;
    const { latitude, longitude, latitudeDelta, longitudeDelta } = region;
    const newBounds = {
      north: latitude + latitudeDelta / 2,
      south: latitude - latitudeDelta / 2,
      east: longitude + longitudeDelta / 2,
      west: longitude - longitudeDelta / 2,
    };

    // Cheap UI update (zoom chip) — not used for marker membership.
    regionChangeDebounceTimer.current = setTimeout(() => {
      regionChangeDebounceTimer.current = null;
      if (flyOverActiveRef.current) return;
      setMapViewport({ zoom, bounds: newBounds });
      if (__DEV__) setDevZoom(zoom);

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
    }, 120);

    // Marker layer: wait until pinch/pan has fully settled.
    markerViewportDebounceTimer.current = setTimeout(() => {
      markerViewportDebounceTimer.current = null;
      if (flyOverActiveRef.current) return;
      let viewportChanged = false;
      setMarkerViewport((prev) => {
        const latSlop = Math.max(latitudeDelta * 0.15, 0.05);
        const lonSlop = Math.max(longitudeDelta * 0.15, 0.05);
        const sameZoom = prev.zoom === zoom;
        const sameBounds = prev.bounds &&
          Math.abs(prev.bounds.north - newBounds.north) < latSlop &&
          Math.abs(prev.bounds.south - newBounds.south) < latSlop &&
          Math.abs(prev.bounds.east - newBounds.east) < lonSlop &&
          Math.abs(prev.bounds.west - newBounds.west) < lonSlop;
        if (sameZoom && sameBounds) return prev;
        viewportChanged = true;
        return { zoom, bounds: newBounds };
      });
      // Pan/zoom also blanks the origin annotation — remount after settle.
      if (viewportChanged) bumpOriginPinThrottled();
    }, 700);
  }, [bumpOriginPinThrottled]);

  if (loading && !location) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: theme.background }]}>
        <ActivityIndicator size="large" color={theme.primary} />
        <Text style={[styles.loadingText, { color: theme.text }]}>
          {t(LOADING_STATE_KEYS[loadingStateIndex])}
        </Text>
        <Text style={[styles.hintText, { color: theme.textSecondary || '#888' }]}>
          {t(LOADING_TIP_KEYS[loadingTipIndex])}
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
            style={[styles.retryButton, { backgroundColor: '#C87840', marginBottom: 12 }]}
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
        onDismiss={handleDismissOnboarding}
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
            onFocus={() => { setSearchFocused(true); mixpanel.track('Search Field Tapped'); }}
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
        userInterfaceStyle="light"
        initialRegion={{
          latitude: location.latitude,
          longitude: location.longitude,
          // Start more zoomed out for cleaner view (multiply by 1.5)
          ...regionDeltasForRadiusKm(location.latitude, radius, 1.5),
        }}
        minZoomLevel={getZoomLimits().minZoom}  // Dynamic based on radius!
        maxZoomLevel={getZoomLimits().maxZoom}  // Cap at 8
        pitchEnabled={false}  // Disable tilt/3D view
        rotateEnabled={false}  // Disable rotation
        showsUserLocation={false}
        showsMyLocationButton={false}
        showsBuildings={false}
        showsIndoors={false}
        showsTraffic={false}
        showsPointsOfInterest={false}
        showsCompass={false}
        showsScale={false}
        mapPadding={{ top: 0, right: 0, bottom: 56, left: 0 }}
        legalLabelInsets={{ bottom: 52, left: 8, right: 0, top: 0 }}
        onPress={handleMapTap}
        onLongPress={handleMapLongPress}
        onRegionChange={(region) => {
          const zoom = Math.max(1, Math.min(20,
            Math.round(Math.log2(360 / region.latitudeDelta))
          ));
          // Ref only during gesture — setState here re-renders markers mid-pan.
          currentZoomRef.current = zoom;
        }}
        onRegionChangeComplete={handleRegionChangeComplete}
      >
        {/* Guard: no markers until location + radius are ready */}
        {(!location || !radius) ? null : <>

        {/* Origin FIRST — before Circle/Polyline so overlay remounts never shift its child index.
            key includes originPinGen so radius/pan settle remounts a fresh MapKit annotation. */}
        {originPin && (
          <OriginPinMarker
            key={`origin-pin-${originPinGen}`}
            coordinate={originPin.coordinate}
            weather={originPin.weather}
            isCenterPoint={originPin.isCenterPoint}
            onPress={() => stableMarkerPress(originPin.dest)}
            styles={styles}
            temperatureUnit={temperatureUnit}
            getWeatherColor={getWeatherColor}
            getWeatherIcon={getWeatherIcon}
          />
        )}

        {/* Radius: Circle for ≤1200km; geodesic Polyline ring above (MKCircle crashes) */}
        {(centerPoint || location) && radius > 0 && radius <= MAX_RADIUS_CIRCLE_KM && (
          <Circle
            center={{
              latitude: (centerPoint || location).latitude,
              longitude: (centerPoint || location).longitude,
            }}
            radius={Number(radius) * 1000}
            strokeWidth={1.5}
            strokeColor={centerPoint ? 'rgba(175, 70, 40, 0.55)' : 'rgba(90, 90, 90, 0.4)'}
            fillColor={centerPoint ? 'rgba(175, 70, 40, 0.06)' : 'rgba(90, 90, 90, 0.05)'}
          />
        )}
        {radiusRingCoords && (
          <Polyline
            coordinates={radiusRingCoords}
            strokeWidth={1.5}
            strokeColor={centerPoint ? 'rgba(175, 70, 40, 0.55)' : 'rgba(90, 90, 90, 0.45)'}
            geodesic
            lineCap="round"
            lineJoin="round"
          />
        )}

        {renderedMarkers.map(({ key, dest }) => (
          <DestinationMarker
            key={key}
            dest={dest}
            onPress={stableMarkerPress}
            getWeatherColor={getWeatherColor}
            getWeatherIcon={getWeatherIcon}
            styles={styles}
            temperatureUnit={temperatureUnit}
          />
        ))}

        {renderedFavourites.map(({ stableKey, fav, withWeather, temp, cond, favBadges, hasFavBadges }) => (
          <Marker
            key={`fav-${stableKey}`}
            coordinate={{ latitude: Number(fav.lat), longitude: Number(fav.lon) }}
            anchor={{ x: 0.5, y: 0.5 }}
            zIndex={hasFavBadges ? 10000 : 500}
            tracksViewChanges={Platform.OS === 'android'}
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
                {hasFavBadges && (() => {
                  const sorted = favBadges
                    .sort((a, b) => (BadgeMetadata[a]?.priority || 99) - (BadgeMetadata[b]?.priority || 99))
                    .slice(0, 6);
                  const right = sorted.slice(0, 3);
                  const left = sorted.slice(3);
                  return (
                    <>
                      <View style={styles.badgeOverlayContainer}>
                        {right.map((badge, i) => (
                          <AnimatedBadge key={i} icon={BadgeMetadata[badge].icon} color={BadgeMetadata[badge].color} delay={i * 40} animate="light" />
                        ))}
                      </View>
                      {left.length > 0 && (
                        <View style={styles.badgeOverlayContainerLeft}>
                          {left.map((badge, i) => (
                            <AnimatedBadge key={i} icon={BadgeMetadata[badge].icon} color={BadgeMetadata[badge].color} delay={(i + 3) * 40} animate="light" />
                          ))}
                        </View>
                      )}
                    </>
                  );
                })()}
              </View>
            </View>
          </Marker>
        ))}

        </>}
      </MapView>

      <LoadingModal
        visible={loadingDestinations}
        mode={reverseMode === 'cold' ? 'cooler' : 'warmer'}
        phaseKey={loadingPhaseKey}
      />

      {/* Empty state when trophy filter is active but no trophy-worthy places visible */}
      <NoHighlightsModal
        visible={
          showOnlyBadges &&
          !loadingDestinations &&
          visibleMarkers.filter((dest) => isTrophyWorthy(getMapBadges(dest.badges))).length === 0 &&
          favouriteDestinations.filter((fav) => {
            if (!fav || fav.lat == null || fav.lon == null) return false;
            const withWeather = displayDestinations.find(
              (d) =>
                (d.id && fav.placeId && d.id === fav.placeId) ||
                (d.id && fav.id && d.id === fav.id) ||
                (Math.abs((d.lat ?? d.latitude) - fav.lat) < 0.01 &&
                  Math.abs((d.lon ?? d.longitude) - fav.lon) < 0.01)
            );
            const badges = withWeather?.badges || fav.badges || [];
            return isTrophyWorthy(getMapBadges(badges));
          }).length === 0
        }
        radiusLabel={t('map.inRadiusKm', { radius: formatDistance(radius, distanceUnit, 0) })}
        onExpandRadius={() => {
          const newRadius = Math.min(radius * 2, 5000);
          setRadius(newRadius);
          playTickSound();
        }}
        onShowAll={() => {
          setShowOnlyBadges(false);
          playTickSound();
        }}
      />

      {/* Favourites Button */}
      <TouchableOpacity
        style={[styles.favouritesButton, { 
          backgroundColor: theme.surface,
          borderColor: 'rgba(0,0,0,0.07)',
          shadowColor: '#000'
        }]}
        onPress={() => navigation.navigate('Favourites', { source: 'map' })}
        accessibilityLabel={t('app.favourites')}
        accessibilityRole="button"
        accessibilityHint="View your saved favourite destinations"
      >
        <Text style={styles.favouritesIcon}>⭐</Text>
      </TouchableOpacity>

      {/* Badge Filter Toggle Button */}
      <TouchableOpacity
        style={[styles.badgeToggleButton, { 
          backgroundColor: showOnlyBadges ? '#D4B83A' : theme.surface,
          borderColor: 'rgba(0,0,0,0.07)',
          shadowColor: '#000',
          opacity: 1.0,
        }]}
        onPress={() => {
          const next = !showOnlyBadges;
          setShowOnlyBadges(next);
          playTickSound();
          mixpanel.track('Badge Filter Toggled', { enabled: next });
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
          borderColor: 'rgba(0,0,0,0.07)',
          shadowColor: '#000'
        }]}
        onPress={() => {
          mixpanel.track('Settings Opened');
          navigation.navigate('Settings');
        }}
        accessibilityLabel={t('app.settings')}
        accessibilityRole="button"
        accessibilityHint="Open app settings"
      >
        <Text style={styles.settingsIcon}>⚙️</Text>
      </TouchableOpacity>

      {/* Feedback Button */}
      <View style={styles.feedbackButtonWrap}>
        <TouchableOpacity
          style={[styles.feedbackButton, {
            backgroundColor: theme.surface,
            borderColor: 'rgba(0,0,0,0.07)',
            shadowColor: '#000',
          }]}
          onPress={() => navigation.navigate('Feedback', { source: 'map' })}
          accessibilityLabel="Feedback senden"
          accessibilityRole="button"
          accessibilityHint="Send feedback to the SunNomad team"
        >
          <Text style={styles.feedbackIcon}>✉️</Text>
        </TouchableOpacity>
        <View style={styles.feedbackBetaBadge}>
          <Text style={styles.feedbackBetaText}>Beta</Text>
        </View>
      </View>

      {/* Collapsible Controls */}
      <View style={styles.controlsWrapper}>
        <TouchableOpacity
          style={[styles.controlsToggle, {
            backgroundColor: theme.surface,
            borderColor: theme.border,
            shadowColor: theme.shadow
          }]}
          onPress={() => setControlsExpanded((prev) => {
            const next = !prev;
            mixpanel.track('Controls Toggled', { expanded: next });
            return next;
          })}
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
              onDateOffsetChange={(offset) => {
                setSelectedDateOffset(offset);
                mixpanel.track('Date Filter Changed', { date_offset: offset });
              }}
            />
            
            <View style={styles.filterSeparator} />
            
            <WeatherFilter
              selectedConditions={selectedConditions}
              onConditionsChange={(conditions) => {
                setSelectedConditions(conditions);
                mixpanel.track('Filter Changed', { filter: conditions });
              }}
            />
          </View>
        )}
      </View>

      <View style={styles.radiusControlsWrapper}>
        {showRadiusMenu && (
          <View style={styles.radiusPresetMenu}>
            {(isMiles
              ? [100, 300, 750, 1500].map(mi => Math.round(milesToKm(mi)))
              : [200, 500, 1000, 2000]
            ).map((radiusOption, index) => {
              const isSelected = isMiles
                ? Math.abs(kmToMiles(radius) - kmToMiles(radiusOption)) < 5
                : radiusOption === radius;
              return (
                <TouchableOpacity
                  key={radiusOption}
                  style={[
                    styles.rpRow,
                    isSelected && styles.rpRowSelected,
                    index < 3 && styles.rpRowBorder,
                  ]}
                  onPress={() => handleRadiusSelect(radiusOption)}
                  activeOpacity={0.6}
                >
                  <Text style={[styles.rpText, isSelected && styles.rpTextSelected]}>
                    {formatDistance(radiusOption, distanceUnit, 0)}
                  </Text>
                  {isSelected && <Text style={styles.rpCheck}>✓</Text>}
                </TouchableOpacity>
              );
            })}
          </View>
        )}
        
        <TouchableOpacity 
          style={styles.radiusDisplay}
          onPress={() => setShowRadiusMenu(!showRadiusMenu)}
          accessibilityLabel={t('radius.title')}
          accessibilityRole="button"
        >
          <Text style={styles.radiusLabel}>{t('radius.title').toUpperCase()}</Text>
          <Text style={styles.radiusDisplayText}>{formatDistance(radius, distanceUnit, 0)}</Text>
        </TouchableOpacity>
        <View style={styles.radiusControls}>
          <TouchableOpacity
            style={styles.radiusButtonLeft}
            onPress={handleRadiusIncrease}
            accessibilityLabel={t('radius.more')}
            activeOpacity={0.6}
          >
            <Text style={styles.radiusPlusText}>+</Text>
          </TouchableOpacity>
          <View style={styles.radiusDivider} />
          <TouchableOpacity
            style={styles.radiusButtonRight}
            onPress={handleRadiusDecrease}
            accessibilityLabel={t('radius.less')}
            activeOpacity={0.6}
          >
            <Text style={styles.radiusMinusText}>−</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Reference location — flat absolute layers (no full-screen wrapper: avoids layout jump) */}
      {showRefMenu && (
        <Pressable
          style={styles.refMenuBackdrop}
          onPress={() => setShowRefMenu(false)}
        />
      )}
      {showRefMenu && (
        <View style={[styles.refMenu, {
          backgroundColor: theme.surface,
          borderColor: 'rgba(0,0,0,0.07)',
          shadowColor: '#000',
        }]}>
          <Text style={[styles.refMenuTitle, { color: theme.textSecondary }]}>{t('map.refTitle')}</Text>
          <TouchableOpacity
            style={styles.refMenuRow}
            onPress={selectGpsReference}
            accessibilityRole="menuitem"
          >
            <Text style={[styles.refMenuIcon, { color: theme.text }, centerPoint && styles.refMenuIconInactive]}>⌖</Text>
            <Text style={[styles.refMenuText, { color: theme.text }, centerPoint && styles.refMenuTextInactive]}>
              {t('map.refCurrentLocation')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.refMenuRow, !manualRefAvailable && !centerPoint && styles.refMenuRowDisabled]}
            onPress={selectManualReference}
            disabled={!manualRefAvailable && !centerPoint}
            accessibilityRole="menuitem"
          >
            <Text style={[styles.refMenuIcon, { color: theme.text }, !centerPoint && styles.refMenuIconInactive]}>✓</Text>
            <Text style={[styles.refMenuText, { color: theme.text }, !centerPoint && styles.refMenuTextInactive]}>
              {manualRefName
                ? t('map.refSelectedLocationNamed', { name: manualRefName })
                : t('map.refSelectedLocation')}
            </Text>
          </TouchableOpacity>
        </View>
      )}
      {showRefTip && !showRefMenu && (
        <View style={styles.refTipWrap} pointerEvents="none">
          <View style={styles.refTip}>
            <Text style={styles.refTipText}>{t('map.refTooltip')}</Text>
          </View>
          <View style={styles.refTipArrow} />
        </View>
      )}
      <View style={styles.bottomRefRow}>
        <Pressable
          style={({ pressed }) => [
            styles.refLocButton,
            {
              backgroundColor: theme.surface,
              borderColor: 'rgba(0,0,0,0.07)',
              shadowColor: '#000',
            },
            pressed && styles.refLocButtonPressed,
          ]}
          onPress={handleRefButtonPress}
          onLongPress={handleRefButtonLongPress}
          delayLongPress={400}
          accessibilityLabel={t('map.refTitle')}
          accessibilityRole="button"
          accessibilityHint="Return the map to the active reference location. Long press for options."
        >
          <Text style={styles.refLocIcon}>{centerPoint ? '📍' : '⌖'}</Text>
        </Pressable>
        {__DEV__ && (
          <View style={[styles.zoomIndicator, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text style={[styles.zoomIndicatorText, { color: theme.text }]}>Z{devZoom}</Text>
          </View>
        )}
      </View>

      {/* Bottom Left Buttons Container */}
      <View style={styles.bottomLeftButtons}>
        {/* Reverse Mode Button (Warm/Cold) */}
        <TouchableOpacity
          style={[styles.reverseButton, {
            backgroundColor: reverseMode === 'cold' ? '#4A82C0' : '#C87840',
            shadowColor: theme.shadow
          }]}
          onPress={toggleReverseMode}
          accessibilityRole="button"
        >
          <Text style={styles.reverseIcon}>{reverseMode === 'cold' ? '❄️' : '☀️'}</Text>
          <Text style={styles.reverseLabel}>{reverseMode === 'cold' ? t('map.modeCooler') : t('map.modeWarmer')}</Text>
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
    fontWeight: '600',
  },
  skipButton: {
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 12,
    borderWidth: 1,
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
    borderWidth: 1.5,
    borderColor: '#E0E0E0',
    paddingHorizontal: 16,
    paddingRight: 40,
    fontSize: 16,
    color: '#333',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.10,
    shadowRadius: 4,
    elevation: 3,
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
    fontWeight: '500',
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
    borderWidth: 1.5,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  controlsToggleText: {
    fontSize: 16,
    fontWeight: '500',
    textAlign: 'center',
  },
  controlsContainer: {
    marginTop: 10,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1.5,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
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
    width: 68,
    height: 68,
    borderRadius: 34,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.85)',
    overflow: 'visible',
    zIndex: 999,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.14,
    shadowRadius: 3,
    elevation: 2,
  },
  currentLocationMarker: {
    borderColor: '#5CA3D9',
    borderWidth: 3,
  },
  currentLocationFrame: {
    height: 118,
    justifyContent: 'flex-start',
    paddingTop: 30,
  },
  currentLocationLabel: {
    position: 'absolute',
    top: 101,
    alignSelf: 'center',
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
    textShadowColor: 'rgba(0, 0, 0, 0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  centerPointLabel: {
    backgroundColor: 'rgba(192, 80, 48, 0.85)',
  },
  markerWeatherIcon: {
    fontSize: 22,
  },
  markerTemp: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(0, 0, 0, 0.82)',
    marginTop: 1,
    letterSpacing: -0.3,
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 5,
    overflow: 'hidden',
  },
  stabilityBadge: {
    position: 'absolute',
    bottom: -16,
    backgroundColor: '#2E7D32',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#fff',
    minWidth: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  currentLocationBadge: {
    backgroundColor: '#4A82C0',
  },
  centerPointMarker: {
    borderColor: '#C05030',
    borderWidth: 2,
  },
  dedicatedHeroMarker: {
    borderColor: '#D4B83A',
    borderWidth: 1.5,
    shadowColor: '#C8A830',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 4,
  },
  centerPointBadge: {
    backgroundColor: '#C05030',
  },
  centerPointBadgeIndicator: {
    position: 'absolute',
    bottom: -10,
    backgroundColor: '#C05030',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#fff',
  },
  centerPointBadgeText: {
    fontSize: 14,
    color: '#fff',
    fontWeight: '600',
  },
  centerPointCircleMarker: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(74, 130, 192, 0.25)',
    borderWidth: 3,
    borderColor: '#4A82C0',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#4A82C0',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.45,
    shadowRadius: 7,
    elevation: 6,
  },
  centerPointCircleInner: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#4A82C0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  centerPointIcon: {
    fontSize: 28,
    color: '#fff',
    fontWeight: '600',
    textAlign: 'center',
  },
  stabilityText: {
    fontSize: 14,
    color: '#fff',
    fontWeight: '600',
    lineHeight: 14,
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
  radiusControlsWrapper: {
    position: 'absolute',
    bottom: 50,
    right: 20,
    alignItems: 'center',
  },
  radiusDisplay: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: '#F4F6F8',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.10)',
    marginBottom: 8,
    alignItems: 'center',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.14,
    shadowRadius: 5,
    elevation: 4,
  },
  radiusLabel: {
    fontSize: 11,
    fontWeight: '400',
    color: '#6B7280',
    textAlign: 'center',
    letterSpacing: 0.5,
    marginBottom: 1,
  },
  radiusDisplayText: {
    fontSize: 22,
    fontWeight: '500',
    color: '#1F2933',
    textAlign: 'center',
  },
  radiusControls: {
    flexDirection: 'row',
    borderRadius: 14,
    backgroundColor: '#F4F6F8',
    overflow: 'hidden',
  },
  radiusButtonLeft: {
    width: 44,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  radiusButtonRight: {
    width: 44,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  radiusDivider: {
    width: 1,
    backgroundColor: '#DDE1E6',
    marginVertical: 10,
  },
  radiusPlusText: {
    fontSize: 23,
    fontWeight: '300',
    color: '#374151',
  },
  radiusMinusText: {
    fontSize: 23,
    fontWeight: '300',
    color: '#374151',
  },
  radiusPresetMenu: {
    position: 'absolute',
    bottom: 100,
    right: 0,
    backgroundColor: '#F4F6F8',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
    paddingVertical: 4,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.10,
    shadowRadius: 4,
    shadowColor: '#000',
    elevation: 4,
    minWidth: 120,
    zIndex: 1000,
  },
  rpRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 18,
  },
  rpRowSelected: {
    backgroundColor: 'rgba(80, 100, 140, 0.06)',
  },
  rpRowBorder: {
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(0,0,0,0.06)',
  },
  rpText: {
    fontSize: 17,
    fontWeight: '400',
    color: '#2C3E6A',
  },
  rpTextSelected: {
    fontWeight: '600',
    color: '#3A5290',
  },
  rpCheck: {
    fontSize: 15,
    fontWeight: '600',
    color: '#3A5290',
    marginLeft: 8,
  },
  zoomIndicator: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    minWidth: 40,
    alignItems: 'center',
  },
  zoomIndicatorText: {
    fontSize: 12,
    fontWeight: '600',
  },
  bottomRefRow: {
    position: 'absolute',
    bottom: 104,
    left: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    zIndex: 1002,
    elevation: 1002,
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
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 22,
    gap: 6,
    borderWidth: 0,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.14,
    shadowRadius: 4,
    elevation: 3,
  },
  reverseIcon: {
    fontSize: 17,
  },
  reverseLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
    letterSpacing: 0.2,
  },
  favouritesButton: {
    position: 'absolute',
    top: 78,
    right: 10,
    width: 58,
    height: 58,
    borderRadius: 29,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.14,
    shadowRadius: 5,
    elevation: 4,
  },
  favouritesIcon: {
    fontSize: 30,
    textAlign: 'center',
    lineHeight: 32,
    includeFontPadding: false,
    marginTop: 2,
  },
  badgeToggleButton: {
    position: 'absolute',
    top: 146,
    right: 10,
    width: 58,
    height: 58,
    borderRadius: 29,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.14,
    shadowRadius: 5,
    elevation: 4,
  },
  badgeToggleIcon: {
    fontSize: 30,
    textAlign: 'center',
    lineHeight: 32,
    includeFontPadding: false,
    marginTop: 2,
  },
  settingsButton: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 58,
    height: 58,
    borderRadius: 29,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.14,
    shadowRadius: 5,
    elevation: 4,
  },
  settingsIcon: {
    fontSize: 30,
    textAlign: 'center',
    lineHeight: 32,
    includeFontPadding: false,
    marginTop: 2,
  },
  feedbackButtonWrap: {
    position: 'absolute',
    top: 214,
    right: 10,
    width: 58,
    height: 58,
  },
  feedbackButton: {
    width: 58,
    height: 58,
    borderRadius: 29,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.14,
    shadowRadius: 5,
    elevation: 4,
  },
  feedbackBetaBadge: {
    position: 'absolute',
    top: -3,
    right: -4,
    backgroundColor: '#E53935',
    borderRadius: 7,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  feedbackBetaText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  feedbackIcon: {
    fontSize: 28,
    textAlign: 'center',
    lineHeight: 30,
    includeFontPadding: false,
    marginTop: 2,
  },
  refLocButton: {
    width: 58,
    height: 58,
    borderRadius: 29,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.14,
    shadowRadius: 5,
    elevation: 4,
  },
  refLocButtonPressed: {
    opacity: 0.75,
  },
  refLocIcon: {
    fontSize: 28,
    textAlign: 'center',
    lineHeight: 32,
    includeFontPadding: false,
  },
  refMenuBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1000,
    elevation: 1000,
  },
  refMenu: {
    position: 'absolute',
    bottom: 170,
    left: 20,
    minWidth: 210,
    borderRadius: 14,
    borderWidth: 1.5,
    paddingVertical: 6,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.14,
    shadowRadius: 5,
    elevation: 1001,
    zIndex: 1001,
  },
  refMenuTitle: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  refMenuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  refMenuRowDisabled: {
    opacity: 0.4,
  },
  refMenuIcon: {
    fontSize: 17,
    width: 22,
    textAlign: 'center',
    fontWeight: '600',
  },
  refMenuIconInactive: {
    opacity: 0.35,
  },
  refMenuText: {
    fontSize: 15,
    fontWeight: '600',
    flexShrink: 1,
  },
  refMenuTextInactive: {
    fontWeight: '500',
    opacity: 0.45,
  },
  refTipWrap: {
    position: 'absolute',
    bottom: 168,
    left: 20,
    alignItems: 'flex-start',
  },
  refTip: {
    backgroundColor: 'rgba(30,30,30,0.72)',
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  refTipArrow: {
    width: 0,
    height: 0,
    marginLeft: 23,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 6,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: 'rgba(30,30,30,0.72)',
  },
  refTipText: {
    fontSize: 11,
    lineHeight: 15,
    color: 'rgba(255,255,255,0.92)',
    letterSpacing: 0.1,
  },
  favouriteMarkerBorder: {
    borderColor: '#C06030',
    borderWidth: 2,
    shadowColor: '#C06030',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
    elevation: 3,
  },
});

export default MapScreen;



