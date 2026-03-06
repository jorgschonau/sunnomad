import {
  getFavourites as fetchFavourites,
  addFavourite as addFavouriteToSupabase,
  removeFavourite as removeFavouriteFromSupabase,
  isFavourite as checkIsFavourite,
  clearFavourites as clearAllFavourites,
} from '../services/favouritesService';

/**
 * Favourites Use-Cases
 * Business logic for managing favourite destinations via Supabase.
 * The DB trigger on the favourites table automatically updates
 * favourite_count on the places table.
 */

/**
 * Get all favourites sorted by most recently saved
 * @returns {Promise<Array>} Array of favourite destinations
 */
export const getFavourites = async () => {
  const { favourites, error } = await fetchFavourites();
  if (error) {
    console.error('getFavourites error:', error);
    return [];
  }
  return favourites.sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
};

/**
 * Add a destination to favourites
 * @param {Object} destination - Destination with id (place UUID), lat, lon, name, etc.
 * @returns {Promise<{success: boolean, message: string}>}
 */
export const addToFavourites = async (destination) => {
  if (!destination?.id) {
    return { success: false, message: 'No place ID' };
  }

  const { favourite, error } = await addFavouriteToSupabase(destination.id);
  if (error) {
    const isDuplicate = error?.code === '23505';
    return {
      success: false,
      message: isDuplicate ? 'Already in favourites' : error.message,
    };
  }
  return { success: true, message: 'Added to favourites' };
};

/**
 * Remove a destination from favourites by place ID
 * @param {string} placeId - Place UUID
 * @returns {Promise<{success: boolean, message: string}>}
 */
export const removeFromFavourites = async (placeId) => {
  const { error } = await removeFavouriteFromSupabase(placeId);
  return {
    success: !error,
    message: error ? 'Failed to remove' : 'Removed from favourites',
  };
};

/**
 * Toggle favourite status of a destination
 * @param {Object} destination - Destination object with id (place UUID)
 * @returns {Promise<{isFavourite: boolean, message: string}>}
 */
export const toggleFavourite = async (destination) => {
  if (!destination?.id) {
    return { success: false, isFavourite: false, message: 'No place ID' };
  }

  const { isFavourite: currentlyFav } = await checkIsFavourite(destination.id);

  if (currentlyFav) {
    const result = await removeFromFavourites(destination.id);
    return { success: result.success, isFavourite: !result.success, message: result.message };
  } else {
    const result = await addToFavourites(destination);
    return { success: result.success, isFavourite: result.success, message: result.message };
  }
};

/**
 * Check if a destination is favourited
 * @param {string} placeId - Place UUID
 * @returns {Promise<boolean>}
 */
export const isDestinationFavourite = async (placeId) => {
  if (!placeId) return false;
  const { isFavourite } = await checkIsFavourite(placeId);
  return isFavourite;
};

/**
 * Clear all favourites
 * @returns {Promise<boolean>}
 */
export const clearAllFavouritesUseCase = async () => {
  const { error } = await clearAllFavourites();
  return !error;
};
