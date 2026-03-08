-- ============================================================================
-- FIX: Remove priority_tier from trigger + add missing columns everywhere
-- ============================================================================
-- Run this in Supabase SQL Editor to fix:
--   1. Favourite insert crash (priority_tier doesn't exist)
--   2. Missing tracking columns on places
--   3. Missing sunshine_duration + humidity on weather_forecast
-- ============================================================================

-- 1) Add missing columns to places
ALTER TABLE places
  ADD COLUMN IF NOT EXISTS detail_view_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS map_view_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_viewed_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS elevation INTEGER;

-- 2) Fix the trigger function: remove priority_tier references
CREATE OR REPLACE FUNCTION update_place_favourite_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE places
    SET favourite_count = favourite_count + 1
    WHERE id = NEW.place_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE places
    SET favourite_count = GREATEST(favourite_count - 1, 0)
    WHERE id = OLD.place_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- 3) Add missing weather columns to weather_forecast
--    sunshine_duration: Open-Meteo provides this, badge system uses it
--    humidity: dropped in openmeteo migration but still queried by placesWeatherService
ALTER TABLE weather_forecast
  ADD COLUMN IF NOT EXISTS sunshine_duration DECIMAL(8, 2),
  ADD COLUMN IF NOT EXISTS humidity INTEGER;
