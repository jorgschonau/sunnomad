import { Platform, Linking } from 'react-native';

/**
 * Navigation providers supported
 */
export const NavigationProvider = {
  APPLE_MAPS: 'apple',
  GOOGLE_MAPS: 'google',
  AUTO: 'auto', // Automatically choose based on platform
};

/**
 * Opens external navigation app with the destination
 * @param {Object} place - Destination object with lat, lon, and name
 * @param {string} providerPreference - Provider preference ('apple', 'google', or 'auto')
 * @returns {Promise<void>}
 */
export const openInMaps = async (place, providerPreference = NavigationProvider.AUTO) => {
  const { lat, lon, name } = place;

  if (!lat || !lon) {
    throw new Error('Place must have valid lat and lon coordinates');
  }

  // Determine which provider to use
  // Default: Google Maps (user can override in settings later)
  let provider = providerPreference;
  if (provider === NavigationProvider.AUTO) {
    provider = NavigationProvider.GOOGLE_MAPS;
  }

  try {
    if (provider === NavigationProvider.APPLE_MAPS) {
      await openAppleMaps(lat, lon, name);
    } else if (provider === NavigationProvider.GOOGLE_MAPS) {
      await openGoogleMaps(lat, lon, name);
    } else {
      throw new Error(`Unknown provider: ${provider}`);
    }
  } catch (error) {
    console.warn(`Failed to open ${provider} maps, trying fallback`, error);
    // Fallback: try the opposite provider
    try {
      if (provider === NavigationProvider.APPLE_MAPS) {
        await openGoogleMaps(lat, lon, name);
      } else {
        await openAppleMaps(lat, lon, name);
      }
    } catch (fallbackError) {
      console.warn('Fallback also failed, opening web maps', fallbackError);
      // Final fallback: Google Maps web
      await openWebMaps(lat, lon, name);
    }
  }
};

/**
 * Open Apple Maps (native app)
 */
const openAppleMaps = async (lat, lon, name) => {
  const label = encodeURIComponent(name || 'Destination');
  const url = Platform.select({
    ios: `maps:0,0?q=${label}@${lat},${lon}`,
    android: `geo:0,0?q=${lat},${lon}(${label})`, // Android fallback
  });

  const canOpen = await Linking.canOpenURL(url);
  if (!canOpen) {
    throw new Error('Cannot open Apple Maps');
  }

  await Linking.openURL(url);
};

/**
 * Open Google Maps
 * On iOS: use universal link (opens app if installed, otherwise browser)
 * On Android: try native intent first, then geo: scheme
 */
const openGoogleMaps = async (lat, lon, name) => {
  const label = encodeURIComponent(name || 'Destination');

  if (Platform.OS === 'ios') {
    // Universal link: opens Google Maps app if installed, Safari otherwise
    const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
    await Linking.openURL(url);
    return;
  }

  // Android: try native navigation intent
  const nativeUrl = `google.navigation:q=${lat},${lon}`;
  const canOpenNative = await Linking.canOpenURL(nativeUrl);
  if (canOpenNative) {
    await Linking.openURL(nativeUrl);
    return;
  }

  // Android fallback: geo scheme
  const geoUrl = `geo:${lat},${lon}?q=${lat},${lon}(${label})`;
  const canOpenGeo = await Linking.canOpenURL(geoUrl);
  if (canOpenGeo) {
    await Linking.openURL(geoUrl);
    return;
  }

  throw new Error('Cannot open Google Maps');
};

/**
 * Open Google Maps web (ultimate fallback)
 */
const openWebMaps = async (lat, lon, name) => {
  const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
  await Linking.openURL(url);
};

/**
 * Check if a specific navigation provider is available
 */
export const isNavigationProviderAvailable = async (provider) => {
  try {
    if (provider === NavigationProvider.APPLE_MAPS) {
      const url = Platform.select({
        ios: 'maps:0,0',
        android: 'geo:0,0',
      });
      return await Linking.canOpenURL(url);
    } else if (provider === NavigationProvider.GOOGLE_MAPS) {
      const url = Platform.select({
        ios: 'comgooglemaps://',
        android: 'google.navigation:q=0,0',
      });
      return await Linking.canOpenURL(url);
    }
    return false;
  } catch (error) {
    return false;
  }
};





