-- Returns whether an email is registered (for forgot-password UX).
-- Run once in Supabase SQL Editor.

CREATE OR REPLACE FUNCTION public.check_email_registered(email_input text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = auth, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM auth.users
    WHERE lower(email) = lower(trim(email_input))
  );
$$;

REVOKE ALL ON FUNCTION public.check_email_registered(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_email_registered(text) TO anon, authenticated;
