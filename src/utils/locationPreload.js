import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';

let _promise = null;

// Filled in as each preload step resolves, so consumers (MapScreen) can read
// whatever is already available without re-issuing the same native calls.
const _resolved = {
  permissionStatus: null, // 'granted' | 'denied' | null (not resolved yet)
  servicesEnabled: null,
  lastKnownPosition: null,
};

// Last real GPS fix applied anywhere in the app during this session (in-memory only).
// Lets a MapScreen remount (e.g. login/logout) start from a known position instantly
// instead of waiting on Location APIs again.
let _cachedLocation = null;

/**
 * Pre-warm location permission, last known position, and AsyncStorage
 * during splash screen. All calls are cached by the OS / SQLite,
 * so MapScreen's initializeLocation() benefits from near-instant returns.
 */
export function startLocationPreload() {
  if (_promise) return _promise;

  const permissionP = Location.requestForegroundPermissionsAsync()
    .then(({ status }) => {
      _resolved.permissionStatus = status;
      return { status };
    })
    .catch(() => {
      _resolved.permissionStatus = 'denied';
      return { status: 'denied' };
    });

  const servicesP = Location.hasServicesEnabledAsync()
    .then((enabled) => {
      _resolved.servicesEnabled = enabled;
      return enabled;
    })
    .catch(() => {
      _resolved.servicesEnabled = false;
      return false;
    });

  const storageP = Promise.all([
    AsyncStorage.getItem('hasSeenOnboarding'),
    AsyncStorage.getItem('mapCenterPoint'),
    AsyncStorage.getItem('selectedDateOffset'),
    AsyncStorage.getItem('mapDestinationsCache'),
  ]).catch(() => []);

  // Chain location fetch after permission (needs grant first)
  const locationP = permissionP.then(({ status }) => {
    if (status === 'granted') {
      return Location.getLastKnownPositionAsync({ maxAge: 60000 })
        .then((position) => {
          _resolved.lastKnownPosition = position;
          return position;
        })
        .catch(() => null);
    }
    return null;
  });

  _promise = Promise.allSettled([permissionP, servicesP, storageP, locationP]);
  return _promise;
}

export function getPreloadPromise() {
  return _promise || Promise.resolve(null);
}

/**
 * Snapshot of whatever preload steps have resolved so far.
 * Fields are null until their respective call finishes.
 */
export function getPreloadResult() {
  return _resolved;
}

export function setCachedLocation({ latitude, longitude }) {
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return;
  _cachedLocation = { latitude, longitude, timestamp: Date.now() };
}

export function getCachedLocation() {
  return _cachedLocation;
}
