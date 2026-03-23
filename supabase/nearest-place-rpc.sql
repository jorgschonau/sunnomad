CREATE OR REPLACE FUNCTION nearest_place(user_lat float, user_lon float, max_distance_km float)
RETURNS SETOF places AS $$
  SELECT p.*
  FROM places p
  WHERE p.is_active = true
    AND (6371 * acos(
      cos(radians(user_lat)) * cos(radians(p.latitude)) *
      cos(radians(p.longitude) - radians(user_lon)) +
      sin(radians(user_lat)) * sin(radians(p.latitude))
    )) <= max_distance_km
  ORDER BY
    (6371 * acos(
      cos(radians(user_lat)) * cos(radians(p.latitude)) *
      cos(radians(p.longitude) - radians(user_lon)) +
      sin(radians(user_lat)) * sin(radians(p.latitude))
    ))
  LIMIT 1;
$$ LANGUAGE sql;
