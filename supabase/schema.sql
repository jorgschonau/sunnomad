-- ============================================================================
-- SunNomad Database Schema - Weather-Focused
-- ============================================================================
-- Fokus: Wetterdaten speichern, cachen und Favoriten verwalten
--
-- Setup Instructions:
-- 1. Create a new Supabase project at https://app.supabase.com
-- 2. Go to SQL Editor in your Supabase dashboard
-- 3. Copy and paste this entire file
-- 4. Run the SQL script
-- ============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- PROFILES TABLE
-- ============================================================================
-- User profiles extending Supabase auth.users
CREATE TABLE profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  
  -- User preferences
  preferred_language TEXT DEFAULT 'en' CHECK (preferred_language IN ('en', 'de', 'fr')),
  theme TEXT DEFAULT 'light' CHECK (theme IN ('light', 'dark', 'standard', 'blue', 'amber')),
  default_radius INTEGER DEFAULT 600 CHECK (default_radius IN (200, 400, 600, 1500, 3000)),
  
  -- Privacy
  is_public BOOLEAN DEFAULT true,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- RLS Policies for profiles
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public profiles are viewable by everyone"
  ON profiles FOR SELECT
  USING (is_public = true OR auth.uid() = id);

CREATE POLICY "Users can insert their own profile"
  ON profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id);

-- ============================================================================
-- PLACES TABLE
-- ============================================================================
-- Wichtige Orte/Städte für Wetter-Suche
-- Diese werden von der App erstellt wenn User sie als Favorit speichern
-- ODER können vorab mit bekannten Camping/Travel Spots befüllt werden
CREATE TABLE places (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Location
  name TEXT NOT NULL,
  latitude DECIMAL(10, 8) NOT NULL,
  longitude DECIMAL(11, 8) NOT NULL,
  
  -- Location metadata
  country_code TEXT, -- ISO 3166-1 alpha-2: "DE", "FR", "US", "CA", etc.
  country_name TEXT, -- "Germany", "France", "United States", "Canada"
  region TEXT DEFAULT 'europe' CHECK (region IN ('europe', 'north_america')),
  place_type TEXT DEFAULT 'city' CHECK (place_type IN ('city', 'town', 'campground', 'beach', 'mountain', 'poi')),
  
  -- External IDs (für Scraping/Integration)
  openweather_id INTEGER, -- OpenWeatherMap City ID
  
  -- Images (später)
  primary_image_url TEXT, -- Haupt-Bild URL (von Wikimedia, Unsplash, etc.)
  image_source TEXT, -- Quelle: 'wikimedia', 'unsplash', 'pexels', etc.
  image_attribution TEXT, -- Credit/Attribution für das Bild
  
  -- Tracking
  favourite_count INTEGER DEFAULT 0, -- Wie oft als Favorit gespeichert
  last_weather_fetch TIMESTAMP WITH TIME ZONE, -- Wann zuletzt Wetter abgerufen
  
  -- Meta
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for places
CREATE INDEX places_location_idx ON places(latitude, longitude);
CREATE INDEX places_country_idx ON places(country_code);
CREATE INDEX places_region_idx ON places(region);
CREATE INDEX places_type_idx ON places(place_type);
CREATE INDEX places_openweather_id_idx ON places(openweather_id);
CREATE INDEX places_favourite_count_idx ON places(favourite_count DESC);
CREATE INDEX places_last_weather_fetch_idx ON places(last_weather_fetch);

-- RLS Policies for places
ALTER TABLE places ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Active places are viewable by everyone"
  ON places FOR SELECT
  USING (is_active = true);

CREATE POLICY "Authenticated users can create places"
  ON places FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- ============================================================================
-- WEATHER_DATA TABLE
-- ============================================================================
-- KERN DER APP: Aktuelle + historische Wetterdaten
-- 60 Tage Historie für Vergleiche und Trend-Analysen
CREATE TABLE weather_data (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  place_id UUID REFERENCES places(id) ON DELETE CASCADE NOT NULL,
  
  -- Timestamp der Wetterdaten
  weather_timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
  
  -- Temperature
  temperature DECIMAL(5, 2), -- °C
  feels_like DECIMAL(5, 2), -- °C (gefühlte Temperatur)
  temp_min DECIMAL(5, 2), -- °C (min in diesem Zeitraum)
  temp_max DECIMAL(5, 2), -- °C (max in diesem Zeitraum)
  dew_point DECIMAL(5, 2), -- °C (Taupunkt)
  
  -- Conditions
  weather_main TEXT, -- "Clear", "Clouds", "Rain", etc.
  weather_description TEXT, -- "clear sky", "broken clouds", etc.
  weather_icon TEXT, -- "01d", "02n", etc.
  
  -- Humidity & Pressure
  humidity INTEGER, -- % relative Luftfeuchtigkeit
  pressure INTEGER, -- hPa (Luftdruck auf Meereshöhe)
  pressure_sea_level INTEGER, -- hPa
  pressure_ground_level INTEGER, -- hPa
  
  -- Wind
  wind_speed DECIMAL(5, 2), -- m/s
  wind_deg INTEGER, -- degrees (Windrichtung)
  wind_gust DECIMAL(5, 2), -- m/s (Böengeschwindigkeit)
  
  -- Clouds & Visibility
  clouds INTEGER, -- % Bewölkung (0-100)
  visibility INTEGER, -- meters Sichtweite
  
  -- Precipitation (Niederschlag)
  rain_1h DECIMAL(5, 2), -- mm Regen letzte 1h
  rain_3h DECIMAL(5, 2), -- mm Regen letzte 3h
  rain_24h DECIMAL(5, 2), -- mm Regen letzte 24h
  snow_1h DECIMAL(5, 2), -- mm Schnee letzte 1h
  snow_3h DECIMAL(5, 2), -- mm Schnee letzte 3h
  snow_24h DECIMAL(5, 2), -- mm Schnee letzte 24h
  precipitation_probability DECIMAL(3, 2), -- 0.00-1.00 (Regenwahrscheinlichkeit)
  
  -- Sun & UV
  sunrise TIMESTAMP WITH TIME ZONE,
  sunset TIMESTAMP WITH TIME ZONE,
  uv_index DECIMAL(4, 2), -- UV Index (0-11+)
  
  -- Calculated Scores (von App berechnet)
  stability_score INTEGER, -- 0-100 (Wetterstabilität)
  comfort_score INTEGER, -- 0-100 (Komfort für Outdoor Aktivitäten)
  
  -- Meta
  data_source TEXT DEFAULT 'openweathermap',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Ein Ort kann mehrere Weather-Datensätze haben (Historie)
  -- Aber nur einen pro Timestamp (auf Stunde gerundet)
  UNIQUE(place_id, weather_timestamp)
);

-- Indexes for weather_data
CREATE INDEX weather_data_place_id_idx ON weather_data(place_id);
CREATE INDEX weather_data_timestamp_idx ON weather_data(weather_timestamp DESC);
CREATE INDEX weather_data_place_timestamp_idx ON weather_data(place_id, weather_timestamp DESC);

-- RLS Policies for weather_data
ALTER TABLE weather_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Weather data is viewable by everyone"
  ON weather_data FOR SELECT
  USING (true);

CREATE POLICY "Authenticated users can insert weather data"
  ON weather_data FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- ============================================================================
-- DAILY_WEATHER_SUMMARY TABLE
-- ============================================================================
-- Tägliche Wetter-Zusammenfassungen (ein Record pro Tag pro Ort)
-- Für schnelle Abfragen von 30-60 Tagen Trends
CREATE TABLE daily_weather_summary (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  place_id UUID REFERENCES places(id) ON DELETE CASCADE NOT NULL,
  
  -- Datum (ohne Zeit)
  date DATE NOT NULL,
  
  -- Temperature (Tageswerte)
  temp_min DECIMAL(5, 2), -- °C
  temp_max DECIMAL(5, 2), -- °C
  temp_avg DECIMAL(5, 2), -- °C
  
  -- Dominant Weather Condition
  weather_main TEXT,
  weather_description TEXT,
  weather_icon TEXT,
  
  -- Wind & Humidity
  humidity_avg INTEGER,
  pressure_avg INTEGER,
  wind_speed_avg DECIMAL(5, 2),
  wind_speed_max DECIMAL(5, 2),
  wind_gust_max DECIMAL(5, 2),
  
  -- Clouds & Precipitation
  clouds_avg INTEGER,
  rain_total DECIMAL(6, 2),
  snow_total DECIMAL(6, 2),
  
  -- UV & Sun
  uv_index_max DECIMAL(4, 2),
  sunrise TIMESTAMP WITH TIME ZONE,
  sunset TIMESTAMP WITH TIME ZONE,
  
  -- Calculated Scores
  stability_score INTEGER,
  comfort_score INTEGER,
  
  -- Meta
  data_points INTEGER DEFAULT 0,
  data_source TEXT DEFAULT 'openweathermap',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(place_id, date)
);

CREATE INDEX daily_weather_summary_place_id_idx ON daily_weather_summary(place_id);
CREATE INDEX daily_weather_summary_date_idx ON daily_weather_summary(date DESC);
CREATE INDEX daily_weather_summary_place_date_idx ON daily_weather_summary(place_id, date DESC);

ALTER TABLE daily_weather_summary ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Daily weather summaries viewable by everyone"
  ON daily_weather_summary FOR SELECT
  USING (true);

CREATE POLICY "Authenticated users can insert daily summaries"
  ON daily_weather_summary FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update daily summaries"
  ON daily_weather_summary FOR UPDATE
  TO authenticated
  USING (true);

-- ============================================================================
-- WEATHER_FORECAST TABLE
-- ============================================================================
-- 16 Tage Vorhersage (OpenWeatherMap One Call API 3.0)
CREATE TABLE weather_forecast (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  place_id UUID REFERENCES places(id) ON DELETE CASCADE NOT NULL,
  
  -- Forecast für welchen Tag/Zeit
  forecast_timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
  
  -- Wann wurde dieser Forecast erstellt
  fetched_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Weather Data (ähnlich wie weather_data, vollständig)
  temperature DECIMAL(5, 2),
  feels_like DECIMAL(5, 2),
  temp_min DECIMAL(5, 2),
  temp_max DECIMAL(5, 2),
  
  weather_main TEXT,
  weather_description TEXT,
  weather_icon TEXT,
  
  humidity INTEGER,
  pressure INTEGER,
  wind_speed DECIMAL(5, 2),
  wind_deg INTEGER,
  wind_gust DECIMAL(5, 2),
  clouds INTEGER,
  visibility INTEGER,
  
  rain_probability DECIMAL(3, 2), -- 0.00-1.00
  rain_volume DECIMAL(5, 2), -- mm
  snow_volume DECIMAL(5, 2), -- mm
  
  uv_index DECIMAL(4, 2),
  
  -- Meta
  data_source TEXT DEFAULT 'openweathermap',
  
  UNIQUE(place_id, forecast_timestamp, fetched_at)
);

-- Indexes for weather_forecast
CREATE INDEX weather_forecast_place_id_idx ON weather_forecast(place_id);
CREATE INDEX weather_forecast_timestamp_idx ON weather_forecast(forecast_timestamp);
CREATE INDEX weather_forecast_fetched_idx ON weather_forecast(fetched_at DESC);

-- RLS Policies
ALTER TABLE weather_forecast ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Forecast data is viewable by everyone"
  ON weather_forecast FOR SELECT
  USING (true);

CREATE POLICY "Authenticated users can insert forecast"
  ON weather_forecast FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- ============================================================================
-- PLACE_IMAGES TABLE (Optional, für später)
-- ============================================================================
-- Multiple images pro Place (Gallery)
-- Wird später befüllt durch Scraping/APIs
CREATE TABLE place_images (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  place_id UUID REFERENCES places(id) ON DELETE CASCADE NOT NULL,
  
  -- Image Data
  image_url TEXT NOT NULL, -- URL zum Bild (external oder Supabase Storage)
  thumbnail_url TEXT, -- Kleines Preview
  
  -- Metadata
  image_source TEXT, -- 'wikimedia', 'unsplash', 'pexels', 'geonames', etc.
  image_attribution TEXT, -- Credit/License Info
  image_license TEXT, -- 'CC-BY-SA', 'Public Domain', etc.
  
  -- Display
  display_order INTEGER DEFAULT 0, -- Für Sortierung in Gallery
  is_primary BOOLEAN DEFAULT false, -- Haupt-Bild für Karte/Liste
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Index on place_id for fast lookup
  CONSTRAINT unique_place_image_url UNIQUE(place_id, image_url)
);

CREATE INDEX place_images_place_id_idx ON place_images(place_id);
CREATE INDEX place_images_is_primary_idx ON place_images(is_primary) WHERE is_primary = true;

-- RLS Policies
ALTER TABLE place_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Place images are viewable by everyone"
  ON place_images FOR SELECT
  USING (true);

CREATE POLICY "Authenticated users can insert place images"
  ON place_images FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- ============================================================================
-- FAVOURITES TABLE
-- ============================================================================
-- User's saved/favourite places
CREATE TABLE favourites (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  place_id UUID REFERENCES places(id) ON DELETE CASCADE NOT NULL,
  
  -- Optional user notes
  notes TEXT,
  tags TEXT[], -- z.B. ["winter-spot", "summer", "camping"]
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(user_id, place_id)
);

-- Indexes for favourites
CREATE INDEX favourites_user_id_idx ON favourites(user_id);
CREATE INDEX favourites_place_id_idx ON favourites(place_id);

-- RLS Policies for favourites
ALTER TABLE favourites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own favourites"
  ON favourites FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own favourites"
  ON favourites FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own favourites"
  ON favourites FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own favourites"
  ON favourites FOR UPDATE
  USING (auth.uid() = user_id);

-- ============================================================================
-- FUNCTIONS AND TRIGGERS
-- ============================================================================

-- Function: Update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger: Update profiles.updated_at
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Trigger: Update places.updated_at
CREATE TRIGGER update_places_updated_at
  BEFORE UPDATE ON places
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Function: Update favourite_count and recalculate priority tier
CREATE OR REPLACE FUNCTION update_place_favourite_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE places
    SET 
      favourite_count = favourite_count + 1,
      -- Auto-update priority tier based on favourites
      priority_tier = CASE 
        WHEN favourite_count + 1 >= 50 THEN 1  -- Top 50+ favourites = Tier 1
        WHEN favourite_count + 1 >= 10 THEN 2  -- 10-49 favourites = Tier 2
        ELSE 3                                  -- < 10 favourites = Tier 3
      END
    WHERE id = NEW.place_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE places
    SET 
      favourite_count = GREATEST(favourite_count - 1, 0),
      priority_tier = CASE 
        WHEN favourite_count - 1 >= 50 THEN 1
        WHEN favourite_count - 1 >= 10 THEN 2
        ELSE 3
      END
    WHERE id = OLD.place_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Function: Increment detail_view_count for a single place
CREATE OR REPLACE FUNCTION increment_detail_view_count(p_place_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE places
  SET detail_view_count = COALESCE(detail_view_count, 0) + 1,
      last_viewed_at = NOW()
  WHERE id = p_place_id;
END;
$$ LANGUAGE plpgsql;

-- Function: Batch-increment map_view_count for visible markers
CREATE OR REPLACE FUNCTION increment_map_view_counts(p_place_ids UUID[])
RETURNS void AS $$
BEGIN
  UPDATE places
  SET map_view_count = COALESCE(map_view_count, 0) + 1,
      last_viewed_at = NOW()
  WHERE id = ANY(p_place_ids);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_place_favourite_count_on_insert
  AFTER INSERT ON favourites
  FOR EACH ROW
  EXECUTE FUNCTION update_place_favourite_count();

CREATE TRIGGER update_place_favourite_count_on_delete
  AFTER DELETE ON favourites
  FOR EACH ROW
  EXECUTE FUNCTION update_place_favourite_count();

-- Function: Create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, username, display_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1))
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Trigger: Update daily_weather_summary.updated_at
CREATE TRIGGER update_daily_weather_summary_updated_at
  BEFORE UPDATE ON daily_weather_summary
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Function: Clean old weather data (für Cron Job)
-- MAXIMUM DATA SETUP: 60 Tage Historie behalten
CREATE OR REPLACE FUNCTION clean_old_weather_data()
RETURNS void AS $$
BEGIN
  -- Detaillierte Wetterdaten: 60 Tage (2 Monate für Vergleiche)
  DELETE FROM weather_data
  WHERE weather_timestamp < NOW() - INTERVAL '60 days';
  
  -- Daily Summaries: 60 Tage (für 30-60 Tage Trends)
  DELETE FROM daily_weather_summary
  WHERE date < CURRENT_DATE - INTERVAL '60 days';
  
  -- Alte Forecasts: 7 Tage (nur aktuelle behalten)
  DELETE FROM weather_forecast
  WHERE fetched_at < NOW() - INTERVAL '7 days';
END;
$$ LANGUAGE plpgsql;

-- Function: Aggregate weather_data into daily_weather_summary
CREATE OR REPLACE FUNCTION aggregate_daily_weather(
  target_place_id UUID,
  target_date DATE
)
RETURNS void AS $$
DECLARE
  summary_record RECORD;
BEGIN
  SELECT
    target_place_id as place_id,
    target_date as date,
    MIN(temperature) as temp_min,
    MAX(temperature) as temp_max,
    AVG(temperature) as temp_avg,
    AVG(humidity) as humidity_avg,
    AVG(pressure) as pressure_avg,
    AVG(wind_speed) as wind_speed_avg,
    MAX(wind_speed) as wind_speed_max,
    MAX(wind_gust) as wind_gust_max,
    AVG(clouds) as clouds_avg,
    SUM(COALESCE(rain_1h, rain_3h, 0)) as rain_total,
    SUM(COALESCE(snow_1h, snow_3h, 0)) as snow_total,
    MAX(uv_index) as uv_index_max,
    COUNT(*) as data_points,
    MODE() WITHIN GROUP (ORDER BY weather_main) as weather_main,
    MODE() WITHIN GROUP (ORDER BY weather_description) as weather_description,
    MODE() WITHIN GROUP (ORDER BY weather_icon) as weather_icon,
    MIN(sunrise) as sunrise,
    MAX(sunset) as sunset
  INTO summary_record
  FROM weather_data
  WHERE place_id = target_place_id
    AND DATE(weather_timestamp) = target_date
  GROUP BY target_place_id, target_date;
  
  IF summary_record.data_points > 0 THEN
    INSERT INTO daily_weather_summary (
      place_id, date, temp_min, temp_max, temp_avg,
      humidity_avg, pressure_avg, wind_speed_avg, wind_speed_max, wind_gust_max,
      clouds_avg, rain_total, snow_total, uv_index_max,
      weather_main, weather_description, weather_icon,
      sunrise, sunset, data_points
    ) VALUES (
      summary_record.place_id, summary_record.date, summary_record.temp_min,
      summary_record.temp_max, summary_record.temp_avg, summary_record.humidity_avg,
      summary_record.pressure_avg, summary_record.wind_speed_avg,
      summary_record.wind_speed_max, summary_record.wind_gust_max,
      summary_record.clouds_avg, summary_record.rain_total, summary_record.snow_total,
      summary_record.uv_index_max, summary_record.weather_main, 
      summary_record.weather_description, summary_record.weather_icon, 
      summary_record.sunrise, summary_record.sunset, summary_record.data_points
    )
    ON CONFLICT (place_id, date)
    DO UPDATE SET
      temp_min = EXCLUDED.temp_min,
      temp_max = EXCLUDED.temp_max,
      temp_avg = EXCLUDED.temp_avg,
      humidity_avg = EXCLUDED.humidity_avg,
      pressure_avg = EXCLUDED.pressure_avg,
      wind_speed_avg = EXCLUDED.wind_speed_avg,
      wind_speed_max = EXCLUDED.wind_speed_max,
      wind_gust_max = EXCLUDED.wind_gust_max,
      clouds_avg = EXCLUDED.clouds_avg,
      rain_total = EXCLUDED.rain_total,
      snow_total = EXCLUDED.snow_total,
      uv_index_max = EXCLUDED.uv_index_max,
      weather_main = EXCLUDED.weather_main,
      weather_description = EXCLUDED.weather_description,
      weather_icon = EXCLUDED.weather_icon,
      sunrise = EXCLUDED.sunrise,
      sunset = EXCLUDED.sunset,
      data_points = EXCLUDED.data_points,
      updated_at = NOW();
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- STORAGE BUCKETS
-- ============================================================================

-- Avatar bucket (für User Profile Bilder)
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for avatars
CREATE POLICY "Avatar images are publicly accessible"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');

CREATE POLICY "Users can upload their own avatar"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'avatars' AND
    auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can update their own avatar"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'avatars' AND
    auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can delete their own avatar"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'avatars' AND
    auth.uid()::text = (storage.foldername(name))[1]
  );

-- ============================================================================
-- USEFUL VIEWS
-- ============================================================================

-- View: Latest weather for each place (extended)
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

-- View: Places with 30-day weather trends
CREATE OR REPLACE VIEW places_with_30day_trends AS
SELECT
  p.id as place_id,
  p.name,
  p.latitude,
  p.longitude,
  p.country_code,
  -- 30-Tage Durchschnitte
  AVG(d.temp_avg) as temp_30d_avg,
  MIN(d.temp_min) as temp_30d_min,
  MAX(d.temp_max) as temp_30d_max,
  AVG(d.rain_total) as rain_30d_avg,
  SUM(d.rain_total) as rain_30d_total,
  AVG(d.wind_speed_max) as wind_30d_avg_max,
  AVG(d.clouds_avg) as clouds_30d_avg,
  -- Regentage & Sonnige Tage
  COUNT(*) FILTER (WHERE d.rain_total > 1.0) as rainy_days_30d,
  COUNT(*) FILTER (WHERE d.clouds_avg < 30) as sunny_days_30d,
  COUNT(*) as total_days
FROM places p
LEFT JOIN daily_weather_summary d ON p.id = d.place_id
  AND d.date >= CURRENT_DATE - INTERVAL '30 days'
WHERE p.is_active = true
GROUP BY p.id, p.name, p.latitude, p.longitude, p.country_code;

-- View: User favourites with current weather + 3-day forecast
CREATE OR REPLACE VIEW user_favourites_with_weather AS
SELECT 
  f.user_id,
  f.id as favourite_id,
  f.notes,
  f.tags,
  f.created_at as saved_at,
  p.*,
  -- Current weather
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

-- ============================================================================
-- SAMPLE DATA - Europa & Nordamerika
-- ============================================================================
-- Uncomment to insert starter places für Testing

/*
-- Europa - Beliebte Camping & Reise Destinationen
INSERT INTO places (name, latitude, longitude, country_code, country_name, region, place_type, openweather_id) VALUES
  -- Deutschland
  ('Berlin', 52.5200, 13.4050, 'DE', 'Germany', 'europe', 'city', 2950159),
  ('Munich', 48.1351, 11.5820, 'DE', 'Germany', 'europe', 'city', 2867714),
  ('Hamburg', 53.5511, 9.9937, 'DE', 'Germany', 'europe', 'city', 2911298),
  ('Garmisch-Partenkirchen', 47.4924, 11.0955, 'DE', 'Germany', 'europe', 'mountain', 2922530),
  
  -- Frankreich
  ('Paris', 48.8566, 2.3522, 'FR', 'France', 'europe', 'city', 2988507),
  ('Nice', 43.7102, 7.2620, 'FR', 'France', 'europe', 'beach', 2990440),
  ('Lyon', 45.7640, 4.8357, 'FR', 'France', 'europe', 'city', 2996944),
  
  -- Spanien
  ('Barcelona', 41.3851, 2.1734, 'ES', 'Spain', 'europe', 'city', 3128760),
  ('Malaga', 36.7213, -4.4214, 'ES', 'Spain', 'europe', 'beach', 2514256),
  ('Ibiza', 38.9067, 1.4206, 'ES', 'Spain', 'europe', 'beach', 2516479),
  
  -- Italien
  ('Rome', 41.9028, 12.4964, 'IT', 'Italy', 'europe', 'city', 3169070),
  ('Venice', 45.4408, 12.3155, 'IT', 'Italy', 'europe', 'city', 3164603),
  ('Lake Garda', 45.5949, 10.6205, 'IT', 'Italy', 'europe', 'beach', 3174953),
  
  -- Niederlande
  ('Amsterdam', 52.3676, 4.9041, 'NL', 'Netherlands', 'europe', 'city', 2759794),
  
  -- Schweiz
  ('Zurich', 47.3769, 8.5417, 'CH', 'Switzerland', 'europe', 'city', 2657896),
  ('Interlaken', 46.6863, 7.8632, 'CH', 'Switzerland', 'europe', 'mountain', 2660718),
  
  -- Österreich
  ('Vienna', 48.2082, 16.3738, 'AT', 'Austria', 'europe', 'city', 2761369),
  ('Innsbruck', 47.2692, 11.4041, 'AT', 'Austria', 'europe', 'mountain', 2775220),
  
  -- Portugal
  ('Lisbon', 38.7223, -9.1393, 'PT', 'Portugal', 'europe', 'city', 2267057),
  ('Algarve', 37.0179, -7.9304, 'PT', 'Portugal', 'europe', 'beach', 2267095),
  
  -- Skandinavien
  ('Stockholm', 59.3293, 18.0686, 'SE', 'Sweden', 'europe', 'city', 2673730),
  ('Copenhagen', 55.6761, 12.5683, 'DK', 'Denmark', 'europe', 'city', 2618425),
  ('Oslo', 59.9139, 10.7522, 'NO', 'Norway', 'europe', 'city', 3143244);

-- Nordamerika - Beliebte Camping & Reise Destinationen  
INSERT INTO places (name, latitude, longitude, country_code, country_name, region, place_type, openweather_id) VALUES
  -- USA - West Coast
  ('Los Angeles', 34.0522, -118.2437, 'US', 'United States', 'north_america', 'city', 5368361),
  ('San Francisco', 37.7749, -122.4194, 'US', 'United States', 'north_america', 'city', 5391959),
  ('San Diego', 32.7157, -117.1611, 'US', 'United States', 'north_america', 'beach', 5391811),
  ('Seattle', 47.6062, -122.3321, 'US', 'United States', 'north_america', 'city', 5809844),
  ('Portland', 45.5152, -122.6784, 'US', 'United States', 'north_america', 'city', 5746545),
  
  -- USA - South
  ('Miami', 25.7617, -80.1918, 'US', 'United States', 'north_america', 'beach', 4164138),
  ('Austin', 30.2672, -97.7431, 'US', 'United States', 'north_america', 'city', 4671654),
  ('New Orleans', 29.9511, -90.0715, 'US', 'United States', 'north_america', 'city', 4335045),
  
  -- USA - East Coast
  ('New York', 40.7128, -74.0060, 'US', 'United States', 'north_america', 'city', 5128581),
  ('Boston', 42.3601, -71.0589, 'US', 'United States', 'north_america', 'city', 4930956),
  ('Washington DC', 38.9072, -77.0369, 'US', 'United States', 'north_america', 'city', 4140963),
  
  -- USA - Mountains & National Parks
  ('Denver', 39.7392, -104.9903, 'US', 'United States', 'north_america', 'mountain', 5419384),
  ('Salt Lake City', 40.7608, -111.8910, 'US', 'United States', 'north_america', 'mountain', 5780993),
  ('Yellowstone', 44.4280, -110.5885, 'US', 'United States', 'north_america', 'mountain', 5843465),
  ('Yosemite', 37.8651, -119.5383, 'US', 'United States', 'north_america', 'mountain', 5505411),
  
  -- Kanada
  ('Vancouver', 49.2827, -123.1207, 'CA', 'Canada', 'north_america', 'city', 6173331),
  ('Toronto', 43.6532, -79.3832, 'CA', 'Canada', 'north_america', 'city', 6167865),
  ('Montreal', 45.5017, -73.5673, 'CA', 'Canada', 'north_america', 'city', 6077243),
  ('Calgary', 51.0447, -114.0719, 'CA', 'Canada', 'north_america', 'city', 5913490),
  ('Banff', 51.1784, -115.5708, 'CA', 'Canada', 'north_america', 'mountain', 5883102);
*/

-- ============================================================================
-- MAINTENANCE / CRON JOBS - Optimiert für 20.000 Places
-- ============================================================================
-- 
-- STRATEGIE: Tiered Updates basierend auf Priority
-- 
-- Im Supabase Dashboard unter "Database" → "Cron Jobs" kannst du einrichten:
--
-- 1. Alte Wetterdaten löschen (täglich um 3 Uhr nachts):
--    SELECT cron.schedule('clean-old-weather', '0 3 * * *', 'SELECT clean_old_weather_data()');
--
-- 2. Tägliche Zusammenfassungen erstellen (täglich um 1 Uhr nachts):
--    SELECT cron.schedule('aggregate-daily-weather', '0 1 * * *', $$
--      SELECT aggregate_daily_weather(place_id, CURRENT_DATE - 1)
--      FROM places WHERE priority_tier = 1;  -- Nur Tier 1!
--    $$);
--
-- 3. TIERED WEATHER UPDATES:
--
--    Tier 1 (Top ~200-500 Places): 2x täglich
--    SELECT cron.schedule('update-tier1-morning', '0 6 * * *', $$
--      SELECT net.http_post(
--        url := 'https://your-function.supabase.co/update-tier1-weather'
--      );
--    $$);
--    SELECT cron.schedule('update-tier1-evening', '0 18 * * *', $$
--      SELECT net.http_post(
--        url := 'https://your-function.supabase.co/update-tier1-weather'
--      );
--    $$);
--
--    Tier 2 (Moderate ~2.000 Places): 1x pro 3 Tage
--    SELECT cron.schedule('update-tier2', '0 12 */3 * *', $$
--      SELECT net.http_post(
--        url := 'https://your-function.supabase.co/update-tier2-weather'
--      );
--    $$);
--
--    Tier 3 (Rest ~17.000 Places): ON-DEMAND ONLY
--    Keine proaktiven Updates! Nur wenn User den Ort aufruft.
--
-- 4. Priority Tier Recalculation (wöchentlich):
--    SELECT cron.schedule('recalculate-tiers', '0 2 * * 0', $$
--      UPDATE places SET priority_tier = CASE
--        WHEN favourite_count >= 50 OR access_count >= 1000 THEN 1
--        WHEN favourite_count >= 10 OR access_count >= 100 THEN 2
--        ELSE 3
--      END;
--    $$);
--
-- ============================================================================
-- API CALL ESTIMATION mit Tiered System:
-- ============================================================================
-- Tier 1: 500 Places × 2 Updates/Tag = 1.000 Calls/Tag
-- Tier 2: 2.000 Places × 0.33 Updates/Tag = 666 Calls/Tag  
-- Tier 3: 17.000 Places × ~0.01 Updates/Tag = ~170 Calls/Tag (on-demand)
-- TOTAL: ~1.836 Calls/Tag
-- 
-- OpenWeatherMap Pro ($40/Monat): 60 Calls/Min = 86.400 Calls/Tag ✅
-- Oder: One Call Daily (1.000 Free + Pay per call danach)
-- ============================================================================

-- ============================================================================
-- END OF SCHEMA
-- ============================================================================
