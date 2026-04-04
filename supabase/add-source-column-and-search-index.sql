-- Add source column to track where places came from
ALTER TABLE places ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'geonames';
-- Possible values: 'geonames', 'user_search', 'seed'

-- Enable pg_trgm for fuzzy/fast name search (if not already enabled)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Trigram index for fast ILIKE search on place names
CREATE INDEX IF NOT EXISTS idx_places_name_en_trgm ON places USING GIN (name_en gin_trgm_ops);
