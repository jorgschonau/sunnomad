import { Mixpanel } from 'mixpanel-react-native';

const token = process.env.EXPO_PUBLIC_MIXPANEL_TOKEN;

export const mixpanel = new Mixpanel(token, true, false, { serverURL: 'https://api-eu.mixpanel.com' });

export function initMixpanel() {
  mixpanel.init();
}
