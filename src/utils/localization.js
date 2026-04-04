import i18n from '../i18n';

/**
 * Get the localized place name with fallback chain:
 * preferred language → name_en → 'Unknown'
 *
 * @param {Object} place - Place object with name_en, name_de, name_fr
 * @param {string} [locale] - Language code ('de', 'fr', 'en'). Defaults to current i18n language.
 * @returns {string}
 */
export const getPlaceName = (place, locale) => {
  if (!place) return 'Unknown';
  const lang = (locale || i18n.language || 'en').split('-')[0];

  switch (lang) {
    case 'de':
      return place.name_de ?? place.name_en ?? 'Unknown';
    case 'fr':
      return place.name_fr ?? place.name_en ?? 'Unknown';
    default:
      return place.name_en ?? 'Unknown';
  }
};
