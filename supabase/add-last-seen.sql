ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS last_seen TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS app_open_count INTEGER DEFAULT 0;

CREATE OR REPLACE FUNCTION increment_app_open(uid UUID)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE profiles
  SET last_seen = NOW(),
      app_open_count = COALESCE(app_open_count, 0) + 1
  WHERE id = uid;
$$;
