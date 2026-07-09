import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';

// Import JSON files
const de = require('./locales/de.json');
const en = require('./locales/en.json');
const fr = require('./locales/fr.json');

const resources = {
  de: { translation: de },
  en: { translation: en },
  fr: { translation: fr },
};

// Get device language
let deviceLanguage = 'en';
try {
  const locale = Localization.locale || Localization.getLocales()[0]?.languageCode || 'en';
  deviceLanguage = locale.split('-')[0] || 'en';
} catch (error) {
  if (__DEV__) console.warn('Could not get device language:', error);
}

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: deviceLanguage,
    fallbackLng: 'en',
    compatibilityJSON: 'v3',
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;

