-- Add stay_en to get_place_detail return so the app can do language-agnostic
-- keyword detection for camping link fallback logic.
-- Run this in the Supabase SQL editor to replace the existing function.

CREATE OR REPLACE FUNCTION get_place_detail(p_place_id uuid, p_lang text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_lang text;
  result json;
BEGIN
  v_lang := CASE WHEN p_lang IN ('de', 'fr') THEN p_lang ELSE 'en' END;

  SELECT json_build_object(
    'stay',              CASE v_lang WHEN 'de' THEN pc.stay_de WHEN 'fr' THEN pc.stay_fr ELSE pc.stay_en END,
    'stay_en',           pc.stay_en,
    'fact',              CASE v_lang WHEN 'de' THEN pc.fact_de WHEN 'fr' THEN pc.fact_fr ELSE pc.fact_en END,
    'when',              CASE v_lang WHEN 'de' THEN pc.when_de WHEN 'fr' THEN pc.when_fr ELSE pc.when_en END,
    'avoid',             CASE v_lang WHEN 'de' THEN pc.avoid_de WHEN 'fr' THEN pc.avoid_fr ELSE pc.avoid_en END,
    'entry_fee',         CASE v_lang WHEN 'de' THEN pc.entry_fee_de WHEN 'fr' THEN pc.entry_fee_fr ELSE pc.entry_fee_en END,
    'camping_link_1',    pc.camping_link_1,
    'camping_link_2',    pc.camping_link_2,
    'intro_en',          pc.intro_en,
    'intro_de',          pc.intro_de,
    'intro_fr',          pc.intro_fr,
    'vehicle_warning_en', pc.vehicle_warning_en,
    'vehicle_warning_de', pc.vehicle_warning_de,
    'vehicle_warning_fr', pc.vehicle_warning_fr,
    'seasonal_en',       pc.seasonal_en,
    'seasonal_de',       pc.seasonal_de,
    'seasonal_fr',       pc.seasonal_fr
  ) INTO result
  FROM place_content pc
  WHERE pc.place_id = p_place_id;

  RETURN result;
END;
$$;
