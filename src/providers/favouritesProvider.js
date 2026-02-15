import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@sunnomad:favourites';

/**
 * Favourites Storage Provider
 * Manages persisting favourite places to AsyncStorage
 */

/**
 * Load all favourites from storage
 * @returns {Promise<Array>} Array of favourite destinations
 */
export const loadFavourites = async () => {
  try {
    const jsonValue = await AsyncStorage.getItem(STORAGE_KEY);
    return jsonValue != null ? JSON.parse(jsonValue) : [];
  } catch (error) {
    console.error('Failed to load favourites:', error);
    return [];
  }
};

/**
 * Save favourites array to storage
 * @param {Array} favourites - Array of favourite destinations
 * @returns {Promise<boolean>} Success status
 */
const saveFavourites = async (favourites) => {
  try {
    const jsonValue = JSON.stringify(favourites);
    await AsyncStorage.setItem(STORAGE_KEY, jsonValue);
    return true;
  } catch (error) {
    console.error('Failed to save favourites:', error);
    return false;
  }
};

/**
 * Add a destination to favourites
 * @param {Object} destination - Destination object with lat, lon, name, etc.
 * @returns {Promise<boolean>} Success status
 */
export const addFavourite = async (destination) => {
  try {
    const favourites = await loadFavourites();
    
    // Check if already exists
    const exists = favourites.some(
      (fav) => fav.lat === destination.lat && fav.lon === destination.lon
    );
    
    if (exists) {
      console.warn('Destination already in favourites');
      return false;
    }
    
    // Add timestamp and local favourite ID (preserve original place ID for Supabase lookups)
    const favourite = {
      ...destination,
      favouriteId: `${destination.lat}_${destination.lon}_${Date.now()}`,
      savedAt: new Date().toISOString(),
    };
    
    favourites.push(favourite);
    return await saveFavourites(favourites);
  } catch (error) {
    console.error('Failed to add favourite:', error);
    return false;
  }
};

/**
 * Remove a destination from favourites
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @returns {Promise<boolean>} Success status
 */
export const removeFavourite = async (lat, lon) => {
  try {
    const favourites = await loadFavourites();
    const filtered = favourites.filter(
      (fav) => !(fav.lat === lat && fav.lon === lon)
    );
    
    return await saveFavourites(filtered);
  } catch (error) {
    console.error('Failed to remove favourite:', error);
    return false;
  }
};

/**
 * Check if a destination is in favourites
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @returns {Promise<boolean>} True if favourite
 */
export const isFavourite = async (lat, lon) => {
  try {
    const favourites = await loadFavourites();
    return favourites.some((fav) => fav.lat === lat && fav.lon === lon);
  } catch (error) {
    console.error('Failed to check favourite:', error);
    return false;
  }
};

/**
 * Clear all favourites
 * @returns {Promise<boolean>} Success status
 */
export const clearFavourites = async () => {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
    return true;
  } catch (error) {
    console.error('Failed to clear favourites:', error);
    return false;
  }
};

