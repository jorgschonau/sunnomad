-- Quick fixes for weather data issues
-- Run this in Supabase SQL Editor

-- STEP 1: Drop views that depend on pressure columns
DROP VIEW IF EXISTS places_with_latest_weather CASCADE;
DROP VIEW IF EXISTS places_with_30day_trends CASCADE;
DROP VIEW IF EXISTS user_favourites_with_weather CASCADE;

-- STEP 2: Fix pressure fields: INTEGER → DECIMAL
ALTER TABLE weather_data 
  ALTER COLUMN pressure TYPE DECIMAL(6, 2),
  ALTER COLUMN pressure_sea_level TYPE DECIMAL(6, 2),
  ALTER COLUMN pressure_ground_level TYPE DECIMAL(6, 2);

ALTER TABLE weather_forecast
  ALTER COLUMN pressure TYPE DECIMAL(6, 2);

ALTER TABLE daily_weather_summary
  ALTER COLUMN pressure_avg TYPE DECIMAL(6, 2);

-- STEP 3: Recreate views
CREATE OR REPLACE VIEW places_with_latest_weather AS
SELECT 
  p.*,
  w.weather_timestamp,
  w.temperature,
  w.feels_like,
  w.temp_min,
  w.temp_max,
  w.weather_main,
  w.weather_description,
  w.weather_icon,
  w.humidity,
  w.pressure,
  w.wind_speed,
  w.wind_deg,
  w.wind_gust,
  w.clouds,
  w.rain_1h,
  w.rain_3h,
  w.snow_1h,
  w.uv_index,
  w.visibility,
  w.stability_score,
  w.comfort_score
FROM places p
LEFT JOIN LATERAL (
  SELECT *
  FROM weather_data
  WHERE place_id = p.id
  ORDER BY weather_timestamp DESC
  LIMIT 1
) w ON true
WHERE p.is_active = true;

CREATE OR REPLACE VIEW places_with_30day_trends AS
SELECT
  p.id as place_id,
  p.name_en,
  p.latitude,
  p.longitude,
  p.country_code,
  AVG(d.temp_avg) as temp_30d_avg,
  MIN(d.temp_min) as temp_30d_min,
  MAX(d.temp_max) as temp_30d_max,
  AVG(d.rain_total) as rain_30d_avg,
  SUM(d.rain_total) as rain_30d_total,
  AVG(d.wind_speed_max) as wind_30d_avg_max,
  AVG(d.clouds_avg) as clouds_30d_avg,
  COUNT(*) FILTER (WHERE d.rain_total > 1.0) as rainy_days_30d,
  COUNT(*) FILTER (WHERE d.clouds_avg < 30) as sunny_days_30d,
  COUNT(*) as total_days
FROM places p
LEFT JOIN daily_weather_summary d ON p.id = d.place_id
  AND d.date >= CURRENT_DATE - INTERVAL '30 days'
WHERE p.is_active = true
GROUP BY p.id, p.name_en, p.latitude, p.longitude, p.country_code;

CREATE OR REPLACE VIEW user_favourites_with_weather AS
SELECT 
  f.user_id,
  f.id as favourite_id,
  f.notes,
  f.tags,
  f.created_at as saved_at,
  p.*,
  w.temperature,
  w.feels_like,
  w.weather_main,
  w.weather_description,
  w.weather_icon,
  w.humidity,
  w.wind_speed,
  w.clouds,
  w.rain_1h,
  w.uv_index,
  w.stability_score,
  w.weather_timestamp
FROM favourites f
JOIN places p ON f.place_id = p.id
LEFT JOIN LATERAL (
  SELECT *
  FROM weather_data
  WHERE place_id = p.id
  ORDER BY weather_timestamp DESC
  LIMIT 1
) w ON true;

-- 2. Fix RLS policies: Allow service role / anon to insert
-- (for backend scripts like run-weather-update.js)

-- Weather data: Allow anon inserts
DROP POLICY IF EXISTS "Authenticated users can insert weather data" ON weather_data;
CREATE POLICY "Anyone can insert weather data"
  ON weather_data FOR INSERT
  WITH CHECK (true);

-- Weather forecast: Allow anon inserts  
DROP POLICY IF EXISTS "Authenticated users can insert forecast" ON weather_forecast;
CREATE POLICY "Anyone can insert weather forecast"
  ON weather_forecast FOR INSERT
  WITH CHECK (true);

-- Daily weather summary: Allow anon inserts
DROP POLICY IF EXISTS "Authenticated users can insert daily summaries" ON daily_weather_summary;
CREATE POLICY "Anyone can insert daily summaries"
  ON daily_weather_summary FOR INSERT
  WITH CHECK (true);

