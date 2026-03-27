/**
 * Domain/UI shared presentation mapping for weather conditions.
 * (Kept here so UI can stay dumb; UI should consume via usecases.)
 */
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

export const getWeatherColor = (condition, temperature = null) => {
  const colors = {
    sunny: '#F0A84D',
    cloudy: '#90A4AE',
    rainy: '#64B5F6',
    snowy: '#E8F0F6',
    windy: '#B8C7CE',
  };
  
  // Sunny but cold → temperature-based blue gradient
  if (condition === 'sunny' && temperature !== null) {
    if (temperature < -10) return '#D6E8F5';
    if (temperature < 0) return '#E5EEF6';
  }
  
  return colors[condition] || '#F0A84D';
};





