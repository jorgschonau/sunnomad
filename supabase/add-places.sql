-- Add Places: Specific German cities + Top 10 from DE, FR, ES, PT, US, CA
-- Run in Supabase SQL Editor

-- Specific German cities (user requested)
INSERT INTO places (name_en, latitude, longitude, country_code, region, place_type, is_active) VALUES
  ('Wittstock', 53.1667, 12.4833, 'DE', 'europe', 'town', true),
  ('Neuruppin', 52.9167, 12.8000, 'DE', 'europe', 'town', true),
  ('Rheinsberg', 53.1000, 12.9000, 'DE', 'europe', 'town', true),
  ('Flensburg', 54.7833, 9.4333, 'DE', 'europe', 'city', true),
  ('Tarp', 54.6500, 9.4000, 'DE', 'europe', 'town', true),
  ('Oranienburg', 52.7542, 13.2364, 'DE', 'europe', 'town', true);

-- Top 10 Germany
INSERT INTO places (name_en, latitude, longitude, country_code, region, place_type, is_active) VALUES
  ('Berlin', 52.5200, 13.4050, 'DE', 'europe', 'city', true),
  ('Hamburg', 53.5511, 9.9937, 'DE', 'europe', 'city', true),
  ('Munich', 48.1351, 11.5820, 'DE', 'europe', 'city', true),
  ('Cologne', 50.9375, 6.9603, 'DE', 'europe', 'city', true),
  ('Frankfurt', 50.1109, 8.6821, 'DE', 'europe', 'city', true),
  ('Stuttgart', 48.7758, 9.1829, 'DE', 'europe', 'city', true),
  ('Düsseldorf', 51.2277, 6.7735, 'DE', 'europe', 'city', true),
  ('Dortmund', 51.5136, 7.4653, 'DE', 'europe', 'city', true),
  ('Essen', 51.4556, 7.0116, 'DE', 'europe', 'city', true),
  ('Leipzig', 51.3397, 12.3731, 'DE', 'europe', 'city', true)
;

-- Top 10 France
INSERT INTO places (name_en, latitude, longitude, country_code, region, place_type, is_active) VALUES
  ('Paris', 48.8566, 2.3522, 'FR', 'europe', 'city', true),
  ('Marseille', 43.2965, 5.3698, 'FR', 'europe', 'city', true),
  ('Lyon', 45.7640, 4.8357, 'FR', 'europe', 'city', true),
  ('Toulouse', 43.6047, 1.4442, 'FR', 'europe', 'city', true),
  ('Nice', 43.7102, 7.2620, 'FR', 'europe', 'city', true),
  ('Nantes', 47.2184, -1.5536, 'FR', 'europe', 'city', true),
  ('Strasbourg', 48.5734, 7.7521, 'FR', 'europe', 'city', true),
  ('Montpellier', 43.6108, 3.8767, 'FR', 'europe', 'city', true),
  ('Bordeaux', 44.8378, -0.5792, 'FR', 'europe', 'city', true),
  ('Lille', 50.6292, 3.0573, 'FR', 'europe', 'city', true)
;

-- Top 10 Spain
INSERT INTO places (name_en, latitude, longitude, country_code, region, place_type, is_active) VALUES
  ('Madrid', 40.4168, -3.7038, 'ES', 'europe', 'city', true),
  ('Barcelona', 41.3851, 2.1734, 'ES', 'europe', 'city', true),
  ('Valencia', 39.4699, -0.3763, 'ES', 'europe', 'city', true),
  ('Sevilla', 37.3891, -5.9845, 'ES', 'europe', 'city', true),
  ('Zaragoza', 41.6488, -0.8891, 'ES', 'europe', 'city', true),
  ('Málaga', 36.7213, -4.4214, 'ES', 'europe', 'city', true),
  ('Murcia', 37.9922, -1.1307, 'ES', 'europe', 'city', true),
  ('Palma', 39.5696, 2.6502, 'ES', 'europe', 'city', true),
  ('Las Palmas', 28.1000, -15.4130, 'ES', 'europe', 'city', true),
  ('Bilbao', 43.2630, -2.9350, 'ES', 'europe', 'city', true)
;

-- Top 10 Portugal
INSERT INTO places (name_en, latitude, longitude, country_code, region, place_type, is_active) VALUES
  ('Lisbon', 38.7223, -9.1393, 'PT', 'europe', 'city', true),
  ('Porto', 41.1579, -8.6291, 'PT', 'europe', 'city', true),
  ('Vila Nova de Gaia', 41.1239, -8.6118, 'PT', 'europe', 'city', true),
  ('Amadora', 38.7538, -9.2305, 'PT', 'europe', 'city', true),
  ('Braga', 41.5454, -8.4265, 'PT', 'europe', 'city', true),
  ('Setúbal', 38.5244, -8.8882, 'PT', 'europe', 'city', true),
  ('Coimbra', 40.2033, -8.4103, 'PT', 'europe', 'city', true),
  ('Queluz', 38.7564, -9.2542, 'PT', 'europe', 'city', true),
  ('Funchal', 32.6669, -16.9241, 'PT', 'europe', 'city', true),
  ('Cacém', 38.7667, -9.3000, 'PT', 'europe', 'city', true)
;

-- Top 10 USA
INSERT INTO places (name_en, latitude, longitude, country_code, region, place_type, is_active) VALUES
  ('New York', 40.7128, -74.0060, 'US', 'north_america', 'city', true),
  ('Los Angeles', 34.0522, -118.2437, 'US', 'north_america', 'city', true),
  ('Chicago', 41.8781, -87.6298, 'US', 'north_america', 'city', true),
  ('Houston', 29.7604, -95.3698, 'US', 'north_america', 'city', true),
  ('Phoenix', 33.4484, -112.0740, 'US', 'north_america', 'city', true),
  ('Philadelphia', 39.9526, -75.1652, 'US', 'north_america', 'city', true),
  ('San Antonio', 29.4241, -98.4936, 'US', 'north_america', 'city', true),
  ('San Diego', 32.7157, -117.1611, 'US', 'north_america', 'city', true),
  ('Dallas', 32.7767, -96.7970, 'US', 'north_america', 'city', true),
  ('San Jose', 37.3382, -121.8863, 'US', 'north_america', 'city', true)
;

-- Top 10 Canada
INSERT INTO places (name_en, latitude, longitude, country_code, region, place_type, is_active) VALUES
  ('Toronto', 43.6532, -79.3832, 'CA', 'north_america', 'city', true),
  ('Montreal', 45.5017, -73.5673, 'CA', 'north_america', 'city', true),
  ('Vancouver', 49.2827, -123.1207, 'CA', 'north_america', 'city', true),
  ('Calgary', 51.0447, -114.0719, 'CA', 'north_america', 'city', true),
  ('Edmonton', 53.5461, -113.4938, 'CA', 'north_america', 'city', true),
  ('Ottawa', 45.4215, -75.6972, 'CA', 'north_america', 'city', true),
  ('Winnipeg', 49.8951, -97.1384, 'CA', 'north_america', 'city', true),
  ('Quebec City', 46.8139, -71.2080, 'CA', 'north_america', 'city', true),
  ('Hamilton', 43.2557, -79.8711, 'CA', 'north_america', 'city', true),
  ('Kitchener', 43.4516, -80.4925, 'CA', 'north_america', 'city', true)
;

-- Summary
SELECT COUNT(*) as total_places FROM places;

