-- ============================================================================
-- FIX TIMEOUT - Use LATERAL JOIN (fast for pagination)
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
  p.place_type AS place_category,
  p.attractiveness_score,
  p.population,
  p.clustering_radius_m,
  
  -- Weather data (from forecast table)
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
    AND forecast_date = CURRENT_DATE
  ORDER BY fetched_at DESC
  LIMIT 1
) w ON true
WHERE p.is_active = true;

-- Critical indexes for performance (without CURRENT_DATE in WHERE)
CREATE INDEX IF NOT EXISTS weather_forecast_place_date_fetched_idx 
  ON weather_forecast(place_id, forecast_date, fetched_at DESC);

CREATE INDEX IF NOT EXISTS places_active_lat_lon_idx 
  ON places(latitude, longitude)
  WHERE is_active = true;

-- Success message
SELECT 'VIEW created successfully!' as status;
