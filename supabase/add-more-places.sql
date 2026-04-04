-- Add More Places (User requested, duplicates removed)
-- Run in Supabase SQL Editor

-- European Cities (NEW)
INSERT INTO places (name_en, latitude, longitude, country_code, region, place_type, is_active) VALUES
  ('London', 51.5074, -0.1278, 'GB', 'europe', 'city', true),
  ('Palermo', 38.1157, 13.3615, 'IT', 'europe', 'city', true),
  ('Naples', 40.8518, 14.2681, 'IT', 'europe', 'city', true),
  ('Athens', 37.9838, 23.7275, 'GR', 'europe', 'city', true),
  ('Marbella', 36.5101, -4.8824, 'ES', 'europe', 'city', true),
  ('Monaco', 43.7384, 7.4246, 'MC', 'europe', 'city', true),
  ('Geneva', 46.2044, 6.1432, 'CH', 'europe', 'city', true),
  ('Batumi', 41.6168, 41.6367, 'GE', 'europe', 'city', true),
  ('Riga', 56.9496, 24.1052, 'LV', 'europe', 'city', true),
  ('Split', 43.5081, 16.4402, 'HR', 'europe', 'city', true),
  ('Oslo', 59.9139, 10.7522, 'NO', 'europe', 'city', true),
  ('Sylt', 54.9079, 8.3369, 'DE', 'europe', 'beach', true);

-- US Cities (NEW - duplicates removed)
INSERT INTO places (name_en, latitude, longitude, country_code, region, place_type, is_active) VALUES
  ('Oahu', 21.4389, -158.0001, 'US', 'north_america', 'beach', true),
  ('Las Vegas', 36.1699, -115.1398, 'US', 'north_america', 'city', true),
  ('Florida Keys', 24.7110, -81.0529, 'US', 'north_america', 'beach', true),
  ('New Orleans', 29.9511, -90.0715, 'US', 'north_america', 'city', true),
  ('Nashville', 36.1627, -86.7816, 'US', 'north_america', 'city', true),
  ('Charleston', 32.7765, -79.9311, 'US', 'north_america', 'city', true),
  ('West Palm Beach', 26.7153, -80.0534, 'US', 'north_america', 'city', true),
  ('Santa Barbara', 34.4208, -119.6982, 'US', 'north_america', 'city', true),
  ('Cleveland', 41.4993, -81.6944, 'US', 'north_america', 'city', true),
  ('Kansas City', 39.0997, -94.5786, 'US', 'north_america', 'city', true),
  ('Memphis', 35.1495, -90.0490, 'US', 'north_america', 'city', true),
  ('Park City', 40.6461, -111.4980, 'US', 'north_america', 'mountain', true),
  ('Juneau', 58.3019, -134.4197, 'US', 'north_america', 'city', true),
  ('Brooklyn', 40.6782, -73.9442, 'US', 'north_america', 'city', true),
  ('Hilton Head', 32.2163, -80.7526, 'US', 'north_america', 'beach', true),
  ('Savannah', 32.0809, -81.0912, 'US', 'north_america', 'city', true),
  ('Asheville', 35.5951, -82.5515, 'US', 'north_america', 'city', true),
  ('Portland', 43.6591, -70.2568, 'US', 'north_america', 'city', true);

-- European Beaches (NEW)
INSERT INTO places (name_en, latitude, longitude, country_code, region, place_type, is_active) VALUES
  ('Elafonissi Beach', 35.2710, 23.5397, 'GR', 'europe', 'beach', true),
  ('Praia da Falésia', 37.0879, -8.1847, 'PT', 'europe', 'beach', true),
  ('Platja de Muro', 39.7894, 3.1058, 'ES', 'europe', 'beach', true),
  ('Myrtos Beach', 38.3426, 20.5411, 'GR', 'europe', 'beach', true),
  ('Spiaggia dei Conigli', 35.5186, 12.5722, 'IT', 'europe', 'beach', true),
  ('Playa de Maspalomas', 27.7410, -15.5860, 'ES', 'europe', 'beach', true),
  ('Plage de Palombaggia', 41.6056, 9.3558, 'FR', 'europe', 'beach', true),
  ('Tropea Beach', 38.6736, 15.8983, 'IT', 'europe', 'beach', true),
  ('Bournemouth Beach', 50.7192, -1.8808, 'GB', 'europe', 'beach', true),
  ('Balos Lagoon', 35.5926, 23.5877, 'GR', 'europe', 'beach', true),
  ('La Concha Beach', 43.3210, -1.9867, 'ES', 'europe', 'beach', true);

-- US Beaches (NEW)
INSERT INTO places (name_en, latitude, longitude, country_code, region, place_type, is_active) VALUES
  ('Siesta Beach', 27.2636, -82.5487, 'US', 'north_america', 'beach', true),
  ('Poipu Beach', 21.8761, -159.4470, 'US', 'north_america', 'beach', true),
  ('Kaanapali Beach', 20.9261, -156.6942, 'US', 'north_america', 'beach', true),
  ('La Jolla Cove', 32.8509, -117.2713, 'US', 'north_america', 'beach', true),
  ('Waikiki Beach', 21.2793, -157.8294, 'US', 'north_america', 'beach', true),
  ('Clearwater Beach', 27.9659, -82.8001, 'US', 'north_america', 'beach', true),
  ('Driftwood Beach', 31.0689, -81.4254, 'US', 'north_america', 'beach', true),
  ('Punaluu Black Sand Beach', 19.1378, -155.5038, 'US', 'north_america', 'beach', true);

-- European National Parks (NEW)
INSERT INTO places (name_en, latitude, longitude, country_code, region, place_type, is_active) VALUES
  ('Plitvice Lakes', 44.8654, 15.5820, 'HR', 'europe', 'poi', true),
  ('Killarney National Park', 52.0116, -9.5675, 'IE', 'europe', 'poi', true),
  ('Timanfaya National Park', 29.0321, -13.7598, 'ES', 'europe', 'poi', true),
  ('Parc National des Calanques', 43.2095, 5.4467, 'FR', 'europe', 'poi', true),
  ('Hohe Tauern National Park', 47.0752, 12.7097, 'AT', 'europe', 'mountain', true),
  ('Teide National Park', 28.2723, -16.6418, 'ES', 'europe', 'mountain', true),
  ('Vatnajokull National Park', 64.4167, -16.8167, 'IS', 'europe', 'poi', true),
  ('Cinque Terre', 44.1271, 9.7044, 'IT', 'europe', 'poi', true),
  ('Bialowieza National Park', 52.7333, 23.8667, 'PL', 'europe', 'poi', true),
  ('Cairngorms National Park', 57.0833, -3.6667, 'GB', 'europe', 'mountain', true);

-- US National Parks (NEW)
INSERT INTO places (name_en, latitude, longitude, country_code, region, place_type, is_active) VALUES
  ('Yellowstone', 44.4280, -110.5885, 'US', 'north_america', 'poi', true),
  ('Yosemite', 37.8651, -119.5383, 'US', 'north_america', 'mountain', true),
  ('Grand Canyon', 36.1069, -112.1129, 'US', 'north_america', 'poi', true);

-- Summary
SELECT 
  region,
  place_type,
  COUNT(*) as count
FROM places
GROUP BY region, place_type
ORDER BY region, place_type;

SELECT COUNT(*) as total_places FROM places;

