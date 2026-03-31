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
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../theme/ThemeProvider';
import { getWeatherIcon, getWeatherColor } from '../../usecases/weatherUsecases';
import { openInMaps, NavigationProvider } from '../../usecases/navigationUsecases';
import { getPlaceDetail } from '../../services/placesWeatherService';
import { supabase } from '../../config/supabase';
import { toggleFavourite, isDestinationFavourite } from '../../usecases/favouritesUsecases';
import { BadgeMetadata } from '../../domain/destinationBadge';
import { getCountryName } from '../../utils/countryNames';
import { useUnits } from '../../contexts/UnitContext';
import { formatTemperature, formatDistance, getTemperatureSymbol, getDistanceSymbol } from '../../utils/unitConversion';

import { LinearGradient } from 'expo-linear-gradient';
import { getHeroImage } from '../../utils/heroImages';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
// Must match calculateSunnyStreak: count sunny in first 5 slots (same as UI)
const getDisplaySunnyStreak = (dest) => {
  const arr = dest.forecastArray;
  if (arr?.length) {
    const slots = [arr[0], arr[1], arr[2], arr[3], arr[4]];
    return slots.filter(s => s?.condition === 'sunny').length;
  }
  const f = dest.forecast;
  const slots = [f?.today, f?.tomorrow, f?.day2, f?.day3, f?.day4];
  return slots.filter(s => s?.condition === 'sunny').length;
};

const AnimatedBadgeCard = ({ index, destination, badge, isExpanded, onToggle, theme, children }) => {
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
          { backgroundColor: theme.background },
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
  const { destination, dateOffset: initialDateOffset = 0, reverseMode = 'warm' } = route.params;
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
  const [firstLineW, setFirstLineW] = useState(null);
  const [heroHintVisible, setHeroHintVisible] = useState(false);
  const favOpacityAnim = React.useRef(new Animated.Value(1)).current;
  const favStarColor = favOpacityAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['#8E8E93', '#C9A84C'],
  });
  const toastOpacityAnim = React.useRef(new Animated.Value(0)).current;
  const toastScaleAnim = React.useRef(new Animated.Value(0.98)).current;
  const uiOpacityAnim = React.useRef(new Animated.Value(1)).current;
  const heroHintAnim = React.useRef(new Animated.Value(0)).current;

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
      
      // PRIORITY 0: No UUID? Try to resolve from DB by coordinates or name
      let resolvedId = effectivePlaceId;
      const isValidUUID = resolvedId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(resolvedId);
      if (!isValidUUID) {
        try {
          const lat = destination.lat ?? destination.latitude;
          const lon = destination.lon ?? destination.longitude;
          console.log('[resolvePlace] no UUID, trying lookup. lat:', lat, 'lon:', lon, 'name:', destination.name);
          // Try by coordinates (±0.05° ≈ 5.5km)
          if (lat != null && lon != null) {
            const { data, error } = await supabase
              .from('places')
              .select('id, name')
              .gte('latitude', lat - 0.05)
              .lte('latitude', lat + 0.05)
              .gte('longitude', lon - 0.05)
              .lte('longitude', lon + 0.05)
              .limit(1);
            console.log('[resolvePlace] coord result:', data, 'error:', error);
            if (data?.[0]?.id) resolvedId = data[0].id;
          }
          // Fallback: try by name (partial, case-insensitive)
          if (!(/^[0-9a-f]{8}-/i.test(resolvedId))) {
            const cleanName = (destination.name || '').replace(/^[📍⊕★]\s?/g, '').trim();
            console.log('[resolvePlace] coord miss, trying name:', cleanName);
            if (cleanName) {
              const { data, error } = await supabase
                .from('places')
                .select('id, name')
                .ilike('name', `%${cleanName}%`)
                .limit(1);
              console.log('[resolvePlace] name result:', data, 'error:', error);
              if (data?.[0]?.id) resolvedId = data[0].id;
            }
          }
          console.log('[resolvePlace] final resolvedId:', resolvedId);
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
          
          // Build 5 forecast slots starting from dateOffset
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
          // Fall through to destination.forecast or generated fallback
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

      // PRIORITY 2a: Build from forecastArray if forecast is incomplete (e.g. date offset > 5)
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
            };
          }
        });
        if (Object.keys(slots).length >= 2) {
          const day0 = destination.forecastArray[startIdx];
          setForecast({
            ...fallbackBase,
            temperature: day0?.high ?? day0?.temp ?? destination.temperature,
            condition: day0?.condition ?? destination.condition,
            forecast: slots,
          });
          setIsLoading(false);
          return;
        }
      }

      // PRIORITY 2b: Use inline forecast data from map
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
    loadForecast();
    checkFavouriteStatus();
  }, [destination.lat, destination.lon, dateOffset]);

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
    Animated.timing(uiOpacityAnim, {
      toValue: newFocused ? 0 : 1,
      duration: 150,
      useNativeDriver: true,
    }).start();
  }, [uiFocused, uiOpacityAnim]);

  // One-time hero hint (shows for 3s on first ever visit, then never again)
  useEffect(() => {
    if (!heroSource) return;
    let timer;
    AsyncStorage.getItem('heroHintShown').then(val => {
      if (!val) {
        setHeroHintVisible(true);
        heroHintAnim.setValue(1);
        timer = setTimeout(() => {
          Animated.timing(heroHintAnim, {
            toValue: 0,
            duration: 400,
            useNativeDriver: true,
          }).start(() => {
            setHeroHintVisible(false);
            AsyncStorage.setItem('heroHintShown', '1').catch(() => {});
          });
        }, 3000);
      }
    });
    return () => { if (timer) clearTimeout(timer); };
  }, [heroSource]);

  const handleDriveThere = async () => {
    try {
      // TODO: Add motor sound (real audio, not haptics) when starting navigation
      // Requires: expo-av Audio.Sound with engine.mp3/wav file
      
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
    return date.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' });
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
   * Find the best day from the visible forecast rows
   * Scoring: temperature and condition; temp has higher weight so that
   * a clearly warmer day (e.g. 16°C windy) can beat a cooler one (e.g. 12°C cloudy).
   */
  const findBestDay = () => {
    if (!forecast?.forecast) return null;
    const isColdMode = reverseMode === 'cold';

    const conditionScore = (condition) => {
      if (!condition) return 0;
      const c = condition.toLowerCase();
      if (c === 'sunny' || c.includes('clear')) return 100;
      if (c === 'cloudy' || c.includes('partly')) return 60;
      if (c.includes('overcast')) return 40;
      if (c.includes('wind')) return 50;
      if (c.includes('rain') || c.includes('snow')) return 10;
      return 50;
    };

    const days = forecastRows.filter(d => d.data);
    if (days.length === 0) return null;

    const scored = days.map(day => {
      const temp = day.data.high ?? day.data.temp ?? 0;
      const cond = conditionScore(day.data.condition);
      const tempNormalized = isColdMode
        ? Math.max(0, Math.min(100, ((35 - temp) / 55) * 100))
        : Math.max(0, Math.min(100, ((temp + 20) / 55) * 100));
      const score = tempNormalized * 0.6 + cond * 0.4;
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

  const heroSource = getHeroImage(destination) || getHeroImage({ ...destination, place_type: forecast?.place_type, image_region: forecast?.image_region });
  const hasHero = !!heroSource;
  const useDarkText = !hasHero && needsDarkText();
  const textColor = useDarkText ? '#2b3e50' : '#fff';
  const subtitleColor = useDarkText ? '#3a4f5d' : '#fff';

  // Date label for hero card (always shown so the pill is tappable)
  const formatDateLabel = (offset) => {
    if (offset === 0) return 'Heute';
    if (offset === 1) return 'Morgen';
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' });
  };
  const heroDateLabel = formatDateLabel(dateOffset);

  return (
    <View style={{ flex: 1 }}>
    <ScrollView
      style={[styles.container, { backgroundColor: theme.background }]}
      showsVerticalScrollIndicator={false}
      showsHorizontalScrollIndicator={false}
    >
      <View style={{ position: 'relative' }}>
      {heroSource && (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 440, overflow: 'hidden' }}>
          <Image
            source={heroSource}
            style={{ width: '100%', height: '100%', top: 0 }}
            resizeMode="cover"
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
        </View>
      )}
      {heroSource && !uiFocused && (
        <Pressable onPress={toggleUiFocus} style={styles.heroHintPill} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.heroHintText}>↗</Text>
        </Pressable>
      )}
      {heroSource && uiFocused && (
        <Pressable onPress={toggleUiFocus} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 440, zIndex: 10 }}>
          <View style={styles.heroHintPill}>
            <Text style={styles.heroHintText}>↙</Text>
          </View>
        </Pressable>
      )}
      <View style={[styles.header, { backgroundColor: heroSource ? 'transparent' : getWeatherColor(heroCondition, heroTemp) }]}>
  <Text style={styles.headerBgIcon}>{getWeatherIcon(heroCondition)}</Text>
  
  <View style={styles.headerTop}>
    <View style={styles.headerNameContainer}>
      {(() => {
        const name = forecast.name || '';
        const hasSpace = name.includes(' ');
        const isLong = name.length > 15;
        const nameFontSize = isLong ? (hasSpace ? 28 : 22) : 34;
        return (
          <View style={{ position: 'relative', alignSelf: 'flex-start' }}>
            <Text
              style={[styles.headerTitle, {
                color: textColor,
                fontSize: nameFontSize,
              }]}
              numberOfLines={2}
              adjustsFontSizeToFit
              minimumFontScale={0.5}
              onTextLayout={(e) => {
                const lines = e.nativeEvent.lines;
                if (lines && lines.length > 0) {
                  setFirstLineW(lines[0].width);
                }
              }}
            >
              {name}
            </Text>
            {heroSource && firstLineW != null && (
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
        const countryName = getCountryName(forecast.countryCode || forecast.country_code, i18n.language || 'en');
        const stateName = forecast.state_name || destination.state_name;
        const showState = stateName && stateName !== countryName;
        return (
          <Text style={[styles.headerCountry, { color: subtitleColor }]}>
            {countryName}{showState ? `, ${stateName}` : ''}
            {(forecast?.elevation || destination.elevation || 0) > 500 ? `\n${forecast?.elevation || destination.elevation}m` : ''}
          </Text>
        );
      })()}
      <TouchableOpacity style={styles.stopStayPill} activeOpacity={0.7}>
        <Text style={styles.stopStayText}>{t('destination.stopStay')}</Text>
      </TouchableOpacity>
    </View>
    <Text style={[styles.headerTemp, { color: textColor }]}>{heroTemp != null ? formatTemperature(heroTemp, temperatureUnit, false) : '?°'}</Text>
  </View>
  
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
          { label: 'Heute', offset: 0 },
          { label: '+1', offset: 1 },
          { label: '+2', offset: 2 },
          { label: '+5', offset: 5 },
          { label: '+7', offset: 7 },
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
  
  <Text style={[styles.headerSubtitle, { color: subtitleColor }]}>{translateCondition(heroDescription)}</Text>
</View>


      <View style={styles.content}>
        <Animated.View style={{ opacity: uiOpacityAnim }} pointerEvents={uiFocused ? 'none' : 'auto'}>
        <View style={[styles.mainInfo, { 
          backgroundColor: theme.surface,
          shadowColor: theme.shadow
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
        </Animated.View>

        {/* Badge Section */}
        <Animated.View style={{ opacity: uiOpacityAnim }} pointerEvents={uiFocused ? 'none' : 'auto'}>
        {destination.badges && destination.badges.length > 0 && (
          <View style={[styles.badgeSection, {
            backgroundColor: theme.surface,
            shadowColor: theme.shadow
          }]}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>{t('badges.awards')}</Text>
            {destination.badges
              .sort((a, b) => (BadgeMetadata[a]?.priority || 99) - (BadgeMetadata[b]?.priority || 99)) // Sort by priority
              .map((badge, index) => {
              const metadata = BadgeMetadata[badge];
              const worthData = destination._worthTheDriveData;
              const worthBudgetData = destination._worthTheDriveBudgetData;
              const warmDryData = destination._warmAndDryData;
              const beachData = destination._beachParadiseData;
              const sunnyStreakData = destination._sunnyStreakData;
              const miracleData = destination._weatherMiracleData;
              const heatwaveData = destination._heatwaveData;
              const snowKingData = destination._snowKingData;
              const rainyDaysData = destination._rainyDaysData;
              const weatherCurseData = destination._weatherCurseData;
              const springAwakeningData = destination._springAwakeningData;
              
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
                  return t('badges.beachparadiseSummary', { temp: fmtTemp(beachData.temp), sunnyDays: beachData.sunnyDays });
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
                  return t('badges.springawakeningSummary', { tempDelta: fmtTempDelta(springAwakeningData.tempDelta), distance: fmtDist(springAwakeningData.roadDistanceKm ?? springAwakeningData.distance) });
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
                  onToggle={() => setExpandedBadges(prev => ({ ...prev, [badge]: !prev[badge] }))}
                  theme={theme}
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
                            🌡️ {t('badges.temperature')}: {fmtTemp(warmDryData.temp)} ({t('badges.rank')} #{warmDryData.tempRank})
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
                            ☀️ {t('badges.sunnyDaysCount', { count: beachData.sunnyDays })}
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
                            🌡️ {t('badges.temperature')}: {fmtTemp(springAwakeningData.tempOrigin)} → {fmtTemp(springAwakeningData.tempDest)} ({fmtTempDelta(springAwakeningData.tempDelta)})
                          </Text>
                          <Text style={[styles.badgeStat, { color: theme.primary }]}>
                            💨 ETA: {formatETA(springAwakeningData.eta)} ({fmtDist(springAwakeningData.roadDistanceKm ?? springAwakeningData.distance)})
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
        </Animated.View>

        {/* Dorthin fahren Button - nach Badges */}
        <Animated.View style={{ opacity: uiOpacityAnim }} pointerEvents={uiFocused ? 'none' : 'auto'}>
          <TouchableOpacity
            style={[styles.driveButtonTop, {
              backgroundColor: theme.primary,
              shadowColor: theme.primary
            }]}
            onPress={handleDriveThere}
          >
            <Text style={styles.driveButtonTopText}>{t('destination.driveThere')}</Text>
          </TouchableOpacity>
        </Animated.View>

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
                <Text style={styles.bestDayLabel}>{t('badges.bestDay')}</Text>
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
                <Text style={styles.forecastIcon}>{hasData ? getWeatherIcon(day.data.condition) : '—'}</Text>
                <Text style={[styles.forecastTemp, { color: isBestDay ? '#7A6B55' : theme.textSecondary, fontWeight: isBestDay ? '600' : '500' }]}>
                  {hasData ? `${formatTemperature(day.data.high, temperatureUnit, false)} / ${formatTemperature(day.data.low, temperatureUnit, false)}` : '—'}
                </Text>
              </View>
            );
          })}
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
      </View>
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
    fontWeight: 'bold',
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
    fontWeight: '700',
  },
  heroDateBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(210, 130, 60, 1)',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 8,
    marginBottom: 2,
    zIndex: 1,
  },
  heroDateBadgeText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },

  header: {
    padding: 20,
    paddingTop: 28,
    paddingBottom: 20,
    position: 'relative',
    minHeight: 140,
  },

  headerBgIcon: {
    position: 'absolute',
    fontSize: 80,
    top: '50%',
    left: '80%',
    transform: [{ translateX: -40 }, { translateY: -40 }],
    opacity: 0.7,
    textShadowColor: 'rgba(0, 0, 0, 0.4)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 10,
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
    fontWeight: '700',
    lineHeight: 30,
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
  headerTemp: {
    fontSize: 56,
    fontWeight: '300',
    letterSpacing: -2,
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
  content: {
    padding: 20,
  },
  mainInfo: {
    borderRadius: 14,
    padding: 18,
    marginBottom: 20,
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
    fontWeight: '600',
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
  badgeSection: {
    borderRadius: 14,
    padding: 18,
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
    marginBottom: 10,
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
    fontWeight: '600',
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
    fontWeight: '600',
    marginTop: 4,
  },
  badgeSummary: {
    fontSize: 15,
    fontWeight: '600',
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
    fontWeight: '600',
    marginBottom: 10,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    opacity: 0.7,
  },
  driveButtonTop: {
    paddingVertical: 16,
    paddingHorizontal: 32,
    minHeight: 64,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 5,
    elevation: 6,
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
    fontWeight: '600',
    color: '#8B7355',
    marginBottom: 1,
    letterSpacing: 0.2,
  },
  bestDayValue: {
    fontSize: 14,
    fontWeight: '600',
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
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  forecastItemSelected: {
    backgroundColor: 'rgba(180, 155, 120, 0.08)',
    borderRadius: 8,
    paddingHorizontal: 8,
    marginHorizontal: -8,
    borderLeftWidth: 2,
    borderLeftColor: 'rgba(180, 140, 80, 0.4)',
  },
  forecastDay: {
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
  },
  forecastIcon: {
    fontSize: 24,
    width: 40,
    textAlign: 'center',
    marginHorizontal: 10,
  },
  forecastTemp: {
    fontSize: 16,
    fontWeight: '500',
    minWidth: 75,
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
  heroHintPill: {
    position: 'absolute',
    top: 12,
    right: 12,
    zIndex: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 12,
  },
  heroHintText: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 12,
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
  stopStayPill: {
    alignSelf: 'flex-start',
    marginTop: 6,
    marginBottom: 10,
    backgroundColor: 'rgba(195, 115, 55, 0.80)',
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderRadius: 16,
    height: 27,
    justifyContent: 'center',
    shadowColor: '#C07337',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
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
    shadowOpacity: 0.18,
    shadowRadius: 4,
    elevation: 5,
  },
  driveButtonText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
  },

  dateDropdownAnchor: {
    alignSelf: 'flex-start',
    zIndex: 20,
  },
  dateDropdown: {
    flexDirection: 'row',
    marginTop: 4,
    gap: 4,
  },
  dateDropdownBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 7,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  dateDropdownBtnActive: {
    backgroundColor: 'rgba(210,130,60,1)',
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
