-- Komplette Score-Berechnung in einem Statement
UPDATE places
SET attractiveness_score = 
  CASE 
    -- CAPITALS & MAJOR ADMIN
    WHEN feature_code = 'P.PPLC' THEN 95
    WHEN feature_code = 'P.PPLA' THEN 85
    
    -- BEWOHNTE ORTE (Population + Elevation Bonus)
    WHEN feature_code = 'P.PPL' THEN
      -- Population Base Score
      (CASE
        WHEN population >= 1000000 THEN 90
        WHEN population >= 500000 THEN 80
        WHEN population >= 250000 THEN 75
        WHEN population >= 100000 THEN 70
        WHEN population >= 50000 THEN 65
        WHEN population >= 25000 THEN 60
        WHEN population >= 10000 THEN 55
        WHEN population >= 5000 THEN 50
        WHEN population >= 2000 THEN 45
        ELSE 40
      END)
      -- PLUS Elevation Bonus
      + (CASE
          WHEN dem BETWEEN 800 AND 1800 THEN 15  -- Alpen Sweet Spot
          WHEN dem BETWEEN 500 AND 800 THEN 10   -- Hügelig
          WHEN dem BETWEEN 1800 AND 2500 THEN 5  -- Hochgebirge
          ELSE 0
        END)
    
    -- NATUR POIs
    WHEN feature_code = 'L.RESN' THEN 65  -- Naturreservat
    WHEN feature_code = 'H.LK' THEN 60    -- See
    WHEN feature_code = 'H.BAY' THEN 55   -- Bucht
    WHEN feature_code = 'L.PRK' THEN 50   -- Park
    WHEN feature_code = 'V.FRST' THEN 45  -- Wald
    
    -- BERGE (Elevation-abhängig)
    WHEN feature_code IN ('T.MT', 'T.PK') THEN
      CASE
        WHEN dem > 2500 THEN 70
        WHEN dem > 1500 THEN 60
        WHEN dem > 800 THEN 50
        ELSE 40
      END
    
    -- CUSTOM POI TYPES (überschreibt Feature Code falls gesetzt)
    WHEN poi_type = 'national_park' THEN 75
    WHEN poi_type = 'ski_resort' THEN 70
    WHEN poi_type = 'beach' THEN 65
    WHEN poi_type = 'lake' THEN 60
    
    -- DEFAULT
    ELSE 35
  END
  + COALESCE(custom_modifier, 0);  -- Custom Modifier immer drauf