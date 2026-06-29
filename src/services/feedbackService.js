import { supabase } from '../config/supabase';

/** Saves feedback; DB trigger sends email to hola@sunnomad.app when Resend is configured. */
export const submitFeedback = async ({ message, senderEmail, userId }) => {
  const { error } = await supabase.from('app_feedback').insert({
    message: message.trim(),
    sender_email: senderEmail?.trim() || null,
    user_id: userId || null,
  });

  return { error };
};
