/**
 * SINGLE SOURCE OF TRUTH for weather condition mapping.
 *
 * WMO code → condition   (mapWeatherCode)
 * DB string → condition   (mapWeatherMain)
 * condition → emoji        (getWeatherIcon)
 * condition → color        (getWeatherColor)
 *
 * Every file in the app imports from HERE. No duplicates anywhere.
 */

/**
 * WMO Weather Code → app condition.
 * Used when we have the raw numeric code from Open-Meteo.
 * https://open-meteo.com/en/docs#weathervariables
 */
export const mapWeatherCode = (code) => {
  if (code === null || code === undefined) return 'cloudy';
  if (code <= 1) return 'sunny';   // 0 Clear sky, 1 Mainly clear
  if (code <= 3) return 'cloudy';  // 2 Partly cloudy, 3 Overcast
  if (code <= 48) return 'windy';  // 45-48 Fog
  if (code <= 67) return 'rainy';  // 51-67 Drizzle & Rain
  if (code <= 77) return 'snowy';  // 71-77 Snow
  if (code <= 82) return 'rainy';  // 80-82 Rain showers
  if (code <= 86) return 'snowy';  // 85-86 Snow showers
  if (code <= 99) return 'rainy';  // 95-99 Thunderstorm
  return 'cloudy';
};

/**
 * DB weather_main string → app condition.
 * Handles both Open-Meteo ('Clear','Clouds') and legacy OpenWeatherMap values.
 */
export const mapWeatherMain = (weatherMain, weatherDescription = '') => {
  if (!weatherMain) return 'cloudy';

  const main = weatherMain.toLowerCase();
  const desc = (weatherDescription || '').toLowerCase();

  // Already an app condition → pass through
  if (main === 'sunny' || main === 'cloudy' || main === 'rainy' || main === 'snowy' || main === 'windy') return main;

  if (main === 'clear') return 'sunny';
  if (main === 'clouds') {
    // WMO code 1 "Mainly clear" was stored as 'Clouds' before the fix
    if (desc.includes('mainly clear') || desc.includes('clear sky')) return 'sunny';
    return 'cloudy';
  }
  if (main === 'rain' || main === 'drizzle' || main === 'thunderstorm') return 'rainy';
  if (main === 'snow') return 'snowy';
  if (main === 'fog' || main === 'mist' || main === 'haze') return 'windy';

  // Description fallback (OpenWeatherMap data)
  if (desc.includes('sun') || desc.includes('clear')) return 'sunny';
  if (desc.includes('shower') || desc.includes('rain') || desc.includes('drizzle')) return 'rainy';
  if (desc.includes('snow')) return 'snowy';
  if (desc.includes('wind') || desc.includes('storm')) return 'windy';

  return 'cloudy';
};

/** App condition → emoji */
export const getWeatherIcon = (condition) => {
  const icons = {
    sunny: '☀️',
    cloudy: '☁️',
    rainy: '🌧️',
    snowy: '❄️',
    windy: '💨',
  };
  return icons[condition] || '☀️';
};

/** App condition → marker/header color */
export const getWeatherColor = (condition, temperature = null) => {
  const colors = {
    sunny: '#F0A84D',
    cloudy: '#90A4AE',
    rainy: '#64B5F6',
    snowy: '#E8F0F6',
    windy: '#B8C7CE',
  };

  if (condition === 'sunny' && temperature !== null) {
    if (temperature < -10) return '#D6E8F5';
    if (temperature < 0) return '#E5EEF6';
  }

  return colors[condition] || '#F0A84D';
};
