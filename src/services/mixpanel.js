import AsyncStorage from '@react-native-async-storage/async-storage';
import { v4 as uuidv4 } from 'uuid';

const TOKEN = process.env.EXPO_PUBLIC_MIXPANEL_TOKEN;
const API = 'https://api-eu.mixpanel.com/track';
const STORAGE_KEY = 'mp_distinct_id';

let distinctId = 'anonymous';

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

function send(event, properties = {}) {
  const payload = JSON.stringify([{
    event,
    properties: { token: TOKEN, distinct_id: distinctId, ...properties },
  }]);
  fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(payload)}`,
  }).catch(() => {});
}

export const mixpanel = {
  track: send,
  flush: () => {},
};
