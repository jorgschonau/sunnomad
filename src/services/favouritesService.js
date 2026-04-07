import { supabase } from '../config/supabase';
import { getPlaceName } from '../utils/localization';
import { mapWeatherMain } from '../domain/weatherPresentation';

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
      .order('created_at', { ascending: false });

    if (error) throw error;

    const transformed = (data || [])
      .filter(fav => fav.places != null)
      .map(fav => {
        const place = fav.places;
        const allForecasts = (place.weather_forecast || [])
          .filter(w => w.forecast_date >= today)
          .sort((a, b) => a.forecast_date.localeCompare(b.forecast_date));
        const weather = allForecasts[0] || {};
        const forecastArray = allForecasts.map(w => ({
          condition: mapWeatherMain(w.weather_main, w.weather_description),
          high: w.temp_max != null ? Math.round(w.temp_max) : null,
          temp: w.temp_max != null ? Math.round(w.temp_max) : null,
          low: w.temp_min != null ? Math.round(w.temp_min) : null,
          windSpeed: w.wind_speed != null ? Math.round(w.wind_speed) : 0,
          description: w.weather_description || '',
          humidity: w.humidity || null,
        }));
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
          condition: mapWeatherMain(weather.weather_main, weather.weather_description),
          weatherDescription: weather.weather_description || null,
          weatherIcon: weather.weather_icon || null,
          windSpeed: weather.wind_speed != null ? Math.round(weather.wind_speed) : null,
          humidity: weather.humidity || null,
          forecastArray,
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


