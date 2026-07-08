import AsyncStorage from '@react-native-async-storage/async-storage';
import { v4 as uuidv4 } from 'uuid';

const TOKEN = process.env.EXPO_PUBLIC_MIXPANEL_TOKEN;
const API = 'https://api-eu.mixpanel.com/track';
const STORAGE_KEY = 'mp_distinct_id';
const IS_DEV = typeof __DEV__ !== 'undefined' && __DEV__;
const TRACKING_ENABLED = !!TOKEN && !IS_DEV;

const BASE_PROPERTIES = {
  app_environment: IS_DEV ? 'development' : 'production',
};

let distinctId = 'anonymous';

async function persistDistinctId(id) {
  distinctId = id;
  try {
    await AsyncStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* keep in-memory id */
  }
}

export async function initMixpanel() {
  try {
    let id = await AsyncStorage.getItem(STORAGE_KEY);
    if (!id) {
      id = uuidv4();
      await AsyncStorage.setItem(STORAGE_KEY, id);
    }
    distinctId = id;
  } catch {
    distinctId = 'anonymous';
  }
}

/** Tie events to Supabase user id after login. */
export async function identifyUser(userId) {
  if (!userId) return;
  await persistDistinctId(String(userId));
}

/** New anonymous id after logout. */
export async function resetMixpanelIdentity() {
  await persistDistinctId(uuidv4());
}

function send(event, properties = {}) {
  if (!TRACKING_ENABLED) return;

  const payload = JSON.stringify([{
    event,
    properties: { token: TOKEN, distinct_id: distinctId, ...BASE_PROPERTIES, ...properties },
  }]);
  fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(payload)}`,
  }).catch(() => {});
}

export const mixpanel = {
  track: send,
  identify: identifyUser,
  reset: resetMixpanelIdentity,
  flush: () => {},
};
