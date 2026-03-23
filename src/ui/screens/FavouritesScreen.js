import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../theme/ThemeProvider';
import { getFavourites, removeFromFavourites } from '../../usecases/favouritesUsecases';
import { getWeatherIcon, getWeatherColor } from '../../usecases/weatherUsecases';
import { useUnits } from '../../contexts/UnitContext';
import { formatTemperature, formatWindSpeed } from '../../utils/unitConversion';

const formatDate = (dateString) => {
  const date = new Date(dateString);
  return date.toLocaleDateString();
};

const FavouritesScreen = ({ navigation }) => {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const { temperatureUnit, windSpeedUnit } = useUnits();
  const [favourites, setFavourites] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadFavourites = async () => {
    setLoading(true);
    try {
      const favs = await getFavourites();
      setFavourites(favs);
    } catch (error) {
      console.error('Failed to load favourites:', error);
      Alert.alert(t('map.error'), 'Failed to load favourites');
    } finally {
      setLoading(false);
    }
  };

  // Reload favourites when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      loadFavourites();
    }, [])
  );

  const handleRemoveFavourite = async (placeId, name) => {
    Alert.alert(
      t('favourites.removeFromFavourites'),
      name,
      [
        { text: t('destination.backToMap'), style: 'cancel' },
        {
          text: t('favourites.removeFromFavourites'),
          style: 'destructive',
          onPress: async () => {
            const result = await removeFromFavourites(placeId);
            if (result.success) {
              await loadFavourites();
            }
          },
        },
      ]
    );
  };

  const handleViewDetails = (destination) => {
    navigation.navigate('DestinationDetail', { destination });
  };

  const renderFavouriteItem = useCallback(({ item }) => (
    <TouchableOpacity
      style={[styles.favouriteCard, {
        backgroundColor: theme.surface,
        borderColor: theme.border,
        shadowColor: theme.shadow,
      }]}
      onPress={() => handleViewDetails(item)}
    >
      <View style={[styles.cardHeader, { backgroundColor: getWeatherColor(item.condition, item.temperature) }]}>
        <Text style={styles.weatherIcon}>{getWeatherIcon(item.condition)}</Text>
        <View style={styles.headerInfo}>
          <Text style={[styles.locationName, { color: theme.text }]}>{item.name}</Text>
          <Text style={[styles.temperature, { color: theme.text }]}>{formatTemperature(item.temperature, temperatureUnit)}</Text>
        </View>
      </View>

      <View style={styles.cardBody}>
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={[styles.statLabel, { color: theme.textSecondary }]}>
              {t('destination.humidity')}
            </Text>
            <Text style={[styles.statValue, { color: theme.text }]}>{item.humidity}%</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={[styles.statLabel, { color: theme.textSecondary }]}>
              {t('destination.wind')}
            </Text>
            <Text style={[styles.statValue, { color: theme.text }]}>{formatWindSpeed(item.windSpeed, windSpeedUnit)}</Text>
          </View>
        </View>

        <View style={styles.cardFooter}>
          <Text style={[styles.savedDate, { color: theme.textTertiary }]}>
            {t('favourites.savedOn', { date: formatDate(item.savedAt) })}
          </Text>
          <TouchableOpacity
            style={[styles.removeButton, { backgroundColor: theme.error + '20', borderColor: theme.error }]}
            onPress={() => handleRemoveFavourite(item.placeId, item.name)}
          >
            <Text style={[styles.removeButtonText, { color: theme.error }]}>✖</Text>
          </TouchableOpacity>
        </View>
      </View>
    </TouchableOpacity>
  ), [theme, t, temperatureUnit, windSpeedUnit]);

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
        />
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
  },
  listContent: {
    padding: 16,
  },
  favouriteCard: {
    borderRadius: 16,
    marginBottom: 16,
    overflow: 'hidden',
    borderWidth: 2,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    padding: 16,
    alignItems: 'center',
  },
  weatherIcon: {
    fontSize: 48,
    marginRight: 16,
  },
  headerInfo: {
    flex: 1,
  },
  locationName: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  temperature: {
    fontSize: 28,
    fontWeight: '700',
  },
  cardBody: {
    padding: 16,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 12,
  },
  statItem: {
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 12,
    marginBottom: 4,
  },
  statValue: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.1)',
  },
  savedDate: {
    fontSize: 12,
  },
  removeButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  removeButtonText: {
    fontSize: 16,
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
    fontWeight: 'bold',
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
    fontWeight: 'bold',
  },
});

export default FavouritesScreen;

