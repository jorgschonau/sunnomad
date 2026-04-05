-- ============================================================================
-- RESTORE WORKING VIEW - Back to basics!
-- ============================================================================
-- This removes to_remove filter completely - just get it working again

DROP VIEW IF EXISTS places_with_latest_weather CASCADE;

CREATE OR REPLACE VIEW places_with_latest_weather AS
SELECT DISTINCT ON (p.id)
  p.id,
  p.name_en,
  p.latitude,
  p.longitude,
  p.country_code,
  p.region,
  p.place_type,
  p.attractiveness_score,
  p.population,
  
  w.forecast_date,
  w.forecast_timestamp,
  ROUND((w.temp_min + w.temp_max) / 2.0, 1) AS temperature,
  w.temp_min,
  w.temp_max,
  w.weather_main,
  w.weather_description,
  w.weather_icon,
  w.wind_speed,
  w.precipitation_sum,
  w.precipitation_probability,
  w.sunrise,
  w.sunset,
  w.rain_volume AS rain_1h,
  w.snow_volume AS snow_1h,
  w.fetched_at AS weather_timestamp,
  w.data_source,
  
  NULL::decimal AS feels_like,
  NULL::integer AS humidity,
  NULL::integer AS cloud_cover,
  NULL::decimal AS rain_3h,
  NULL::decimal AS snow_3h,
  NULL::decimal AS snow_24h,
  NULL::decimal AS wind_gust,
  NULL::integer AS stability_score,
  NULL::text AS weather_trend
  
FROM places p
LEFT JOIN weather_forecast w 
  ON w.place_id = p.id 
  AND w.forecast_date = CURRENT_DATE
WHERE p.is_active = true
ORDER BY p.id, w.fetched_at DESC NULLS LAST;

-- Test it
SELECT COUNT(*) FROM places_with_latest_weather;
SELECT * FROM places_with_latest_weather LIMIT 5;
