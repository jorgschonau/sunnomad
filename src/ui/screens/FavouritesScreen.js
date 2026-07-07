import React, { useState, useCallback, useRef, useEffect } from 'react';
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
import { formatTemperature } from '../../utils/unitConversion';
import Ionicons from '@expo/vector-icons/Ionicons';

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

const FavouriteCard = ({ item, theme, t, temperatureUnit, onPress }) => {
  const conditionLabel = t(`weather.${item.condition || 'cloudy'}`);
  const countryLabel = item.country_code || '';
  const heroSource = item.heroUrl
    ? { uri: item.heroUrl }
    : getHeroImage(heroDestForItem(item));
  const metaLine = [countryLabel, conditionLabel].filter(Boolean).join(' · ');

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
          <LinearGradient
            colors={['rgba(0,0,0,0.12)', 'rgba(0,0,0,0.62)']}
            style={StyleSheet.absoluteFill}
          />
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.55)']}
            start={{ x: 0.4, y: 0 }}
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
          <View style={[styles.statDivider, { backgroundColor: theme.border }]} />
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

const FavouriteSwipeableRow = ({ item, theme, t, temperatureUnit, onPress, onDelete }) => {
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
        onPress={onPress}
      />
    </ReanimatedSwipeable>
  );
};

const FavouritesScreen = ({ navigation }) => {
  const { t, i18n } = useTranslation();
  const { theme } = useTheme();
  const { temperatureUnit } = useUnits();
  const [favourites, setFavourites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pendingDelete, setPendingDelete] = useState(null);
  const hasLoadedRef = useRef(false);
  const pendingDeleteRef = useRef(null);

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
    } catch (error) {
      console.error('Failed to load favourites:', error);
      Alert.alert(t('map.error'), 'Failed to load favourites');
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      mixpanel.track('Favourites Opened');
      loadFavourites();
    }, [])
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
      mixpanel.track('Favourite Removed', { place_id: placeId, place_name: pending.item.name });
      invalidateListThumbCache(placeId);
    }
  }, []);

  const flushPendingDelete = useCallback(async () => {
    if (pendingDeleteRef.current) {
      await commitPendingDelete();
    }
  }, [commitPendingDelete]);

  const queueDelete = useCallback(async (item) => {
    await flushPendingDelete();

    const placeId = item.placeId || item.id;
    setFavourites((prev) => prev.filter((f) => (f.placeId || f.id) !== placeId));

    const timeoutId = setTimeout(() => {
      commitPendingDelete();
    }, UNDO_MS);

    pendingDeleteRef.current = { item, timeoutId };
    setPendingDelete(item);
  }, [flushPendingDelete, commitPendingDelete]);

  const undoDelete = useCallback(() => {
    const pending = pendingDeleteRef.current;
    if (!pending) return;

    clearTimeout(pending.timeoutId);
    pendingDeleteRef.current = null;
    setPendingDelete(null);
    setFavourites((prev) => {
      const id = pending.item.placeId || pending.item.id;
      if (prev.some((f) => (f.placeId || f.id) === id)) return prev;
      return [pending.item, ...prev];
    });
  }, []);

  const handleViewDetails = (destination) => {
    navigation.navigate('DestinationDetail', { destination, source: 'favourites' });
  };

  const renderFavouriteItem = useCallback(({ item }) => (
    <FavouriteSwipeableRow
      item={item}
      theme={theme}
      t={t}
      temperatureUnit={temperatureUnit}
      onPress={() => handleViewDetails(item)}
      onDelete={queueDelete}
    />
  ), [theme, t, temperatureUnit, queueDelete]);

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
        <FlatList
          data={favourites}
          renderItem={renderFavouriteItem}
          keyExtractor={(item) => item.favouriteId || item.id || `${item.lat}_${item.lon}`}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
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
    paddingTop: 8,
    paddingBottom: 24,
  },
  swipeableContainer: {
    marginBottom: 14,
  },
  swipeableChild: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  favouriteCard: {
    borderRadius: 16,
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  deleteAction: {
    width: DELETE_ACTION_WIDTH,
    backgroundColor: '#E53935',
    justifyContent: 'center',
    alignItems: 'center',
    borderTopRightRadius: 16,
    borderBottomRightRadius: 16,
  },
  heroStrip: {
    height: 88,
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
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  locationMeta: {
    fontSize: 13,
    fontWeight: '500',
    marginTop: 2,
    color: 'rgba(255,255,255,0.92)',
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  temperature: {
    fontSize: 22,
    fontWeight: '700',
    marginLeft: 10,
    color: '#FFFFFF',
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  cardBody: {
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statDivider: {
    width: 1,
    height: 28,
    opacity: 0.35,
  },
  statLabel: {
    fontSize: 12,
    fontWeight: '500',
    marginBottom: 4,
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
