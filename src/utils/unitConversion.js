/**
 * Unit conversion utilities for distance and temperature
 */

/**
 * Convert kilometers to miles
 * @param {number} km - Distance in kilometers
 * @returns {number} - Distance in miles
 */
export const kmToMiles = (km) => {
  return km * 0.621371;
};

/**
 * Convert miles to kilometers
 * @param {number} miles - Distance in miles
 * @returns {number} - Distance in kilometers
 */
export const milesToKm = (miles) => {
  return miles * 1.60934;
};

/**
 * Convert Celsius to Fahrenheit
 * @param {number} celsius - Temperature in Celsius
 * @returns {number} - Temperature in Fahrenheit
 */
export const celsiusToFahrenheit = (celsius) => {
  return (celsius * 9/5) + 32;
};

/**
 * Convert Fahrenheit to Celsius
 * @param {number} fahrenheit - Temperature in Fahrenheit
 * @returns {number} - Temperature in Celsius
 */
export const fahrenheitToCelsius = (fahrenheit) => {
  return (fahrenheit - 32) * 5/9;
};

/**
 * Format distance based on unit preference
 * @param {number} distanceKm - Distance in kilometers
 * @param {string} unit - 'km' or 'miles'
 * @param {number} decimals - Number of decimal places (default: 0)
 * @returns {string} - Formatted distance with unit
 */
export const formatDistance = (distanceKm, unit = 'km', decimals = 0) => {
  if (unit === 'miles') {
    const miles = kmToMiles(distanceKm);
    return `${miles.toFixed(decimals)} mi`;
  }
  return `${distanceKm.toFixed(decimals)} km`;
};

/**
 * Format temperature based on unit preference
 * @param {number} tempCelsius - Temperature in Celsius
 * @param {string} unit - 'celsius' or 'fahrenheit'
 * @param {boolean} includeSymbol - Include degree symbol (default: true)
 * @returns {string} - Formatted temperature with unit
 */
export const formatTemperature = (tempCelsius, unit = 'celsius', includeSymbol = true) => {
  if (unit === 'fahrenheit') {
    const fahrenheit = celsiusToFahrenheit(tempCelsius);
    return includeSymbol ? `${Math.round(fahrenheit)} °F` : `${Math.round(fahrenheit)}°`;
  }
  return includeSymbol ? `${Math.round(tempCelsius)} °C` : `${Math.round(tempCelsius)}°`;
};

/**
 * Get numeric temperature value based on unit preference (for calculations)
 * @param {number} tempCelsius - Temperature in Celsius
 * @param {string} unit - 'celsius' or 'fahrenheit'
 * @returns {number} - Temperature in selected unit
 */
export const getTemperatureValue = (tempCelsius, unit = 'celsius') => {
  if (unit === 'fahrenheit') {
    return Math.round(celsiusToFahrenheit(tempCelsius));
  }
  return Math.round(tempCelsius);
};

/**
 * Get numeric distance value based on unit preference (for calculations)
 * @param {number} distanceKm - Distance in kilometers
 * @param {string} unit - 'km' or 'miles'
 * @returns {number} - Distance in selected unit
 */
export const getDistanceValue = (distanceKm, unit = 'km') => {
  if (unit === 'miles') {
    return kmToMiles(distanceKm);
  }
  return distanceKm;
};

/**
 * Convert km/h to mph
 * @param {number} kmh - Speed in km/h
 * @returns {number} - Speed in mph
 */
export const kmhToMph = (kmh) => {
  return kmh * 0.621371;
};

/**
 * Convert km/h to m/s
 * @param {number} kmh - Speed in km/h
 * @returns {number} - Speed in m/s
 */
export const kmhToMs = (kmh) => {
  return kmh / 3.6;
};

/**
 * Convert km/h to Beaufort scale
 * @param {number} kmh - Speed in km/h
 * @returns {number} - Beaufort scale (0-12)
 */
export const kmhToBeaufort = (kmh) => {
  if (kmh < 1) return 0;
  if (kmh < 6) return 1;
  if (kmh < 12) return 2;
  if (kmh < 20) return 3;
  if (kmh < 29) return 4;
  if (kmh < 39) return 5;
  if (kmh < 50) return 6;
  if (kmh < 62) return 7;
  if (kmh < 75) return 8;
  if (kmh < 89) return 9;
  if (kmh < 103) return 10;
  if (kmh < 118) return 11;
  return 12;
};

/**
 * Get Beaufort description
 * @param {number} beaufort - Beaufort scale (0-12)
 * @returns {string} - Description (e.g., "Light breeze", "Gale")
 */
export const getBeaufortDescription = (beaufort) => {
  const descriptions = [
    'Calm', 'Light air', 'Light breeze', 'Gentle breeze',
    'Moderate breeze', 'Fresh breeze', 'Strong breeze', 'Near gale',
    'Gale', 'Strong gale', 'Storm', 'Violent storm', 'Hurricane'
  ];
  return descriptions[beaufort] || 'Unknown';
};

/**
 * Convert mm to inches
 * @param {number} mm - Precipitation in mm
 * @returns {number} - Precipitation in inches
 */
export const mmToInches = (mm) => {
  return mm * 0.0393701;
};

/**
 * Convert inches to mm
 * @param {number} inches - Precipitation in inches
 * @returns {number} - Precipitation in mm
 */
export const inchesToMm = (inches) => {
  return inches * 25.4;
};

/**
 * Format wind speed based on unit preference
 * @param {number} speedKmh - Wind speed in km/h
 * @param {string} unit - 'kmh', 'mph', 'ms', or 'beaufort'
 * @returns {string} - Formatted wind speed with unit
 */
export const formatWindSpeed = (speedKmh, unit = 'kmh') => {
  switch (unit) {
    case 'mph':
      const mph = kmhToMph(speedKmh);
      return `${Math.round(mph)} mph`;
    case 'ms':
      const ms = kmhToMs(speedKmh);
      return `${ms.toFixed(1)} m/s`;
    case 'beaufort':
      const beaufort = kmhToBeaufort(speedKmh);
      return `${beaufort} Bft`;
    default: // 'kmh'
      return `${Math.round(speedKmh)} km/h`;
  }
};

/**
 * Format precipitation based on unit preference
 * @param {number} precipMm - Precipitation in mm
 * @param {string} unit - 'mm' or 'inches'
 * @param {number} decimals - Number of decimal places (default: 1)
 * @returns {string} - Formatted precipitation with unit
 */
export const formatPrecipitation = (precipMm, unit = 'mm', decimals = 1) => {
  if (unit === 'inches') {
    const inches = mmToInches(precipMm);
    return `${inches.toFixed(decimals)} in`;
  }
  return `${precipMm.toFixed(decimals)} mm`;
};

/**
 * Get temperature unit symbol
 * @param {string} unit - 'celsius' or 'fahrenheit'
 * @returns {string} - '°C' or '°F'
 */
export const getTemperatureSymbol = (unit = 'celsius') => {
  return unit === 'fahrenheit' ? '°F' : '°C';
};

/**
 * Get distance unit symbol
 * @param {string} unit - 'km' or 'miles'
 * @returns {string} - 'km' or 'mi'
 */
export const getDistanceSymbol = (unit = 'km') => {
  return unit === 'miles' ? 'mi' : 'km';
};

/**
 * Get wind speed unit symbol
 * @param {string} unit - 'kmh', 'mph', 'ms', or 'beaufort'
 * @returns {string} - Unit symbol
 */
export const getWindSpeedSymbol = (unit = 'kmh') => {
  const symbols = {
    kmh: 'km/h',
    mph: 'mph',
    ms: 'm/s',
    beaufort: 'Bft'
  };
  return symbols[unit] || 'km/h';
};

/**
 * Get precipitation unit symbol
 * @param {string} unit - 'mm' or 'inches'
 * @returns {string} - 'mm' or 'in'
 */
export const getPrecipitationSymbol = (unit = 'mm') => {
  return unit === 'inches' ? 'in' : 'mm';
};
