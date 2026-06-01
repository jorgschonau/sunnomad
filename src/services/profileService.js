import { supabase } from '../config/supabase';

/**
 * Profile Service
 * Handles user profile operations
 */

/**
 * Get user profile by ID
 * @param {string} userId - User ID
 * @returns {Promise<{profile, error}>}
 */
export const getProfile = async (userId) => {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) throw error;
    return { profile: data, error: null };
  } catch (error) {
    console.error('Get profile error:', error);
    return { profile: null, error };
  }
};

/**
 * Update user profile
 * @param {string} userId - User ID
 * @param {object} updates - Profile updates
 * @returns {Promise<{profile, error}>}
 */
export const updateProfile = async (userId, updates) => {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', userId)
      .select()
      .single();

    if (error) throw error;
    return { profile: data, error: null };
  } catch (error) {
    console.error('Update profile error:', error);
    return { profile: null, error };
  }
};

/**
 * Upload avatar image
 * @param {string} userId - User ID
 * @param {string} fileUri - Local file URI
 * @param {string} fileType - File MIME type
 * @returns {Promise<{url, error}>}
 */
export const uploadAvatar = async (userId, fileUri, fileType = 'image/jpeg') => {
  try {
    // Create unique filename
    const fileExt = fileType.split('/')[1];
    const fileName = `${userId}/${Date.now()}.${fileExt}`;

    // Read file as blob (for React Native)
    const response = await fetch(fileUri);
    const blob = await response.blob();

    // Upload to Supabase Storage
    const { data, error } = await supabase.storage
      .from('avatars')
      .upload(fileName, blob, {
        contentType: fileType,
        upsert: true,
      });

    if (error) throw error;

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('avatars')
      .getPublicUrl(fileName);

    return { url: publicUrl, error: null };
  } catch (error) {
    console.error('Upload avatar error:', error);
    return { url: null, error };
  }
};

/**
 * Search profiles by username
 * @param {string} query - Search query
 * @param {number} limit - Max results
 * @returns {Promise<{profiles, error}>}
 */
export const searchProfiles = async (query, limit = 10) => {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, username, display_name, avatar_url')
      .or(`username.ilike.%${query}%,display_name.ilike.%${query}%`)
      .eq('is_public', true)
      .limit(limit);

    if (error) throw error;
    return { profiles: data, error: null };
  } catch (error) {
    console.error('Search profiles error:', error);
    return { profiles: [], error };
  }
};

export const recordAppOpen = async (userId) => {
  try {
    await supabase.rpc('increment_app_open', { uid: userId });
  } catch {
    // fire-and-forget, non-critical
  }
};

export default {
  getProfile,
  updateProfile,
  uploadAvatar,
  searchProfiles,
  recordAppOpen,
};


