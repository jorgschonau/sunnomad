-- Komplette Score-Berechnung in einem Statement
UPDATE places
SET 
  attractiveness_score_raw = LEAST(
    CASE 
      WHEN place_type = 'large_city' THEN 85
      WHEN place_type = 'city' THEN 80
      WHEN place_type = 'medium_city' THEN 70
      WHEN place_type = 'town' THEN 62
      WHEN place_type = 'small_town' THEN 55
      WHEN place_type = 'village' THEN 45
      WHEN place_type = 'national_park' THEN 78
      WHEN place_type = 'natural_park' THEN 70
      WHEN place_type = 'nature_reserve' THEN 65
      WHEN place_type = 'beach' THEN 75
      WHEN place_type = 'mountain' THEN 60
      WHEN feature_code = 'PPLC' THEN 95
      WHEN feature_code = 'PPLA' THEN 85
      ELSE 35
    END
    -- Elevation Bonus nur für kleine Orte, per DEM
    + (CASE
        WHEN place_type IN ('small_town', 'village', 'town') THEN
          CASE
            WHEN dem BETWEEN 800 AND 1800 THEN 15
            WHEN dem BETWEEN 500 AND 800 THEN 10
            WHEN dem BETWEEN 1800 AND 2500 THEN 5
            ELSE 0
          END
        ELSE 0
      END)
    -- Island Boost (nicht für beach, die haben schon 75)
    + (CASE 
        WHEN is_island = true AND place_type != 'beach' THEN 8 
        ELSE 0 
      END),
    100
  ),
  attractiveness_score = LEAST(
    GREATEST(
      LEAST(
        CASE 
          WHEN place_type = 'large_city' THEN 85
          WHEN place_type = 'city' THEN 80
          WHEN place_type = 'medium_city' THEN 70
          WHEN place_type = 'town' THEN 62
          WHEN place_type = 'small_town' THEN 55
          WHEN place_type = 'village' THEN 45
          WHEN place_type = 'national_park' THEN 78
          WHEN place_type = 'natural_park' THEN 70
          WHEN place_type = 'nature_reserve' THEN 65
          WHEN place_type = 'beach' THEN 75
          WHEN place_type = 'mountain' THEN 60
          WHEN feature_code = 'PPLC' THEN 95
          WHEN feature_code = 'PPLA' THEN 85
          ELSE 35
        END
        + (CASE
            WHEN place_type IN ('small_town', 'village', 'town') THEN
              CASE
                WHEN dem BETWEEN 800 AND 1800 THEN 15
                WHEN dem BETWEEN 500 AND 800 THEN 10
                WHEN dem BETWEEN 1800 AND 2500 THEN 5
                ELSE 0
              END
            ELSE 0
          END)
        + (CASE 
            WHEN is_island = true AND place_type != 'beach' THEN 8 
            ELSE 0 
          END),
        100
      )
      + COALESCE(manual_adjustment, 0),
      0
    ),
    100
  )
WHERE is_active = true;