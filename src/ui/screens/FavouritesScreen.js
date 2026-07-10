import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Pressable,
  ActivityIndicator,
  Alert,
  Image,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import { useTheme } from '../../theme/ThemeProvider';
import { getFavourites, removeFromFavourites } from '../../usecases/favouritesUsecases';
import { resolveListThumbUrls, invalidateListThumbCache } from '../../services/placeHeroImageService';
import { mixpanel } from '../../services/mixpanel';
import { getWeatherIcon, getWeatherColor } from '../../usecases/weatherUsecases';
import { getHeroImage } from '../../utils/heroImages';
import { useUnits } from '../../contexts/UnitContext';
import { formatTemperature, kmToMiles } from '../../utils/unitConversion';
import { calculateETA } from '../../domain/destinationBadge';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getCachedLocation, getPreloadResult } from '../../utils/locationPreload';
import Ionicons from '@expo/vector-icons/Ionicons';

const SORT_STORAGE_KEY = 'favouritesSort';
const SORT_KEYS = ['recent', 'warmest', 'nearest', 'sun'];
const ROAD_FACTOR = 1.35;

const haversineKm = (lat1, lon1, lat2, lon2) => {
  const R = 6371;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const sortFavourites = (items, sortKey, userLoc) => {
  const list = [...items];
  switch (sortKey) {
    case 'warmest':
      return list.sort((a, b) => (b.temperature ?? -999) - (a.temperature ?? -999));
    case 'nearest': {
      if (!userLoc) return list;
      const dist = (item) => haversineKm(userLoc.latitude, userLoc.longitude, item.lat, item.lon);
      return list.sort((a, b) => dist(a) - dist(b));
    }
    case 'sun':
      return list.sort((a, b) => (b.sunshineHoursToday ?? -1) - (a.sunshineHoursToday ?? -1));
    case 'recent':
    default:
      return list.sort((a, b) => new Date(b.savedAt || 0) - new Date(a.savedAt || 0));
  }
};

const formatDriveDistance = (straightKm, distanceUnit, locale) => {
  if (straightKm == null || straightKm <= 0) return null;
  const roadKm = straightKm * ROAD_FACTOR;
  const etaH = Math.round(calculateETA(roadKm));
  const numLocale = locale?.startsWith('de') ? 'de-DE' : 'en-US';
  if (distanceUnit === 'miles') {
    const mi = Math.round(kmToMiles(roadKm));
    return `${mi.toLocaleString(numLocale)} mi · ~${etaH}h`;
  }
  const km = Math.round(roadKm);
  return `${km.toLocaleString(numLocale)} km · ~${etaH}h`;
};

const resolveUserLocation = () => {
  const cached = getCachedLocation();
  if (cached) return cached;
  const pos = getPreloadResult().lastKnownPosition;
  if (pos?.coords) {
    return { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
  }
  return null;
};

const NA_COUNTRIES = new Set(['US', 'CA', 'MX']);
const UNDO_MS = 5000;
const DELETE_ACTION_WIDTH = 72;

const inferImageRegion = (countryCode) => {
  const cc = (countryCode || '').toUpperCase();
  if (NA_COUNTRIES.has(cc)) return 'na';
  if (['ES', 'IT', 'GR', 'PT', 'HR', 'ME', 'AL', 'MT', 'CY', 'TR', 'FR'].includes(cc)) return 'eu_south';
  if (['RO', 'BG', 'RS', 'MK', 'BA', 'SI'].includes(cc)) return 'eu_balkan';
  if (['PL', 'CZ', 'HU', 'SK', 'UA', 'BY', 'LT', 'LV', 'EE'].includes(cc)) return 'eu_east';
  return undefined;
};

const heroDestForItem = (item) => ({
  ...item,
  id: item.placeId || item.id,
  image_region: item.image_region ?? inferImageRegion(item.country_code),
});

const SORT_LABELS = {
  recent: 'favourites.sortRecent',
  warmest: 'favourites.sortWarmest',
  nearest: 'favourites.sortNearest',
  sun: 'favourites.sortSun',
};

const SortBar = ({ sortKey, onSortChange, hasLocation, theme, t }) => {
  const options = SORT_KEYS.filter((key) => key !== 'nearest' || hasLocation);
  return (
    <View style={styles.sortBar}>
      {options.map((key) => {
        const active = sortKey === key;
        return (
          <Pressable
            key={key}
            style={[
              styles.sortChip,
              {
                backgroundColor: active ? theme.primaryLight : theme.surface,
                borderColor: active ? theme.primaryLight : `${theme.border}AA`,
              },
            ]}
            onPress={() => onSortChange(key)}
          >
            <Text
              style={[
                styles.sortChipText,
                { color: active ? theme.primaryDark : theme.textSecondary },
              ]}
            >
              {t(SORT_LABELS[key])}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
};

const FavouriteCard = ({ item, theme, t, temperatureUnit, distanceUnit, locale, userLocation, onPress }) => {
  const conditionLabel = t(`weather.${item.condition || 'cloudy'}`);
  const countryLabel = item.country_code || '';
  const heroSource = item.heroUrl
    ? { uri: item.heroUrl }
    : getHeroImage(heroDestForItem(item));

  const straightKm = userLocation
    ? haversineKm(userLocation.latitude, userLocation.longitude, item.lat, item.lon)
    : null;
  const driveLabel = formatDriveDistance(straightKm, distanceUnit, locale);
  const metaLine = [driveLabel, countryLabel, conditionLabel].filter(Boolean).join(' · ');

  const trendLabel = item.sunshineTrend === 'more'
    ? t('favourites.trendMore')
    : item.sunshineTrend === 'less'
      ? t('favourites.trendLess')
      : t('favourites.trendStable');
  const sunTodayValue = item.sunshineHoursToday != null
    ? `☀ ${item.sunshineHoursToday}h`
    : '—';

  const headerContent = (
    <>
      <Text style={styles.weatherIcon}>{getWeatherIcon(item.condition)}</Text>
      <View style={styles.headerTextBlock}>
        <Text style={styles.locationName} numberOfLines={1}>{item.name}</Text>
        {metaLine ? (
          <Text style={styles.locationMeta} numberOfLines={1}>{metaLine}</Text>
        ) : null}
      </View>
      <Text style={styles.temperature}>
        {formatTemperature(item.temperature, temperatureUnit)}
      </Text>
    </>
  );

  return (
    <Pressable
      style={[styles.favouriteCard, { backgroundColor: theme.surface, shadowColor: theme.shadow }]}
      onPress={onPress}
    >
      {heroSource ? (
        <View style={styles.heroStrip}>
          <Image source={heroSource} style={styles.heroImage} resizeMode="cover" />
          <View style={styles.heroImageBrighten} pointerEvents="none" />
          <View style={styles.heroImageContrast} pointerEvents="none" />
          <LinearGradient
            colors={[
              'transparent',
              'rgba(0,0,0,0.03)',
              'rgba(0,0,0,0.14)',
              'rgba(0,0,0,0.28)',
              'rgba(0,0,0,0.38)',
            ]}
            locations={[0, 0.25, 0.5, 0.78, 1]}
            style={StyleSheet.absoluteFill}
          />
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.07)', 'rgba(0,0,0,0.28)']}
            locations={[0, 0.55, 1]}
            start={{ x: 0.2, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.heroContent}>{headerContent}</View>
        </View>
      ) : (
        <View style={[styles.heroStrip, styles.heroFallback, {
          backgroundColor: getWeatherColor(item.condition, item.temperature),
        }]}>
          <View style={styles.heroContent}>{headerContent}</View>
        </View>
      )}

      <View style={styles.cardBody}>
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={[styles.statLabel, { color: theme.textSecondary }]}>{t('favourites.sunToday')}</Text>
            <Text style={[styles.statValue, { color: theme.text }]}>{sunTodayValue}</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={[styles.statLabel, { color: theme.textSecondary }]}>{t('favourites.trend')}</Text>
            <Text style={[styles.statValue, styles.trendValue, { color: theme.text }]} numberOfLines={1}>
              {trendLabel}
            </Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
};

const FavouriteSwipeableRow = ({ item, theme, t, temperatureUnit, distanceUnit, locale, userLocation, onPress, onDelete }) => {
  const swipeableRef = useRef(null);
  const hapticFiredRef = useRef(false);

  const renderRightActions = useCallback(() => (
    <Pressable
      style={styles.deleteAction}
      onPress={() => {
        swipeableRef.current?.close();
        onDelete(item);
      }}
      accessibilityLabel={t('favourites.removeFromFavourites')}
    >
      <Ionicons name="trash-outline" size={22} color="#FFFFFF" />
    </Pressable>
  ), [item, onDelete, t]);

  return (
    <ReanimatedSwipeable
      ref={swipeableRef}
      renderRightActions={renderRightActions}
      overshootRight={false}
      rightThreshold={40}
      friction={2}
      containerStyle={styles.swipeableContainer}
      childrenContainerStyle={styles.swipeableChild}
      onSwipeableWillOpen={() => {
        if (!hapticFiredRef.current) {
          hapticFiredRef.current = true;
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        }
      }}
      onSwipeableClose={() => {
        hapticFiredRef.current = false;
      }}
    >
      <FavouriteCard
        item={item}
        theme={theme}
        t={t}
        temperatureUnit={temperatureUnit}
        distanceUnit={distanceUnit}
        locale={locale}
        userLocation={userLocation}
        onPress={onPress}
      />
    </ReanimatedSwipeable>
  );
};

const FavouritesScreen = ({ navigation, route }) => {
  const { t, i18n } = useTranslation();
  const { theme } = useTheme();
  const { temperatureUnit, distanceUnit } = useUnits();
  const [favourites, setFavourites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [sortKey, setSortKey] = useState('recent');
  const [userLocation, setUserLocation] = useState(() => resolveUserLocation());
  const hasLoadedRef = useRef(false);
  const pendingDeleteRef = useRef(null);
  const sortKeyRef = useRef(sortKey);
  sortKeyRef.current = sortKey;

  useEffect(() => {
    AsyncStorage.getItem(SORT_STORAGE_KEY).then((saved) => {
      if (saved && SORT_KEYS.includes(saved)) setSortKey(saved);
    });
  }, []);

  const handleSortChange = useCallback((key) => {
    if (key === sortKey) return;
    const previousSort = sortKey;
    setSortKey(key);
    AsyncStorage.setItem(SORT_STORAGE_KEY, key).catch(() => {});
    mixpanel.track('Favourites Sort Changed', {
      sort: key,
      previous_sort: previousSort,
      favourites_count: favourites.length,
    });
  }, [sortKey, favourites.length]);

  const sortedFavourites = useMemo(
    () => sortFavourites(favourites, sortKey, userLocation),
    [favourites, sortKey, userLocation],
  );

  const availableSortKeys = useMemo(
    () => SORT_KEYS.filter((key) => key !== 'nearest' || userLocation),
    [userLocation],
  );

  useEffect(() => {
    if (sortKey === 'nearest' && !userLocation) {
      setSortKey('recent');
      AsyncStorage.setItem(SORT_STORAGE_KEY, 'recent').catch(() => {});
    }
  }, [sortKey, userLocation]);

  useEffect(() => () => {
    invalidateListThumbCache();
    hasLoadedRef.current = false;
    const pending = pendingDeleteRef.current;
    if (pending) {
      clearTimeout(pending.timeoutId);
      removeFromFavourites(pending.item.placeId || pending.item.id);
    }
  }, []);

  const loadFavourites = async () => {
    const showSpinner = !hasLoadedRef.current;
    if (showSpinner) setLoading(true);
    try {
      const favs = await getFavourites(i18n.language);
      const thumbUrls = await resolveListThumbUrls(favs.map((f) => f.placeId || f.id));
      const withHero = favs.map((fav) => {
        const id = String(fav.placeId || fav.id);
        const heroUrl = thumbUrls.get(id);
        return heroUrl ? { ...fav, heroUrl } : fav;
      });
      setFavourites(withHero);
      hasLoadedRef.current = true;
      return withHero;
    } catch (error) {
      console.error('Failed to load favourites:', error);
      Alert.alert(t('map.error'), t('favourites.loadFailed'));
      return [];
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      const loc = resolveUserLocation();
      setUserLocation(loc);
      loadFavourites().then((favs) => {
        mixpanel.track('Favourites Opened', {
          favourites_count: favs.length,
          sort: sortKeyRef.current,
          has_location: !!loc,
          source: route.params?.source ?? 'direct',
        });
      });
    }, [route.params?.source])
  );

  const commitPendingDelete = useCallback(async () => {
    const pending = pendingDeleteRef.current;
    if (!pending) return;

    clearTimeout(pending.timeoutId);
    pendingDeleteRef.current = null;
    setPendingDelete(null);

    const placeId = pending.item.placeId || pending.item.id;
    const result = await removeFromFavourites(placeId);
    if (result.success) {
      mixpanel.track('Favourite Removed', {
        place_id: placeId,
        place_name: pending.item.name,
        method: 'swipe',
        sort: sortKey,
      });
      invalidateListThumbCache(placeId);
    }
  }, [sortKey]);

  const flushPendingDelete = useCallback(async () => {
    if (pendingDeleteRef.current) {
      await commitPendingDelete();
    }
  }, [commitPendingDelete]);

  const queueDelete = useCallback(async (item) => {
    await flushPendingDelete();

    const placeId = item.placeId || item.id;
    mixpanel.track('Favourite Delete Started', {
      place_id: placeId,
      place_name: item.name,
      sort: sortKey,
    });
    setFavourites((prev) => prev.filter((f) => (f.placeId || f.id) !== placeId));

    const timeoutId = setTimeout(() => {
      commitPendingDelete();
    }, UNDO_MS);

    pendingDeleteRef.current = { item, timeoutId };
    setPendingDelete(item);
  }, [flushPendingDelete, commitPendingDelete, sortKey]);

  const undoDelete = useCallback(() => {
    const pending = pendingDeleteRef.current;
    if (!pending) return;

    const placeId = pending.item.placeId || pending.item.id;
    mixpanel.track('Favourite Remove Undone', {
      place_id: placeId,
      place_name: pending.item.name,
      sort: sortKey,
    });

    clearTimeout(pending.timeoutId);
    pendingDeleteRef.current = null;
    setPendingDelete(null);
    setFavourites((prev) => {
      const id = pending.item.placeId || pending.item.id;
      if (prev.some((f) => (f.placeId || f.id) === id)) return prev;
      return [pending.item, ...prev];
    });
  }, [sortKey]);

  const handleViewDetails = (destination) => {
    mixpanel.track('Favourite Tapped', {
      place_id: destination.placeId || destination.id,
      place_name: destination.name,
      sort: sortKey,
      condition: destination.condition,
      temperature: destination.temperature,
    });
    navigation.navigate('DestinationDetail', { destination, source: 'favourites' });
  };

  const renderFavouriteItem = useCallback(({ item }) => (
    <FavouriteSwipeableRow
      item={item}
      theme={theme}
      t={t}
      temperatureUnit={temperatureUnit}
      distanceUnit={distanceUnit}
      locale={i18n.language}
      userLocation={userLocation}
      onPress={() => handleViewDetails(item)}
      onDelete={queueDelete}
    />
  ), [theme, t, temperatureUnit, distanceUnit, i18n.language, userLocation, queueDelete]);

  const renderEmptyState = () => (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyIcon}>⭐</Text>
      <Text style={[styles.emptyTitle, { color: theme.text }]}>{t('favourites.empty')}</Text>
      <Text style={[styles.emptyDescription, { color: theme.textSecondary }]}>
        {t('favourites.emptyDescription')}
      </Text>
      <TouchableOpacity
        style={[styles.backButton, { backgroundColor: theme.primary }]}
        onPress={() => navigation.navigate('Map')}
      >
        <Text style={styles.backButtonText}>{t('destination.backToMap')}</Text>
      </TouchableOpacity>
    </View>
  );

  if (loading) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: theme.background }]}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {favourites.length === 0 ? (
        renderEmptyState()
      ) : (
        <>
          {favourites.length > 1 ? (
            <SortBar
              sortKey={availableSortKeys.includes(sortKey) ? sortKey : 'recent'}
              onSortChange={handleSortChange}
              hasLocation={!!userLocation}
              theme={theme}
              t={t}
            />
          ) : null}
          <FlatList
            data={sortedFavourites}
            renderItem={renderFavouriteItem}
            keyExtractor={(item) => item.favouriteId || item.id || `${item.lat}_${item.lon}`}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          />
        </>
      )}

      {pendingDelete ? (
        <View style={[styles.snackbar, { backgroundColor: theme.text }]}>
          <Text style={styles.snackbarText}>{t('favourites.removed')}</Text>
          <Pressable onPress={undoDelete} hitSlop={8}>
            <Text style={[styles.snackbarUndo, { color: theme.primary }]}>{t('favourites.undo')}</Text>
          </Pressable>
        </View>
      ) : null}
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
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 24,
  },
  sortBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 6,
  },
  sortChip: {
    paddingHorizontal: 15,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
  },
  sortChipText: {
    fontSize: 13,
    fontWeight: '600',
  },
  swipeableContainer: {
    marginBottom: 10,
  },
  swipeableChild: {
    borderRadius: 19,
    overflow: 'hidden',
  },
  favouriteCard: {
    borderRadius: 19,
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 14,
    elevation: 2,
  },
  deleteAction: {
    width: DELETE_ACTION_WIDTH,
    backgroundColor: '#E53935',
    justifyContent: 'center',
    alignItems: 'center',
    borderTopRightRadius: 19,
    borderBottomRightRadius: 19,
  },
  heroStrip: {
    height: 100,
    justifyContent: 'flex-end',
  },
  heroFallback: {
    justifyContent: 'center',
  },
  heroImage: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
  heroImageBrighten: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.065)',
  },
  heroImageContrast: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(128,128,128,0.05)',
    mixBlendMode: 'overlay',
  },
  heroContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  weatherIcon: {
    fontSize: 28,
    marginRight: 10,
  },
  headerTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  locationName: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  locationMeta: {
    fontSize: 12,
    fontWeight: '500',
    marginTop: 2,
    color: 'rgba(255,255,255,0.78)',
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  temperature: {
    fontSize: 20,
    fontWeight: '600',
    marginLeft: 10,
    color: '#FFFFFF',
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  cardBody: {
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 32,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 12,
    fontWeight: '500',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  statValue: {
    fontSize: 17,
    fontWeight: '600',
  },
  trendValue: {
    fontSize: 15,
  },
  snackbar: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 24,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
  snackbarText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  snackbarUndo: {
    fontSize: 15,
    fontWeight: '700',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyIcon: {
    fontSize: 80,
    marginBottom: 24,
  },
  emptyTitle: {
    fontSize: 24,
    fontWeight: '600',
    marginBottom: 12,
  },
  emptyDescription: {
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 32,
  },
  backButton: {
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 12,
  },
  backButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
});

export default FavouritesScreen;
