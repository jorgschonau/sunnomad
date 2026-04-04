-- ============================================================================
-- Consolidate Weather Tables - Single Source of Truth
-- ============================================================================
-- Purpose: Merge weather_data + weather_forecast into single weather_forecast table
-- Date: 2026-01-24
-- 
-- Why: Simpler schema, better performance, ready for date-based map filtering
--
-- IMPORTANT: This assumes weather_data is already empty or we don't care about old data
-- (we're starting fresh with Open-Meteo anyway)
-- ============================================================================

-- ============================================================================
-- STEP 0: Add to_remove column to places (if not exists)
-- ============================================================================

ALTER TABLE places 
  ADD COLUMN IF NOT EXISTS to_remove BOOLEAN DEFAULT false;

-- Index for fast filtering (partial index for true values only)
CREATE INDEX IF NOT EXISTS places_to_remove_idx ON places(to_remove) WHERE to_remove = true;

-- Also need index for is_active + to_remove combo (most common query)
CREATE INDEX IF NOT EXISTS places_active_not_removed_idx ON places(is_active, to_remove) 
  WHERE is_active = true AND (to_remove = false OR to_remove IS NULL);

UPDATE places 
SET to_remove = false 
WHERE to_remove IS NULL;

-- ============================================================================
-- STEP 1: Drop views that depend on weather_data
-- ============================================================================

DROP VIEW IF EXISTS places_with_latest_weather CASCADE;
DROP VIEW IF EXISTS user_favourites_with_weather CASCADE;
DROP VIEW IF EXISTS places_with_30day_trends CASCADE; -- Unused (daily_weather_summary table doesn't exist)

-- ============================================================================
-- STEP 2: Drop weather_data table (no longer needed)
-- ============================================================================

DROP TABLE IF EXISTS weather_data CASCADE;

-- We only keep weather_forecast now!

-- ============================================================================
-- STEP 3: Add forecast_date column to weather_forecast
-- ============================================================================

-- forecast_date = cleaner for date-based queries (map date filter)
-- Keep forecast_timestamp for backwards compatibility (set to midnight)
ALTER TABLE weather_forecast
  ADD COLUMN IF NOT EXISTS forecast_date DATE;

-- Set forecast_date from existing forecast_timestamp
UPDATE weather_forecast
SET forecast_date = DATE(forecast_timestamp)
WHERE forecast_date IS NULL;

-- Make it NOT NULL after populating
ALTER TABLE weather_forecast
  ALTER COLUMN forecast_date SET NOT NULL;

-- ============================================================================
-- STEP 4: Create performance index for date-based queries
-- ============================================================================

-- CRITICAL for map performance when user selects date filter
-- Query: WHERE place_id = X AND forecast_date = '2026-01-25'
CREATE INDEX IF NOT EXISTS weather_forecast_place_date_idx 
  ON weather_forecast(place_id, forecast_date);

-- Also useful: get all weather for a specific date (all places)
CREATE INDEX IF NOT EXISTS weather_forecast_date_idx 
  ON weather_forecast(forecast_date);

-- ============================================================================
-- STEP 5: Update UNIQUE constraint to use forecast_date
-- ============================================================================

-- Drop old constraint (if exists)
ALTER TABLE weather_forecast
  DROP CONSTRAINT IF EXISTS weather_forecast_place_id_forecast_timestamp_fetched_at_key;

-- Add new constraint using forecast_date (one row per place per date)
-- Note: We allow multiple fetches per day (fetched_at differs)
ALTER TABLE weather_forecast
  DROP CONSTRAINT IF EXISTS weather_forecast_place_date_unique;

ALTER TABLE weather_forecast
  ADD CONSTRAINT weather_forecast_place_date_unique 
  UNIQUE(place_id, forecast_date, fetched_at);

-- ============================================================================
-- STEP 6: Recreate places_with_latest_weather view (simplified)
-- ============================================================================

-- This view returns weather for TODAY by default
-- (for Map when no date filter is selected)
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
  p.clustering_radius_m,
  
  -- Weather data (from forecast table)
  w.forecast_date,
  w.forecast_timestamp,
  ROUND((w.temp_min + w.temp_max) / 2.0, 1) AS temperature, -- Average of min/max
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
  w.rain_volume AS rain_1h, -- Map old column names for compatibility
  w.snow_volume AS snow_1h,
  w.fetched_at AS weather_timestamp,
  w.data_source,
  
  -- Legacy columns (not in weather_forecast, but needed by app)
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
LEFT JOIN LATERAL (
  SELECT *
  FROM weather_forecast
  WHERE place_id = p.id
    AND forecast_date = CURRENT_DATE -- TODAY only
  ORDER BY fetched_at DESC -- Latest fetch if multiple exist
  LIMIT 1
) w ON true
WHERE p.is_active = true
  AND COALESCE(p.to_remove, false) = false; -- Exclude places marked for removal (faster than OR)

-- ============================================================================
-- STEP 7: Create function to get weather for specific date
-- ============================================================================

-- This will be used by the Map when user selects date filter
-- Usage: SELECT * FROM get_weather_for_date('2026-01-27')
CREATE OR REPLACE FUNCTION get_weather_for_date(target_date DATE)
RETURNS TABLE (
  id UUID,
  name_en TEXT,
  latitude DECIMAL,
  longitude DECIMAL,
  country_code TEXT,
  region TEXT,
  place_type TEXT,
  attractiveness_score INTEGER,
  population INTEGER,
  clustering_radius_m INTEGER,
  forecast_date DATE,
  temp_min DECIMAL,
  temp_max DECIMAL,
  weather_main TEXT,
  weather_description TEXT,
  weather_icon TEXT,
  wind_speed DECIMAL,
  precipitation_sum DECIMAL,
  precipitation_probability DECIMAL,
  sunrise TIMESTAMP WITH TIME ZONE,
  sunset TIMESTAMP WITH TIME ZONE,
  rain_volume DECIMAL,
  snow_volume DECIMAL,
  weather_timestamp TIMESTAMP WITH TIME ZONE,
  data_source TEXT
) AS $$
BEGIN
  RETURN QUERY
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
    p.clustering_radius_m,
    
    w.forecast_date,
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
    w.rain_volume,
    w.snow_volume,
    w.fetched_at AS weather_timestamp,
    w.data_source
    
  FROM places p
  LEFT JOIN LATERAL (
    SELECT *
    FROM weather_forecast
    WHERE place_id = p.id
      AND forecast_date = target_date
    ORDER BY fetched_at DESC
    LIMIT 1
  ) w ON true
  WHERE p.is_active = true
    AND COALESCE(p.to_remove, false) = false; -- Exclude places marked for removal (faster than OR)
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- STEP 8: Recreate user_favourites_with_weather view (for future feature)
-- ============================================================================

CREATE OR REPLACE VIEW user_favourites_with_weather AS
SELECT 
  f.user_id,
  f.id as favourite_id,
  f.notes,
  f.tags,
  f.created_at as saved_at,
  
  -- Place data
  p.*,
  
  -- Current weather (from forecast table, today)
  w.forecast_date,
  ROUND((w.temp_min + w.temp_max) / 2.0, 1) AS temperature, -- Average of min/max
  w.temp_max,
  w.weather_main,
  w.weather_description,
  w.weather_icon,
  w.wind_speed,
  w.precipitation_sum,
  w.precipitation_probability,
  w.rain_volume,
  w.snow_volume,
  w.sunrise,
  w.sunset,
  w.fetched_at AS weather_timestamp
  
FROM favourites f
JOIN places p ON f.place_id = p.id
LEFT JOIN LATERAL (
  SELECT *
  FROM weather_forecast
  WHERE place_id = p.id
    AND forecast_date = CURRENT_DATE
  ORDER BY fetched_at DESC
  LIMIT 1
) w ON true;

-- ============================================================================
-- STEP 9: Update cleanup function
-- ============================================================================

CREATE OR REPLACE FUNCTION clean_old_weather_data()
RETURNS void AS $$
BEGIN
  -- Keep forecasts for past 2 days + today + future 14 days = ~16 days total
  -- Delete old fetches (we only need the latest fetch per date)
  DELETE FROM weather_forecast
  WHERE fetched_at < NOW() - INTERVAL '2 days'
    AND forecast_date < CURRENT_DATE - INTERVAL '2 days';
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- DONE! Schema is now consolidated
-- ============================================================================

-- Summary:
--   ✅ Dropped weather_data table
--   ✅ weather_forecast is now single source of truth
--   ✅ Added forecast_date column (DATE) for fast date queries
--   ✅ Created performance indexes for date-based filtering
--   ✅ Simplified places_with_latest_weather view
--   ✅ Created get_weather_for_date() function for map date filter
--   ✅ Updated cleanup function
--
-- Next steps:
--   1. Update fetch scripts to use forecast_date
--   2. Update placesWeatherService.js to use new view/function
--   3. Hook up DateFilter component to call get_weather_for_date()
--
-- Performance:
--   - Map query with date filter: O(1) lookup via (place_id, forecast_date) index
--   - Simpler schema = faster queries
--   - Less storage (no duplicate data between tables)
