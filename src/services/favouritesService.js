import { supabase } from '../config/supabase';
import { getPlaceName } from '../utils/localization';

/**
 * Favourites Service
 * Handles user's favourite places with Supabase backend
 */

/**
 * Get all favourites for the current user
 * @returns {Promise<{favourites, error}>}
 */
export const getFavourites = async (locale = 'en') => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      // User not logged in, return empty array
      return { favourites: [], error: null };
    }

    const today = new Date().toISOString().split('T')[0];

    const { data, error } = await supabase
      .from('favourites')
      .select(`
        *,
        places (
          id,
          name_en, name_de, name_fr,
          latitude,
          longitude,
          country_code,
          place_type,
          weather_forecast (
            forecast_date, temp_min, temp_max,
            weather_main, weather_description, weather_icon,
            wind_speed, humidity, rain_volume, snow_volume
          )
        )
      `)
      .eq('user_id', user.id)
      .eq('places.weather_forecast.forecast_date', today)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const transformed = data.map(fav => {
      const place = fav.places;
      const weather = place?.weather_forecast?.[0] || {};
      return {
        id: place.id,
        favouriteId: fav.id,
        lat: place.latitude,
        lon: place.longitude,
        name: getPlaceName(place, locale),
        country_code: place.country_code,
        place_type: place.place_type,
        notes: fav.notes,
        savedAt: fav.created_at,
        placeId: place.id,
        temperature: weather.temp_max != null ? Math.round(weather.temp_max) : null,
        tempMin: weather.temp_min,
        tempMax: weather.temp_max,
        condition: weather.weather_main || null,
        weatherDescription: weather.weather_description || null,
        weatherIcon: weather.weather_icon || null,
        windSpeed: weather.wind_speed != null ? Math.round(weather.wind_speed) : null,
        humidity: weather.humidity || null,
      };
    });

    return { favourites: transformed, error: null };
  } catch (error) {
    console.error('Get favourites error:', error);
    return { favourites: [], error };
  }
};

/**
 * Add a place to favourites
 * @param {string} placeId - Place ID
 * @param {string} notes - Optional notes
 * @returns {Promise<{favourite, error}>}
 */
export const addFavourite = async (placeId, notes = null) => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const { data, error } = await supabase
      .from('favourites')
      .insert({
        user_id: user.id,
        place_id: placeId,
        notes,
      })
      .select(`
        *,
        places (*)
      `)
      .single();

    if (error) throw error;
    return { favourite: data, error: null };
  } catch (error) {
    console.error('Add favourite error:', error);
    return { favourite: null, error };
  }
};

/**
 * Remove a place from favourites
 * @param {string} placeId - Place ID
 * @returns {Promise<{error}>}
 */
export const removeFavourite = async (placeId) => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const { error } = await supabase
      .from('favourites')
      .delete()
      .eq('user_id', user.id)
      .eq('place_id', placeId);

    if (error) throw error;
    return { error: null };
  } catch (error) {
    console.error('Remove favourite error:', error);
    return { error };
  }
};

/**
 * Check if a place is in favourites
 * @param {string} placeId - Place ID
 * @returns {Promise<{isFavourite, error}>}
 */
export const isFavourite = async (placeId) => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { isFavourite: false, error: null };
    }

    const { data, error } = await supabase
      .from('favourites')
      .select('id')
      .eq('user_id', user.id)
      .eq('place_id', placeId)
      .single();

    if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows returned

    return { isFavourite: !!data, error: null };
  } catch (error) {
    console.error('Check favourite error:', error);
    return { isFavourite: false, error };
  }
};

/**
 * Clear all favourites for the current user
 * @returns {Promise<{error}>}
 */
export const clearFavourites = async () => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const { error } = await supabase
      .from('favourites')
      .delete()
      .eq('user_id', user.id);

    if (error) throw error;
    return { error: null };
  } catch (error) {
    console.error('Clear favourites error:', error);
    return { error };
  }
};

export default {
  getFavourites,
  addFavourite,
  removeFavourite,
  isFavourite,
  clearFavourites,
};


