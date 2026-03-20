import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';

let _promise = null;

/**
 * Pre-warm location permission, last known position, and AsyncStorage
 * during splash screen. All calls are cached by the OS / SQLite,
 * so MapScreen's initializeLocation() benefits from near-instant returns.
 */
export function startLocationPreload() {
  if (_promise) return _promise;

  const permissionP = Location.requestForegroundPermissionsAsync()
    .catch(() => ({ status: 'denied' }));

  const servicesP = Location.hasServicesEnabledAsync().catch(() => false);

  const storageP = Promise.all([
    AsyncStorage.getItem('hasSeenOnboarding'),
    AsyncStorage.getItem('mapCenterPoint'),
    AsyncStorage.getItem('selectedDateOffset'),
    AsyncStorage.getItem('mapDestinationsCache'),
  ]).catch(() => []);

  // Chain location fetch after permission (needs grant first)
  const locationP = permissionP.then(({ status }) => {
    if (status === 'granted') {
      return Location.getLastKnownPositionAsync({ maxAge: 60000 }).catch(() => null);
    }
    return null;
  });

  _promise = Promise.allSettled([permissionP, servicesP, storageP, locationP]);
  return _promise;
}

export function getPreloadPromise() {
  return _promise || Promise.resolve(null);
}
