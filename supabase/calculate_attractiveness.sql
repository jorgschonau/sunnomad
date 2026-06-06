-- 2026-06-02: Attractiveness score recalculation
-- Run after bulk imports/enrichment. Only updates attractiveness_score (no raw column).

WITH schlafstaedte AS (
  SELECT p.id
  FROM places p
  WHERE p.place_type IN ('small_town', 'medium_town')
    AND p.terrain_type = 'flatland'
    AND p.population > 10000
    AND EXISTS (
      SELECT 1 FROM places big
      WHERE big.feature_code IN ('PPLC', 'PPLA')
        AND big.population > 200000
        AND big.id != p.id
        AND ST_Distance(p.geom::geography, big.geom::geography) / 1000 < 15
    )
)
UPDATE places p
SET attractiveness_score = LEAST(
    GREATEST(
      LEAST(
        CASE
          WHEN p.feature_code = 'PPLC'  THEN 95
          WHEN p.feature_code = 'PPLA'  THEN 80
          WHEN p.feature_code = 'PPLA2' THEN 75
          WHEN p.feature_code = 'PPLA3' THEN 65
          WHEN p.feature_code = 'PPLA4' THEN 58
          WHEN p.place_type = 'city'           THEN 80
          WHEN p.place_type = 'medium_town'    THEN 70
          WHEN p.place_type = 'small_town'     THEN 55
          WHEN p.place_type = 'village'        THEN 45
          WHEN p.place_type = 'national_park'  THEN 78
          WHEN p.place_type = 'natural_park'   THEN 70
          WHEN p.place_type = 'nature_reserve' THEN 72
          WHEN p.place_type = 'beach'          THEN 75
          WHEN p.place_type = 'mountain'       THEN 60
          WHEN p.place_type = 'scenic_drive'   THEN 65
          ELSE 35
        END
        + (CASE
            WHEN p.place_type IN ('small_town', 'medium_town', 'village', 'mountain')
              AND (p.feature_code IS NULL OR p.feature_code NOT IN ('PPLC', 'PPLA'))
              AND p.terrain_type NOT IN ('desert', 'high_mountains')
              AND p.dem > 0
            THEN (CASE
              WHEN p.dem BETWEEN 800  AND 1800 THEN 15
              WHEN p.dem BETWEEN 500  AND 800  THEN 10
              WHEN p.dem BETWEEN 1800 AND 2500 THEN 5
              ELSE 0 END)
            * (CASE WHEN p.country_code NOT IN ('DE', 'CH', 'AT', 'IT', 'ES', 'FR') THEN 0.4 ELSE 1.0 END)
            ELSE 0 END)
        + (CASE WHEN p.is_island = true AND p.place_type != 'beach' THEN 8 ELSE 0 END)
        + (CASE WHEN p.terrain_type = 'coastal'
            AND p.place_type IN ('city', 'small_town', 'village', 'medium_town', 'beach')
            THEN 8 ELSE 0 END)
        + (CASE WHEN p.terrain_type = 'lake'    THEN 5 ELSE 0 END)
        + (CASE WHEN p.terrain_type = 'desert'  THEN 6 ELSE 0 END)
        + (CASE WHEN p.terrain_type = 'hills'
            THEN 3 * (CASE
              WHEN p.country_code IN ('GT', 'BZ')                    THEN 0.0
              WHEN p.country_code IN ('MX', 'TR', 'RO', 'BA', 'GR') THEN 0.4
              ELSE 1.0 END)
            ELSE 0 END)
        + (CASE WHEN p.terrain_type = 'flatland'
            AND p.place_type NOT IN ('national_park', 'natural_park', 'nature_reserve', 'scenic_drive')
            THEN -5 ELSE 0 END)
        + (CASE WHEN p.place_type = 'beach' AND p.terrain_type = 'lake' THEN -15 ELSE 0 END)
        + (CASE
            WHEN p.population > 50000
            AND p.place_type IN ('medium_town', 'small_town')
            AND p.terrain_type = 'flatland'
            AND (p.feature_code IS NULL OR p.feature_code NOT IN ('PPLC', 'PPLA'))
            THEN -8 ELSE 0 END)
        + (CASE
            WHEN p.place_type = 'village'
            AND p.population > 0 AND p.population < 100
            AND p.terrain_type NOT IN ('high_mountains', 'mountains')
            THEN -8
            WHEN p.place_type = 'village'
            AND p.population > 0 AND p.population < 300
            AND p.terrain_type NOT IN ('high_mountains', 'mountains')
            THEN -4
            ELSE 0 END)
        + (CASE WHEN p.id IN (SELECT id FROM schlafstaedte) THEN -6 ELSE 0 END)
        + (CASE
            WHEN p.ferry_minutes IS NULL THEN 0
            WHEN p.ferry_minutes = 0     THEN 0
            WHEN p.ferry_minutes <= 60   THEN -3
            WHEN p.ferry_minutes <= 180  THEN -10
            WHEN p.ferry_minutes <= 480  THEN -18
            ELSE -25 END),
        100
      )
      + COALESCE(p.manual_adjustment, 0),
      0
    ),
    100
  )::INTEGER
WHERE p.is_active = true;
