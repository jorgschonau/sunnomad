UPDATE places
SET 
  attractiveness_score_raw = LEAST(
    CASE 
      WHEN feature_code = 'PPLC'  THEN 95
      WHEN feature_code = 'PPLA'  THEN 80
      WHEN feature_code = 'PPLA2' THEN 75
      WHEN feature_code = 'PPLA3' THEN 65
      WHEN feature_code = 'PPLA4' THEN 58
      WHEN place_type = 'city'           THEN 80
      WHEN place_type = 'medium_town'    THEN 70
      WHEN place_type = 'small_town'     THEN 55
      WHEN place_type = 'village'        THEN 45
      WHEN place_type = 'national_park'  THEN 78
      WHEN place_type = 'natural_park'   THEN 70
      WHEN place_type = 'nature_reserve' THEN 72
      WHEN place_type = 'beach'          THEN 75
      WHEN place_type = 'mountain'       THEN 60
      WHEN place_type = 'scenic_drive'   THEN 65
      ELSE 35
    END
    -- Elevation (nicht bei desert)
    + (CASE
        WHEN place_type IN ('small_town', 'medium_town', 'village')
          AND feature_code NOT IN ('PPLC', 'PPLA')
          AND terrain_type != 'desert'
        THEN CASE
          WHEN dem BETWEEN 800  AND 1800 THEN 15
          WHEN dem BETWEEN 500  AND 800  THEN 10
          WHEN dem BETWEEN 1800 AND 2500 THEN 5
          ELSE 0 END
        ELSE 0 END)
    + (CASE WHEN is_island = true AND place_type != 'beach' THEN 8 ELSE 0 END)
    -- Coastal nur kleine Orte
    + (CASE WHEN terrain_type = 'coastal'
        AND place_type IN ('small_town', 'village', 'medium_town', 'beach')
        THEN 8 ELSE 0 END)
    + (CASE WHEN terrain_type = 'lake'    THEN 5 ELSE 0 END)
    + (CASE WHEN terrain_type = 'desert'  THEN 6 ELSE 0 END)
    + (CASE WHEN terrain_type = 'hills'   THEN 3 ELSE 0 END)
    + (CASE WHEN terrain_type = 'flatland' THEN -5 ELSE 0 END)
    + (CASE WHEN place_type = 'beach' AND terrain_type = 'lake' THEN -15 ELSE 0 END)
    + (CASE 
        WHEN population > 50000 
        AND place_type IN ('medium_town', 'small_town')
        AND terrain_type = 'flatland'
        AND feature_code NOT IN ('PPLC', 'PPLA')
        THEN -8 ELSE 0 END)
    -- ferry_minutes Malus
    + (CASE
        WHEN ferry_minutes IS NULL THEN 0
        WHEN ferry_minutes = 0     THEN 0
        WHEN ferry_minutes <= 60   THEN -3
        WHEN ferry_minutes <= 180  THEN -10
        WHEN ferry_minutes <= 480  THEN -18
        ELSE -25 END),
    100
  ),
  attractiveness_score = LEAST(
    GREATEST(
      LEAST(
        CASE 
          WHEN feature_code = 'PPLC'  THEN 95
          WHEN feature_code = 'PPLA'  THEN 80
          WHEN feature_code = 'PPLA2' THEN 75
          WHEN feature_code = 'PPLA3' THEN 65
          WHEN feature_code = 'PPLA4' THEN 58
          WHEN place_type = 'city'           THEN 80
          WHEN place_type = 'medium_town'    THEN 70
          WHEN place_type = 'small_town'     THEN 55
          WHEN place_type = 'village'        THEN 45
          WHEN place_type = 'national_park'  THEN 78
          WHEN place_type = 'natural_park'   THEN 70
          WHEN place_type = 'nature_reserve' THEN 72
          WHEN place_type = 'beach'          THEN 75
          WHEN place_type = 'mountain'       THEN 60
          WHEN place_type = 'scenic_drive'   THEN 65
          ELSE 35
        END
        + (CASE
            WHEN place_type IN ('small_town', 'medium_town', 'village')
              AND feature_code NOT IN ('PPLC', 'PPLA')
              AND terrain_type != 'desert'
            THEN CASE
              WHEN dem BETWEEN 800  AND 1800 THEN 15
              WHEN dem BETWEEN 500  AND 800  THEN 10
              WHEN dem BETWEEN 1800 AND 2500 THEN 5
              ELSE 0 END
            ELSE 0 END)
        + (CASE WHEN is_island = true AND place_type != 'beach' THEN 8 ELSE 0 END)
        + (CASE WHEN terrain_type = 'coastal'
            AND place_type IN ('small_town', 'village', 'medium_town', 'beach')
            THEN 8 ELSE 0 END)
        + (CASE WHEN terrain_type = 'lake'    THEN 5 ELSE 0 END)
        + (CASE WHEN terrain_type = 'desert'  THEN 6 ELSE 0 END)
        + (CASE WHEN terrain_type = 'hills'   THEN 3 ELSE 0 END)
        + (CASE WHEN terrain_type = 'flatland' THEN -5 ELSE 0 END)
        + (CASE WHEN place_type = 'beach' AND terrain_type = 'lake' THEN -15 ELSE 0 END)
        + (CASE 
            WHEN population > 50000 
            AND place_type IN ('medium_town', 'small_town')
            AND terrain_type = 'flatland'
            AND feature_code NOT IN ('PPLC', 'PPLA')
            THEN -8 ELSE 0 END)
        + (CASE
            WHEN ferry_minutes IS NULL THEN 0
            WHEN ferry_minutes = 0     THEN 0
            WHEN ferry_minutes <= 60   THEN -3
            WHEN ferry_minutes <= 180  THEN -10
            WHEN ferry_minutes <= 480  THEN -18
            ELSE -25 END),
        100
      )
      + COALESCE(manual_adjustment, 0),
      0
    ),
    100
  )
WHERE is_active = true;