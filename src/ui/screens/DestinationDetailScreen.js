import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Pressable,
  Alert,
  ActivityIndicator,
  Animated,
  Easing,
  LayoutAnimation,
  InteractionManager,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../theme/ThemeProvider';
import { getWeatherIcon, getWeatherColor } from '../../usecases/weatherUsecases';
import { openInMaps, NavigationProvider } from '../../usecases/navigationUsecases';
import { getPlaceDetail } from '../../services/placesWeatherService';
import { supabase } from '../../config/supabase';
import { toggleFavourite, isDestinationFavourite } from '../../usecases/favouritesUsecases';
import { BadgeMetadata, calculateBadges, filterWarmDryIfHeatwave } from '../../domain/destinationBadge';
import { getCountryName } from '../../utils/countryNames';
import { useUnits } from '../../contexts/UnitContext';
import { formatTemperature, formatDistance, getTemperatureSymbol, getDistanceSymbol } from '../../utils/unitConversion';

import { LinearGradient } from 'expo-linear-gradient';
import {
  getHeroImage as getDedicatedHeroImage,
  getCachedHeroImage,
  listDedicatedHeroImages,
  DEFAULT_HERO_IMAGE_URL,
} from '../../services/placeHeroImageService';
import { getHeroImage } from '../../utils/heroImages';
import AsyncStorage from '@react-native-async-storage/async-storage';
import StopStayCard from '../components/StopStayCard';
import { mixpanel } from '../../services/mixpanel';

const getWindDescriptionKey = (windSpeed) => {
  const speed = windSpeed || 0;
  if (speed <= 10) return 'destination.windCalm';
  if (speed <= 20) return 'destination.windLight';
  if (speed <= 35) return 'destination.windModerate';
  if (speed <= 50) return 'destination.windStrong';
  return 'destination.windStorm';
};

/** Display-only: correct day counts for badge descriptions (no badge logic change).
 *  Today = dest.condition OR forecast.today (same day, count once). Then tomorrow..day4 (5 days total). */
const getDisplaySnowDays = (dest) => {
  const f = dest.forecast;
  const isTodaySnowy = dest.condition === 'snowy' || f?.today?.condition === 'snowy';
  let n = isTodaySnowy ? 1 : 0;
  if (f?.tomorrow?.condition === 'snowy') n++;
  if (f?.day2?.condition === 'snowy') n++;
  if (f?.day3?.condition === 'snowy') n++;
  if (f?.day4?.condition === 'snowy') n++;
  return n;
};
const getDisplayRainyDays = (dest) => {
  const today = dest.condition === 'rainy' || dest.forecast?.today?.condition === 'rainy';
  let n = today ? 1 : 0;
  const f = dest.forecast;
  if (f?.tomorrow?.condition === 'rainy') n++;
  if (f?.day2?.condition === 'rainy') n++;
  if (f?.day3?.condition === 'rainy') n++;
  if (f?.day4?.condition === 'rainy') n++;
  if (f?.day5?.condition === 'rainy') n++;
  return n;
};
const getDisplayHotDays = (dest) => {
  const today = (dest.temperature ?? 0) >= 34 || dest.forecast?.today?.high >= 34;
  let n = today ? 1 : 0;
  const f = dest.forecast;
  if (f?.tomorrow?.high >= 34) n++;
  if (f?.day2?.high >= 34) n++;
  if (f?.day3?.high >= 34) n++;
  if (f?.day4?.high >= 34) n++;
  if (f?.day5?.high >= 34) n++;
  return n;
};
// Must match calculateSunnyStreak: longest CONSECUTIVE sunny run in first 5 slots
const getDisplaySunnyStreak = (dest) => {
  let slots;
  const arr = dest.forecastArray;
  if (arr?.length) {
    slots = [arr[0], arr[1], arr[2], arr[3], arr[4]];
  } else {
    const f = dest.forecast;
    slots = [f?.today, f?.tomorrow, f?.day2, f?.day3, f?.day4];
  }
  let max = 0, cur = 0;
  for (const s of slots) {
    if (s?.condition === 'sunny') { cur++; if (cur > max) max = cur; }
    else { cur = 0; }
  }
  return max;
};

const AnimatedBadgeCard = ({ index, destination, badge, isExpanded, onToggle, theme, overHero, children }) => {
  const fadeAnim = React.useRef(new Animated.Value(0)).current;
  const slideAnim = React.useRef(new Animated.Value(50)).current;
  const scaleAnim = React.useRef(new Animated.Value(0.8)).current;

  React.useEffect(() => {
    fadeAnim.setValue(0);
    slideAnim.setValue(50);
    scaleAnim.setValue(0.8);

    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 600,
        delay: index * 200,
        useNativeDriver: true,
      }),
      Animated.spring(slideAnim, {
        toValue: 0,
        tension: 40,
        friction: 6,
        delay: index * 200,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        tension: 40,
        friction: 6,
        delay: index * 200,
        useNativeDriver: true,
      }),
    ]).start();
  }, [destination, badge]);

  return (
    <TouchableOpacity onPress={onToggle} activeOpacity={0.7}>
      <Animated.View
        style={[
          styles.badgeCard,
          { backgroundColor: overHero ? 'rgba(255,255,255,0.92)' : theme.background },
          {
            opacity: fadeAnim,
            transform: [
              { translateX: slideAnim },
              { scale: scaleAnim }
            ],
          }
        ]}
      >
        {children}
        <Text style={[styles.badgeExpandIndicator, { color: theme.textSecondary }]}>
          {isExpanded ? '▲' : '▼'}
        </Text>
      </Animated.View>
    </TouchableOpacity>
  );
};

const DestinationDetailScreen = ({ route, navigation }) => {
  const { t, i18n } = useTranslation();
  const { theme } = useTheme();
  const { temperatureUnit, distanceUnit } = useUnits();
  const { destination, dateOffset: initialDateOffset = 0, reverseMode = 'warm', origin, source: viewSource = 'map' } = route.params;
  const [dateOffset, setDateOffset] = useState(initialDateOffset);
  const [datePickerVisible, setDatePickerVisible] = useState(false);
  const tempSym = getTemperatureSymbol(temperatureUnit);
  const distSym = getDistanceSymbol(distanceUnit);
  const fmtTemp = (c) => formatTemperature(c, temperatureUnit);
  const fmtDist = (km, dec = 0) => formatDistance(km, distanceUnit, dec);
  const fmtTempDelta = (delta) => {
    const val = temperatureUnit === 'fahrenheit' ? Math.round(delta * 9 / 5) : Math.round(delta);
    return `${val > 0 ? '+' : ''}${val} ${tempSym}`;
  };
  const effectivePlaceId = destination?.placeId || destination?.id;
  
  // Show map data immediately, then upgrade with Supabase data in background
  const initialForecast = destination ? {
    ...destination,
    id: effectivePlaceId,
    description: destination.description || destination.weatherDescription || destination.condition || '',
    countryCode: destination.countryCode || destination.country_code,
    country_code: destination.country_code || destination.countryCode,
    country: destination.country,
    forecast: destination.forecast ? {
      today: destination.forecast.today || { condition: destination.condition, temp: destination.temperature, high: destination.temperature, low: destination.temperature ? destination.temperature - 3 : null },
      tomorrow: destination.forecast.tomorrow || null,
      day3: destination.forecast.day3 || destination.forecast.day2 || null,
      day4: destination.forecast.day4 || null,
      day5: destination.forecast.day5 || null,
    } : {
      today: { condition: destination.condition, temp: destination.temperature, high: destination.temperature, low: destination.temperature ? destination.temperature - 3 : null },
      tomorrow: null, day3: null, day4: null, day5: null,
    },
  } : null;

  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [forecast, setForecast] = useState(initialForecast);
  const [isFavourite, setIsFavourite] = useState(false);
  const [favouriteLoading, setFavouriteLoading] = useState(false);
  const [expandedBadges, setExpandedBadges] = useState({});
  const [favToast, setFavToast] = useState(null);
  const [uiFocused, setUiFocused] = useState(false);
  const [localBadges, setLocalBadges] = useState(destination?.badges || []);
  const [badgeSource, setBadgeSource] = useState(destination);
  const [firstLineW, setFirstLineW] = useState(null);
  // Base layer under the hero: last hero shown for this place (rotation cross-fades
  // from it), or the blurred local generic on first load.
  const [heroBase, setHeroBase] = useState(() => getCachedHeroImage({ id: effectivePlaceId }));
  // null = lookup pending; the resolved hero fades in over the base layer
  const [heroMeta, setHeroMeta] = useState(null);
  const [heroList, setHeroList] = useState([]);
  const [heroIndex, setHeroIndex] = useState(0);
  const [devHeroNavVisible, setDevHeroNavVisible] = useState(true);
  // null = not loaded yet from storage; false = never used → pulse the button
  const [heroExpandUsed, setHeroExpandUsed] = useState(null);

  const getHeroTrackingProps = (meta = null) => {
    const h = meta
      ?? (heroList.length > 0 ? heroList[heroIndex] : null)
      ?? heroMeta;
    return {
      hero_image_name: h?.hero_image_name ?? destination.generic_key ?? null,
      hero_variant: h?.hero_variant ?? null,
      hero_variant_index: h?.hero_variant_index ?? null,
      hero_source: h?.hero_source ?? 'local',
    };
  };
  const [heroHintVisible, setHeroHintVisible] = useState(false);
  const scrollViewRef = React.useRef(null);
  const stopStayCardY = React.useRef(0);
  const [readyForDetails, setReadyForDetails] = useState(false);
  const favOpacityAnim = React.useRef(new Animated.Value(1)).current;
  const favStarColor = favOpacityAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['#8E8E93', '#C9A84C'],
  });
  const toastOpacityAnim = React.useRef(new Animated.Value(0)).current;
  const toastScaleAnim = React.useRef(new Animated.Value(0.98)).current;
  const uiOpacityAnim = React.useRef(new Animated.Value(1)).current;
  const heroHintAnim = React.useRef(new Animated.Value(0)).current;
  const heroScaleAnim = React.useRef(new Animated.Value(1)).current;
  const heroFadeAnim = React.useRef(new Animated.Value(0)).current;
  const lastFadedHeroUrl = React.useRef(null);
  // Reset opacity to 0 synchronously (before the state update that swaps the image
  // source commits), so the new image never briefly flashes at full opacity.
  const startHeroFade = useCallback((url) => {
    if (!url || url === lastFadedHeroUrl.current) return;
    lastFadedHeroUrl.current = url;
    heroFadeAnim.setValue(0);
    Animated.timing(heroFadeAnim, {
      toValue: 1,
      duration: 850,
      easing: Easing.inOut(Easing.ease),
      useNativeDriver: true,
    }).start();
  }, [heroFadeAnim]);
  const pulseAnim = React.useRef(new Animated.Value(1)).current;
  const vignetteAnim = React.useRef(new Animated.Value(0)).current;

  /**
   * Helper: Convert a forecastData entry (from Supabase) to the app forecast slot format
   */
  const toForecastSlot = (entry) => {
    if (!entry) return null;
    return {
      condition: entry.condition,
      temp: Math.round((entry.tempMin + entry.tempMax) / 2),
      high: entry.tempMax,
      low: entry.tempMin,
      description: entry.weatherDescription,
      precipitation: entry.precipitation ?? 0,
      sunshine_duration: entry.sunshine_duration ?? 0,
    };
  };

  /**
   * Helper: Build 5 forecast slots starting from dateOffset
   * forecastData is indexed from today (index 0 = today, 1 = tomorrow, etc.)
   */
  const buildForecastSlots = (forecastData, fallbackPlace) => {
    const startIdx = dateOffset;
    const keys = ['today', 'tomorrow', 'day3', 'day4', 'day5'];
    const slots = {};
    keys.forEach((key, i) => {
      const entry = forecastData[startIdx + i];
      if (entry) {
        slots[key] = toForecastSlot(entry);
      } else if (i === 0 && fallbackPlace) {
        // First slot fallback: use place's current weather
        slots[key] = {
          condition: fallbackPlace.condition,
          temp: fallbackPlace.temperature,
          high: fallbackPlace.temperature,
          low: fallbackPlace.temperature ? fallbackPlace.temperature - 3 : null,
        };
      } else {
        slots[key] = null;
      }
    });
    return slots;
  };

  const loadForecast = async () => {
    try {
      setIsRefreshing(true);
      setError(null);

      // FAST PATH: Map already provides forecastArray with 16 days — use it directly
      if (destination.forecastArray && destination.forecastArray.length > dateOffset) {
        const startIdx = dateOffset;
        const keys = ['today', 'tomorrow', 'day3', 'day4', 'day5'];
        const slots = {};
        keys.forEach((key, i) => {
          const entry = destination.forecastArray[startIdx + i];
          if (entry) {
            slots[key] = {
              condition: entry.condition,
              temp: entry.high ?? entry.temp,
              high: entry.high,
              low: entry.low,
              description: entry.description,
              precipitation: entry.precipitation ?? 0,
              sunshine_duration: entry.sunshine_duration ?? 0,
            };
          }
        });
        if (Object.keys(slots).length >= 2) {
          const day0 = destination.forecastArray[startIdx];
          const fastForecast = {
            ...destination,
            id: effectivePlaceId,
            description: destination.description || destination.weatherDescription || destination.condition || '',
            countryCode: destination.countryCode || destination.country_code,
            country_code: destination.country_code || destination.countryCode,
            country: destination.country,
            state_name: destination.state_name || null,
            elevation: destination.elevation ?? destination.dem ?? null,
            temperature: day0?.high ?? day0?.temp ?? destination.temperature,
            condition: day0?.condition ?? destination.condition,
            forecast: slots,
          };
          setForecast(fastForecast);
          setIsLoading(false);
          setIsRefreshing(false);
          return;
        }
      }
      
      // SLOW PATH: No forecastArray — resolve UUID and fetch from DB
      let resolvedId = effectivePlaceId;
      const isValidUUID = resolvedId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(resolvedId);
      if (!isValidUUID) {
        try {
          const lat = destination.lat ?? destination.latitude;
          const lon = destination.lon ?? destination.longitude;
          __DEV__ && console.log('[resolvePlace] no UUID, trying lookup. lat:', lat, 'lon:', lon, 'name:', destination.name);
          if (lat != null && lon != null) {
            const { data, error } = await supabase
              .from('places')
              .select('id, name_en')
              .gte('latitude', lat - 0.05)
              .lte('latitude', lat + 0.05)
              .gte('longitude', lon - 0.05)
              .lte('longitude', lon + 0.05)
              .limit(1);
            __DEV__ && console.log('[resolvePlace] coord result:', data, 'error:', error);
            if (data?.[0]?.id) resolvedId = data[0].id;
          }
          if (!(/^[0-9a-f]{8}-/i.test(resolvedId))) {
            const cleanName = (destination.name || '').replace(/^[📍⊕★]\s?/g, '').trim();
            __DEV__ && console.log('[resolvePlace] coord miss, trying name:', cleanName);
            if (cleanName) {
              const { data, error } = await supabase
                .from('places')
                .select('id, name_en')
                .ilike('name_en', `%${cleanName}%`)
                .limit(1);
              __DEV__ && console.log('[resolvePlace] name result:', data, 'error:', error);
              if (data?.[0]?.id) resolvedId = data[0].id;
            }
          }
          __DEV__ && console.log('[resolvePlace] final resolvedId:', resolvedId);
        } catch (e) {
          console.warn('[resolvePlace] lookup failed:', e);
        }
      }

      const hasValidUUID = resolvedId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(resolvedId);
      if (hasValidUUID) {
        try {
          const { place, forecast: forecastData, error: fetchError } = await getPlaceDetail(resolvedId, i18n.language);
          
          if (fetchError || !place || !forecastData || forecastData.length < 2) {
            throw new Error(fetchError || 'Insufficient forecast data from Supabase');
          }
          
          const forecastSlots = buildForecastSlots(forecastData, place);
          
          const convertedForecast = {
            ...place,
            name: destination.name,
            description: place.weatherDescription || place.condition || '',
            forecast: forecastSlots,
          };
          
          convertedForecast.attractivenessScore =
            convertedForecast.attractivenessScore ?? destination.attractivenessScore ?? destination.attractiveness_score ?? null;

          if (destination.badges) {
            convertedForecast.badges = destination.badges;
            convertedForecast._worthTheDriveData = destination._worthTheDriveData;
            convertedForecast._worthTheDriveBudgetData = destination._worthTheDriveBudgetData;
            convertedForecast._warmAndDryData = destination._warmAndDryData;
            convertedForecast._beachParadiseData = destination._beachParadiseData;
            convertedForecast._sunnyStreakData = destination._sunnyStreakData;
            convertedForecast._weatherMiracleData = destination._weatherMiracleData;
            convertedForecast._heatwaveData = destination._heatwaveData;
            convertedForecast._snowKingData = destination._snowKingData;
            convertedForecast._rainyDaysData = destination._rainyDaysData;
            convertedForecast._weatherCurseData = destination._weatherCurseData;
            convertedForecast._springAwakeningData = destination._springAwakeningData;
          }
          
          setForecast(convertedForecast);
          setIsLoading(false);
          return;
        } catch (fetchError) {
          console.warn(`⚠️ Supabase fetch failed for ${destination.name}, using inline forecast fallback:`, fetchError);
        }
      }
      
      // Preserve resolved UUID for fallback paths (favourites need it)
      const fallbackBase = {
        ...destination,
        id: resolvedId || destination.id,
        description: destination.description || destination.weatherDescription || destination.condition || '',
        countryCode: destination.countryCode || destination.country_code,
        country_code: destination.country_code || destination.countryCode,
        country: destination.country,
      };

      // PRIORITY 2: Use inline forecast data from map
      // Map data forecast is already relative to the selected date (targetDate)
      if (destination.forecast) {
        const normalizedForecast = {
          today: destination.forecast.today ? {
            ...destination.forecast.today,
            high: destination.forecast.today.high ?? Math.round(destination.forecast.today.temp || destination.temperature || 0),
            low: destination.forecast.today.low ?? Math.round((destination.forecast.today.temp || destination.temperature || 0) - 3),
          } : { condition: destination.condition, high: destination.temperature, low: destination.temperature - 3 },
          tomorrow: destination.forecast.tomorrow ? {
            ...destination.forecast.tomorrow,
            high: destination.forecast.tomorrow.high ?? Math.round(destination.forecast.tomorrow.temp || 0),
            low: destination.forecast.tomorrow.low ?? Math.round((destination.forecast.tomorrow.temp || 0) - 3),
          } : null,
          day3: destination.forecast.day3 || destination.forecast.day2 ? {
            ...(destination.forecast.day3 || destination.forecast.day2),
            high: (destination.forecast.day3?.high || destination.forecast.day2?.high) ?? Math.round((destination.forecast.day3?.temp || destination.forecast.day2?.temp || 0)),
            low: (destination.forecast.day3?.low || destination.forecast.day2?.low) ?? Math.round((destination.forecast.day3?.temp || destination.forecast.day2?.temp || 0) - 3),
          } : null,
          day4: destination.forecast.day4 ? {
            ...destination.forecast.day4,
            high: destination.forecast.day4.high ?? Math.round(destination.forecast.day4.temp || 0),
            low: destination.forecast.day4.low ?? Math.round((destination.forecast.day4.temp || 0) - 3),
          } : null,
          day5: destination.forecast.day5 ? {
            ...destination.forecast.day5,
            high: destination.forecast.day5.high ?? Math.round(destination.forecast.day5.temp || 0),
            low: destination.forecast.day5.low ?? Math.round((destination.forecast.day5.temp || 0) - 3),
          } : null,
        };
        
        setForecast({ ...fallbackBase, forecast: normalizedForecast });
        setIsLoading(false);
        return;
      }
      
      // PRIORITY 3: Fallback - generate forecast from current data (5 days)
      setForecast({
        ...fallbackBase,
        forecast: {
          today: { condition: destination.condition, temp: destination.temperature, high: destination.temperature, low: destination.temperature - 3 },
          tomorrow: { condition: destination.condition, temp: destination.temperature + 1, high: destination.temperature + 1, low: destination.temperature - 2 },
          day3: { condition: destination.condition, temp: destination.temperature, high: destination.temperature, low: destination.temperature - 3 },
          day4: { condition: destination.condition, temp: destination.temperature - 1, high: destination.temperature - 1, low: destination.temperature - 4 },
          day5: { condition: destination.condition, temp: destination.temperature, high: destination.temperature, low: destination.temperature - 3 },
        }
      });
    } catch (err) {
      console.error('Error fetching forecast:', err);
      // Only show error if we don't have any data at all
      if (!forecast) {
        setError(err.message || t('destination.errorMessage'));
      }
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      setReadyForDetails(true);
      loadForecast();
      checkFavouriteStatus();
      mixpanel.track('Destination Viewed', {
        place_id: effectivePlaceId,
        place_name: destination.name,
        country_code: destination.countryCode || destination.country_code,
        condition: destination.condition,
        temperature: destination.temperature,
        distance_km: destination.distance,
        source: viewSource,
      });
    });
    return () => task.cancel();
  }, [destination.lat, destination.lon]);

  useEffect(() => {
    const placeObj = { id: effectivePlaceId, generic_key: destination.generic_key, name_en: destination.name_en };
    setHeroList([]);
    setHeroIndex(0);
    lastFadedHeroUrl.current = null;
    const cached = getCachedHeroImage(placeObj);
    setHeroBase(cached);
    setHeroMeta(null);

    // Lookup taking too long (slow network): commit to what we have — the last
    // cached hero, else the local generic (DEFAULT url routes to it in render).
    let fallbackShown = false;
    const fallbackHero = cached ?? {
      url: DEFAULT_HERO_IMAGE_URL,
      hero_variant: null,
      hero_variant_index: null,
      hero_source: 'timeout_fallback',
      hero_image_name: null,
    };
    const fallbackTimer = setTimeout(() => {
      fallbackShown = true;
      startHeroFade(fallbackHero.url);
      setHeroMeta(fallbackHero);
    }, 3000);

    getDedicatedHeroImage(placeObj).then(async (hero) => {
      if (hero.url?.startsWith('http')) {
        try { await Image.prefetch(hero.url); } catch (_) { /* ignore */ }
      }
      clearTimeout(fallbackTimer);
      if (fallbackShown) {
        // Late arrival: promote the fallback to base so the cross-fade starts from it
        setHeroBase(fallbackHero);
      }
      startHeroFade(hero.url);
      setHeroMeta(hero);
      if (__DEV__) {
        const list = await listDedicatedHeroImages(placeObj);
        setHeroList(list);
        const idx = list.findIndex((h) => h.url === hero.url);
        setHeroIndex(idx >= 0 ? idx : 0);
        list.forEach((h) => {
          if (h.url?.startsWith('http') && h.url !== hero.url) {
            Image.prefetch(h.url).catch(() => {});
          }
        });
      }
      if (hero.url !== DEFAULT_HERO_IMAGE_URL) {
        mixpanel.track('Hero Shown', {
          place_id: effectivePlaceId,
          place_name: destination.name,
          hero_image_name: hero.hero_image_name,
          hero_variant: hero.hero_variant,
          hero_variant_index: hero.hero_variant_index,
          hero_source: hero.hero_source,
        });
      }
    }).catch(() => {});

    return () => clearTimeout(fallbackTimer);
  }, [effectivePlaceId]);

  useEffect(() => {
    if (!__DEV__) return;
    AsyncStorage.getItem('devHeroNavVisible').then((v) => {
      if (v === '0') setDevHeroNavVisible(false);
    });
  }, []);

  const toggleDevHeroNav = useCallback(() => {
    setDevHeroNavVisible((prev) => {
      const next = !prev;
      AsyncStorage.setItem('devHeroNavVisible', next ? '1' : '0').catch(() => {});
      return next;
    });
  }, []);

  // Date offset change: rebuild forecast slots + badges locally (no DB call needed)
  useEffect(() => {
    if (dateOffset === 0) {
      setForecast(initialForecast);
      setLocalBadges(destination.badges || []);
      setBadgeSource(destination);
      return;
    }
    if (destination.forecastArray && destination.forecastArray.length > dateOffset) {
      const startIdx = dateOffset;
      const keys = ['today', 'tomorrow', 'day3', 'day4', 'day5'];
      const slots = {};
      keys.forEach((key, i) => {
        const entry = destination.forecastArray[startIdx + i];
        if (entry) {
          slots[key] = {
            condition: entry.condition,
            temp: entry.high ?? entry.temp,
            high: entry.high,
            low: entry.low,
            description: entry.description,
            precipitation: entry.precipitation ?? 0,
            windSpeed: entry.windSpeed ?? 0,
            sunshine_duration: entry.sunshine_duration ?? 0,
          };
        }
      });
      const day0 = destination.forecastArray[startIdx];
      const shiftedDest = {
        ...destination,
        temperature: day0?.high ?? day0?.temp ?? destination.temperature,
        condition: day0?.condition ?? destination.condition,
        windSpeed: day0?.windSpeed ?? destination.windSpeed,
        forecast: slots,
        forecastArray: destination.forecastArray.slice(startIdx),
      };
      const originDay = origin?.forecastArray?.[startIdx];
      const originWeather = {
        temperature: originDay?.high ?? originDay?.temp ?? origin?.temperature ?? destination.temperature,
        condition: originDay?.condition ?? origin?.condition ?? destination.condition,
        lat: origin?.lat ?? destination.lat,
        lon: origin?.lon ?? destination.lon,
        name: 'Origin',
        isCurrentLocation: true,
      };
      const newBadges = calculateBadges(shiftedDest, originWeather, destination.distance || 0, new Map(), reverseMode);
      setLocalBadges(newBadges);
      setBadgeSource(shiftedDest);
      setForecast(prev => ({
        ...prev,
        ...shiftedDest,
        forecast: slots,
      }));
    }
  }, [dateOffset]);

  const checkFavouriteStatus = async () => {
    const placeId = forecast?.id || effectivePlaceId;
    const status = await isDestinationFavourite(placeId);
    setIsFavourite(status);
    favOpacityAnim.setValue(status ? 1 : 0);
  };

  const animateFavourite = (willBeFavourite) => {
    if (willBeFavourite) {
      favOpacityAnim.setValue(0);
      Animated.timing(favOpacityAnim, {
        toValue: 1,
        duration: 180,
        delay: 40,
        useNativeDriver: false,
      }).start();
    } else {
      Animated.timing(favOpacityAnim, {
        toValue: 0,
        duration: 160,
        useNativeDriver: false,
      }).start();
    }
  };

  const showFavToast = (message) => {
    setFavToast(message);
    toastOpacityAnim.setValue(0);
    toastScaleAnim.setValue(0.98);
    Animated.sequence([
      Animated.parallel([
        Animated.timing(toastOpacityAnim, { toValue: 1, duration: 150, useNativeDriver: true }),
        Animated.timing(toastScaleAnim, { toValue: 1, duration: 150, useNativeDriver: true }),
      ]),
      Animated.delay(1500),
      Animated.timing(toastOpacityAnim, { toValue: 0, duration: 250, useNativeDriver: true }),
    ]).start(() => setFavToast(null));
  };

  const handleToggleFavourite = async () => {
    if (favouriteLoading) return;
    
    setFavouriteLoading(true);
    try {
      const target = forecast || destination;
      const result = await toggleFavourite({ ...target, id: target.id || effectivePlaceId });
      if (result.success) {
        animateFavourite(result.isFavourite);
        setIsFavourite(result.isFavourite);
        showFavToast(result.isFavourite ? t('favourites.saved') : t('favourites.removed'));
        const favProps = {
          place_id: effectivePlaceId,
          place_name: destination.name,
          country_code: destination.countryCode || destination.country_code,
          ...getHeroTrackingProps(),
        };
        mixpanel.track(result.isFavourite ? 'Destination Favourited' : 'Destination Unfavourited', favProps);
      } else {
        if (__DEV__) console.warn('Toggle favourite failed:', result.message);
        showFavToast(result.message || 'Failed to update favourites');
      }
    } catch (error) {
      console.error('Failed to toggle favourite:', error);
      showFavToast('Failed to update favourites');
    } finally {
      setFavouriteLoading(false);
    }
  };

  const toggleUiFocus = useCallback(() => {
    const newFocused = !uiFocused;
    setUiFocused(newFocused);
    if (heroExpandUsed === false) {
      setHeroExpandUsed(true);
      AsyncStorage.setItem('heroExpandUsed', '1').catch(() => {});
    }
    // First fullscreen entry: load the variant list on demand so the user can swipe
    if (newFocused && heroList.length === 0) {
      const placeObj = { id: effectivePlaceId, generic_key: destination.generic_key, name_en: destination.name_en };
      listDedicatedHeroImages(placeObj).then((list) => {
        if (list.length < 2) return;
        const idx = list.findIndex((h) => h.url === heroMeta?.url);
        setHeroList(list);
        setHeroIndex(idx >= 0 ? idx : 0);
        list.forEach((h) => {
          if (h.url?.startsWith('http') && h.url !== heroMeta?.url) {
            Image.prefetch(h.url).catch(() => {});
          }
        });
      }).catch(() => {});
    }
    mixpanel.track('Hero Image Toggled', {
      place_id: effectivePlaceId,
      place_name: destination.name,
      action: newFocused ? 'expand' : 'collapse',
      ...getHeroTrackingProps(),
    });

    LayoutAnimation.configureNext({
      duration: 300,
      create: { type: LayoutAnimation.Types.easeOut, property: LayoutAnimation.Properties.opacity },
      update: { type: LayoutAnimation.Types.easeOut },
      delete: { type: LayoutAnimation.Types.easeOut, property: LayoutAnimation.Properties.opacity },
    });

    Animated.parallel([
      Animated.timing(heroScaleAnim, {
        toValue: newFocused ? 1.025 : 1.0,
        duration: 320,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(vignetteAnim, {
        toValue: newFocused ? 1 : 0,
        duration: 320,
        useNativeDriver: true,
      }),
    ]).start();
  }, [uiFocused, heroScaleAnim, vignetteAnim, heroExpandUsed, heroList.length, heroMeta]);

  useEffect(() => {
    AsyncStorage.getItem('heroExpandUsed').then((v) => {
      if (__DEV__) console.log('[heroDiscovery] heroExpandUsed:', v);
      setHeroExpandUsed(v === '1');
    });
  }, []);

  // Show the "View photo" tooltip for ~2s, then fade it out
  const showHeroTooltip = useCallback((onDone) => {
    setHeroHintVisible(true);
    Animated.timing(heroHintAnim, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
    setTimeout(() => {
      Animated.timing(heroHintAnim, {
        toValue: 0,
        duration: 400,
        useNativeDriver: true,
      }).start(() => {
        setHeroHintVisible(false);
        if (onDone) onDone();
      });
    }, 2000);
  }, []);

  // Dev: long-press the fullscreen button to reset the discovery hints
  const resetHeroDiscoveryHints = useCallback(() => {
    if (!__DEV__) return;
    AsyncStorage.multiRemove(['heroExpandUsed', 'heroExpandPulseShown']).catch(() => {});
    setHeroExpandUsed(false);
    console.log('[heroDiscovery] hints reset');
    showHeroTooltip();
  }, [showHeroTooltip]);

  // Gentle looping pulse on the fullscreen button until it has been used once (ever).
  // JS-orchestrated loop: Animated.loop with native-driven sequences is unreliable.
  useEffect(() => {
    if (heroExpandUsed !== false) return;
    if (__DEV__) console.log('[heroDiscovery] pulse loop started');
    let cancelled = false;
    let pauseTimer;
    const runPulse = () => {
      if (cancelled) return;
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.15, duration: 550, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1.0, duration: 550, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]).start(({ finished }) => {
        if (!finished || cancelled) return;
        pauseTimer = setTimeout(runPulse, 1400);
      });
    };
    pauseTimer = setTimeout(runPulse, 800);
    return () => {
      cancelled = true;
      clearTimeout(pauseTimer);
      pulseAnim.setValue(1);
    };
  }, [heroExpandUsed]);

  // One-time discovery: show "View photo" tooltip after 1s on first ever visit
  useEffect(() => {
    let tooltipTimer;
    AsyncStorage.getItem('heroExpandPulseShown').then(val => {
      if (val) return;
      tooltipTimer = setTimeout(() => {
        showHeroTooltip(() => {
          AsyncStorage.setItem('heroExpandPulseShown', '1').catch(() => {});
        });
      }, 1000);
    });
    return () => clearTimeout(tooltipTimer);
  }, []);

  const handleDriveThere = async () => {
    try {
      mixpanel.track('Drive There Tapped', {
        place_id: effectivePlaceId,
        place_name: destination.name,
        country_code: destination.countryCode || destination.country_code,
        distance_km: destination.distance,
        ...getHeroTrackingProps(),
      });
      await openInMaps(destination, NavigationProvider.AUTO);
    } catch (error) {
      Alert.alert(
        t('destination.navigationError'),
        t('destination.navigationErrorMessage'),
        [{ text: 'OK' }]
      );
      console.error('Navigation error:', error);
    }
  };

  // Loading state — only show fullscreen spinner if we have NO data at all
  if (isLoading && !forecast) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: theme.background }]}>
        <ActivityIndicator size="large" color={theme.primary} />
        <Text style={[styles.loadingText, { color: theme.text }]}>{t('destination.loading')}</Text>
      </View>
    );
  }

  // Error state
  if (error) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: theme.background }]}>
        <Text style={styles.errorIcon}>⚠️</Text>
        <Text style={[styles.errorTitle, { color: theme.error }]}>{t('destination.errorTitle')}</Text>
        <Text style={[styles.errorMessage, { color: theme.text }]}>{error}</Text>
        <TouchableOpacity 
          style={[styles.retryButton, { backgroundColor: theme.primary }]} 
          onPress={loadForecast}
        >
          <Text style={styles.retryButtonText}>{t('destination.retry')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Data state (forecast is loaded)
  if (!forecast) {
    return null;
  }

  // Convert old "Weather code XX" to proper description (for legacy DB data)
  const fixWeatherCodeDescription = (description) => {
    if (!description) return '';
    
    // Check for "Weather code XX" pattern
    const match = description.match(/Weather code (\d+)/i);
    if (match) {
      const code = parseInt(match[1]);
      const codeDescriptions = {
        0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
        45: 'Foggy', 48: 'Depositing rime fog',
        51: 'Light drizzle', 53: 'Moderate drizzle', 55: 'Dense drizzle',
        56: 'Light freezing drizzle', 57: 'Dense freezing drizzle',
        61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain',
        66: 'Light freezing rain', 67: 'Heavy freezing rain',
        71: 'Slight snow', 73: 'Moderate snow', 75: 'Heavy snow', 77: 'Snow grains',
        80: 'Slight rain showers', 81: 'Moderate rain showers', 82: 'Violent rain showers',
        85: 'Slight snow showers', 86: 'Heavy snow showers',
        95: 'Thunderstorm', 96: 'Thunderstorm with slight hail', 99: 'Thunderstorm with heavy hail',
      };
      return codeDescriptions[code] || description;
    }
    
    return description;
  };

  // Translate weather condition
  const translateCondition = (description) => {
    if (!description) return '';
    
    // First, fix any legacy "Weather code XX" entries
    const fixedDesc = fixWeatherCodeDescription(description);
    
    // Try direct translation from weather.descriptions (exact match)
    const directTranslation = t(`weather.descriptions.${fixedDesc}`, { defaultValue: null });
    if (directTranslation && directTranslation !== `weather.descriptions.${fixedDesc}`) {
      return directTranslation;
    }
    
    const desc = fixedDesc.toLowerCase();
    
    // Map English conditions to translation keys
    if (desc.includes('mainly clear')) return t('weather.conditions.mainlyClear');
    if (desc.includes('partly cloudy')) return t('weather.conditions.partlyCloudy');
    if (desc === 'clear sky' || desc === 'clear') return t('weather.conditions.clearSky');
    if (desc.includes('few clouds')) return t('weather.conditions.fewClouds');
    if (desc.includes('scattered clouds')) return t('weather.conditions.scatteredClouds');
    if (desc.includes('broken clouds')) return t('weather.conditions.brokenClouds');
    if (desc.includes('overcast')) return t('weather.conditions.overcast');
    if (desc.includes('foggy') || desc.includes('rime fog')) return t('weather.conditions.foggy');
    if (desc.includes('freezing drizzle')) return t('weather.conditions.lightFreezingDrizzle');
    if (desc.includes('dense drizzle')) return t('weather.conditions.denseDrizzle');
    if (desc.includes('light drizzle')) return t('weather.conditions.lightDrizzle');
    if (desc.includes('moderate drizzle')) return t('weather.conditions.moderateDrizzle');
    if (desc.includes('drizzle')) return t('weather.conditions.drizzle');
    if (desc.includes('freezing rain')) return t('weather.conditions.lightFreezingRain');
    if (desc.includes('violent rain') || desc.includes('heavy rain showers')) return t('weather.conditions.violentRainShowers');
    if (desc.includes('moderate rain showers')) return t('weather.conditions.moderateRainShowers');
    if (desc.includes('slight rain showers') || desc.includes('light rain showers')) return t('weather.conditions.slightRainShowers');
    if (desc.includes('light rain') || desc.includes('slight rain')) return t('weather.conditions.slightRain');
    if (desc.includes('moderate rain')) return t('weather.conditions.moderateRain');
    if (desc.includes('heavy rain') || desc.includes('intense rain')) return t('weather.conditions.heavyRain');
    if (desc.includes('snow grains')) return t('weather.conditions.snowGrains');
    if (desc.includes('heavy snow showers')) return t('weather.conditions.heavySnowShowers');
    if (desc.includes('slight snow showers') || desc.includes('light snow showers')) return t('weather.conditions.slightSnowShowers');
    if (desc.includes('light snow') || desc.includes('slight snow')) return t('weather.conditions.slightSnow');
    if (desc.includes('moderate snow')) return t('weather.conditions.moderateSnow');
    if (desc.includes('heavy snow') || desc.includes('intense snow')) return t('weather.conditions.heavySnow');
    if (desc.includes('sleet')) return t('weather.conditions.sleet');
    if (desc.includes('thunderstorm') && desc.includes('heavy hail')) return t('weather.conditions.thunderstormHeavyHail');
    if (desc.includes('thunderstorm') && desc.includes('hail')) return t('weather.conditions.thunderstormSlightHail');
    if (desc.includes('thunderstorm') || desc.includes('thunder')) return t('weather.conditions.thunderstorm');
    if (desc.includes('mist')) return t('weather.conditions.mist');
    if (desc.includes('fog')) return t('weather.conditions.fog');
    
    // Simple condition names (from badge calculations)
    if (desc === 'sunny') return t('weather.sunny');
    if (desc === 'cloudy') return t('weather.cloudy');
    if (desc === 'rainy') return t('weather.rainy');
    if (desc === 'snowy') return t('weather.snowy');
    if (desc === 'windy') return t('weather.windy');

    // Catch legacy "X conditions" pattern from old cached data
    const condMatch = desc.match(/^(\w+)\s+conditions$/);
    if (condMatch) {
      const cond = condMatch[1];
      const condKey = t(`weather.${cond}`, { defaultValue: '' });
      if (condKey) return condKey;
    }
    
    // Fallback to fixed description if no translation match
    return fixedDesc;
  };

  // Format ETA as "5h 50min" (no decimal)
  const formatETA = (decimalHours) => {
    if (!decimalHours || decimalHours <= 0) return '0h 0min';
    const totalMinutes = Math.round(decimalHours * 60);
    const roundedMinutes = Math.round(totalMinutes / 5) * 5; // Round to nearest 5 min
    const hours = Math.floor(roundedMinutes / 60);
    const minutes = roundedMinutes % 60;
    return minutes > 0 ? `${hours}h ${minutes}min` : `${hours}h`;
  };

  // Calculate sunshine hours from condition
  const getSunshineHours = () => {
    const condition = forecast.condition?.toLowerCase() || '';
    if (condition.includes('clear') || condition.includes('sunny')) return '8-10';
    if (condition.includes('partly') || condition.includes('few clouds')) return '6-8';
    if (condition.includes('cloud')) return '4-6';
    if (condition.includes('rain') || condition.includes('storm')) return '2-4';
    return '6-8';
  };

  const dateLocale = i18n.language === 'de' ? 'de-DE' : i18n.language === 'fr' ? 'fr-FR' : 'en-US';

  /**
   * Generate date label for a forecast row
   * dayIndex 0 = selected day, 1 = selected+1, etc.
   */
  const getForecastDayLabel = (dayIndex) => {
    const totalOffset = dateOffset + dayIndex;
    if (totalOffset === 0) return t('destination.today');
    if (totalOffset === 1) return t('destination.tomorrow');
    const date = new Date();
    date.setDate(date.getDate() + totalOffset);
    return date.toLocaleDateString(dateLocale, { weekday: 'short', day: 'numeric', month: 'short' });
  };

  // Build the 5 forecast rows with labels (used by UI + findBestDay)
  const forecastRows = [
    { key: 'today', label: getForecastDayLabel(0), data: forecast?.forecast?.today },
    { key: 'tomorrow', label: getForecastDayLabel(1), data: forecast?.forecast?.tomorrow },
    { key: 'day3', label: getForecastDayLabel(2), data: forecast?.forecast?.day3 },
    { key: 'day4', label: getForecastDayLabel(3), data: forecast?.forecast?.day4 },
    { key: 'day5', label: getForecastDayLabel(4), data: forecast?.forecast?.day5 },
  ];

  /**
   * Find the best day from the visible forecast rows.
   * Scoring: sunshine (40%) + temperature (35%) + precipitation penalty (25%).
   *
   * TODO: heat-wave mode — during extreme heat, the "best" day is the coolest,
   * not the coldest overall (reverseMode='cold'). Would need a separate scoring
   * path that rewards temps below a threshold (e.g. <28°C) rather than just
   * inverting the scale. Skipped for now, revisit when heat-wave detection lands.
   */
  const findBestDay = () => {
    if (!forecast?.forecast) return null;
    const isColdMode = reverseMode === 'cold';

    const days = forecastRows.filter(d => d.data);
    if (days.length === 0) return null;

    const scored = days.map(day => {
      const temp = day.data.high ?? day.data.temp ?? 0;
      const precipMm = day.data.precipitation ?? 0;
      const sunshine = day.data.sunshine_duration ?? 0; // seconds from Open-Meteo

      const tempNormalized = isColdMode
        ? Math.max(0, Math.min(100, ((35 - temp) / 55) * 100))
        : Math.max(0, Math.min(100, ((temp + 20) / 55) * 100));

      // Normalize sunshine: 0–14h (50400s) → 0–100
      const sunScore = Math.min(100, (sunshine / 50400) * 100);

      // Precipitation penalty: 0mm=100, 10mm=50, 20mm=0
      const precipScore = Math.max(0, 100 - precipMm * 5);

      const score = sunScore * 0.40 + tempNormalized * 0.35 + precipScore * 0.25;
      return { ...day, score, temp, condition: day.data.condition };
    });

    return scored.reduce((a, b) => a.score >= b.score ? a : b);
  };

  const bestDay = findBestDay();

  // Hero card: first forecast slot = the selected day
  const selectedDayData = forecast?.forecast?.today;
  const heroTemp = selectedDayData?.high ?? forecast.temperature;
  const heroCondition = selectedDayData?.condition ?? forecast.condition;
  const heroDescription = selectedDayData?.description ?? forecast.description;

  // Check if we need dark text (for cold/light backgrounds like snow or sunny+freezing)
  const needsDarkText = () => {
    const condition = heroCondition?.toLowerCase() || '';
    const temp = heroTemp;
    
    // Snow/ice conditions always need dark text
    if (condition.includes('snow') || condition.includes('ice') || condition.includes('freezing')) {
      return true;
    }
    
    // Sunny but freezing (< 0 °C) also uses light blue background → dark text
    if (condition === 'sunny' && temp !== null && temp !== undefined && temp < 0) {
      return true;
    }
    
    return false;
  };

  const activeHeroMeta =
    heroList.length > 0
      ? (heroList[heroIndex] ?? heroMeta)
      : heroMeta;

  const cycleHero = (delta, method = 'button') => {
    if (heroList.length < 2) return;
    const next = (heroIndex + delta + heroList.length) % heroList.length;
    // Promote the currently shown image to base so the next one cross-fades over it
    const current = heroList[heroIndex] ?? heroMeta;
    if (current) setHeroBase(current);
    startHeroFade(heroList[next]?.url);
    setHeroIndex(next);
    mixpanel.track('Hero Browsed', {
      place_id: effectivePlaceId,
      place_name: destination.name,
      direction: delta > 0 ? 'next' : 'prev',
      method,
      ...getHeroTrackingProps(heroList[next]),
    });
  };

  // Resolved hero (fades in over the base). Null while the lookup is pending.
  const heroSource = activeHeroMeta
    ? (activeHeroMeta.url && activeHeroMeta.url !== DEFAULT_HERO_IMAGE_URL
        ? { uri: activeHeroMeta.url }
        : getHeroImage(destination))
    : null;
  // Base layer: last hero shown for this place (rotation and timeout-fallback
  // cross-fade from it), otherwise the local generic. Blur it only while nothing
  // has been shown for this place yet (loading placeholder).
  const heroBaseSource = heroBase?.url && heroBase.url !== DEFAULT_HERO_IMAGE_URL
    ? { uri: heroBase.url }
    : getHeroImage(destination);
  const heroBaseBlurred = !heroBase;
  const hasHero = !!(heroSource || heroBaseSource);
  const useDarkText = !hasHero && needsDarkText();
  const textColor = useDarkText ? '#2b3e50' : '#fff';
  const subtitleColor = useDarkText ? '#3a4f5d' : '#fff';

  // Date label for hero card (always shown so the pill is tappable)
  const formatDateLabel = (offset) => {
    if (offset === 0) return t('destination.today');
    if (offset === 1) return t('destination.tomorrow');
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toLocaleDateString(dateLocale, { weekday: 'short', day: 'numeric', month: 'short' });
  };
  const heroDateLabel = formatDateLabel(dateOffset);

  return (
    <View style={{ flex: 1 }}>
    <ScrollView
      style={[styles.container, { backgroundColor: theme.background }]}
      showsVerticalScrollIndicator={false}
      showsHorizontalScrollIndicator={false}
      ref={scrollViewRef}
    >
      <View style={{ position: 'relative', minHeight: 500 }}>
      {hasHero && (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 500, overflow: 'hidden' }}>
          {heroBaseSource && (
            <Animated.Image
              source={heroBaseSource}
              blurRadius={heroBaseBlurred ? 12 : 0}
              style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, transform: [{ scale: heroScaleAnim }] }}
              resizeMode="cover"
            />
          )}
          {heroSource && (
            <Animated.Image
              source={heroSource}
              style={{ width: '100%', height: '100%', top: 0, opacity: heroFadeAnim, transform: [{ scale: heroScaleAnim }] }}
              resizeMode="cover"
            />
          )}
          <LinearGradient
            colors={['rgba(0,0,0,0.28)', 'transparent']}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '40%', zIndex: 1 }}
            pointerEvents="none"
          />
          <LinearGradient
            colors={['rgba(0,0,0,0.0)', 'rgba(0,0,0,0.08)', 'rgba(0,0,0,0.35)']}
            locations={[0, 0.5, 1]}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
            pointerEvents="none"
          />
          <LinearGradient
            colors={['transparent', 'rgba(235,242,255,1)']}
            style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 80 }}
            pointerEvents="none"
          />
          <Animated.View
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.10)', opacity: vignetteAnim }}
            pointerEvents="none"
          />
        </View>
      )}
      {hasHero && (
        <>
          {uiFocused && heroList.length > 1 && (
            <View style={styles.heroDotsRow} pointerEvents="none">
              {heroList.map((h, i) => (
                <View
                  key={h.url ?? i}
                  style={[styles.heroDot, i === heroIndex && styles.heroDotActive]}
                />
              ))}
            </View>
          )}
          {heroHintVisible && (
            <Animated.View style={[styles.heroExpandTooltip, { opacity: heroHintAnim }]} pointerEvents="none">
              <Text style={styles.heroExpandTooltipText}>View photo</Text>
            </Animated.View>
          )}
          <Animated.View style={[styles.heroExpandButtonOuter, { transform: [{ scale: pulseAnim }] }]}>
            <Pressable
              onPress={toggleUiFocus}
              onLongPress={__DEV__ ? resetHeroDiscoveryHints : undefined}
              style={styles.heroExpandButton}
              hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
            >
              <MaterialIcons
                name={uiFocused ? 'fullscreen-exit' : 'fullscreen'}
                size={17}
                color="rgba(255, 255, 255, 0.95)"
              />
            </Pressable>
          </Animated.View>
          {heroList.length > 1 && (uiFocused || (__DEV__ && devHeroNavVisible)) && (
            <>
              <Pressable
                onPress={() => cycleHero(-1, 'button')}
                style={styles.heroChevronLeft}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <MaterialIcons name="chevron-left" size={22} color="rgba(255, 255, 255, 0.95)" />
              </Pressable>
              <Pressable
                onPress={() => cycleHero(1, 'button')}
                style={styles.heroChevronRight}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <MaterialIcons name="chevron-right" size={22} color="rgba(255, 255, 255, 0.95)" />
              </Pressable>
            </>
          )}
          {__DEV__ && heroList.length > 1 && (
              <Pressable
                onPress={toggleDevHeroNav}
                style={styles.devHeroCounter}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                {devHeroNavVisible ? (
                  <View style={styles.devHeroCounterPill}>
                    <Text style={styles.devHeroCounterText}>
                      {heroIndex + 1} / {heroList.length}
                    </Text>
                    <MaterialIcons name="visibility-off" size={13} color="rgba(255, 255, 255, 0.75)" />
                  </View>
                ) : (
                  <View style={styles.devHeroCounterPill}>
                    <MaterialIcons name="visibility" size={14} color="rgba(255, 255, 255, 0.92)" />
                  </View>
                )}
              </Pressable>
          )}
        </>
      )}
      <View style={styles.heroContent}>
      <View style={[styles.header, { backgroundColor: hasHero ? 'transparent' : getWeatherColor(heroCondition, heroTemp) }]}>
  <View style={styles.headerTop}>
    <View style={styles.headerNameContainer}>
      {(() => {
        const name = forecast.name || '';
        const len = name.length;
        const nameFontSize = len > 18 ? 20 : len > 14 ? 24 : len > 10 ? 28 : 34;
        return (
          <View style={{ position: 'relative', alignSelf: 'flex-start' }}>
            <Text
              style={[styles.headerTitle, {
                color: textColor,
                fontSize: nameFontSize,
              }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.45}
              onTextLayout={(e) => {
                const lines = e.nativeEvent.lines;
                if (lines && lines.length > 0) {
                  setFirstLineW(lines[0].width);
                }
              }}
            >
              {name}
            </Text>
            {hasHero && firstLineW != null && (
              <Pressable
                onPress={!favouriteLoading ? handleToggleFavourite : undefined}
                hitSlop={{ top: 12, bottom: 12, left: 10, right: 10 }}
                style={{
                  position: 'absolute',
                  left: firstLineW + 4,
                  top: 2,
                }}
              >
                <Animated.Text
                  style={{
                    fontSize: Math.round(nameFontSize * 0.6),
                    color: favStarColor,
                    textShadowColor: 'rgba(0, 0, 0, 0.15)',
                    textShadowOffset: { width: 0, height: 0.5 },
                    textShadowRadius: 1,
                  }}
                >
                  {isFavourite ? '★' : '☆'}
                </Animated.Text>
              </Pressable>
            )}
          </View>
        );
      })()}
      {(forecast.countryCode || forecast.country_code) && (() => {
        const cc = (forecast.countryCode || forecast.country_code).toUpperCase();
        const stateName = forecast.state_name || destination.state_name;
        const showState = stateName && stateName !== cc;
        return (
          <>
            <Text style={[styles.headerCountry, { color: subtitleColor }]}>
              {cc}{showState ? `, ${stateName}` : ''}
              {(forecast?.elevation || destination.elevation || 0) > 500 ? ` · ${forecast?.elevation || destination.elevation}m` : ''}
            </Text>
            <Text style={[styles.headerConditionText, { color: subtitleColor }]}>{translateCondition(heroDescription)}</Text>
          </>
        );
      })()}
    </View>
    <View style={styles.headerTempRow}>
      <Text style={styles.headerWeatherIcon}>{getWeatherIcon(heroCondition)}</Text>
      <Text style={[styles.headerTemp, { color: textColor }]}>{heroTemp != null ? formatTemperature(heroTemp, temperatureUnit) : '?°'}</Text>
    </View>
  </View>
  
  {!uiFocused && (
  <View style={styles.headerPillRow}>
    <TouchableOpacity
      style={styles.stopStayPill}
      activeOpacity={0.7}
      onPress={() => {
        mixpanel.track('Stop Stay Tapped', { place_id: effectivePlaceId, place_name: destination.name });
        scrollViewRef.current?.scrollTo({ y: stopStayCardY.current, animated: true });
      }}
    >
      <Text style={styles.stopStayText}>{t('destination.stopStay')}</Text>
    </TouchableOpacity>
  </View>
  )}
  {!uiFocused && (
  <View style={[styles.headerPillRow, { marginTop: 0 }]}>
    <View style={styles.dateDropdownAnchor}>
      <TouchableOpacity
        style={styles.heroDateBadge}
        activeOpacity={0.7}
        onPress={() => setDatePickerVisible((v) => !v)}
      >
        <Text style={styles.heroDateBadgeText}>{heroDateLabel}  ▾</Text>
      </TouchableOpacity>
    {datePickerVisible && (
      <View style={styles.dateDropdown}>
        {[
          { label: t('destination.today'), offset: 0 },
          { label: '+1', offset: 1 },
          { label: '+3', offset: 3 },
          { label: '+5', offset: 5 },
          { label: '+7', offset: 7 },
          { label: '+10', offset: 10 },
        ].map((opt) => (
          <TouchableOpacity
            key={opt.offset}
            style={[
              styles.dateDropdownBtn,
              dateOffset === opt.offset && styles.dateDropdownBtnActive,
            ]}
            activeOpacity={0.7}
            onPress={() => {
              setDateOffset(opt.offset);
              setDatePickerVisible(false);
              mixpanel.track('Date Changed', {
                place_id: effectivePlaceId,
                place_name: destination.name,
                date_offset: opt.offset,
              });
            }}
          >
            <Text style={[
              styles.dateDropdownBtnText,
              dateOffset === opt.offset && styles.dateDropdownBtnTextActive,
            ]}>
              {opt.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    )}
    </View>
  </View>
  )}

</View>

  {!uiFocused && readyForDetails && localBadges && localBadges.length > 0 && (
        <View style={styles.heroBadges}>
            {filterWarmDryIfHeatwave(localBadges, badgeSource._heatwaveData?.shouldAward)
              .sort((a, b) => (BadgeMetadata[a]?.priority || 99) - (BadgeMetadata[b]?.priority || 99))
              .map((badge, index) => {
              const metadata = BadgeMetadata[badge];
              const worthData = badgeSource._worthTheDriveData;
              const worthBudgetData = badgeSource._worthTheDriveBudgetData;
              const warmDryData = badgeSource._warmAndDryData;
              const beachData = badgeSource._beachParadiseData;
              const sunnyStreakData = badgeSource._sunnyStreakData;
              const miracleData = badgeSource._weatherMiracleData;
              const heatwaveData = badgeSource._heatwaveData;
              const snowKingData = badgeSource._snowKingData;
              const rainyDaysData = badgeSource._rainyDaysData;
              const weatherCurseData = badgeSource._weatherCurseData;
              const springAwakeningData = badgeSource._springAwakeningData;
              
              // Determine which badge type
              const isWorthTheDrive = badge === 'WORTH_THE_DRIVE';
              const isWorthTheDriveBudget = badge === 'WORTH_THE_DRIVE_BUDGET';
              const isWarmAndDry = badge === 'WARM_AND_DRY';
              const isBeachParadise = badge === 'BEACH_PARADISE';
              const isSunnyStreak = badge === 'SUNNY_STREAK';
              const isWeatherMiracle = badge === 'WEATHER_MIRACLE';
              const isHeatwave = badge === 'HEATWAVE';
              const isSnowKing = badge === 'SNOW_KING';
              const isRainyDays = badge === 'RAINY_DAYS';
              const isWeatherCurse = badge === 'WEATHER_CURSE';
              const isSpringAwakening = badge === 'SPRING_AWAKENING';
              
              // Get summary text for collapsed state
              const getSummaryText = () => {
                if (isWorthTheDrive && worthData) {
                  return t('badges.worththedriveSummary', { tempDelta: fmtTempDelta(worthData.tempDelta), distance: fmtDist(worthData.roadDistanceKm ?? destination.distance) });
                }
                if (isWorthTheDriveBudget && worthBudgetData) {
                  return t('badges.worththedrivebudgetSummary', { tempDelta: fmtTempDelta(worthBudgetData.tempDelta), distance: fmtDist(worthBudgetData.roadDistanceKm ?? destination.distance) });
                }
                if (isWarmAndDry && warmDryData) {
                  return t('badges.warmanddrySummary', { temp: fmtTemp(warmDryData.temp), condition: translateCondition(warmDryData.condition) });
                }
                if (isBeachParadise && beachData) {
                  return t('badges.beachparadiseSummary', { temp: fmtTemp(beachData.temp), condition: translateCondition(beachData.condition) });
                }
                if (isSunnyStreak) {
                  const days = sunnyStreakData?.streakLength ?? getDisplaySunnyStreak(destination);
                  const avg = sunnyStreakData?.avgTemp ?? destination.temperature;
                  return t('badges.sunnystreakSummary', { days, avgTemp: fmtTemp(avg) });
                }
                if (isWeatherMiracle && miracleData) {
                  return t('badges.weathermiracleSummary', { tempGain: fmtTempDelta(miracleData.tempGain) });
                }
                if (isHeatwave && heatwaveData) {
                  return t('badges.heatwaveSummary', { days: heatwaveData.hotDays, avgTemp: fmtTemp(heatwaveData.avgTemp) });
                }
                if (isSnowKing && snowKingData) {
                  return t('badges.snowkingSummary', { snowDays: getDisplaySnowDays(destination), snowfall: Math.round((snowKingData.totalSnowfall || 0) / 10) });
                }
                if (isRainyDays && rainyDaysData) {
                  return t('badges.rainydaysSummary', { rainyDays: getDisplayRainyDays(destination) });
                }
                if (isWeatherCurse && weatherCurseData) {
                  return t('badges.weathercurseSummary', { tempLoss: fmtTempDelta(-Math.abs(weatherCurseData.tempLoss)) });
                }
                if (isSpringAwakening && springAwakeningData) {
                  return t('badges.springawakeningSummary', { temp: fmtTemp(springAwakeningData.tempDest), condition: translateCondition('sunny') });
                }
                return t('badges.tapForDetails');
              };
              
              const isExpanded = expandedBadges[badge] || false;

              return (
                <AnimatedBadgeCard
                  key={index}
                  index={index}
                  destination={destination}
                  badge={badge}
                  isExpanded={isExpanded}
                  onToggle={() => {
                    const expanding = !expandedBadges[badge];
                    setExpandedBadges(prev => ({ ...prev, [badge]: expanding }));
                    if (expanding) {
                      mixpanel.track('Badge Expanded', {
                        place_id: effectivePlaceId,
                        place_name: destination.name,
                        badge,
                      });
                    }
                  }}
                  theme={theme}
                  overHero
                >
                      <View style={[styles.badgeIconContainer, { backgroundColor: metadata.color }]}>
                        {typeof metadata.icon === 'string' ? (
                          <Text style={styles.badgeCardIcon}>{metadata.icon}</Text>
                        ) : (
                          <Image source={metadata.icon} style={{ width: 44, height: 44, resizeMode: 'cover', borderRadius: 22 }} />
                        )}
                      </View>
                      <View style={styles.badgeContent}>
                        <Text style={[styles.badgeName, { color: theme.text }]}>
                          {t(`badges.${badge.toLowerCase().replace(/_/g, '')}`)}
                        </Text>
                        
                        {/* Collapsed: Show summary */}
                        {!isExpanded && (
                          <Text style={[styles.badgeSummary, { color: theme.textSecondary }]}>
                            {getSummaryText()}
                          </Text>
                        )}
                        
                        {/* Expanded: Show description and details */}
                        {isExpanded && (
                          <>
                            <Text style={[styles.badgeDescription, { color: theme.textSecondary }]}>
                              {isSunnyStreak
                                ? t('badges.sunnystreakDescription', { count: sunnyStreakData?.streakLength ?? getDisplaySunnyStreak(destination) })
                                : isHeatwave && heatwaveData
                                ? t('badges.heatwaveDescription', { count: heatwaveData.hotDays, heatThreshold: fmtTemp(34) })
                                : (isWorthTheDrive || isWorthTheDriveBudget) && reverseMode === 'cold'
                                ? t(`badges.${badge.toLowerCase().replace(/_/g, '')}DescriptionCold`)
                                : t(`badges.${badge.toLowerCase().replace(/_/g, '')}Description`)}
                            </Text>
                            
                            {/* Worth the Drive stats */}
                            {isWorthTheDrive && worthData && (
                        <View style={styles.badgeStats}>
                          <Text style={[styles.badgeStat, { color: '#D65A2E' }]}>
                            🌡️ {t('badges.temperature')}: {fmtTemp(worthData.tempOrigin)} → {fmtTemp(worthData.tempDest)} ({fmtTempDelta(worthData.tempDelta)})
                          </Text>
                          <Text style={[styles.badgeStat, { color: theme.primary }]}>
                            💨 ETA: {formatETA(worthData.eta)} ({fmtDist(worthData.roadDistanceKm ?? destination.distance)})
                          </Text>
                        </View>
                      )}
                      
                      {/* Worth the Drive Budget stats */}
                      {isWorthTheDriveBudget && worthBudgetData && (
                        <View style={styles.badgeStats}>
                          <Text style={[styles.badgeStat, { color: '#D65A2E' }]}>
                            🌡️ {t('badges.temperature')}: {fmtTemp(worthBudgetData.tempOrigin)} → {fmtTemp(worthBudgetData.tempDest)} ({fmtTempDelta(worthBudgetData.tempDelta)})
                          </Text>
                          <Text style={[styles.badgeStat, { color: theme.primary }]}>
                            💨 ETA: {formatETA(worthBudgetData.eta)} ({fmtDist(worthBudgetData.roadDistanceKm ?? destination.distance)})
                          </Text>
                        </View>
                      )}
                      
                      {/* Warm & Dry stats */}
                      {isWarmAndDry && warmDryData && (
                        <View style={styles.badgeStats}>
                          <Text style={[styles.badgeStat, { color: '#D65A2E' }]}>
                            🌡️ {t('badges.temperature')}: {fmtTemp(warmDryData.temp)}{warmDryData.tempRank && warmDryData.tempRank < 999 ? ` (${t('badges.rank')} #${warmDryData.tempRank})` : ''}
                          </Text>
                          <Text style={[styles.badgeStat, { color: theme.primary }]}>
                            ☀️ {t('badges.conditions')}: {translateCondition(warmDryData.condition)}
                          </Text>
                          <Text style={[styles.badgeStat, { color: theme.primary }]}>
                            💨 {t(getWindDescriptionKey(warmDryData.windSpeed))}
                          </Text>
                        </View>
                      )}
                      
                      {/* Beach Paradise stats */}
                      {isBeachParadise && beachData && (
                        <View style={styles.badgeStats}>
                          <Text style={[styles.badgeStat, { color: '#D65A2E' }]}>
                            🌡️ {t('badges.temperature')}: {fmtTemp(beachData.temp)}
                          </Text>
                          <Text style={[styles.badgeStat, { color: theme.primary }]}>
                            ☀️ {translateCondition(beachData.condition)}
                          </Text>
                          <Text style={[styles.badgeStat, { color: theme.primary }]}>
                            💨 {t(getWindDescriptionKey(beachData.windSpeed))}
                          </Text>
                        </View>
                      )}
                      
                      {/* Sunny Streak stats */}
                      {isSunnyStreak && (
                        <View style={styles.badgeStats}>
                          <Text style={[styles.badgeStat, { color: metadata.color }]}>
                            ☀️ {t('badges.sunshineStreak', { count: sunnyStreakData?.streakLength ?? getDisplaySunnyStreak(destination) })}
                          </Text>
                          <Text style={[styles.badgeStat, { color: theme.primary }]}>
                            🌡️ Ø {fmtTemp(sunnyStreakData?.avgTemp ?? destination.temperature ?? 0)}
                          </Text>
                        </View>
                      )}
                      
                      {/* Weather Miracle stats */}
                      {isWeatherMiracle && miracleData && (
                        <View style={styles.badgeStats}>
                          <Text style={[styles.badgeStat, { color: '#D65A2E' }]}>
                            {t('badges.miracleDetail', { todayTemp: fmtTemp(miracleData.todayTemp), futureTemp: fmtTemp(miracleData.futureTempMax), gain: fmtTempDelta(miracleData.tempGain) })}
                          </Text>
                          <Text style={[styles.badgeStat, { color: theme.primary }]}>
                            ☀️ {translateCondition(miracleData.todayCondition)} → {translateCondition(miracleData.futureCondition)}
                          </Text>
                        </View>
                      )}
                      
                      {/* Heatwave stats */}
                      {isHeatwave && heatwaveData && (
                        <View style={styles.badgeStats}>
                          <Text style={[styles.badgeStat, { color: metadata.color }]}>
                            🔥 {t('badges.heatwaveDays', { count: heatwaveData.hotDays })}
                          </Text>
                          <Text style={[styles.badgeStat, { color: '#D65A2E' }]}>
                            🌡️ Ø {fmtTemp(heatwaveData.avgTemp)} (Max {fmtTemp(heatwaveData.maxTemp)})
                          </Text>
                        </View>
                      )}
                      
                      {/* Snow King stats */}
                      {isSnowKing && snowKingData && (
                        <View style={styles.badgeStats}>
                          <Text style={[styles.badgeStat, { color: metadata.color }]}>
                            ❄️ {t('badges.snowDaysCount', { count: getDisplaySnowDays(destination) })}
                          </Text>
                          <Text style={[styles.badgeStat, { color: theme.primary }]}>
                            📊 {t('badges.totalSnowfall', { amount: Math.round((snowKingData.totalSnowfall || 0) / 10) })}
                          </Text>
                          <Text style={[styles.badgeStat, { color: '#D65A2E' }]}>
                            🌡️ Ø {fmtTemp(snowKingData.avgTemp)}
                          </Text>
                        </View>
                      )}
                      
                      {/* Rainy Days stats */}
                      {isRainyDays && rainyDaysData && (
                        <View style={styles.badgeStats}>
                          <Text style={[styles.badgeStat, { color: theme.primary }]}>
                            🌧️ {t('badges.rainyDaysCount', { count: getDisplayRainyDays(destination) })}
                          </Text>
                          <Text style={[styles.badgeStat, { color: '#D65A2E' }]}>
                            💧 {t('badges.heavyRain')}: {rainyDaysData.hasHeavyRain ? t('badges.heavyRainYes') : t('badges.heavyRainNo')}
                          </Text>
                        </View>
                      )}
                      
                      {/* Weather Curse stats */}
                      {isWeatherCurse && weatherCurseData && (
                        <View style={styles.badgeStats}>
                          <Text style={[styles.badgeStat, { color: '#4CAF50' }]}>
                            {t('badges.curseToday', { temp: fmtTemp(weatherCurseData.todayTemp), condition: translateCondition(weatherCurseData.todayCondition) })}
                          </Text>
                          <Text style={[styles.badgeStat, { color: '#D65A2E' }]}>
                            {t('badges.curseSoon', { temp: fmtTemp(weatherCurseData.futureTempMin), condition: translateCondition(weatherCurseData.futureCondition) })}
                          </Text>
                        </View>
                      )}
                      
                      {/* Spring Awakening stats */}
                      {isSpringAwakening && springAwakeningData && (
                        <View style={styles.badgeStats}>
                          <Text style={[styles.badgeStat, { color: '#D65A2E' }]}>
                            🌡️ {t('badges.temperature')}: {fmtTemp(springAwakeningData.tempDest)}
                          </Text>
                          <Text style={[styles.badgeStat, { color: theme.primary }]}>
                            ☀️ {translateCondition('sunny')} · 💨 ≤ 20 km/h
                          </Text>
                        </View>
                      )}
                          </>
                        )}
                      </View>
                </AnimatedBadgeCard>
              );
            })}
        </View>
      )}

      {!uiFocused && (
        <View style={styles.heroFooter}>
          <View style={[styles.mainInfo, {
            backgroundColor: theme.surface,
            shadowColor: theme.shadow,
            marginBottom: 10,
          }]}>
            <View style={[styles.statsContainer, { borderTopColor: theme.border }]}>
              <View style={styles.statItem}>
                <Text style={[styles.statLabel, { color: theme.textSecondary }]}>{t('destination.sun')}</Text>
                <Text style={[styles.statValue, { color: theme.text }]}>{getSunshineHours()} {t('destination.hoursShort')}</Text>
              </View>
              <View style={styles.statItem}>
                <Text style={[styles.statLabel, { color: theme.textSecondary }]}>{t('destination.humidity')}</Text>
                <Text style={[styles.statValue, { color: theme.text }]}>{forecast.humidity || 0}%</Text>
              </View>
              <View style={styles.statItem}>
                <Text style={[styles.statLabel, { color: theme.textSecondary }]}>{t('destination.wind')}</Text>
                <Text style={[styles.statValue, { color: theme.text }]}>{t(getWindDescriptionKey(forecast.windSpeed))}</Text>
              </View>
            </View>
          </View>
          <TouchableOpacity
            style={[styles.driveButtonTop, {
              backgroundColor: theme.primary,
              shadowColor: theme.primary
            }]}
            onPress={handleDriveThere}
          >
            <Text style={styles.driveButtonTopText}>{t('destination.driveThere')}</Text>
          </TouchableOpacity>
        </View>
      )}

      </View>

      </View>



      {readyForDetails && (
      <View style={{ padding: 20, paddingTop: 0, marginTop: -22 }}>
        <View style={[styles.forecastSection, {
          backgroundColor: theme.surface,
          shadowColor: theme.shadow
        }]}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>{t('destination.forecast')}</Text>
          
          {/* Best Day Highlight */}
          {bestDay && (
            <View style={[styles.bestDayContainer, { backgroundColor: 'rgba(245, 240, 230, 0.8)', borderColor: 'rgba(180, 160, 120, 0.3)' }]}>
              <Text style={styles.bestDayIcon}>✦</Text>
              <View style={styles.bestDayContent}>
                <Text style={styles.bestDayLabel}>
                  {reverseMode === 'cold' ? t('badges.coolestDay') : t('badges.warmestDay')}
                </Text>
                <Text style={styles.bestDayValue}>
                  {bestDay.label} ({formatTemperature(bestDay.temp, temperatureUnit)}, {translateCondition(bestDay.condition)})
                </Text>
              </View>
              <Text style={styles.bestDayWeatherIcon}>{getWeatherIcon(bestDay.condition)}</Text>
            </View>
          )}
          
          {forecastRows.map((day, index) => {
            const isBestDay = bestDay && day.key === bestDay.key;
            const isLast = index === forecastRows.length - 1;
            const hasData = day.data != null;
            return (
              <View
                key={day.key}
                style={[
                  styles.forecastItem,
                  { borderBottomColor: isLast ? 'transparent' : theme.background },
                  isBestDay && styles.forecastItemSelected,
                  !hasData && { opacity: 0.4 },
                ]}
              >
                <Text style={[styles.forecastDay, { color: isBestDay ? '#7A6B55' : theme.text }]}>
                  {day.label}
                </Text>
                <View style={styles.forecastIconWrap}>
                  <Text style={styles.forecastIcon}>{hasData ? getWeatherIcon(day.data.condition) : '—'}</Text>
                </View>
                <Text style={[styles.forecastTemp, { color: isBestDay ? '#7A6B55' : theme.textSecondary, fontWeight: isBestDay ? '600' : '500' }]}>
                  {hasData ? `${formatTemperature(day.data.high, temperatureUnit, false)}\u00A0/\u00A0${formatTemperature(day.data.low, temperatureUnit)}` : '—'}
                </Text>
              </View>
            );
          })}
        </View>

        {/* Stop & Stay Card */}
        <View onLayout={(e) => { stopStayCardY.current = e.nativeEvent.layout.y; }}>
          <StopStayCard 
            destination={destination} 
            lang={i18n.language} 
          />
        </View>

        <View style={styles.actionsContainer}>
          <TouchableOpacity
            style={[styles.favouriteButton, {
              backgroundColor: isFavourite ? theme.primary : theme.surface,
              borderColor: theme.primary
            }]}
            onPress={handleToggleFavourite}
            disabled={favouriteLoading}
          >
            {favouriteLoading ? (
              <ActivityIndicator size="small" color={isFavourite ? '#fff' : theme.primary} />
            ) : (
              <Text style={[styles.favouriteButtonText, { color: isFavourite ? '#fff' : theme.primary }]}>
                {isFavourite ? '⭐' : '☆'}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
      )}
    </ScrollView>
    {favToast && (
      <Animated.View style={[styles.favToast, { opacity: toastOpacityAnim, transform: [{ scale: toastScaleAnim }] }]} pointerEvents="none">
        <Text style={styles.favToastText}>{favToast}</Text>
      </Animated.View>
    )}

    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 20,
    fontWeight: '500',
  },
  errorIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  errorTitle: {
    fontSize: 26,
    fontWeight: '600',
    marginBottom: 12,
  },
  errorMessage: {
    fontSize: 20,
    textAlign: 'center',
    marginBottom: 24,
    paddingHorizontal: 20,
  },
  retryButton: {
    paddingVertical: 18,
    paddingHorizontal: 40,
    minHeight: 64,
    borderRadius: 12,
    marginBottom: 16,
    justifyContent: 'center',
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '600',
  },
  heroDateBadge: {
    backgroundColor: 'rgba(185, 110, 48, 0.92)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 14,
    height: 27,
    justifyContent: 'center',
  },
  heroDateBadgeText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },

  header: {
    padding: 20,
    paddingTop: 28,
    paddingBottom: 0,
    position: 'relative',
  },
  heroContent: {
    minHeight: 500,
    flexDirection: 'column',
    zIndex: 1,
  },
  heroBadges: {
    paddingHorizontal: 20,
    marginTop: 8,
  },
  heroFooter: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
    marginTop: 'auto',
  },

  headerTempRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerWeatherIcon: {
    fontSize: 28,
    marginRight: 4,
    textShadowColor: 'rgba(0, 0, 0, 0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
    zIndex: 1,
  },
  headerNameContainer: {
    flexShrink: 1,
    maxWidth: '65%',
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '600',
    lineHeight: 34,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },
  headerCountry: {
    fontSize: 15,
    fontWeight: '500',
    marginTop: 2,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },
  headerConditionText: {
    fontSize: 14,
    fontWeight: '400',
    marginTop: 6,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  headerTemp: {
    fontSize: 36,
    fontWeight: '300',
    letterSpacing: -1,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  headerSubtitle: {
    fontSize: 16,
    fontWeight: '500',
    zIndex: 1,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  mainInfo: {
    borderRadius: 14,
    padding: 14,
    zIndex: 1,
    marginBottom: 10,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingTop: 0,
  },
  statItem: {
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.3,
    textTransform: 'capitalize',
    marginBottom: 4,
    opacity: 0.6,
  },
  statValue: {
    fontSize: 18,
    fontWeight: '500',
  },
  forecastSection: {
    borderRadius: 14,
    padding: 16,
    marginBottom: 20,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  badgeCard: {
    flexDirection: 'row',
    padding: 14,
    borderRadius: 12,
    marginBottom: 5,
  },
  badgeIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
    opacity: 0.85,
  },
  badgeCardIcon: {
    fontSize: 24,
  },
  badgeContent: {
    flex: 1,
  },
  badgeName: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 4,
  },
  badgeDescription: {
    fontSize: 14,
    marginBottom: 8,
  },
  badgeStats: {
    marginTop: 4,
  },
  badgeStat: {
    fontSize: 14,
    fontWeight: '500',
    marginTop: 4,
  },
  badgeSummary: {
    fontSize: 15,
    fontWeight: '500',
    marginTop: 2,
  },
  badgeExpandIndicator: {
    fontSize: 12,
    position: 'absolute',
    right: 16,
    top: 20,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '500',
    marginBottom: 10,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    opacity: 0.7,
  },
  driveButtonTop: {
    paddingVertical: 13,
    paddingHorizontal: 32,
    minHeight: 56,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.14,
    shadowRadius: 6,
    elevation: 4,
  },
  driveButtonTopText: {
    fontSize: 20,
    fontWeight: '600',
    color: '#fff',
    letterSpacing: 0.3,
  },
  bestDayContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 12,
  },
  bestDayIcon: {
    fontSize: 16,
    marginRight: 8,
    opacity: 0.7,
  },
  bestDayContent: {
    flex: 1,
  },
  bestDayLabel: {
    fontSize: 11,
    fontWeight: '500',
    color: '#8B7355',
    marginBottom: 1,
    letterSpacing: 0.2,
  },
  bestDayValue: {
    fontSize: 14,
    fontWeight: '500',
    color: '#5D4F45',
  },
  bestDayWeatherIcon: {
    fontSize: 22,
    marginLeft: 6,
    opacity: 0.8,
  },
  forecastItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 0,
    borderBottomWidth: 1,
  },
  forecastItemSelected: {
    backgroundColor: 'rgba(160, 140, 110, 0.07)',
    borderRadius: 8,
    borderLeftWidth: 1.5,
    borderLeftColor: 'rgba(160, 130, 75, 0.35)',
    paddingLeft: 6,
  },
  forecastDay: {
    fontSize: 16,
    fontWeight: '500',
    flex: 1,
  },
  forecastIconWrap: {
    width: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  forecastIcon: {
    fontSize: 24,
  },
  forecastTemp: {
    fontSize: 16,
    fontWeight: '500',
    width: 110,
    textAlign: 'right',
  },
  actionsContainer: {
    gap: 12,
    marginTop: 24,
    marginBottom: 30,
  },
  favToast: {
    position: 'absolute',
    top: '58%',
    alignSelf: 'center',
    backgroundColor: 'rgba(50, 50, 52, 0.72)',
    paddingHorizontal: 19,
    paddingVertical: 9,
    borderRadius: 15,
  },
  favToastText: {
    color: 'rgba(255, 255, 255, 0.82)',
    fontSize: 15,
    fontWeight: '400',
    letterSpacing: 0.1,
  },
  heroExpandButtonOuter: {
    position: 'absolute',
    top: 7,
    right: 12,
    zIndex: 10,
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  heroExpandButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(0, 0, 0, 0.38)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 0.75,
    borderColor: 'rgba(255, 255, 255, 0.28)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
  },
  heroExpandTooltip: {
    position: 'absolute',
    top: 12,
    right: 50,
    zIndex: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.52)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.18)',
  },
  heroExpandTooltipText: {
    color: 'rgba(255, 255, 255, 0.9)',
    fontSize: 12,
    fontWeight: '500',
  },
  heroDotsRow: {
    position: 'absolute',
    top: 396,
    left: 0,
    right: 0,
    zIndex: 10,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 7,
  },
  heroDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.45)',
  },
  heroDotActive: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
  },
  heroChevronLeft: {
    position: 'absolute',
    left: 8,
    top: '50%',
    marginTop: -15,
    zIndex: 11,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(0, 0, 0, 0.38)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 0.75,
    borderColor: 'rgba(255, 255, 255, 0.28)',
  },
  heroChevronRight: {
    position: 'absolute',
    right: 8,
    top: '50%',
    marginTop: -15,
    zIndex: 11,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(0, 0, 0, 0.38)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 0.75,
    borderColor: 'rgba(255, 255, 255, 0.28)',
  },
  devHeroCounter: {
    position: 'absolute',
    top: 138,
    right: 16,
    zIndex: 11,
  },
  devHeroCounterPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  devHeroCounterText: {
    color: 'rgba(255, 255, 255, 0.92)',
    fontSize: 11,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  tapToShowPill: {
    position: 'absolute',
    top: 180,
    zIndex: 10,
    alignSelf: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
  },
  tapToShowText: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 12,
    fontWeight: '400',
  },
  headerPillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  stopStayPill: {
    backgroundColor: 'rgba(172, 100, 44, 0.72)',
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderRadius: 14,
    height: 27,
    justifyContent: 'center',
    shadowColor: '#7A4020',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 2,
  },
  stopStayText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  heroFavouriteButton: {
    marginLeft: 2,
    marginTop: 6,
    padding: 2,
  },
  favouriteButton: {
    paddingVertical: 16,
    paddingHorizontal: 24,
    minHeight: 56,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  favouriteButtonText: {
    fontSize: 24,
    fontWeight: '600',
  },
  driveButton: {
    paddingVertical: 16,
    paddingHorizontal: 24,
    minHeight: 56,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 5,
    elevation: 3,
  },
  driveButtonText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
  },

  dateDropdownAnchor: {
    zIndex: 20,
  },
  dateDropdown: {
    position: 'absolute',
    top: '100%',
    left: 0,
    flexDirection: 'row',
    marginTop: 4,
    gap: 3,
  },
  dateDropdownBtn: {
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: 7,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  dateDropdownBtnActive: {
    backgroundColor: 'rgba(185,110,48,0.92)',
  },
  dateDropdownBtnText: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
    fontWeight: '600',
  },
  dateDropdownBtnTextActive: {
    color: '#fff',
  },
});

export default DestinationDetailScreen;
