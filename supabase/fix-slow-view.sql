-- ============================================================================
-- QUICK FIX: Fast VIEW ohne LATERAL JOIN
-- ============================================================================
-- Run this if map is slow after migration

-- Drop old VIEW
DROP VIEW IF EXISTS places_with_latest_weather CASCADE;

-- Create FASTER VIEW (using DISTINCT ON instead of LATERAL)
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
  AND (p.to_remove IS NULL OR p.to_remove = false)
ORDER BY p.id, w.fetched_at DESC NULLS LAST;

-- Create essential indexes if missing
CREATE INDEX IF NOT EXISTS weather_forecast_place_date_fetched_idx 
  ON weather_forecast(place_id, forecast_date, fetched_at DESC);

CREATE INDEX IF NOT EXISTS places_active_idx 
  ON places(is_active) 
  WHERE is_active = true;

-- Verify it works
SELECT COUNT(*) FROM places_with_latest_weather;
