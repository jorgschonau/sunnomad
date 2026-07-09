import { supabase } from '../config/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Linking from 'expo-linking';

/**
 * Authentication Service
 * Handles all authentication-related operations with Supabase
 */

const SESSION_KEY = '@sunnomad:session';

/**
 * Initialize auth session from storage
 */
export const initializeSession = async () => {
  try {
    const sessionJson = await AsyncStorage.getItem(SESSION_KEY);
    if (sessionJson) {
      const session = JSON.parse(sessionJson);
      const { data, error } = await supabase.auth.setSession({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      });
      
      if (error) throw error;
      return data.session;
    }
    return null;
  } catch (error) {
    if (__DEV__) console.warn('Stored session invalid, clearing:', error.message);
    await AsyncStorage.removeItem(SESSION_KEY);
    return null;
  }
};

/**
 * Save session to storage
 */
const saveSession = async (session) => {
  try {
    if (session) {
      await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } else {
      await AsyncStorage.removeItem(SESSION_KEY);
    }
  } catch (error) {
    console.error('Failed to save session:', error);
  }
};

/**
 * Sign up with email and password
 * @param {string} email - User's email
 * @param {string} password - User's password
 * @param {string} username - User's username
 * @param {string} displayName - User's display name
 * @returns {Promise<{user, session, error}>}
 */
export const signUp = async (email, password, username, displayName) => {
  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          username,
          display_name: displayName || username,
        },
      },
    });

    if (error) throw error;
    
    if (data.session) {
      await saveSession(data.session);
    }

    return { user: data.user, session: data.session, error: null };
  } catch (error) {
    console.error('Sign up error:', error);
    return { user: null, session: null, error };
  }
};

/**
 * Sign in with email and password
 * @param {string} email - User's email
 * @param {string} password - User's password
 * @returns {Promise<{user, session, error}>}
 */
export const signIn = async (email, password) => {
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) throw error;
    
    if (data.session) {
      await saveSession(data.session);
    }

    return { user: data.user, session: data.session, error: null };
  } catch (error) {
    console.error('Sign in error:', error);
    return { user: null, session: null, error };
  }
};

/**
 * Sign out current user
 * @returns {Promise<{error}>}
 */
export const signOut = async () => {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    
    await saveSession(null);
    return { error: null };
  } catch (error) {
    console.error('Sign out error:', error);
    return { error };
  }
};

/**
 * Get current user
 * @returns {Promise<User|null>}
 */
export const getCurrentUser = async () => {
  try {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error) throw error;
    return user;
  } catch (error) {
    console.error('Get current user error:', error);
    return null;
  }
};

/**
 * Get current session
 * @returns {Promise<Session|null>}
 */
export const getCurrentSession = async () => {
  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) throw error;
    return session;
  } catch (error) {
    console.error('Get current session error:', error);
    return null;
  }
};

/**
 * Reset password (send reset email)
 * @param {string} email - User's email
 * @returns {Promise<{error}>}
 */
export const resetPassword = async (email) => {
  try {
    const trimmed = email.trim();
    const { data: exists, error: checkError } = await supabase.rpc('check_email_registered', {
      email_input: trimmed,
    });

    if (!checkError && exists === false) {
      const err = new Error('email_not_registered');
      return { error: err };
    }

    if (checkError && __DEV__) {
      console.warn('check_email_registered unavailable, skipping pre-check:', checkError.message);
    }

    const { error } = await supabase.auth.resetPasswordForEmail(trimmed, {
      redirectTo: Linking.createURL('reset-password'),
    });
    if (error) throw error;
    return { error: null };
  } catch (error) {
    console.error('Reset password error:', error);
    return { error };
  }
};

/**
 * Update password
 * @param {string} newPassword - New password
 * @returns {Promise<{error}>}
 */
export const updatePassword = async (newPassword) => {
  try {
    const { error } = await supabase.auth.updateUser({
      password: newPassword,
    });
    if (error) throw error;
    return { error: null };
  } catch (error) {
    console.error('Update password error:', error);
    return { error };
  }
};

/**
 * Permanently delete the current user's account (Apple 5.1.1(v) / Google Play requirement).
 * Runs server-side via Edge Function since deleting an auth user needs the service role key.
 * Cascades to profiles/favourites via ON DELETE CASCADE.
 * @returns {Promise<{error}>}
 */
export const deleteAccount = async () => {
  try {
    const { error } = await supabase.functions.invoke('delete-account');
    if (error) throw error;

    await saveSession(null);
    return { error: null };
  } catch (error) {
    console.error('Delete account error:', error);
    return { error };
  }
};

/**
 * Parse Supabase auth tokens out of a deep link URL
 * (e.g. sunnomad://reset-password#access_token=...&refresh_token=...&type=recovery)
 * @param {string} url
 * @returns {{accessToken: string|null, refreshToken: string|null, type: string|null, error: string|null}|null}
 */
export const parseAuthUrl = (url) => {
  if (!url) return null;

  const hashIndex = url.indexOf('#');
  const queryIndex = url.indexOf('?');
  const paramsString =
    hashIndex >= 0 ? url.slice(hashIndex + 1) : queryIndex >= 0 ? url.slice(queryIndex + 1) : '';

  if (!paramsString) return null;

  const params = new URLSearchParams(paramsString);
  return {
    accessToken: params.get('access_token'),
    refreshToken: params.get('refresh_token'),
    type: params.get('type'),
    error: params.get('error_description') || params.get('error'),
  };
};

/**
 * Set the session from a password recovery deep link
 * @param {string} accessToken
 * @param {string} refreshToken
 * @returns {Promise<{session, error}>}
 */
export const setRecoverySession = async (accessToken, refreshToken) => {
  try {
    const { data, error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error) throw error;
    return { session: data.session, error: null };
  } catch (error) {
    console.error('Set recovery session error:', error);
    return { session: null, error };
  }
};

/**
 * Listen to auth state changes
 * @param {function} callback - Callback function (event, session) => void
 * @returns {object} Subscription object with unsubscribe method
 */
export const onAuthStateChange = (callback) => {
  const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
    await saveSession(session);
    callback(event, session);
  });
  
  return subscription;
};

export default {
  initializeSession,
  signUp,
  signIn,
  signOut,
  getCurrentUser,
  getCurrentSession,
  resetPassword,
  updatePassword,
  deleteAccount,
  parseAuthUrl,
  setRecoverySession,
  onAuthStateChange,
};


