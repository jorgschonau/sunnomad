-- ============================================================================
-- Simplified places_with_latest_weather view
-- Clustering is now handled by react-native-map-clustering library
-- ============================================================================

DROP VIEW IF EXISTS places_with_latest_weather CASCADE;

CREATE OR REPLACE VIEW places_with_latest_weather AS
SELECT 
  p.id,
  p.name_en,
  p.latitude,
  p.longitude,
  p.country_code,
  p.region,
  p.place_type,
  p.attractiveness_score,
  p.population,
  
  -- Latest weather data
  w.weather_timestamp,
  w.temperature,
  w.feels_like,
  w.temp_min,
  w.temp_max,
  w.humidity,
  w.pressure,
  w.wind_speed,
  w.wind_deg,
  w.wind_gust,
  w.clouds AS cloud_cover,
  w.rain_1h,
  w.rain_3h,
  w.snow_1h,
  w.snow_3h,
  w.snow_24h,
  w.weather_main,
  w.weather_description,
  w.weather_icon,
  w.stability_score,
  w.weather_trend,
  w.data_source
  
FROM places p
LEFT JOIN LATERAL (
  SELECT *
  FROM weather_data
  WHERE place_id = p.id
  ORDER BY weather_timestamp DESC
  LIMIT 1
) w ON true
WHERE p.is_active = true;
