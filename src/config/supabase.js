import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

// Supabase Configuration — read from app.config.js extra (not .env)
const supabaseUrl = Constants.expoConfig?.extra?.supabaseUrl ?? '';
const supabaseAnonKey = Constants.expoConfig?.extra?.supabaseAnonKey ?? '';

if (__DEV__ && (!supabaseUrl || !supabaseAnonKey)) {
  console.warn('Supabase credentials not configured. Auth features will be disabled.');
}

// Without this, a dead/absent connection makes fetch hang on the OS-level TCP
// timeout (30-60s+) before rejecting — the user just stares at a spinner.
// Aborting after 10s surfaces "Network request timed out" much sooner.
const REQUEST_TIMEOUT_MS = 10000;

const fetchWithTimeout = (url, options = {}) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  return fetch(url, { ...options, signal: controller.signal }).finally(() => {
    clearTimeout(timeoutId);
  });
};

// Create Supabase client with AsyncStorage for session persistence
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  global: {
    fetch: fetchWithTimeout,
  },
});

export default supabase;


