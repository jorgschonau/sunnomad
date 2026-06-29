-- E-Mail bei neuem Feedback (Resend → hola@sunnomad.app)
-- Key setzen via: node scripts/setup-feedback-email.js

CREATE TABLE IF NOT EXISTS private_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

ALTER TABLE private_config ENABLE ROW LEVEL SECURITY;
-- No policies = only service role / SECURITY DEFINER functions can read

CREATE OR REPLACE FUNCTION send_feedback_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  resend_key text;
BEGIN
  SELECT value INTO resend_key FROM private_config WHERE key = 'resend_api_key';
  IF resend_key IS NULL OR btrim(resend_key) = '' THEN
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || resend_key,
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'from', 'SunNomad <feedback@sunnomad.app>',
      'to', jsonb_build_array('hola@sunnomad.app'),
      'subject', 'SunNomad Feedback from ' || CASE
        WHEN NEW.sender_email IS NOT NULL AND btrim(NEW.sender_email) <> ''
        THEN NEW.sender_email
        ELSE 'Anonymous'
      END,
      'text', CASE
        WHEN NEW.sender_email IS NOT NULL AND btrim(NEW.sender_email) <> ''
        THEN 'Von: ' || NEW.sender_email || E'\n\n' || NEW.message
        ELSE NEW.message
      END
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_feedback_send_email ON app_feedback;
CREATE TRIGGER on_feedback_send_email
  AFTER INSERT ON app_feedback
  FOR EACH ROW
  EXECUTE FUNCTION send_feedback_email();
